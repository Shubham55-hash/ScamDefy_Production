const ENV = {
  BACKEND_URL: "http://127.0.0.1:8000",
  GOOGLE_SAFE_BROWSING_API_KEY: "",   // loaded from storage
  GEMINI_API_KEY: "",                 // loaded from storage
  SCAN_ENDPOINT: "/api/scan",
  VOICE_ENDPOINT: "/api/voice/analyze",
  HEALTH_ENDPOINT: "/api/health",
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

export default ENV;
