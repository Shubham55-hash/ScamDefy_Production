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
from services.ai_service import generate_explanation
from services.domain_age_service import get_domain_age


def normalize_url(url: str) -> str:
    url = url.strip()
    if url.endswith("/"):
        url = url[:-1]
    if "#" in url:
        url = url.split("#")[0]
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

    if not bypass_cache and url in scan_cache:
        result = dict(scan_cache[url])
        result["cached"] = True
        result["scan_time_ms"] = int((time.time() - start_time) * 1000)
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
        check_gsb(final_url),
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
    }

    scan_cache[url] = response_data
    return response_data


async def _async_analyze_domain(url: str):
    return analyze_domain(url)


@router.post("/explain")
async def explain_url(req: ExplainRequest):
    if req.api_key:
        os.environ["GEMINI_API_KEY"] = str(req.api_key)
    explanation = await generate_explanation(req.url, req.score, req.verdict, req.flags)
    return {"explanation": explanation}


class MessageRequest(BaseModel):
    text: str


@router.post("/analyze-message")
async def analyze_message(req: MessageRequest):
    text_lower = req.text.strip().lower()

    SCAM_SIGNALS = [
        (r"kyc",                           "KYC Urgency",           35, "HIGH"),
        (r"verif",                         "Verification Lure",     20, "MEDIUM"),
        (r"account.{0,20}block",           "Account Threat",        35, "HIGH"),
        (r"click here",                    "Phishing CTA",          25, "HIGH"),
        (r"prize|won|winner",              "Prize Scam",            35, "HIGH"),
        (r"lottery",                       "Lottery Scam",          35, "HIGH"),
        (r"\botp\b",                       "OTP Request",           45, "CRITICAL"),
        (r"\bpin\b",                       "PIN Request",           45, "CRITICAL"),
        (r"password",                      "Credential Request",    40, "HIGH"),
        (r"urgent|immediately",            "Urgency Tactic",        20, "MEDIUM"),
        (r"congratulations",               "Prize Lure",            20, "MEDIUM"),
        (r"\bfree\b",                      "Free Offer Lure",       10, "LOW"),
        (r"bank|banking",                  "Bank Impersonation",    25, "MEDIUM"),
        (r"refund",                        "Refund Scam",           25, "HIGH"),
        (r"suspend|blocked",               "Suspension Threat",     30, "HIGH"),
        (r"cvv|card number",               "Card Data Request",     50, "CRITICAL"),
        (r"aadhaar|aadhar|pan card",       "Document Request",      30, "HIGH"),
        (r"reset.{0,10}password",          "Password Reset Lure",   35, "HIGH"),
        (r"invest|profit|returns",         "Investment Scam",       30, "HIGH"),
        (r"delivery.{0,15}fail",           "Delivery Scam",         25, "MEDIUM"),
        (r"gift card|itunes|amazon card",  "Gift Card Scam",        40, "HIGH"),
        (r"remote access|teamviewer|anydesk", "Remote Access Scam", 50, "CRITICAL"),
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
        user_alert = "⚠️ Strong scam indicators detected. Do NOT click any links or share personal information."
    elif total_score >= 40:
        risk_level, scam_category = "HIGH", "Suspicious Message"
        user_alert = "This message contains suspicious patterns. Verify the sender through official channels only."
    elif total_score >= 15:
        risk_level, scam_category = "SUSPICIOUS", "Potentially Suspicious"
        user_alert = "Some suspicious characteristics found. Exercise caution before responding."
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


class ReportRequest(BaseModel):
    url: str
    reason: str
    notes: str = ""


@router.post("/report")
async def report_url(req: ReportRequest):
    import logging as _log
    _log.getLogger(__name__).info(
        f"[ScamDefy] Report — url={req.url!r} reason={req.reason!r} notes={req.notes!r}"
    )
    return {"status": "received", "message": "Thank you for your report."}
