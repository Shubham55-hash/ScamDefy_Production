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

function levenshtein(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;

  const d = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[a.length][b.length];
}

function _getDomainParts(hostname) {
  const parts = hostname.split('.');
  if (parts.length < 2) return { main: hostname, tld: '', root: hostname };

  // Heuristic for common multi-part TLDs
  const secondToLast = parts[parts.length - 2];
  const list = ["com", "co", "gov", "org", "edu", "net", "ac", "sch", "res"];
  if (list.includes(secondToLast)) {
    if (parts.length >= 3) {
      return {
        main: parts[parts.length - 3],
        tld: "." + parts.slice(-2).join('.'),
        root: parts.slice(-3).join('.')
      };
    }
  }

  return {
    main: parts[parts.length - 2],
    tld: "." + parts[parts.length - 1],
    root: parts.slice(-2).join('.')
  };
}

function extractDomainInfo(urlStr) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const { main, tld, root } = _getDomainParts(hostname);
    
    return { hostname, tld, mainDomainPart: main, fullDomain: root, parts: hostname.split('.') };
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

  // 1. Typosquatting and Character Substitution Detection
  if (!LEGIT_DOMAINS.includes(fullDomain)) {
    for (const legit of LEGIT_DOMAINS) {
      const legitName = legit.split('.')[0];
      
      // Check substitutions first (higher priority/weight)
      const cleanMain = mainDomainPart.replace(/1/g, 'l').replace(/0/g, 'o').replace(/rn/g, 'm');
      if (cleanMain === legitName && mainDomainPart !== legitName) {
        flags.push({ type: "CHARACTER_SUBSTITUTION", detail: `Substitutions found simulating ${legit}`, weight: 80 });
        riskContribution += 80;
        break;
      }

      const dist = levenshtein(mainDomainPart, legitName);
      if (dist <= 2) {
        flags.push({ type: "TYPOSQUATTING", detail: `Similar to ${legit}`, weight: 60 });
        riskContribution += 60;
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
