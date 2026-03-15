from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import os
import asyncio
import time
import uuid
from datetime import datetime, timezone

from utils.url_expander import expand_url_backend
from services.gsb_service import check_url as check_gsb
from services.urlhaus_service import check_url as check_urlhaus
from services.domain_service import analyze as analyze_domain
from services.risk_service import score as calculate_score
from services.ai_service import generate_explanation

def normalize_url(url: str) -> str:
    """Basic URL normalization to ensure consistent cache keys."""
    url = url.strip().lower()
    if url.endswith('/'):
        url = url[:-1]
    # Remove fragments as they don't affect risk
    if '#' in url:
        url = url.split('#')[0]
    return url

router = APIRouter()

class ScanRequest(BaseModel):
    url: str

class ExplainRequest(BaseModel):
    url: str
    score: float
    verdict: str
    flags: list
    api_key: Optional[str] = None

# In-memory cache
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
    normalized = normalize_url(req.url)
    return await run_scan_pipeline(normalized, bypass_cache)

@router.get("/scan")
async def scan_url_get(url: str, bypass_cache: bool = False):
    normalized = normalize_url(url)
    return await run_scan_pipeline(normalized, bypass_cache)

async def run_scan_pipeline(url: str, bypass_cache: bool = False):
    start_time = time.time()
    
    # Check cache (skip if bypass_cache is true)
    if not bypass_cache and url in scan_cache:
        result = scan_cache[url]
        result["cached"] = True
        result["scan_time_ms"] = int((time.time() - start_time) * 1000)
        return result

    # 1. URL Expander
    expand_result = await expand_url_backend(url)
    final_url = expand_result.get("final_url", url)
    expanded = expand_result.get("hop_count", 0) > 0

    # Parallel execution of checks
    results = await asyncio.gather(
        check_gsb(final_url),
        check_urlhaus(final_url),
        return_analyze_domain(final_url) # Wrapper to handle sync function
    )
    
    gsb_result, uh_result, domain_result = results

    # Score
    risk_result = calculate_score(gsb_result, uh_result, domain_result, final_url)
    
    # AI Explanation if score > 30
    explanation = ""
    flags = [f["type"] for f in domain_result.get("flags", [])]
    if gsb_result.get("is_threat"): flags.append("GSB_THREAT")
    if uh_result.get("is_phishing"): flags.append("URLHAUS_MALWARE")
    
    if risk_result["score"] > 30:
        explanation = await generate_explanation(
            final_url, 
            risk_result["score"], 
            risk_result["verdict"], 
            flags
        )

    signals = [
        {
            "name":     f.replace("_", " ").title(),
            "points":   40 if f in ("GSB_THREAT", "URLHAUS_MALWARE") else 20,
            "severity": "CRITICAL" if f in ("GSB_THREAT", "URLHAUS_MALWARE")
                        else "HIGH" if f in ("TYPOSQUATTING", "CHARACTER_SUBSTITUTION",
                                             "BRAND_IMPERSONATION", "PUNYCODE_HOMOGRAPH")
                        else "MEDIUM",
        }
        for f in flags
    ]

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
            "gsb":         risk_result["breakdown"]["gsb"],
            "urlhaus":     risk_result["breakdown"]["urlhaus"],
            "domain":      risk_result["breakdown"]["domain"],
            "url_pattern": risk_result["breakdown"]["url_pattern"],
            "threatfox":   0.0,
            "heuristics":  risk_result["breakdown"]["url_pattern"],
            "virustotal":  0.0,
        },
        "signals":      signals,
        "explanation":  explanation,
        "flags":        flags,
        "cached":       False,
        "scan_time_ms": int((time.time() - start_time) * 1000),
        "timestamp":    datetime.now(timezone.utc).isoformat(),
    }

    # Cache it
    scan_cache[url] = response_data
    return response_data

async def return_analyze_domain(url: str):
    # run synchronously (it's fast enough)
    return analyze_domain(url)

@router.post("/explain")
async def explain_url(req: ExplainRequest):
    # If the extension passes an API key from the popup, override env
    if req.api_key:
        os.environ["GEMINI_API_KEY"] = str(req.api_key)
        
    explanation = await generate_explanation(
        req.url, 
        req.score, 
        req.verdict, 
        req.flags
    )
    return {"explanation": explanation}


import re as _re


class MessageRequest(BaseModel):
    text: str

class ReportRequest(BaseModel):
    url: str
    reason: str
    notes: str = ""


@router.post("/analyze-message")
async def analyze_message(req: MessageRequest):
    """Keyword + regex heuristic scam analysis of SMS/WhatsApp messages."""
    text_lower = req.text.strip().lower()

    SCAM_SIGNALS = [
        (r"kyc",                "KYC Urgency",           30, "HIGH"),
        (r"verif",              "Verification Lure",      20, "MEDIUM"),
        (r"account.{0,20}block","Account Threat",         35, "HIGH"),
        (r"click here",         "Phishing CTA",           25, "HIGH"),
        (r"prize",              "Prize Scam",             30, "HIGH"),
        (r"lottery",            "Lottery Scam",           30, "HIGH"),
        (r"\botp\b",            "OTP Request",            40, "CRITICAL"),
        (r"\bpin\b",            "PIN Request",            40, "CRITICAL"),
        (r"password",           "Credential Request",     35, "HIGH"),
        (r"urgent",             "Urgency Tactic",         15, "MEDIUM"),
        (r"congratulations",    "Prize Lure",             20, "MEDIUM"),
        (r"\bfree\b",           "Free Offer Lure",        10, "LOW"),
        (r"bank",               "Bank Impersonation",     20, "MEDIUM"),
        (r"refund",             "Refund Scam",            25, "HIGH"),
        (r"suspend",            "Suspension Threat",      30, "HIGH"),
    ]

    signals_triggered = []
    total_score = 0
    for pattern, name, points, severity in SCAM_SIGNALS:
        if _re.search(pattern, text_lower):
            signals_triggered.append({"name": name, "signal": pattern, "points": points, "severity": severity})
            total_score += points

    total_score = min(total_score, 100)

    if total_score >= 70:
        risk_level, scam_category = "CRITICAL", "Phishing / Social Engineering"
        user_alert = "⚠️ Strong scam indicators detected. Do not click links or share personal information."
    elif total_score >= 40:
        risk_level, scam_category = "HIGH", "Suspicious Message"
        user_alert = "This message contains suspicious patterns. Verify the sender through official channels."
    elif total_score >= 15:
        risk_level, scam_category = "SUSPICIOUS", "Potentially Suspicious"
        user_alert = "Some suspicious characteristics found. Exercise caution."
    else:
        risk_level, scam_category = "SAFE", "Appears Legitimate"
        user_alert = "No strong scam signals detected in this message."

    return {
        "scan_type":         "message",
        "risk_level":        risk_level,
        "risk_score":        total_score,
        "scam_category":     scam_category,
        "signals_triggered": signals_triggered,
        "recommendation":    "Never share OTPs, passwords, or banking details in response to unsolicited messages.",
        "user_alert":        user_alert,
    }


@router.post("/report")
async def report_url(req: ReportRequest):
    """Accept a false-positive/false-negative report. Logged for review."""
    import logging as _log
    _log.getLogger(__name__).info(
        f"[ScamDefy] Report — url={req.url!r} reason={req.reason!r} notes={req.notes!r}"
    )
    return {"status": "received", "message": "Thank you for your report."}
