import urllib.parse
from typing import Dict, Any

def calculate_url_pattern_score(url: str) -> float:
    score = 0
    if len(url) > 75: score += 30
    if len(url) > 150: score += 40
    
    try:
        parsed_url = urllib.parse.urlparse(url)
        if parsed_url.scheme != "https":
            score += 50
            
        params = urllib.parse.parse_qs(parsed_url.query)
        if len(params.keys()) > 4:
            score += 20
            
    except Exception:
        score = 100
        
    return float(min(score, 100))

def score(gsb_result: Dict[str, Any], uh_result: Dict[str, Any], domain_result: Dict[str, Any], url: str) -> Dict[str, Any]:
    gsb_threat = gsb_result.get("is_threat", False)
    uh_threat = uh_result.get("is_phishing", False)
    
    domain_contribution = float(domain_result.get("risk_contribution", 0.0))
    url_pattern_score = float(calculate_url_pattern_score(url))
    
    # 1. Base Weighted Score
    # GSB and UH now contribute heavily even without the override
    gsb_contribution = 100.0 if gsb_threat else 0.0
    uh_contribution = 100.0 if uh_threat else 0.0
    
    final_score = (
        gsb_contribution * 0.40 +
        uh_contribution * 0.30 +
        domain_contribution * 0.20 +
        url_pattern_score * 0.10
    )
    
    # 2. Authoritative Override: 
    # If GSB or URLHaus identifies a threat, the verdict must be BLOCKED (100)
    is_authoritative_threat = gsb_threat or uh_threat
    if is_authoritative_threat:
        final_score = 100.0
    
    # 3. Verdict thresholds
    verdict = "SAFE"
    color = "#22c55e" # var(--green)
    
    if final_score >= 80:
        verdict = "BLOCKED"
        color = "#ef4444" # var(--red)
    elif final_score >= 60:
        verdict = "DANGER"
        color = "#f97316" # var(--orange)
    elif final_score >= 30:
        verdict = "CAUTION"
        color = "#f59e0b" # var(--yellow)

    return {
        "url": url,
        "score": round(final_score, 1),
        "verdict": verdict,
        "breakdown": {
            "gsb": gsb_contribution,
            "urlhaus": uh_contribution,
            "domain": domain_contribution,
            "url_pattern": url_pattern_score
        },
        "color": color,
        "should_block": final_score >= 80,
        "authoritative_hit": is_authoritative_threat
    }
