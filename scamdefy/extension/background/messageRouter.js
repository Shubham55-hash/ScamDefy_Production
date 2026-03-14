import ENV from '../config/env.js';
import { expandUrl } from '../modules/urlExpander.js';
import { explainRisk } from '../modules/aiExplainer.js';

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
    // Check local whitelist
    const storageResult = await new Promise(resolve => chrome.storage.local.get(['whitelist'], resolve));
    const whitelist = storageResult.whitelist || [];
    if (whitelist.includes(url)) {
      return { 
        success: true, 
        data: { url, verdict: "SAFE", score: 0, color: "#22c55e", explanation: "User Whitelisted URL" },
        error: null 
      };
    }

    const endpoint = `${ENV.BACKEND_URL}${ENV.SCAN_ENDPOINT}${bypassCache ? '?bypass_cache=true' : ''}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
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
    // base64 to blob
    const res = await fetch(base64Audio);
    const blob = await res.blob();
    
    const storage = await new Promise(res => chrome.storage.local.get(['GEMINI_API_KEY'], res));
    const apiKey = storage.GEMINI_API_KEY;
    
    const formData = new FormData();
    formData.append("audio", blob, filename);
    
    const url = `${ENV.BACKEND_URL}${ENV.VOICE_ENDPOINT}${apiKey ? `?api_key=${apiKey}` : ''}`;
    const response = await fetch(url, {
      method: "POST",
      body: formData
    });
    
    if (!response.ok) throw new Error(`Backend voice analysis failed: ${response.status}`);
    const data = await response.json();
    return { success: true, data, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.toString() };
  }
}
