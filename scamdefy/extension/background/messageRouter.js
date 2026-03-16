import ENV from '../config/env.js';
import { expandUrl } from '../modules/urlExpander.js';
import { explainRisk } from '../modules/aiExplainer.js';

let _serviceWorkerScanCache = null;

export function injectScanCacheRef(cacheRef) {
  _serviceWorkerScanCache = cacheRef;
}

export async function handleMessage(message, sender) {
  const { type, payload } = message;
  try {
    switch (type) {
      case 'SCAN_URL':
        return await scanUrl(payload.url, payload.bypass_cache || false);

      case 'EXPAND_URL':
        const expanded = await expandUrl(payload.url);
        return { success: true, data: expanded, error: null };

      case 'EXPLAIN_URL':
        const expl = await explainRisk(payload.url, payload.score, payload.verdict, payload.flags);
        return { success: true, data: expl, error: null };

      case 'GET_STATUS':
        return new Promise((resolve) => {
          chrome.storage.local.get(['moduleStatus'], (result) => {
            resolve({ success: true, data: result.moduleStatus || [], error: null });
          });
        });

      case 'ANALYZE_VOICE':
        return await analyzeVoice(payload.base64Audio, payload.filename);

      default:
        return { success: false, data: null, error: `Unknown message type: ${type}` };
    }
  } catch (err) {
    console.error(`[ScamDefy] Error handling message ${type}:`, err);
    return { success: false, data: null, error: err.toString() };
  }
}

async function scanUrl(url, bypassCache = false) {
  try {
    // KEY FIX: clear in-memory service worker cache on forced rescan
    if (bypassCache && _serviceWorkerScanCache) {
      _serviceWorkerScanCache.delete(url);
      console.log('[ScamDefy] Cleared in-memory cache for:', url);
    }

    const storageResult = await new Promise(resolve =>
      chrome.storage.local.get(['whitelist'], resolve)
    );
    const whitelist = storageResult.whitelist || [];
    if (whitelist.includes(url)) {
      return {
        success: true,
        data: { url, verdict: 'SAFE', score: 0, color: '#22c55e',
                explanation: 'User Whitelisted URL', flags: [], domain_age: null },
        error: null,
      };
    }

    const settingsResult = await new Promise(resolve =>
      chrome.storage.local.get(['backendUrl'], resolve)
    );
    const backendUrl = (settingsResult.backendUrl || ENV.BACKEND_URL).replace(/\/$/, '');

    const endpoint = `${backendUrl}${ENV.SCAN_ENDPOINT}${bypassCache ? '?bypass_cache=true' : ''}`;
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });

    if (!response.ok) throw new Error(`Backend scan failed: ${response.status}`);
    const data = await response.json();
    return { success: true, data, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.toString() };
  }
}

async function analyzeVoice(base64Audio, filename) {
  try {
    const res  = await fetch(base64Audio);
    const blob = await res.blob();

    const settingsResult = await new Promise(r =>
      chrome.storage.local.get(['backendUrl'], r)
    );
    const backendUrl = (settingsResult.backendUrl || ENV.BACKEND_URL).replace(/\/$/, '');

    const formData = new FormData();
    formData.append('audio', blob, filename);

    const url      = `${backendUrl}${ENV.VOICE_ENDPOINT}`;
    const response = await fetch(url, { method: 'POST', body: formData });

    if (!response.ok) throw new Error(`Backend voice analysis failed: ${response.status}`);
    const data = await response.json();
    return { success: true, data, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.toString() };
  }
}
