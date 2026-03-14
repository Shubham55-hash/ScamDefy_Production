import ENV from '../config/env.js';
import { handleMessage } from './messageRouter.js';
import { runAllHealthChecks } from './healthCheck.js';

// Load ENV variables
// In manifest V3, ES modules use static imports, so we don't need importScripts for env.js since we export it cleanly
import { validateConfig } from '../config/env.js';

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[ScamDefy] Extension Installed. Running setup...");
  
  const configStatus = validateConfig();
  console.log("[ScamDefy] Config Valid:", configStatus.valid, configStatus.missing);
  
  await runAllHealthChecks();
  
  // Set up repeating alarm for health checks
  chrome.alarms.create("healthCheckAlarm", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "healthCheckAlarm") {
    await runAllHealthChecks();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return true to indicate we will send a response asynchronously
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.toString() });
  });
  return true; 
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only process main_frame navigations
  if (details.frameId !== 0) return;
  
  const url = details.url;
  
  // Skip internal pages and localhost
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.includes('localhost') || url.includes('127.0.0.1')) {
    return;
  }
  
  try {
    const scanResponse = await handleMessage({ type: 'SCAN_URL', payload: { url } }, null);
    
    if (scanResponse.success && scanResponse.data) {
      const result = scanResponse.data;
      
      // Store scan result
      chrome.storage.local.set({ [`scan_${url}`]: result });
      
      if (result.should_block || result.score >= 80) {
        // Redirect to warning page
        const warningUrl = chrome.runtime.getURL(`ui/warning.html?url=${encodeURIComponent(url)}`);
        chrome.tabs.update(details.tabId, { url: warningUrl });
      }
    }
  } catch (e) {
    console.error(`[ScamDefy] Navigation scan failed for ${url}:`, e);
  }
});
