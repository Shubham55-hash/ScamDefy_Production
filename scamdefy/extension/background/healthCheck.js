import ENV from '../config/env.js';
import { healthCheck as expanderCheck } from '../modules/urlExpander.js';
import { healthCheck as domainCheck } from '../modules/domainAnalyzer.js';
import { healthCheck as riskCheck } from '../modules/riskScorer.js';
import { healthCheck as aiCheck } from '../modules/aiExplainer.js';

export async function runAllHealthChecks() {
  console.log("[ScamDefy] Running Master Health Check...");
  const results = [];

  // 1. Backend Connectivity Check
  let backendRes = { module: "Backend Connection", status: "fail", reason: "Unknown" };
  try {
    const res = await fetch(`${ENV.BACKEND_URL}${ENV.HEALTH_ENDPOINT}`);
    if (res.ok) {
      const data = await res.json();
      // Extract GSB, PhishTank, Voice from backend health
      results.push({ module: "Google Safe Browsing", status: data.modules.gsb_service    ? "ok" : "fail", reason: data.modules.gsb_service    ? "Active" : "No API key or error" });
      results.push({ module: "URLHaus",              status: data.modules.urlhaus_service ? "ok" : "fail", reason: data.modules.urlhaus_service ? "Active" : "No API key or error" });
      results.push({ module: "Voice Detector",       status: data.modules.voice_cnn       ? "ok" : "fail", reason: data.modules.voice_cnn       ? "Active" : "Model unavailable"   });
      backendRes = { module: "Backend Connection", status: "ok", reason: "Connected to " + ENV.BACKEND_URL };
    } else {
      backendRes.reason = `HTTP ${res.status}`;
      // Push failures for backend modules since backend is down
      ["Google Safe Browsing", "URLHaus", "Voice Detector"].forEach(m => {
        results.push({ module: m, status: "fail", reason: "Backend Offline" });
      });
    }
  } catch (e) {
    backendRes.reason = "Fetch failed: " + e.message;
    ["Google Safe Browsing", "URLHaus", "Voice Detector"].forEach(m => {
      results.push({ module: m, status: "fail", reason: "Backend Offline" });
    });
  }
  results.push(backendRes);

  // 2-5. Extension Module Checks
  const extChecks = [
    { name: "URL Expander", fn: expanderCheck },
    { name: "Domain Analyzer", fn: domainCheck },
    { name: "Risk Scorer", fn: riskCheck },
    { name: "AI Explainer", fn: aiCheck }
  ];

  for (const check of extChecks) {
    try {
      const res = await check.fn();
      results.push({ module: check.name, status: res.status, reason: res.reason });
    } catch (e) {
      results.push({ module: check.name, status: "fail", reason: e.toString() });
    }
  }

  // 6. Aggregate into storage
  await new Promise(resolve => {
    chrome.storage.local.set({ moduleStatus: results }, resolve);
  });

  // 7. Set Extension Badge
  const allGreen = results.every(r => r.status === "ok");
  const anyRed = results.some(r => r.status === "fail");

  if (allGreen) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" }); // Green
  } else if (anyRed) {
    chrome.action.setBadgeText({ text: "✗" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }); // Red
  } else {
    // Some might be warned/degraded (Yellow) - theoretically our status only has ok/fail as per prompt,
    // but we can fallback to yellow if needed.
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" }); // Yellow
  }

  // Log failed modules
  const failed = results.filter(r => r.status !== "ok");
  if (failed.length > 0) {
    console.warn(`[ScamDefy] ${failed.length} modules failed health check:`, failed);
  } else {
    console.log("[ScamDefy] All systems GO.");
  }

  return results;
}
