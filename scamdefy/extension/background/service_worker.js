import ENV from '../config/env.js';
import { handleMessage, injectScanCacheRef } from './messageRouter.js';
import { runAllHealthChecks } from './healthCheck.js';
import { validateConfig, isTrustedDashboardOrigin, isSecureBackendUrl } from '../config/env.js';

console.log('[ScamDefy] BACKGROUND SCRIPT LOADING...');

const SCAN_TIMEOUT_MS  = 8000;
const CACHE_TTL_MS     = 30000;
// Default thresholds (will be overridden by storage)
let POPUP_THRESHOLD  = 50;
let BANNER_THRESHOLD = 30;

// Load initial thresholds from storage
chrome.storage.local.get(['popupThreshold', 'bannerThreshold'], (res) => {
  if (res.popupThreshold)  POPUP_THRESHOLD  = res.popupThreshold;
  if (res.bannerThreshold) BANNER_THRESHOLD = res.bannerThreshold;
  console.log(`[ScamDefy] Thresholds initialized: POPUP=${POPUP_THRESHOLD}, BANNER=${BANNER_THRESHOLD}`);
});

const scanCache = new Map();
const sessionWhitelist = new Set();
const PROTECTION_LEVELS = ['conservative', 'balanced', 'aggressive'];
const WARNINGS_KEY = 'warningTokens';
const MAX_WARNING_TOKENS = 100;

function senderOrigin(sender) {
  if (sender.origin) return sender.origin;
  try { return new URL(sender.url).origin; } catch (_) { return null; }
}

function isFromWarningPage(sender) {
  return sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL('ui/warning.html'));
}

function isBlockingResult(result, blockDangerous = true) {
  const score = result?.score || 0;
  return (blockDangerous && result?.authoritative_hit === true) || score > POPUP_THRESHOLD;
}

// Each warning page gets a one-time token bound to its URL and tab, so a bypass
// (and any guardian escalation) can only be issued for the warning actually shown.
// chrome.storage.session is not readable by content scripts.
async function issueWarningToken(tabId, url, blocked) {
  const token = crypto.randomUUID();
  try {
    const { [WARNINGS_KEY]: tokens = {} } = await chrome.storage.session.get(WARNINGS_KEY);
    tokens[token] = { url, tabId, blocked, ts: Date.now() };
    const pruned = Object.fromEntries(
      Object.entries(tokens).sort((a, b) => b[1].ts - a[1].ts).slice(0, MAX_WARNING_TOKENS)
    );
    await chrome.storage.session.set({ [WARNINGS_KEY]: pruned });
  } catch (err) {
    console.warn('[ScamDefy] Could not record warning token:', err);
  }
  return token;
}

async function consumeWarningToken(token, url, tabId) {
  if (!token) return null;
  try {
    const { [WARNINGS_KEY]: tokens = {} } = await chrome.storage.session.get(WARNINGS_KEY);
    const entry = tokens[token];
    if (!entry || entry.url !== url || entry.tabId !== tabId) return null;
    delete tokens[token];
    await chrome.storage.session.set({ [WARNINGS_KEY]: tokens });
    return entry;
  } catch (_) {
    return null;
  }
}

function warningTokenFromSender(sender) {
  try { return new URL(sender.url).searchParams.get('token'); } catch (_) { return null; }
}

