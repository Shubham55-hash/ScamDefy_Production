import ENV from '../config/env.js';
import { handleMessage, injectScanCacheRef } from './messageRouter.js';
import { runAllHealthChecks } from './healthCheck.js';
import { validateConfig } from '../config/env.js';

const SCAN_TIMEOUT_MS = 8000;
const CACHE_TTL_MS    = 30000;

const scanCache = new Map();

// Inject reference so messageRouter can clear it on bypass_cache
injectScanCacheRef(scanCache);

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ScamDefy] Extension installed. Running setup...');
  const configStatus = validateConfig();
  console.log('[ScamDefy] Config valid:', configStatus.valid, configStatus.missing);
  await runAllHealthChecks();
  chrome.alarms.create('healthCheckAlarm', { periodInMinutes: 30 });
  chrome.alarms.create('cacheCleanup',     { periodInMinutes: 1  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheckAlarm') await runAllHealthChecks();
  if (alarm.name === 'cacheCleanup') {
    const now = Date.now();
    for (const [url, entry] of scanCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) scanCache.delete(url);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.toString() }));
  return true;
});

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

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (shouldSkipUrl(url) || url.includes('ui/warning.html')) return;

  const { whitelist = [], autoScan = true } = await chrome.storage.local.get(['whitelist', 'autoScan']);
  if (!autoScan || whitelist.includes(url)) return;

  const cached = scanCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (cached.inProgress) return;
    console.log('[ScamDefy] ✓ Proactive block check (cached) for:', url);
    await handleScanResult(details.tabId, url, cached.result);
    return;
  }

  console.log('[ScamDefy] ⚡ Proactive scan triggered in onBeforeNavigate:', url);
  // Mark as in-progress to avoid duplicate fetches
  scanCache.set(url, { timestamp: Date.now(), inProgress: true });

  try {
    const result = await handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
    if (result) {
      scanCache.set(url, { result, timestamp: Date.now(), inProgress: false });
      await handleScanResult(details.tabId, url, result);
    }
  } catch (err) {
    console.error('[ScamDefy] Proactive scan failed:', err);
    scanCache.delete(url);
  }
}, { url: [{ schemes: ['http', 'https'] }] });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // We check as soon as we have a URL, don't wait for 'complete' for blocking
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  
  const url = tab.url;
  if (!url || shouldSkipUrl(url) || url.includes('ui/warning.html')) return;

  const { whitelist = [], autoScan = true } = await chrome.storage.local.get(['whitelist', 'autoScan']);
  if (!autoScan || whitelist.includes(url)) return;

  const cached = scanCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (cached.inProgress) {
        // If still scanning from onBeforeNavigate, we'll let that handler finish
        return;
    }
    console.log('[ScamDefy] ✓ onUpdated check (cached) for:', url);
    await handleScanResult(tabId, url, cached.result);
    return;
  }

  // If we reach here, onBeforeNavigate might have been skipped or failed
  console.log('[ScamDefy] 🔍 Scanning in onUpdated:', url);
  scanCache.set(url, { timestamp: Date.now(), inProgress: true });

  try {
    const scanPromise = handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ timedOut: true }), SCAN_TIMEOUT_MS)
    );
    const outcome = await Promise.race([scanPromise, timeoutPromise]);
    
    if (outcome.timedOut) { 
        console.warn('[ScamDefy] Scan timed out for:', url);
        scanCache.delete(url);
        return; 
    }

    scanCache.set(url, { result: outcome, timestamp: Date.now(), inProgress: false });
    await handleScanResult(tabId, url, outcome);
  } catch (err) {
    console.error('[ScamDefy] onUpdated scan error:', err);
    scanCache.delete(url);
  }
});

async function handleScanResult(tabId, url, scanResponse) {
  if (!scanResponse?.success || !scanResponse?.data) {
    console.warn('[ScamDefy] No scan data for:', url);
    return;
  }
  const result = scanResponse.data;

  chrome.storage.local.set({ [`scan_${url}`]: result });

  const { blockDangerous = true, showBanner = true } = await chrome.storage.local.get(
    ['blockDangerous', 'showBanner']
  );

  const shouldBlock = (blockDangerous && result.should_block === true) || result.score >= 60;

  if (shouldBlock) {
    console.log(`[ScamDefy] 🚨 BLOCKING — score: ${result.score}`);
    const encoded    = btoa(JSON.stringify(result));
    const warningUrl = chrome.runtime.getURL(
      `ui/warning.html?url=${encodeURIComponent(url)}&data=${encoded}`
    );
    try { 
        // Before updating, check if we are already on the warning page for this tab
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.url.includes('ui/warning.html')) return;
        
        await chrome.tabs.update(tabId, { url: warningUrl }); 
    }
    catch (err) { console.warn('[ScamDefy] Could not redirect tab:', err.message); }

    try {
      await chrome.action.setBadgeText({ text: '!', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
    } catch (_) {}

    try {
      const notificationId = `threat_${tabId}_${Date.now()}`;
      chrome.notifications.create(notificationId, {
        type:    'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title:   `🚨 Threat Blocked — ${result.scam_type || result.verdict}`,
        message: `Risk Score: ${result.score}/100\n${(result.flags || []).slice(0, 2).join(', ') || 'Multiple threat signals detected'}`,
        priority: 2,
      });
    } catch (_) {}

  } else if (result.score >= 30 && showBanner) {
    console.log(`[ScamDefy] ⚠️ Caution — score: ${result.score}`);
    
    // Only inject banner if page is actually loaded or loading
    // We wait for status complete for banner to ensure DOM is ready
    const tabCheck = await chrome.tabs.get(tabId);
    if (tabCheck.status === 'complete') {
        injectBanner(tabId, { verdict: result.verdict, score: result.score, url, color: '#f59e0b' });
    } else {
        // If not loaded yet, wait for completion to inject banner
        const listener = (tid, cInfo) => {
            if (tid === tabId && cInfo.status === 'complete') {
                injectBanner(tabId, { verdict: result.verdict, score: result.score, url, color: '#f59e0b' });
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    }
    try {
      await chrome.action.setBadgeText({ text: '?', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId });
    } catch (_) {}
  } else {
    console.log(`[ScamDefy] ✅ Safe — score: ${result.score}`);
    try {
      await chrome.action.setBadgeText({ text: '✓', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
    } catch (_) {}
  }
}

async function injectBanner(tabId, args) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/warningBanner.js'] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func:   (bannerArgs) => window.__scamdefyShowBanner(bannerArgs),
      args:   [args],
    });
  } catch (e) {
    console.warn('[ScamDefy] Banner injection failed:', e.message);
  }
}