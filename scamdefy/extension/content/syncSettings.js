
/**
 * Content script to sync dashboard settings with the extension storage.
 * Only injected on trusted dashboard origins (see manifest.json); the
 * service worker additionally verifies the sender origin.
 * Listens for the 'scamdefy-settings-updated' and
 * 'scamdefy-safety-circle-updated' custom events dispatched by the dashboard.
 */

(function() {
  // Manifest match patterns can't pin a port, so restrict local hosts to the Vite dev port here.
  const TRUSTED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://scam-defy-production.vercel.app'
  ];
  if (!TRUSTED_ORIGINS.includes(window.location.origin)) return;

  console.log('[ScamDefy] SyncSettings content script loaded.');

  const readJson = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const syncNow = () => {
    if (!chrome.runtime?.id) {
      console.warn('[ScamDefy] Extension connection lost. Please refresh.');
      return;
    }

    const settings = readJson('scamdefy_settings');
    const safetyCircle = readJson('scamdefy_safety_circle');
    if (!settings && !safetyCircle) return;

    // Only forward general settings the user has actually saved, so the
    // extension keeps its own backendUrl / protocol when they are absent.
    const payload = { safetyCircle };
    if (settings && typeof settings.protectionLevel === 'string') {
      payload.protectionLevel = settings.protectionLevel;
    }
    if (settings && typeof settings.backendUrl === 'string' && settings.backendUrl.trim()) {
      payload.backendUrl = settings.backendUrl.trim();
    }

    try {
      chrome.runtime.sendMessage({
        type: 'SYNC_SETTINGS',
        payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[ScamDefy] Sync partially failed:', chrome.runtime.lastError.message);
        } else {
          console.log('[ScamDefy] Settings synced successfully:', response);
        }
      });
    } catch (err) {
      console.error('[ScamDefy] Fatal sync error:', err);
    }
  };

  window.addEventListener('scamdefy-settings-updated', syncNow);
  window.addEventListener('scamdefy-safety-circle-updated', syncNow);

  syncNow();
})();
