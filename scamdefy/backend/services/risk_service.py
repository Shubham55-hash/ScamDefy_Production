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
        parsed_url = urllib.parse.urlparse(url)

        if parsed_url.scheme != "https":
            score += 35

        if len(url) > 100:
            score += 20
        if len(url) > 200:
            score += 20

        params = urllib.parse.parse_qs(parsed_url.query)
        if len(params.keys()) > 4:
            score += 15
        if len(params.keys()) > 8:
            score += 10

        hostname = parsed_url.hostname or ""
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname):
            score += 60

        path_lower = (parsed_url.path or "").lower()
        for kw in ["login", "verify", "update", "confirm", "secure", "account",
                   "signin", "password", "credential", "banking", "otp"]:
            if kw in path_lower:
                score += 10
                break

        if "%2f" in url.lower() or "%40" in url.lower() or "data:" in url.lower():
            score += 30

    except Exception:
        score = 50

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

    gsb_contribution = 100.0 if gsb_threat else 0.0
    uh_contribution  = 100.0 if uh_threat  else 0.0

    final_score = (
        gsb_contribution    * 0.40 +
        uh_contribution     * 0.30 +
        domain_contribution * 0.12 +
        url_pattern_score   * 0.08 +
        age_score           * 0.06 +
        impersonation_score * 0.04
    )

    if not gsb_threat and not uh_threat:
        if impersonation_score >= 60 and age_score >= 50:
            final_score = max(final_score, 70.0)
        elif impersonation_score >= 60:
            final_score = max(final_score, 55.0)
        elif age_score >= 70:
            final_score = max(final_score, 50.0)

    is_authoritative_threat = gsb_threat or uh_threat
    if is_authoritative_threat:
        final_score = 100.0

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
        reasons.append("🚫 Listed on Google Safe Browsing as a confirmed threat")
    if uh_threat:
        reasons.append("🚫 Identified as phishing/malware by URLHaus database")
    if impersonation_reason:
        reasons.append(f"⚠️ Brand impersonation detected: {impersonation_reason}")
    if age_reason:
        reasons.append(f"🕐 Domain age risk: {age_reason}")
    for flag in domain_result.get("flags", []):
        detail = flag.get("detail", "")
        if detail and detail != impersonation_reason:
            reasons.append(f"• {detail}")
    if url_pattern_score >= 35:
        reasons.append(f"• Suspicious URL structure detected (score: {url_pattern_score:.0f}/100)")

    return {
        "url":          url,
        "score":        round(final_score, 1),
        "verdict":      verdict,
        "breakdown": {
            "gsb":           gsb_contribution,
            "urlhaus":       uh_contribution,
            "domain":        domain_contribution,
            "url_pattern":   url_pattern_score,
            "domain_age":    age_score,
            "impersonation": impersonation_score,
        },
        "color":             color,
        "should_block":      final_score >= 60,
        "authoritative_hit": is_authoritative_threat,
        "reasons":           reasons,
    }
