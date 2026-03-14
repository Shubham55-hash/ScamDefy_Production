from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import os
import asyncio
import time

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

    response_data = {
        "url": url,
        "final_url": final_url,
        "expanded": expanded,
        "score": risk_result["score"],
        "verdict": risk_result["verdict"],
        "color": risk_result["color"],
        "should_block": risk_result["should_block"],
        "breakdown": {
            "gsb": gsb_result,
            "urlhaus": uh_result,
            "domain": domain_result,
            "url_pattern": risk_result["breakdown"]["url_pattern"]
        },
        "explanation": explanation,
        "flags": flags,
        "cached": False,
        "scan_time_ms": int((time.time() - start_time) * 1000)
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
