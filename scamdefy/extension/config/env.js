const ENV = {
  BACKEND_URL: "http://localhost:8000",
  GOOGLE_SAFE_BROWSING_API_KEY: "",   // loaded from storage
  GEMINI_API_KEY: "",                 // loaded from storage
  SCAN_ENDPOINT: "/api/scan",
  VOICE_ENDPOINT: "/api/voice/analyze",
  HEALTH_ENDPOINT: "/api/health",
  // Dashboard origins allowed to push settings into the extension.
  // Keep in sync with the syncSettings.js content_scripts matches in manifest.json.
  DASHBOARD_ORIGINS: [
    /^http:\/\/localhost:5173$/,       // Vite dev server
    /^http:\/\/127\.0\.0\.1:5173$/,
    /^https:\/\/scam-defy-production\.vercel\.app$/
  ],
  RISK_THRESHOLDS: {
    LOW: 30,
    MEDIUM: 60,
    HIGH: 80
  }
};

export function validateConfig() {
  const requiredKeys = ['BACKEND_URL', 'SCAN_ENDPOINT', 'VOICE_ENDPOINT', 'HEALTH_ENDPOINT'];
  const missing = [];
  
  for (const key of requiredKeys) {
    if (typeof ENV[key] !== 'string' || ENV[key].trim() === '') {
      missing.push(key);
      console.warn(`[ScamDefy] Missing required ENV key: ${key}`);
    }
  }
  
  return { valid: missing.length === 0, missing };
}

export function isTrustedDashboardOrigin(origin) {
  return typeof origin === 'string' && ENV.DASHBOARD_ORIGINS.some(re => re.test(origin));
}

/** Guardian PII may only be sent over HTTPS, or plain HTTP to a loopback backend. */
export function isSecureBackendUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch (_) {
    return false;
  }
}

export default ENV;
