from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import os
import asyncio
import time
import uuid
import re as _re
from datetime import datetime, timezone

from utils.url_expander import expand_url_backend
from services.gsb_service import check_url as check_gsb
from services.urlhaus_service import check_url as check_urlhaus
from services.domain_service import analyze as analyze_domain
from services.risk_service import score as calculate_score
from services.ai_service import generate_explanation, analyze_message_ai
from services.domain_age_service import get_domain_age
from utils.threat_logger import log_threat
from utils.report_manager import add_report, get_report_counts


def normalize_url(url: str) -> str:
    url = url.strip()
    if not _re.match(r'^https?://', url, _re.IGNORECASE):
        url = "http://" + url
    if url.endswith("/"):
        url = url[:-1]
    if "#" in url:
        url = url.split("#")[0]
    return url


import urllib.parse as _urlparse

def validate_url_input(raw: str) -> Optional[str]:
    """
    Returns an error message string if the input is not a valid URL,
    or None if it is valid.
    """
    trimmed = raw.strip()
    if not trimmed:
        return "URL cannot be empty."
    # Reject inputs with spaces — they're sentences/messages, not URLs
    if _re.search(r'\s', trimmed):
        return "Invalid URL: input contains spaces. Please use the Message Scanner for text."
    # Add scheme for parsing if missing
    with_scheme = trimmed if _re.match(r'^https?://', trimmed, _re.IGNORECASE) else 'http://' + trimmed
    try:
        parsed = _urlparse.urlparse(with_scheme)
        host = parsed.hostname or ''
        if not host or '.' not in host:
            return f"'{trimmed}' is not a valid URL — must contain a domain (e.g. google.com)."
    except Exception:
        return f"'{trimmed}' could not be parsed as a URL."
    return None


router = APIRouter()


class ScanRequest(BaseModel):
    url: str
    gsb_key: Optional[str] = None
    gemini_key: Optional[str] = None


class ExplainRequest(BaseModel):
    url: str
    score: float
    verdict: str
    flags: list
    api_key: Optional[str] = None


scan_cache = {}


def _flags_to_scam_type(flags: list) -> str:
    priority = [
        "GSB_THREAT", "URLHAUS_MALWARE", "TYPOSQUATTING", "CHARACTER_SUBSTITUTION",
        "BRAND_IMPERSONATION", "PUNYCODE_HOMOGRAPH", "DEEP_SUBDOMAIN",
        "SUSPICIOUS_TLD", "HYPHEN_ABUSE",
    ]
    for f in priority:
        if f in flags:
            return f.replace("_", " ").title()
    return "Suspicious URL" if flags else "Clean"


def _score_to_risk_level(score: float) -> str:
    if score >= 80: return "CRITICAL"
    if score >= 60: return "HIGH"
    if score >= 30: return "MEDIUM"
    return "LOW"


@router.post("/scan")
async def scan_url_post(req: ScanRequest, bypass_cache: bool = False):
    err = validate_url_input(req.url)
    if err:
        return {"error": True, "message": err, "url": req.url}
    normalized = normalize_url(req.url)
    return await run_scan_pipeline(normalized, bypass_cache, gsb_key=req.gsb_key, gemini_key=req.gemini_key)


@router.get("/scan")
async def scan_url_get(url: str, bypass_cache: bool = False, gsb_key: str = None, gemini_key: str = None):
    err = validate_url_input(url)
    if err:
        return {"error": True, "message": err, "url": url}
    normalized = normalize_url(url)
    return await run_scan_pipeline(normalized, bypass_cache, gsb_key, gemini_key)


