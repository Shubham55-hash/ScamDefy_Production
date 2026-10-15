
/**
 * Content script to sync dashboard settings with the extension storage.
 * Listens for the 'scamdefy-settings-updated' custom event dispatched by Settings.tsx
 */

(function() {
  console.log('[ScamDefy] SyncSettings content script loaded.');

  const syncNow = () => {
    const settingsRaw = localStorage.getItem('scamdefy_settings');
    const scRaw = localStorage.getItem('scamdefy_safety_circle');

    if (settingsRaw) {
      const settings = JSON.parse(settingsRaw);
      settings.safetyCircle = scRaw ? JSON.parse(scRaw) : null;

      if (!chrome.runtime?.id) {
        console.warn('[ScamDefy] Extension connection lost. Please refresh.');
        return;
      }

      try {
        chrome.runtime.sendMessage({
          type: 'SYNC_SETTINGS',
          payload: settings
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
    }
  };

  window.addEventListener('scamdefy-settings-updated', (event) => {
    syncNow();
  });

  window.addEventListener('scamdefy-safety-circle-updated', (event) => {
    syncNow();
  });

  if (chrome.runtime?.id) {
    syncNow();
  }
})();
