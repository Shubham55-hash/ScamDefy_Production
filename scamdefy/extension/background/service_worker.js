import ENV from '../config/env.js';
import { handleMessage } from './messageRouter.js';
import { runAllHealthChecks } from './healthCheck.js';
import { validateConfig } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Time to wait for a scan result before allowing navigation and injecting a
// "still scanning" banner. Increase if your backend is slow; decrease for
// snappier UX.
const SCAN_TIMEOUT_MS = 4000;

// In-flight scan promises keyed by tabId.
// onBeforeNavigate starts the scan early; onCommitted reuses the promise
// instead of firing a second redundant request.
const pendingScans = new Map();

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[ScamDefy] Extension Installed. Running setup...");

  const configStatus = validateConfig();
  console.log("[ScamDefy] Config Valid:", configStatus.valid, configStatus.missing);

  await runAllHealthChecks();

  // Repeating alarm keeps health checks running after the service worker sleeps
  chrome.alarms.create("healthCheckAlarm", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "healthCheckAlarm") {
    await runAllHealthChecks();
  }
});

// Pass extension popup messages to the router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.toString() }));
  return true; // keep message channel open for async response
});

// ---------------------------------------------------------------------------
// URL skip helper
// Centralised so both navigation listeners use the same filter logic.
// ---------------------------------------------------------------------------

function shouldSkipUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.includes('localhost') ||
    url.includes('127.0.0.1')
  );
}

// ---------------------------------------------------------------------------
// Primary listener: onBeforeNavigate
// Fires BEFORE the page starts loading — early enough to start a scan
// without racing against the page render. The result is stored in
// pendingScans so onCommitted can reuse it and avoid a duplicate request.
//
// NOTE: Do NOT use onCompleted here — it fires after full page render,
// which is too late for any meaningful interception.
// ---------------------------------------------------------------------------

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  const url = details.url;
  if (shouldSkipUrl(url)) return;

  // Check whitelist BEFORE firing any backend scan to avoid unnecessary calls
  const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
  if (whitelist.includes(url)) return;

  // Start scan immediately and stash the promise for onCommitted to reuse
  const scanPromise = handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
  pendingScans.set(details.tabId, { promise: scanPromise, url });
});

// ---------------------------------------------------------------------------
// Fallback listener: onCommitted
// Handles JS navigations, form submissions, and pushState changes where
// onBeforeNavigate may not fire. If a pending scan already exists for this
// tabId+url pair, reuses it instead of firing a duplicate request.
//
// Uses Promise.race to enforce SCAN_TIMEOUT_MS: if the backend is slow,
// a neutral "SCANNING" banner is shown immediately while we await the result.
// ---------------------------------------------------------------------------

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (shouldSkipUrl(url)) return;

  // Consume the pending scan (if any) regardless of whether we use it,
  // to avoid memory leaks from abandoned promises
  const pending = pendingScans.get(details.tabId);
  pendingScans.delete(details.tabId);

  let scanPromise;
  if (pending && pending.url === url) {
    // Reuse the already-started scan from onBeforeNavigate
    scanPromise = pending.promise;
  } else {
    // onBeforeNavigate didn't fire (e.g. pushState navigation) — start now
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (whitelist.includes(url)) return;
    scanPromise = handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
  }

  // Race the scan against a timeout so slow backends don't block the UX
  const timeoutPromise = new Promise(resolve =>
    setTimeout(() => resolve({ timedOut: true }), SCAN_TIMEOUT_MS)
  );

  const outcome = await Promise.race([scanPromise, timeoutPromise]);

  if (outcome.timedOut) {
    // Show a neutral "still scanning" banner and continue waiting
    injectBanner(details.tabId, {
      verdict: 'SCANNING',
      score: null,
      url,
      color: '#6b7280',
    });
    const result = await scanPromise;
    handleScanResult(details.tabId, url, result);
    return;
  }

  handleScanResult(details.tabId, url, outcome);
});

// ---------------------------------------------------------------------------
// handleScanResult — acts on the completed scan
// Score bands:
//   >= 80  → BLOCKED: hard redirect to warning page (data embedded in URL)
//   60–79  → DANGER: orange inline banner, no redirect
//   30–59  → CAUTION: yellow informational banner, no redirect
//    < 30  → SAFE: do nothing
// ---------------------------------------------------------------------------

async function handleScanResult(tabId, url, scanResponse) {
  // If scan failed (backend down / network error) — show a visible grey
  // warning banner instead of silently doing nothing.
  if (!scanResponse?.success || !scanResponse?.data) {
    injectBanner(tabId, {
      verdict: 'ERROR',
      score: null,
      url,
      color: '#94a3b8',
    });
    return;
  }

  const result = scanResponse.data;

  // Persist scan data for the popup history feature
  chrome.storage.local.set({ [`scan_${url}`]: result });

  if (result.score >= 80) {
    // Embed scan data in redirect URL — avoids storage race condition
    // where storage was written AFTER redirect so warning.js read empty storage.
    const encoded    = btoa(JSON.stringify(result));
    const warningUrl = chrome.runtime.getURL(
      `ui/warning.html?url=${encodeURIComponent(url)}&data=${encoded}`
    );
    chrome.tabs.update(tabId, { url: warningUrl });

  } else if (result.score >= 60) {
    injectBanner(tabId, {
      verdict: result.verdict,
      score:   result.score,
      url,
      color:   '#f97316',
    });

  } else if (result.score >= 30) {
    injectBanner(tabId, {
      verdict: result.verdict,
      score:   result.score,
      url,
      color:   '#f59e0b',
    });
  }
  // score < 30 = SAFE — do nothing, no UI disruption
}

// ---------------------------------------------------------------------------
// injectBanner — executes warningBanner.js in the target tab, then calls
// the exposed window.__scamdefyShowBanner function with the banner args.
// Two-step injection is required because executeScript files[] and func
// execute in separate worlds — we must inject the script first, then call
// the function it registered on window.
// ---------------------------------------------------------------------------

async function injectBanner(tabId, args) {
  try {
    // Step 1: inject the banner script into the page's world
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/warningBanner.js'],
    });
    // Step 2: call the function registered by the script
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (bannerArgs) => window.__scamdefyShowBanner(bannerArgs),
      args: [args],
    });
  } catch (e) {
    // Injection fails on chrome:// pages, PDFs, etc. — silently ignore
    console.warn('[ScamDefy] Banner injection failed:', e);
  }
}
