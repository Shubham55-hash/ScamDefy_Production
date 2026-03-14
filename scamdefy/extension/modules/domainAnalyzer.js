const LEGIT_DOMAINS = [
  "google.com", "paypal.com", "amazon.com", "microsoft.com", 
  "apple.com", "facebook.com", "instagram.com", "netflix.com",
  "bankofamerica.com", "chase.com", "wellsfargo.com", "citi.com"
];

const PROTECTED_BRANDS = [
  "paypal", "google", "amazon", "microsoft", "apple",
  "facebook", "instagram", "netflix", "bank", "secure", "login", "verify"
];

const SUSPICIOUS_TLDS = [
  ".xyz", ".tk", ".ml", ".ga", ".cf", ".gq",
  ".pw", ".top", ".click", ".download", ".zip", ".review", ".country"
];

// Levenshtein distance implementation inline
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1  // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function extractDomainInfo(urlStr) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    
    // Split into parts
    const parts = hostname.split('.');
    
    // TLD could be complex (co.uk) but for simplicity we take the last part
    // or known multi-part TLDs. Let's just use the last part for basic TLD check.
    const tld = "." + parts[parts.length - 1];
    
    // Main domain (e.g. "google" from "www.google.com")
    let mainDomainPart = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    let fullDomain = parts.length > 1 ? `${mainDomainPart}${tld}` : hostname;

    return { hostname, tld, mainDomainPart, fullDomain, parts };
  } catch (e) {
    return null;
  }
}

export function analyzeDomain(url) {
  const flags = [];
  let riskContribution = 0;
  
  const domainInfo = extractDomainInfo(url);
  if (!domainInfo) {
    return { domain: url, flags: [{ type: "INVALID_URL", detail: "Could not parse URL", weight: 0 }], risk_contribution: 0, is_suspicious: false };
  }

  const { hostname, tld, mainDomainPart, fullDomain, parts } = domainInfo;

  // 1. Typosquatting Detection
  // Check against top legitimate domains
  if (!LEGIT_DOMAINS.includes(fullDomain)) {
    for (const legit of LEGIT_DOMAINS) {
      const legitParts = legit.split('.');
      const legitName = legitParts[0];
      
      const dist = levenshtein(mainDomainPart, legitName);
      if (dist > 0 && dist <= 2) {
        // Flag as typosquat
        flags.push({ type: "TYPOSQUATTING", detail: `Similar to ${legit}`, weight: 60 });
        riskContribution += 60;
        break; // Only flag once for typosquatting
      }
      
      // Character substitutions check (simple replacements to check equivalence)
      const cleanMain = mainDomainPart.replace(/1/g, 'l').replace(/0/g, 'o').replace(/rn/g, 'm');
      if (cleanMain === legitName && mainDomainPart !== legitName) {
        flags.push({ type: "CHARACTER_SUBSTITUTION", detail: `Substitutions found simulating ${legit}`, weight: 80 });
        riskContribution += 80;
        break;
      }
    }
  }

  // 2. Suspicious TLD Check
  if (SUSPICIOUS_TLDS.includes(tld)) {
    flags.push({ type: "SUSPICIOUS_TLD", detail: `Uses high-risk TLD: ${tld}`, weight: 20 });
    riskContribution += 20;
  }

  // 3. Subdomain Depth
  // a.b.c.google.com -> parts.length = 5. Subdomains = 5 - 2 = 3.
  const subdomainCount = parts.length - 2;
  if (subdomainCount > 3) {
    flags.push({ type: "DEEP_SUBDOMAIN", detail: `Has ${subdomainCount} subdomains`, weight: 30 });
    riskContribution += 30;
  }

  // 4. Hyphen Abuse
  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    flags.push({ type: "HYPHEN_ABUSE", detail: `Contains ${hyphenCount} hyphens`, weight: 20 });
    riskContribution += 20;
  }

  // 5. Brand Impersonation
  // Check if domain contains brand name but is not the official domain
  if (!LEGIT_DOMAINS.includes(fullDomain)) {
    for (const brand of PROTECTED_BRANDS) {
      if (hostname.includes(brand)) {
        flags.push({ type: "BRAND_IMPERSONATION", detail: `Contains protected brand name '${brand}'`, weight: 50 });
        riskContribution += 50;
        break; // Only flag once per brand impersonation check
      }
    }
  }

  // 6. Punycode / Homograph
  if (hostname.startsWith('xn--') || parts.some(p => p.startsWith('xn--'))) {
    flags.push({ type: "PUNYCODE_HOMOGRAPH", detail: "Uses IDN/Punycode encoding", weight: 70 });
    riskContribution += 70;
  }

  // Cap risk at 100
  riskContribution = Math.min(riskContribution, 100);

  return {
    domain: hostname,
    flags,
    risk_contribution: riskContribution,
    is_suspicious: riskContribution >= 30
  };
}

export function healthCheck() {
  try {
    const test1 = analyzeDomain("https://paypa1.com/login");
    const test2 = analyzeDomain("https://google.com/search");
    
    const hasTyposquat = test1.flags.some(f => f.type === "CHARACTER_SUBSTITUTION" || f.type === "TYPOSQUATTING");
    if (!hasTyposquat) {
      return { status: "fail", reason: "Did not flag paypa1.com as typosquatting" };
    }
    
    if (test2.risk_contribution > 0 || test2.is_suspicious) {
      return { status: "fail", reason: "Flagged google.com as suspicious" };
    }
    
    return { status: "ok", reason: "Domain analyzer functioning correctly" };
  } catch (e) {
    return { status: "fail", reason: e.toString() };
  }
}
