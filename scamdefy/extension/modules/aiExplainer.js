import ENV from '../config/env.js';

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);                    
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function explainRisk(url, score, verdict, flagsList) {
  if (score <= 30) {
    return "This URL appears safe.";
  }

  const flagsStr = flagsList.length > 0 ? flagsList.join(', ') : 'suspicious patterns';
  const fallback = `This URL scored ${score}/100 risk. It was flagged for: ${flagsStr}. We recommend not clicking it.`;

  try {
    const urlHash = await sha256(url);
    const cacheKey = `expl_${urlHash}`;
    
    // Check cache
    const cached = await new Promise(resolve => {
      chrome.storage.local.get([cacheKey], result => resolve(result[cacheKey]));
    });
    
    if (cached) return cached;

    // Check local storage for API key
    const settings = await new Promise(resolve => {
      chrome.storage.local.get(['geminiKey', 'backendUrl'], resolve);
    });

    const apiKey = settings.geminiKey || ENV.GEMINI_API_KEY || "";
    const backendUrl = (settings.backendUrl || ENV.BACKEND_URL).replace(/\/$/, '');

    // Call Backend for Gemini explanation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${backendUrl}/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        score,
        verdict,
        flags: flagsList,
        api_key: apiKey
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Gemini Backend error: ${response.status}`);
    }

    const data = await response.json();
    const explanation = data.explanation;

    // Save to cache
    await new Promise(resolve => {
      chrome.storage.local.set({ [cacheKey]: explanation }, resolve);
    });

    return explanation;

  } catch (error) {
    console.warn("[ScamDefy] AI Explainer fallback activated. Error:", error);
    return fallback;
  }
}

export async function healthCheck() {
  try {
    const testResult = await explainRisk("http://fake-test.com", 85, "BLOCKED", ["TYPOSQUATTING", "SUSPICIOUS_TLD"]);
    if (testResult && testResult.length > 0) {
      return { status: "ok", reason: "AI Explainer functioning (or fallback active)" };
    } else {
      return { status: "fail", reason: "AI Explainer returned empty string" };
    }
  } catch (e) {
    return { status: "fail", reason: e.toString() };
  }
}