async def run_scan_pipeline(url: str, bypass_cache: bool = False, gsb_key: str = None, gemini_key: str = None):
    start_time = time.time()

    if not bypass_cache and url in scan_cache:
        result = dict(scan_cache[url])
        result["cached"] = True
        result["scan_time_ms"] = int((time.time() - start_time) * 1000)
        # Always get fresh community reports even for cached results
        result["community_reports"] = get_report_counts(url)
        return result

    if "scamdefy-test-block.com" in url:
        return {
            "id":           str(uuid.uuid4()),
            "url":          url,
            "final_url":    url,
            "expanded":     False,
            "score":        100.0,
            "verdict":      "BLOCKED",
            "risk_level":   "CRITICAL",
            "scam_type":    "Phishing Test Detected",
            "color":        "#ef4444",
            "should_block": True,
            "breakdown": {
                "gsb": 0.0, "urlhaus": 100.0, "domain": 0.0, "url_pattern": 0.0, "domain_age": 0.0, "impersonation": 0.0, "heuristics": 0.0, "virustotal": 0.0
            },
            "domain_age": { "age_days": 2, "registered_on": "2026-03-14", "source": "mock" },
            "signals": [
                {"name": "URLhaus Malware", "points": 100, "severity": "CRITICAL"},
            ],
            "explanation":  "(Test) This is a demonstration of the ScamDefy blocking feature.",
            "reasons":      ["🚫 Identified as a test phishing URL by ScamDefy local mock"],
            "flags":        ["URLHAUS_MALWARE"],
            "cached":       False,
            "scan_time_ms": 10,
            "timestamp":    datetime.now(timezone.utc).isoformat(),
        }

    expand_result = await expand_url_backend(url)
    final_url = expand_result.get("final_url", url)
    expanded  = expand_result.get("hop_count", 0) > 0

    results = await asyncio.gather(
        check_gsb(final_url, api_key=gsb_key),
        check_urlhaus(final_url),
        _async_analyze_domain(final_url),
        get_domain_age(final_url),
    )

    gsb_result, uh_result, domain_result, domain_age_result = results

    risk_result = calculate_score(
        gsb_result,
        uh_result,
        domain_result,
        final_url,
        domain_age_result=domain_age_result,
    )

    flags = [f["type"] for f in domain_result.get("flags", [])]
    if gsb_result.get("is_threat"):   flags.append("GSB_THREAT")
    if uh_result.get("is_phishing"):  flags.append("URLHAUS_MALWARE")
    if domain_age_result.get("age_days") is not None and domain_age_result["age_days"] < 90:
        flags.append("NEW_DOMAIN")
    if risk_result["breakdown"].get("impersonation", 0) > 0:
        if "BRAND_IMPERSONATION" not in flags:
            flags.append("BRAND_IMPERSONATION")

    explanation = ""
    reasons = risk_result.get("reasons", [])
    if risk_result["score"] > 30:
        reasons_str = "; ".join(reasons[:4]) if reasons else ""
        explanation = await generate_explanation(
            final_url,
            risk_result["score"],
            risk_result["verdict"],
            flags,
            extra_context=reasons_str,
            api_key=gemini_key,
        )
    elif reasons:
        explanation = " ".join(reasons[:2])

    signals = []
    for f in flags:
        severity = (
            "CRITICAL" if f in ("GSB_THREAT", "URLHAUS_MALWARE") else
            "HIGH"     if f in ("TYPOSQUATTING", "CHARACTER_SUBSTITUTION",
                                 "BRAND_IMPERSONATION", "PUNYCODE_HOMOGRAPH", "NEW_DOMAIN") else
            "MEDIUM"
        )
        points = (
            40 if f in ("GSB_THREAT", "URLHAUS_MALWARE") else
            30 if f in ("BRAND_IMPERSONATION", "TYPOSQUATTING", "NEW_DOMAIN") else
            20
        )
        signals.append({"name": f.replace("_", " ").title(), "points": points, "severity": severity})

    response_data = {
        "id":           str(uuid.uuid4()),
        "url":          url,
        "final_url":    final_url,
        "expanded":     expanded,
        "score":        risk_result["score"],
        "verdict":      risk_result["verdict"],
        "risk_level":   _score_to_risk_level(risk_result["score"]),
        "scam_type":    _flags_to_scam_type(flags),
        "color":        risk_result["color"],
        "should_block": risk_result["should_block"],
        "breakdown": {
            "gsb":           risk_result["breakdown"]["gsb"],
            "urlhaus":       risk_result["breakdown"]["urlhaus"],
            "domain":        risk_result["breakdown"]["domain"],
            "url_pattern":   risk_result["breakdown"]["url_pattern"],
            "domain_age":    risk_result["breakdown"].get("domain_age", 0.0),
            "impersonation": risk_result["breakdown"].get("impersonation", 0.0),
            "heuristics":    risk_result["breakdown"]["url_pattern"],
            "virustotal":    0.0,
        },
        "domain_age": {
            "age_days":      domain_age_result.get("age_days"),
            "registered_on": domain_age_result.get("registered_on"),
            "source":        domain_age_result.get("source", "unknown"),
        },
        "signals":      signals,
        "explanation":  explanation,
        "reasons":      reasons,
        "flags":        flags,
        "cached":       False,
        "scan_time_ms": int((time.time() - start_time) * 1000),
        "timestamp":    datetime.now(timezone.utc).isoformat(),
        "community_reports": get_report_counts(url),
    }

    scan_cache[url] = response_data
    
    # Log to Surveillance if score >= 30
    if risk_result["score"] >= 30:
        log_threat(
            id=response_data["id"],
            url=response_data["url"],
            risk_level=response_data["risk_level"],
            score=response_data["score"],
            scam_type=response_data["scam_type"],
            explanation=response_data["explanation"],
            signals=flags, # log_threat expects List[str]
            breakdown=response_data["breakdown"],
            domain_age=response_data["domain_age"]
        )

    return response_data


