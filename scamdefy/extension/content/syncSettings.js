
/**
 * Content script to sync dashboard settings with the extension storage.
 * Listens for the 'scamdefy-settings-updated' custom event dispatched by Settings.tsx
 */

(function() {
  console.log('[ScamDefy] SyncSettings content script loaded.');

  window.addEventListener('scamdefy-settings-updated', (event) => {
    const { protectionLevel } = event.detail;
    console.log('[ScamDefy] Settings update detected:', protectionLevel);
    
    // Read the full settings from localStorage (which was just updated by useSettings.ts)
    const settingsRaw = localStorage.getItem('scamdefy_settings');
    if (settingsRaw) {
      const settings = JSON.parse(settingsRaw);

      // Check if the extension context is still valid
      if (!chrome.runtime?.id) {
        console.warn('[ScamDefy] Extension connection lost. Please refresh the page to sync settings.');
        return;
      }

      try {
        chrome.runtime.sendMessage({
          type: 'SYNC_SETTINGS',
          payload: settings
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[ScamDefy] Sync partially failed (likely context invalidated):', chrome.runtime.lastError.message);
          } else {
            console.log('[ScamDefy] Settings synced successfully:', response);
          }
        });
      } catch (err) {
        console.error('[ScamDefy] Fatal sync error. Please refresh the dashboard:', err);
      }
    }
  });

  // Initial sync on load
  const initialSettings = localStorage.getItem('scamdefy_settings');
  if (initialSettings && chrome.runtime?.id) {
    try {
      chrome.runtime.sendMessage({
        type: 'SYNC_SETTINGS',
        payload: JSON.parse(initialSettings)
      });
    } catch (e) {
      console.warn('[ScamDefy] Initial sync failed (context invalidated).');
    }
  }
})();
