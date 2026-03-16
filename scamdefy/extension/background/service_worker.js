import ENV from '../config/env.js';
import { handleMessage } from './messageRouter.js';
import { runAllHealthChecks } from './healthCheck.js';
import { validateConfig } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCAN_TIMEOUT_MS = 5000;

// Result cache — prevents double-scanning same URL within 10 seconds
const scanCache = new Map();
const CACHE_TTL_MS = 10000;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ScamDefy] Extension installed. Running setup...');
  const configStatus = validateConfig();
  console.log('[ScamDefy] Config valid:', configStatus.valid, configStatus.missing);
  await runAllHealthChecks();
  chrome.alarms.create('healthCheckAlarm', { periodInMinutes: 30 });
  chrome.alarms.create('cacheCleanup', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheckAlarm') {
    await runAllHealthChecks();
  }
  if (alarm.name === 'cacheCleanup') {
    const now = Date.now();
    for (const [url, entry] of scanCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) scanCache.delete(url);
    }
  }
});

// ---------------------------------------------------------------------------
// Message listener — popup + content scripts
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.toString() }));
  return true;
});

// ---------------------------------------------------------------------------
// URL skip helper
// ---------------------------------------------------------------------------

function shouldSkipUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('data:') ||
    url.includes('localhost') ||
    url.includes('127.0.0.1')
  );
}

// ---------------------------------------------------------------------------
// STEP 1 — Pre-fetch scan the moment navigation begins (onBeforeNavigate)
//
// Starts the backend scan BEFORE the page renders so the result is cached
// and ready when tabs.onUpdated fires at page-complete (~1–4 seconds later).
// ---------------------------------------------------------------------------

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (shouldSkipUrl(url) || url.includes('ui/warning.html')) return;

  const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
  if (whitelist.includes(url)) return;

  // Skip if already cached recently
  const cached = scanCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return;

  console.log('[ScamDefy] ⚡ Pre-fetching scan for:', url);
  try {
    const result = await handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
    if (result) {
      scanCache.set(url, { result, timestamp: Date.now() });
    }
  } catch (err) {
    // Silent — tabs.onUpdated will retry
  }
}, { url: [{ schemes: ['http', 'https'] }] });

// ---------------------------------------------------------------------------
// STEP 2 — Act when tab fully loads (tabs.onUpdated, status='complete')
//
// This is the same trigger used by ScamDefy-main. By the time this fires,
// the pre-fetch above has already completed and the scan result is cached.
// We check the result and redirect the tab to warning.html if needed.
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when page fully loads
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || shouldSkipUrl(tab.url)) return;

  const url = tab.url;

  // Never redirect the warning page itself (would cause infinite loop)
  if (url.includes('ui/warning.html')) return;

  // Respect whitelist
  const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
  if (whitelist.includes(url)) return;

  // Use pre-fetched cached result if available
  const cached = scanCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[ScamDefy] ✓ Using pre-fetched result for:', url);
    await handleScanResult(tabId, url, cached.result);
    return;
  }

  // Cache miss — scan now with timeout
  console.log('[ScamDefy] 🔍 Scanning (no pre-fetch cache):', url);
  try {
    const scanPromise = handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ timedOut: true }), SCAN_TIMEOUT_MS)
    );

    const outcome = await Promise.race([scanPromise, timeoutPromise]);

    if (outcome.timedOut) {
      console.warn('[ScamDefy] Scan timed out for:', url);
      return;
    }

    scanCache.set(url, { result: outcome, timestamp: Date.now() });
    await handleScanResult(tabId, url, outcome);

  } catch (err) {
    console.error('[ScamDefy] Scan error for', url, err);
  }
});

// ---------------------------------------------------------------------------
// handleScanResult
//
// Score bands — matching backend risk_service.py thresholds:
//   should_block === true  OR  score >= 60  →  redirect to warning.html
//   score >= 30                             →  yellow inline banner only
//   score <  30                             →  safe, do nothing
// ---------------------------------------------------------------------------

async function handleScanResult(tabId, url, scanResponse) {
  if (!scanResponse?.success || !scanResponse?.data) {
    console.warn('[ScamDefy] No scan data for:', url);
    return;
  }

  const result = scanResponse.data;

  // Persist to storage so popup.js can read it
  chrome.storage.local.set({ [`scan_${url}`]: result });

  // Block if backend says so OR score is high enough
  const shouldBlock = result.should_block === true || result.score >= 60;

  if (shouldBlock) {
    console.log(`[ScamDefy] 🚨 BLOCKING — score: ${result.score}, verdict: ${result.verdict}`);

    // Build warning URL — encode full scan result as base64 so warning.js
    // can render instantly without waiting for storage (eliminates race condition)
    const encoded = btoa(JSON.stringify(result));
    const warningUrl = chrome.runtime.getURL(
      `ui/warning.html?url=${encodeURIComponent(url)}&data=${encoded}`
    );

    try {
      await chrome.tabs.update(tabId, { url: warningUrl });
    } catch (err) {
      console.warn('[ScamDefy] Could not redirect tab (may have been closed):', err.message);
    }

    // Red badge
    try {
      await chrome.action.setBadgeText({ text: '!', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
    } catch (e) { /* tab may be gone */ }

    // Browser notification
    try {
      chrome.notifications.create(`threat_${tabId}_${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: `🚨 Threat Blocked — ${result.scam_type || result.verdict}`,
        message: `Risk Score: ${result.score}/100\n${(result.flags || []).slice(0, 2).join(', ') || 'Multiple threat signals detected'}`,
        priority: 2,
      });
    } catch (e) { /* notifications permission may be absent */ }

  } else if (result.score >= 30) {
    console.log(`[ScamDefy] ⚠️ Caution — score: ${result.score}`);
    injectBanner(tabId, {
      verdict: result.verdict,
      score: result.score,
      url,
      color: '#f59e0b',
    });
    try {
      await chrome.action.setBadgeText({ text: '?', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId });
    } catch (e) { /* ignore */ }

  } else {
    console.log(`[ScamDefy] ✅ Safe — score: ${result.score}`);
    try {
      await chrome.action.setBadgeText({ text: '✓', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
    } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// injectBanner — yellow caution banner for medium-risk pages (score 30–59)
// ---------------------------------------------------------------------------

async function injectBanner(tabId, args) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/warningBanner.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (bannerArgs) => window.__scamdefyShowBanner(bannerArgs),
      args: [args],
    });
  } catch (e) {
    console.warn('[ScamDefy] Banner injection failed:', e.message);
  }
}