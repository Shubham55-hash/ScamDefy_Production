import urllib.parse
import re
from typing import Dict, Any, List

FAMOUS_BRANDS = [
    # Financial
    "paypal", "paytm", "gpay", "googlepay", "phonepe", "razorpay",
    "stripe", "venmo", "cashapp", "zelle", "wise", "revolut",
    "bankofamerica", "chase", "wellsfargo", "citibank", "hsbc",
    "barclays", "sbi", "hdfc", "icici", "axis", "kotak", "pnb",
    # Tech Giants
    "google", "gmail", "youtube", "apple", "icloud", "microsoft",
    "windows", "outlook", "hotmail", "office365", "azure",
    "amazon", "aws", "facebook", "instagram", "whatsapp", "meta",
    "twitter", "linkedin", "tiktok", "snapchat", "telegram",
    # E-commerce / Delivery
    "flipkart", "myntra", "snapdeal", "nykaa", "meesho",
    "ebay", "alibaba", "aliexpress", "shopify", "etsy",
    "fedex", "dhl", "ups", "usps", "bluedart",
    # Government / Official
    "irs", "uidai", "aadhar", "incometax", "epfo", "npci",
    "irctc", "nsdl",
    # Crypto
    "binance", "coinbase", "bitcoin", "ethereum",
    "metamask", "opensea", "bybit", "okx",
    # Misc high-value
    "netflix", "spotify", "adobe", "dropbox", "zoom",
    "support", "helpdesk", "secure", "verify", "signin", "login",
    "account", "update", "confirm", "wallet", "reward", "prize",
]

LEGITIMATE_BRAND_DOMAINS = {
    "google.com", "gmail.com", "youtube.com", "googlemail.com",
    "apple.com", "icloud.com", "me.com",
    "microsoft.com", "outlook.com", "hotmail.com", "live.com",
    "amazon.com", "amazon.in", "amazon.co.uk",
    "facebook.com", "instagram.com", "whatsapp.com", "meta.com",
    "twitter.com", "x.com", "linkedin.com",
    "paypal.com", "paypal.in",
    "netflix.com", "spotify.com",
    "flipkart.com", "myntra.com",
    "sbi.co.in", "onlinesbi.sbi", "hdfcbank.com", "icicibank.com",
    "incometax.gov.in", "uidai.gov.in", "irctc.co.in",
    "binance.com", "coinbase.com",
}


def _root_domain(hostname: str) -> str:
    parts = hostname.lower().replace("www.", "").split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else hostname


def get_brand_impersonation(hostname: str) -> Dict[str, Any]:
    hostname_clean = hostname.lower().replace("www.", "")
    root = _root_domain(hostname_clean)
    if root in LEGITIMATE_BRAND_DOMAINS:
        return {"impersonates": None, "weight": 0}
    for brand in FAMOUS_BRANDS:
        if brand in hostname_clean:
            return {
                "impersonates": brand,
                "weight": 70,
                "detail": f"Impersonating '{brand}' — not the official domain",
            }
    return {"impersonates": None, "weight": 0}


def calculate_url_pattern_score(url: str) -> float:
    score = 0
    try:
        url_lower = url.lower()
        parsed_url = urllib.parse.urlparse(url_lower)
        hostname = parsed_url.hostname or ""

        # 1. Non-HTTPS is a significant signal but not definitive
        if parsed_url.scheme == "http":
            score += 35

        # 2. Length based signals
        if len(url) > 80:  score += 15
        if len(url) > 150: score += 15

        # 3. Keyword Analysis (EVERYWHERE in the URL)
        SUSPICIOUS_KEYWORDS = [
            "login", "verify", "update", "confirm", "secure", "account",
            "signin", "password", "credential", "banking", "otp", "wallet",
            "support", "service", "billing", "security", "customer", "invoice"
        ]
        keywords_found = 0
        for kw in SUSPICIOUS_KEYWORDS:
            if kw in url_lower:
                keywords_found += 1
        
        score += min(keywords_found * 15, 60)

        # 4. Technical anomalies
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname):
            score += 60
        
        # Multiple hyphens / dots in hostname
        if hostname.count('-') >= 2: score += 15
        if hostname.count('.') >= 3: score += 20

        # 5. Suspicious character encoding (Hides URL from human eyes)
        if "%2f" in url_lower or "%40" in url_lower or "@" in hostname:
            score += 40

        # 6. High-risk TLDs
        SUS_TLDS = [".xyz", ".tk", ".ml", ".ga", ".cf", ".gq", ".pw", ".top", ".click", ".zip"]
        if any(hostname.endswith(tld) for tld in SUS_TLDS):
            score += 40

    except Exception:
        return 0.0

    return float(min(score, 100))


