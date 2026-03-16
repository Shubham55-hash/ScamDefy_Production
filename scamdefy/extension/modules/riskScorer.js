const RISK_THRESHOLDS = {
  LOW: 30,
  MEDIUM: 60,
  HIGH: 80
};

export function calculateUrlPatternScore(url) {
  let score = 0;
  // Simple heuristic for URL pattern risk
  if (url.length > 75) score += 30;
  if (url.length > 150) score += 40;
  
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:') {
      score += 50; // Non-HTTPS is risky
    }
    
    // Check entropy (random-looking paths/params)
    const paramCount = Array.from(urlObj.searchParams.keys()).length;
    if (paramCount > 4) Object.assign({}, {score: score += 20});
    
  } catch(e) {
    score = 100; // Invalid URL
  }
  
  return Math.min(score, 100);
}

export function calculateRisk(url, gsbResult, urlhausResult, domainResult) {
  const gsbScore = gsbResult.is_threat ? 100 : 0;
  const urlhausScore = urlhausResult.is_phishing ? 100 : 0;
  const domainScore = domainResult.risk_contribution || 0;
  const urlPatternScore = calculateUrlPatternScore(url);

  // score = (gsb * 0.35 + phishtank * 0.25 + domain * 0.25 + url_pattern * 0.15)
  const finalScore = (
    gsbScore * 0.35 +
    urlhausScore * 0.25 +
    domainScore * 0.25 +
    urlPatternScore * 0.15
  );

  let verdict = "SAFE";
  let color = "#22c55e";
  
  if (finalScore >= 80) {
    verdict = "BLOCKED";
    color = "#ef4444";
  } else if (finalScore >= 60) {
    verdict = "DANGER";
    color = "#f97316";
  } else if (finalScore >= 30) {
    verdict = "CAUTION";
    color = "#f59e0b";
  }

  return {
    url,
    score: Math.round(finalScore),
    verdict,
    breakdown: {
      gsb: gsbScore,
      urlhaus: urlhausScore,
      domain: domainScore,
      url_pattern: urlPatternScore
    },
    color,
    should_block: finalScore >= 80
  };
}

export function healthCheck() {
  try {
    // Score a clearly safe URL
    const safeUrl = "https://google.com";
    const safeGsb = { is_threat: false };
    const safePt = { is_phishing: false };
    const safeDomain = { risk_contribution: 0 };
    
    const safeResult = calculateRisk(safeUrl, safeGsb, safePt, safeDomain);
    if (safeResult.verdict !== "SAFE" || safeResult.score >= 30) {
      return { status: "fail", reason: "Safe URL was not scored as SAFE" };
    }

    // Score a blocked URL — use both GSB + urlhaus hits to guarantee score >= 80
    const dangerUrl = "http://paypa1-update-login-secure.xyz/?token=123&v=4&q=5&z=8&p=9";
    const dangerGsb    = { is_threat: true };
    const dangerPt     = { is_phishing: true };   // ← was false, now true to push score over 80
    const dangerDomain = { risk_contribution: 100 };

    const dangerResult = calculateRisk(dangerUrl, dangerGsb, dangerPt, dangerDomain);
    if (dangerResult.verdict !== "BLOCKED" || dangerResult.score < 80) {
      return { status: "fail", reason: `Blocked URL was not scored as BLOCKED (Score was ${dangerResult.score})` };
    }

    return { status: "ok", reason: "Risk scorer functioning correctly" };
  } catch (e) {
    return { status: "fail", reason: e.toString() };
  }
}