async def _async_analyze_domain(url: str):
    return analyze_domain(url)


@router.post("/explain")
async def explain_url(req: ExplainRequest):
    explanation = await generate_explanation(req.url, req.score, req.verdict, req.flags, api_key=req.api_key)
    return {"explanation": explanation}


class MessageRequest(BaseModel):
    text: str
    gemini_key: Optional[str] = None


@router.post("/analyze-message")
async def analyze_message(req: MessageRequest):
    text = req.text.strip()
    
    # Quick Check: If input is too short or just a single word, it's not a message-based scam
    words = text.split()
    if len(text) < 5 or (len(words) == 1 and "." not in text):
        return {
            "scan_type":         "message",
            "risk_level":        "SAFE",
            "risk_score":        0.0,
            "scam_category":     "Appears Legitimate",
            "signals_triggered": [],
            "recommendation":    "This input is too short to be a structured scam message.",
            "user_alert":        "No scam signals detected in this short text.",
            "link_count":        0
        }
    
    # 1. Extract URLs from message
    # Regex to find standard http/https links
    url_pattern = r'https?://[^\s<>"]+|www\.[^\s<>"]+'
    found_urls = _re.findall(url_pattern, text)
    
    link_results = []
    if found_urls:
        # Scan each found URL using the full pipeline
        for raw_url in found_urls[:3]: # limit to first 3 links
            url = raw_url if raw_url.startswith("http") else "http://" + raw_url
            try:
                res = await run_scan_pipeline(url, bypass_cache=False, gemini_key=req.gemini_key)
                link_results.append(res)
            except: continue

    # 2. Run AI Context Analysis on the text
    ai_result = await analyze_message_ai(text, api_key=req.gemini_key)
    
    # 3. Decision Logic & Scoring
    # Start with AI score as baseline
    final_score = float(ai_result.get("score", 0))
    risk_level = ai_result.get("verdict", "SAFE")
    scam_category = ai_result.get("scam_category", "Social Engineering")
    user_alert = ai_result.get("explanation", "No immediate scam signals detected.")
    signals_triggered = [{"name": s, "points": 20, "severity": "MEDIUM"} for s in ai_result.get("signals", [])]

    # Overlay Link Results if a malicious link is found
    malicious_link = next((l for l in link_results if l.get("score", 0) > 40), None)
    
    if malicious_link:
        # If a link is bad, upgrade to DANGER/CRITICAL level (SCAM)
        final_score = max(final_score, malicious_link["score"])
        risk_level = "CRITICAL" if final_score >= 80 else "DANGER"
        scam_category = f"Phishing / {malicious_link['scam_type']}"
        user_alert = f"WARNING: Malicious link detected ({malicious_link['url']})! {malicious_link['explanation']}"
        
        # Add link signal
        signals_triggered.append({
            "name": "Malicious Link Detected",
            "points": int(malicious_link["score"]),
            "severity": "CRITICAL" if final_score >= 80 else "HIGH"
        })
    else:
        # No bad links, use AI verdict but cap at SUSPICIOUS (not SCAM) per user request
        if risk_level in ("DANGER", "CRITICAL", "SCAM"):
             risk_level = "SUSPICIOUS"
             if final_score > 60: final_score = 60 # Cap score for text-only
    
    # Map AI DANGER to app-specific risk levels if needed
    if not malicious_link:
        if risk_level == "DANGER": risk_level = "HIGH"
        if risk_level == "CRITICAL": risk_level = "HIGH"

    # Log to surveillance if significant
    if final_score >= 15:
        log_threat(
            id=str(uuid.uuid4()),
            url=f"Msg: {text[:40]}...",
            risk_level=risk_level,
            score=float(final_score),
            scam_type=scam_category,
            explanation=user_alert,
            signals=[s["name"] for s in signals_triggered]
        )

    return {
        "scan_type":         "message",
        "risk_level":        risk_level,
        "risk_score":        final_score,
        "scam_category":     scam_category,
        "signals_triggered": signals_triggered,
        "recommendation":    "Verify sender identity and never click unexpected links or share sensitive codes.",
        "user_alert":        user_alert,
        "link_count":        len(found_urls)
    }


class ReportRequest(BaseModel):
    url: str
    reason: str         # 'scam' | 'false_positive'
    notes: str = ""


@router.post("/report")
async def report_url(req: ReportRequest):
    counts = add_report(req.url, req.reason, req.notes)
    return {
        "status": "received",
        "message": "Thank you for your report.",
        "community_reports": counts,
    }


@router.get("/report-counts")
async def get_report_counts_endpoint(url: str):
    """Fetch current community report counts for a URL without scanning."""
    return get_report_counts(url)