def score(
    gsb_result: Dict[str, Any],
    uh_result: Dict[str, Any],
    domain_result: Dict[str, Any],
    url: str,
    domain_age_result: Dict[str, Any] = None,
) -> Dict[str, Any]:
    gsb_threat = gsb_result.get("is_threat", False)
    uh_threat  = uh_result.get("is_phishing", False)

    domain_contribution = float(domain_result.get("risk_contribution", 0.0))
    url_pattern_score   = float(calculate_url_pattern_score(url))

    # Domain Age Signal
    age_score  = 0.0
    age_reason = None
    if domain_age_result:
        age_days = domain_age_result.get("age_days")
        if age_days is not None:
            if age_days < 7:
                age_score  = 90.0
                age_reason = f"Domain is only {age_days} day(s) old — brand-new domains are a major phishing indicator"
            elif age_days < 30:
                age_score  = 70.0
                age_reason = f"Domain registered {age_days} days ago — very recently created"
            elif age_days < 90:
                age_score  = 50.0
                age_reason = f"Domain is {age_days} days old — under 3 months, suspicious for impersonation"
            elif age_days < 180:
                age_score  = 25.0
                age_reason = f"Domain registered {age_days} days ago — less than 6 months old"

    # Brand Impersonation Signal
    impersonation_score  = 0.0
    impersonation_reason = None
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.netloc.lower()
        imp = get_brand_impersonation(hostname)
        if imp["impersonates"]:
            impersonation_score  = float(imp["weight"])
            impersonation_reason = imp["detail"]
    except Exception:
        pass

    for flag in domain_result.get("flags", []):
        if flag.get("type") in ("BRAND_IMPERSONATION", "CHARACTER_SUBSTITUTION", "TYPOSQUATTING"):
            w = float(flag.get("weight", 60))
            if w > impersonation_score:
                impersonation_score  = w
                impersonation_reason = flag.get("detail", impersonation_reason)

    # 1. Calculate weighted contributions
    gsb_contrib   = 100.0 if gsb_threat else 0.0
    uh_contrib    = 100.0 if uh_threat  else 0.0
    
    # Authoritative hit (GSB/URLHaus) is the primary signal
    auth_val = max(gsb_contrib, uh_contrib)
    
    # Raw components for heuristics
    # Weights: Auth 40%, Domain 15%, Pattern 15%, Age 15%, Impersonation 15%
    c_auth    = auth_val * 0.40
    c_domain  = domain_contribution * 0.15
    c_pattern = url_pattern_score   * 0.15
    c_age     = age_score           * 0.15
    c_imp     = impersonation_score * 0.15
    
    # Preliminary weighted sum
    weighted_sum = c_auth + c_domain + c_pattern + c_age + c_imp
    
    # 2. Determine final score with overrides
    final_score = weighted_sum
    is_authoritative_threat = gsb_threat or uh_threat
    
    if is_authoritative_threat:
        final_score = 100.0
    else:
        # Dynamic bonuses for suspicious combinations instead of hard floors
        # This creates more varied scores (e.g. 64.5, 72.8)
        bonus = 0.0
        
        # Scenario A: Brand Impersonation + High Risk TLD or Anomalies
        if impersonation_score > 0:
            if url_pattern_score > 50: bonus += 15.0
            elif url_pattern_score > 30: bonus += 10.0
            
            # Scenario B: Brand Impersonation + New Domain
            if age_score > 50: bonus += 20.0
            elif age_score > 20: bonus += 10.0
        
        # Scenario C: Just a very suspicious URL pattern
        elif url_pattern_score > 70:
            bonus += 15.0
            
        final_score = min(100.0, weighted_sum + bonus)
        
        # Low floor to ensure detected threats are visible as at least CAUTION
        if (impersonation_score > 0 or age_score > 40 or url_pattern_score > 40) and final_score < 30:
            final_score = 30.0
    
    # 3. Normalization logic: Scale components so they sum to final_score
    # This ensures the breakdown shown to the user is intuitive.
    if final_score > 0:
        if weighted_sum > 0:
            ratio = final_score / weighted_sum
        else:
            # If all signals were 0 but final_score > 0 (shouldn't happen with current logic),
            # we don't have a breakdown to show.
            ratio = 1.0
            
        n_gsb     = (gsb_contrib * 0.40) * ratio if gsb_threat else 0.0
        n_uh      = (uh_contrib  * 0.40) * ratio if uh_threat  else 0.0
        n_domain  = c_domain  * ratio
        n_pattern = c_pattern * ratio
        n_age     = c_age     * ratio
        n_imp     = c_imp     * ratio
    else:
        n_gsb = n_uh = n_domain = n_pattern = n_age = n_imp = 0.0

    verdict = "SAFE"
    color   = "#22c55e"
    if final_score >= 80:
        verdict = "BLOCKED"
        color   = "#ef4444"
    elif final_score >= 60:
        verdict = "DANGER"
        color   = "#f97316"
    elif final_score >= 30:
        verdict = "CAUTION"
        color   = "#f59e0b"

    reasons: List[str] = []
    if gsb_threat:
        reasons.append("🚫 Confirmed threat: Listed on Google Safe Browsing")
    if uh_threat:
        reasons.append("🚫 Malware/Phishing: Identified by URLHaus")
    if impersonation_reason:
        reasons.append(f"⚠️ Brand Risk: {impersonation_reason}")
    if age_reason:
        reasons.append(f"🕐 Age Risk: {age_reason}")
    elif domain_age_result and domain_age_result.get("age_days") is not None:
        reasons.append(f"• Domain Age: {domain_age_result['age_days']} days")
    
    domain_flags = [f.get("detail", "") for f in domain_result.get("flags", []) 
                    if f.get("detail", "") != impersonation_reason]
    for df in domain_flags[:3]:
        reasons.append(f"• {df}")

    if url_pattern_score >= 30:
        reasons.append(f"• Suspicious URL characteristics detected")

    return {
        "url":          url,
        "score":        round(final_score, 1),
        "verdict":      verdict,
        "breakdown": {
            "gsb":           round(n_gsb, 1),
            "urlhaus":       round(n_uh, 1),
            "domain":        round(n_domain, 1),
            "url_pattern":   round(n_pattern, 1),
            "domain_age":    round(n_age, 1),
            "impersonation": round(n_imp, 1),
        },
        "color":             color,
        "should_block":      final_score >= 60,
        "authoritative_hit": is_authoritative_threat,
        "reasons":           reasons,
    }
