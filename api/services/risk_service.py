import urllib.parse
import re
from typing import Dict, Any, List
from services.domain_service import levenshtein

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
    # Search & Tech
    "google.com", "google.co.in", "google.co.uk", "google.com.br", "gmail.com", "youtube.com", "googlemail.com",
    "apple.com", "icloud.com", "me.com", "appleid.apple.com",
    "microsoft.com", "outlook.com", "hotmail.com", "live.com", "office.com", "bing.com",
    "amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amazon.co.jp",
    "facebook.com", "instagram.com", "whatsapp.com", "messenger.com", "meta.com",
    "twitter.com", "x.com", "linkedin.com",
    # Payments
    "paypal.com", "paypal.in", "paytm.com", "phonepe.com", "razorpay.com", "stripe.com",
    # Entertainment
    "netflix.com", "spotify.com", "disneyplus.com",
    # E-commerce
    "flipkart.com", "myntra.com", "ebay.com", "alibaba.com", "aliexpress.com",
    # Banking
    "sbi.co.in", "onlinesbi.sbi", "hdfcbank.com", "icicibank.com", "axisbank.com", "kotak.com",
    # Official
    "incometax.gov.in", "uidai.gov.in", "irctc.co.in", "india.gov.in", "gov.uk", "usa.gov",
    # Crypto
    "binance.com", "coinbase.com", "bitcoin.org", "ethereum.org",
}


def _root_domain(hostname: str) -> str:
    parts = hostname.lower().replace("www.", "").split(".")
    if len(parts) < 2:
        return hostname
        
    # Handle multi-part TLDs like .co.uk, .gov.in
    if parts[-2] in ("com", "co", "gov", "org", "net", "edu", "res", "sch", "ac"):
        if len(parts) >= 3:
            return ".".join(parts[-3:])

    return ".".join(parts[-2:])


def get_brand_impersonation(hostname: str) -> Dict[str, Any]:
    hostname_clean = hostname.lower().replace("www.", "")
    root = _root_domain(hostname_clean)
    if root in LEGITIMATE_BRAND_DOMAINS:
        return {"impersonates": None, "weight": 0}
        
    main_part = root.split('.')[0]
    
    for brand in FAMOUS_BRANDS:
        # Direct containment check
        if brand in hostname_clean:
            return {
                "impersonates": brand,
                "weight": 70,
                "detail": f"Impersonating '{brand}' — not the official domain",
            }
        
        # Levenshtein check for typosquats in the root domain part
        dist = levenshtein(main_part, brand)
        if dist <= 2:
             return {
                "impersonates": brand,
                "weight": 60,
                "detail": f"Typosquatted impersonation of '{brand}'",
            }
            
    return {"impersonates": None, "weight": 0}


def calculate_url_pattern_score(url: str, is_whitelisted: bool = False) -> float:
    score = 0
    try:
        url_lower = url.lower()
        parsed_url = urllib.parse.urlparse(url_lower)
        hostname = parsed_url.hostname or ""

        # 1. Non-HTTPS is a significant signal but not definitive
        if parsed_url.scheme == "http":
            # Legitimate domains on HTTP are NOT suspicious for scam analysis
            # We zero it out for whitelisted domains to avoid user confusion
            score += 0 if is_whitelisted else 35

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
    # Identify if the domain is a known legitimate brand
    is_whitelisted = False
    try:
        parsed_tmp = urllib.parse.urlparse(url)
        hostname_tmp = (parsed_tmp.netloc or parsed_tmp.path).lower().replace("www.", "")
        root_tmp = _root_domain(hostname_tmp)
        if root_tmp in LEGITIMATE_BRAND_DOMAINS:
            is_whitelisted = True
    except Exception:
        pass

    gsb_threat = gsb_result.get("is_threat", False)
    uh_threat  = uh_result.get("is_phishing", False)

    domain_contribution = float(domain_result.get("risk_contribution", 0.0))
    url_pattern_score   = float(calculate_url_pattern_score(url, is_whitelisted=is_whitelisted))

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
    
    # Rebalanced Weights for a more even distribution
    # Authority 25%, Reputation 15%, Pattern 20%, Age 20%, Impersonation 20%
    c_auth    = auth_val * 0.25
    c_domain  = domain_contribution * 0.15
    c_pattern = url_pattern_score   * 0.20
    c_age     = age_score           * 0.20
    c_imp     = impersonation_score * 0.20
    
    # Preliminary weighted sum
    weighted_sum = c_auth + c_domain + c_pattern + c_age + c_imp
    
    # 2. Determine final score with overrides
    final_score = weighted_sum
    is_authoritative_threat = gsb_threat or uh_threat
    
    if is_authoritative_threat:
        # If it's a known threat, force high score, but spread the "blame"
        final_score = max(90.0, weighted_sum)
        if final_score > 100: final_score = 100.0
    else:
        # Dynamic bonuses for suspicious combinations
        bonus = 0.0
        if impersonation_score > 0:
            if url_pattern_score > 30: bonus += 15.0
            if age_score > 30: bonus += 15.0
        
        final_score = min(100.0, weighted_sum + bonus)
        
        # Floor for caution
        if (impersonation_score > 0 or age_score > 40) and final_score < 35:
            final_score = 35.0
    
    # 3. Normalization logic: Scale components to reach final_score
    if final_score > 0:
        # Total weight available to distribute
        denominator = weighted_sum if weighted_sum > 0 else 1.0
        ratio = final_score / denominator
            
        n_gsb     = (gsb_contrib * 0.25) * ratio if gsb_threat else 0.0
        n_uh      = (uh_contrib  * 0.25) * ratio if uh_threat  else 0.0
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