function notifyGuardians(safetyCircle, backendUrl, alert) {
  const apiBase = (backendUrl || ENV.BACKEND_URL).replace(/\/$/, '');
  if (!isSecureBackendUrl(apiBase)) {
    console.warn('[ScamDefy] Skipping guardian alert: backend URL is not HTTPS:', apiBase);
    return Promise.resolve(null);
  }
  const userName = safetyCircle.shareUserName && safetyCircle.userName
    ? safetyCircle.userName
    : 'A ScamDefy user';
  return fetch(`${apiBase}/api/guardian/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guardians: safetyCircle.guardians,
      alert_type: 'URL_SCAN',
      user_name: userName,
      ...alert
    })
  }).then(res => res.json());
}

// Inject reference so messageRouter can clear it on bypass_cache
injectScanCacheRef(scanCache);

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ScamDefy] !!! onInstalled fired !!!');
  console.log('[ScamDefy] webNavigation API available:', !!chrome.webNavigation);
  const configStatus = validateConfig();
  console.log('[ScamDefy] Config valid:', configStatus.valid, configStatus.missing);
  await runAllHealthChecks();
  chrome.alarms.create('healthCheckAlarm', { periodInMinutes: 30 });
  chrome.alarms.create('cacheCleanup',     { periodInMinutes: 1  });
});

// Also run health checks when the browser starts up (service worker waking after a restart)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ScamDefy] onStartup — running startup health check...');
  await runAllHealthChecks();
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
  if (message.type === 'SYNC_SETTINGS') {
    if (sender.id !== chrome.runtime.id || !isTrustedDashboardOrigin(senderOrigin(sender))) {
      console.warn('[ScamDefy] Rejected SYNC_SETTINGS from untrusted origin:', senderOrigin(sender));
      sendResponse({ success: false, error: 'untrusted_origin' });
      return true;
    }
    handleSyncSettings(message.payload || {}).then(sendResponse);
    return true;
  }
  if (message.type === 'OPEN_WARNING') {
    const url = message.payload.url;
    const cached = scanCache.get(url);
    const openWarning = async (result) => {
      const { blockDangerous = true } = await chrome.storage.local.get(['blockDangerous']);
      showWarningPage(sender.tab.id, url, result, isBlockingResult(result, blockDangerous));
    };
    if (cached && cached.result) {
      openWarning(cached.result.data || cached.result);
    } else {
      // Fallback: trigger a new scan then show warning
      handleMessage({ type: 'SCAN_URL', payload: { url } }, null)
        .then(res => {
          if (res && res.success) openWarning(res.data);
        });
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.type === 'PROCEED_ANYWAY') {
    if (!isFromWarningPage(sender)) {
      console.warn('[ScamDefy] Rejected PROCEED_ANYWAY from untrusted sender:', sender.url);
      sendResponse({ success: false, error: 'untrusted_sender' });
      return true;
    }
    const { url } = message.payload || {};
    const tabId = sender.tab?.id;
    (async () => {
      const warning = url ? await consumeWarningToken(warningTokenFromSender(sender), url, tabId) : null;
      if (!warning) {
        console.warn('[ScamDefy] Rejected PROCEED_ANYWAY: no matching warning for', url);
        sendResponse({ success: false, error: 'no_matching_warning' });
        return;
      }

      sessionWhitelist.add(url);
      const res = await chrome.storage.local.get(['whitelist', 'safetyCircle', 'backendUrl']);
      const list = res.whitelist || [];
      if (!list.includes(url)) chrome.storage.local.set({ whitelist: [...list, url] });

      // Safety Circle Escalation — only when this warning was an actual block
      const sc = res.safetyCircle;
      if (warning.blocked && sc && sc.enabled && sc.notifyOnEscalation && sc.guardians && sc.guardians.length > 0) {
        notifyGuardians(sc, res.backendUrl, {
          scam_type: 'User Bypassed Critical Block',
          risk_score: 99,
          is_escalation: true,
          bypass_cooldown: true
        }).catch(err => console.warn('[ScamDefy] Guardian escalation failed:', err));
      }

      // Navigate to the real URL
      chrome.tabs.update(tabId, { url });
      sendResponse({ success: true });
    })();
    return true;
  }
  if (message.type === 'REVOKE_WHITELIST') {
    const { url } = message.payload;
    if (url) sessionWhitelist.delete(url);
    sendResponse({ success: true });
    return true;
  }
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.toString() }));
  return true;
});

async function handleSyncSettings(settings) {
  const {
    protectionLevel,
    backendUrl,
    safetyCircle
  } = settings;

  const mapping = {
    conservative: { popup: 80, banner: 50 },
    balanced:     { popup: 40, banner: 30 },
    aggressive:   { popup: 20, banner: 1  }
  };

  const updates = {};

  // Only touch fields that were sent, so a Safety-Circle-only sync keeps
  // the extension's existing protocol and backend URL.
  if (PROTECTION_LEVELS.includes(protectionLevel)) {
    const thresholds = mapping[protectionLevel];
    POPUP_THRESHOLD  = thresholds.popup;
    BANNER_THRESHOLD = thresholds.banner;
    Object.assign(updates, {
      protectionLevel,
      popupThreshold:  thresholds.popup,
      bannerThreshold: thresholds.banner
    });
    console.log(`[ScamDefy] Protocol updated to ${protectionLevel}: POPUP=${POPUP_THRESHOLD}, BANNER=${BANNER_THRESHOLD}`);
  }

  if (typeof backendUrl === 'string' && /^https?:\/\//i.test(backendUrl)) {
    updates.backendUrl = backendUrl;
  }

  if ('safetyCircle' in settings) {
    updates.safetyCircle = safetyCircle && typeof safetyCircle === 'object' ? safetyCircle : null;
  }

  await chrome.storage.local.set(updates);

  // Re-run health checks now that keys might have changed
  await runAllHealthChecks();

  return { success: true };
}

function shouldSkipUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('data:')
  );
}

// ─── onBeforeNavigate: earliest possible interception point ─────────────────
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  console.log('[ScamDefy] !!! onBeforeNavigate FIRE !!!', details.url);
  if (details.frameId !== 0) return;
  const url = details.url;
  if (shouldSkipUrl(url) || url.includes('ui/warning.html')) {
    console.log('[ScamDefy] skipping URL:', url);
    return;
  }

  const { whitelist = [], autoScan = true } = await chrome.storage.local.get(['whitelist', 'autoScan']);
  console.log('[ScamDefy] autoScan:', autoScan, 'whitelisted:', whitelist.includes(url));
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

// ─── onUpdated: catch navigations that onBeforeNavigate may have missed ──────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when the tab commits a new URL OR finishes loading
  // NOTE: Must use || not && here — we want to fire on EITHER condition
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  const url = tab.url;
  console.log('[ScamDefy] 🔄 onUpdated:', changeInfo.status, url);
  if (!url || shouldSkipUrl(url) || url.includes('ui/warning.html')) return;

  const { whitelist = [], autoScan = true } = await chrome.storage.local.get(['whitelist', 'autoScan']);
  if (!autoScan || whitelist.includes(url)) return;

  const cached = scanCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (cached.inProgress) {
      // Still scanning from onBeforeNavigate — let that handler finish
      return;
    }
    console.log('[ScamDefy] ✓ onUpdated check (cached) for:', url);
    await handleScanResult(tabId, url, cached.result);
    return;
  }

  // onBeforeNavigate may have been skipped or failed — scan now
  console.log('[ScamDefy] 🔍 Scanning in onUpdated:', url);
  scanCache.set(url, { timestamp: Date.now(), inProgress: true });

  try {
    const scanPromise    = handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
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

console.log('[ScamDefy] BACKGROUND LISTENERS REGISTERED');


// ─── Main decision function ──────────────────────────────────────────────────
async function handleScanResult(tabId, url, scanResponse) {
  // Check whitelists
  const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
  if (whitelist.includes(url) || sessionWhitelist.has(url)) {
    console.log('[ScamDefy] ✓ Skipping block for whitelisted URL:', url);
    return;
  }

  if (!scanResponse?.success || !scanResponse?.data) {
    console.warn('[ScamDefy] No scan data for:', url);
    return;
  }
  const { blockDangerous = true, showBanner = true } = await chrome.storage.local.get(
    ['blockDangerous', 'showBanner']
  );

  // ── Logic Fix: Force block only if it's a confirmed authoritative threat (GSB/URLhaus)
  // or if the heuristic risk score strictly exceeds the protocol's threshold.
  const result = scanResponse.data;
  const score = result.score || 0;

  const isAuthoritative = result.authoritative_hit === true;
  const shouldShowPopup = isBlockingResult(result, blockDangerous);

  if (shouldShowPopup) {
    console.log(`[ScamDefy] 🚨 POPUP WARNING — score: ${score} (threshold: >${POPUP_THRESHOLD}, authoritative: ${isAuthoritative})`);
    await showWarningPage(tabId, url, result, true);

  // ── Show caution banner for score 31–75 ──────────────────────────────────
  } else if (score > BANNER_THRESHOLD && showBanner) {
    console.log(`[ScamDefy] ⚠️ Caution banner — score: ${score}`);
    await showCautionBanner(tabId, url, result);

  // ── Safe ──────────────────────────────────────────────────────────────────
  } else {
    console.log(`[ScamDefy] ✅ Safe — score: ${score}`);
    try {
      await chrome.action.setBadgeText({ text: '✓', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
    } catch (_) {}
  }
}

// ─── Redirect to full warning/block page ────────────────────────────────────
async function showWarningPage(tabId, url, result, blocked = false) {
  const token = await issueWarningToken(tabId, url, blocked);
  // Encode result as UTF-8-safe base64
  const uint8      = new TextEncoder().encode(JSON.stringify(result));
  const binString  = Array.from(uint8, b => String.fromCharCode(b)).join('');
  const encoded    = btoa(binString);
  const warningUrl = chrome.runtime.getURL(
    `ui/warning.html?url=${encodeURIComponent(url)}&data=${encodeURIComponent(encoded)}&token=${encodeURIComponent(token)}`
  );
  console.log('[ScamDefy] ⚡ Redirecting tab to warning page:', warningUrl);

  // Retry up to 3 times — tab may still be navigating when we first try
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && tab.url.includes('ui/warning.html')) {
        console.log('[ScamDefy] Already on warning page, skipping redirect');
        return;
      }
      await chrome.tabs.update(tabId, { url: warningUrl });
      console.log(`[ScamDefy] ✅ Redirect succeeded on attempt ${attempt + 1}`);
      break;
    } catch (err) {
      if (attempt < 2) {
        console.warn(`[ScamDefy] Redirect attempt ${attempt + 1} failed, retrying…`, err.message);
        await new Promise(r => setTimeout(r, 300));
      } else {
        console.error('[ScamDefy] Could not redirect tab after 3 attempts:', err.message);
      }
    }
  }

  // Badge
  try {
    await chrome.action.setBadgeText({ text: '!', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
  } catch (_) {}

  // Desktop notification
  try {
    chrome.notifications.create(`threat_${tabId}_${Date.now()}`, {
      type:     'basic',
      iconUrl:  chrome.runtime.getURL('icons/icon48.png'),
      title:    `🚨 Threat Detected — ${result.scam_type || result.verdict}`,
      message:  `Risk Score: ${Math.round(result.score)}/100\n${(result.flags || []).slice(0, 2).join(', ') || 'Multiple threat signals detected'}`,
      priority: 2,
    });
  } catch (_) {}

  // Safety Circle Notification
  try {
    const { safetyCircle, backendUrl } = await chrome.storage.local.get(['safetyCircle', 'backendUrl']);
    if (safetyCircle && safetyCircle.enabled && safetyCircle.guardians && safetyCircle.guardians.length > 0) {
      const riskScore = Math.round(result.score || 0);
      if (riskScore >= (safetyCircle.threshold || 30)) {
        console.log(`[ScamDefy] Triggering Safety Circle alert for score ${riskScore}...`);
        notifyGuardians(safetyCircle, backendUrl, {
          scam_type: result.scam_type || result.verdict || 'Suspicious Website',
          risk_score: riskScore,
          is_escalation: false,
          bypass_cooldown: false
        }).then(data => data && console.log('[ScamDefy] Guardian notify result:', data))
          .catch(err => console.warn('[ScamDefy] Guardian fetch failed:', err));
      }
    }
  } catch (err) {
    console.warn('[ScamDefy] Safety Circle notify error:', err);
  }
}

// ─── Inject caution banner (score 31–75) ────────────────────────────────────
async function showCautionBanner(tabId, url, result) {
  const score = Math.round(result.score ?? 0);
  const args  = { verdict: result.verdict, score, url, color: '#f59e0b' };

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      injectBanner(tabId, args);
    } else {
      // Wait for page load to finish, then inject
      const listener = (tid, cInfo) => {
        if (tid === tabId && cInfo.status === 'complete') {
          injectBanner(tabId, args);
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    }
  } catch (_) {}

  try {
    await chrome.action.setBadgeText({ text: '?', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId });
  } catch (_) {}
}

// ─── Content-script banner injection ────────────────────────────────────────
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