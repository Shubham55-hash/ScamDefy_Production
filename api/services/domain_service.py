import urllib.parse
from typing import Dict, Any, List

LEGIT_DOMAINS = [
    "google.com", "google.co.in", "google.co.uk", "gmail.com", "youtube.com",
    "apple.com", "icloud.com", "microsoft.com", "outlook.com", "amazon.com", "amazon.in",
    "facebook.com", "instagram.com", "whatsapp.com", "netflix.com", "spotify.com",
    "paypal.com", "paytm.com", "phonepe.com", "stripe.com",
    "bankofamerica.com", "chase.com", "wellsfargo.com", "citi.com", 
    "sbi.co.in", "hdfcbank.com", "icicibank.com", "incometax.gov.in", "uidai.gov.in"
]

PROTECTED_BRANDS = [
    "paypal", "google", "amazon", "microsoft", "apple", "facebook", "instagram", "netflix",
    "bank", "secure", "login", "verify", "paytm", "gpay", "phonepe", "razorpay", "stripe",
    "binance", "coinbase", "bitcoin", "ethereum", "meta", "whatsapp", "twitter", "linkedin",
    "fedex", "dhl", "ups", "irs", "aadhar", "uidai", "support", "help", "billing"
]

SUSPICIOUS_TLDS = [
    ".xyz", ".tk", ".ml", ".ga", ".cf", ".gq",
    ".pw", ".top", ".click", ".download", ".zip", ".review", ".country"
]

def levenshtein(a: str, b: str) -> int:
    """
    Damerau-Levenshtein distance (Optimal String Alignment distance).
    Handles insertions, deletions, substitutions, and transpositions.
    """
    if not a: return len(b)
    if not b: return len(a)
    
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    
    for i in range(len(a) + 1): d[i][0] = i
    for j in range(len(b) + 1): d[0][j] = j
    
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i-1] == b[j-1] else 1
            d[i][j] = min(
                d[i-1][j] + 1,      # deletion
                d[i][j-1] + 1,      # insertion
                d[i-1][j-1] + cost   # substitution
            )
            if i > 1 and j > 1 and a[i-1] == b[j-2] and a[i-2] == b[j-1]:
                d[i][j] = min(d[i][j], d[i-2][j-2] + 1) # transposition
                
    return d[len(a)][len(b)]

def _get_main_domain_and_tld(hostname: str):
    """
    TLD-aware extraction of the main domain part and the full domain (root).
    Handles multi-part TLDs like .co.uk, .gov.in, etc.
    """
    parts = hostname.lower().split('.')
    if len(parts) < 2:
        return hostname, "", hostname

    # Heuristic for common multi-part TLDs
    # In a full system we'd use tldextract or public suffix list
    second_to_last = parts[-2]
    if second_to_last in ("com", "co", "gov", "org", "edu", "net", "ac", "sch", "res"):
        if len(parts) >= 3:
            tld = "." + ".".join(parts[-2:])
            main = parts[-3]
            root = ".".join(parts[-3:])
            return main, tld, root
    
    tld = "." + parts[-1]
    main = parts[-2]
    root = ".".join(parts[-2:])
    return main, tld, root

def analyze(url: str) -> Dict[str, Any]:
    flags = []
    risk_contribution = 0
    
    try:
        parsed_url = urllib.parse.urlparse(url)
        # Handle cases where url might not have a scheme
        hostname = (parsed_url.netloc or parsed_url.path).lower().replace("www.", "")
        if not hostname:
            return {"domain": url, "flags": [], "risk_contribution": 0, "is_suspicious": False}
            
        main_domain_part, tld, full_domain = _get_main_domain_and_tld(hostname)
        parts = hostname.split('.')
        
        # 1. Typosquatting and Character Substitution
        if full_domain not in LEGIT_DOMAINS:
            for legit in LEGIT_DOMAINS:
                legit_name = legit.split('.')[0]
                
                # Check character substitution first as it usually has higher weight/severity
                clean_main = main_domain_part.replace('1', 'l').replace('0', 'o').replace('rn', 'm')
                if clean_main == legit_name and main_domain_part != legit_name:
                    flags.append({"type": "CHARACTER_SUBSTITUTION", "detail": f"Substitutions found simulating {legit}", "weight": 80})
                    risk_contribution += 80
                    break
                
                dist = levenshtein(main_domain_part, legit_name)
                # Catch exact brand name on different TLD (dist == 0) or small typos (dist 1-2)
                if dist <= 2:
                    flags.append({"type": "TYPOSQUATTING", "detail": f"Similar to {legit}", "weight": 60})
                    risk_contribution += 60
                    break

        # 2. Suspicious TLD
        if tld in SUSPICIOUS_TLDS:
            flags.append({"type": "SUSPICIOUS_TLD", "detail": f"Uses high-risk TLD: {tld}", "weight": 20})
            risk_contribution += 20
            
        # 3. Subdomain Depth
        subdomain_count = len(parts) - (2 if tld.count('.') == 1 else 3)
        if subdomain_count > 2:
            flags.append({"type": "DEEP_SUBDOMAIN", "detail": f"Has {subdomain_count} subdomains", "weight": 30})
            risk_contribution += 30
            
        # 4. Hyphen Abuse
        hyphen_count = hostname.count('-')
        if hyphen_count >= 3:
            flags.append({"type": "HYPHEN_ABUSE", "detail": f"Contains {hyphen_count} hyphens", "weight": 20})
            risk_contribution += 20
            
        # 5. Brand Impersonation
        if full_domain not in LEGIT_DOMAINS:
            for brand in PROTECTED_BRANDS:
                if brand in hostname:
                    flags.append({"type": "BRAND_IMPERSONATION", "detail": f"Contains protected brand name '{brand}'", "weight": 50})
                    risk_contribution += 50
                    break
                    
        # 6. Punycode
        if hostname.startswith('xn--') or any(p.startswith('xn--') for p in parts):
            flags.append({"type": "PUNYCODE_HOMOGRAPH", "detail": "Uses IDN/Punycode encoding", "weight": 70})
            risk_contribution += 70

        risk_contribution = min(risk_contribution, 100)
        
        return {
            "domain": hostname,
            "flags": flags,
            "risk_contribution": risk_contribution,
            "is_suspicious": risk_contribution >= 30
        }
        
    except Exception as exc:
        return {"domain": url, "flags": [{"type": "ERROR", "detail": str(exc), "weight": 0}], "risk_contribution": 0, "is_suspicious": False}

