import httpx
import logging
import os
import urllib.parse
from typing import Dict, Any

# URLhaus does not strictly require an API key for basic lookups,
# but we can use their API to query URLs.
# API Documentation: https://urlhaus-api.abuse.ch/

async def check_url(url: str) -> Dict[str, Any]:
    endpoint = "https://urlhaus-api.abuse.ch/v1/url/"
    
    # URLhaus expects the payload to contain the URL in form-data
    data = {
        "url": url
    }
    
    headers = {
        "User-Agent": "scamdefy/1.0"
    }
    
    api_key = os.getenv("URLHAUS_API_KEY")
    if api_key and "YOUR_URLHAUS_API_KEY" not in api_key:
        headers["Auth-Key"] = api_key

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # URLhaus expects the payload in form-data (data=) not JSON (json=)
            response = await client.post(endpoint, data=data, headers=headers)
            response.raise_for_status()
            
            result_json = response.json()
            status = result_json.get("query_status", "no_results")
            
            # If query_status is "ok", it means it found an entry.
            is_phishing = status == "ok" and result_json.get("url_status") in ["online", "offline"]
            
        return {
            "url": url,
            "is_phishing": is_phishing,
            "verified": is_phishing, # If it's on URLhaus, we consider it verified malicious
            "in_database": is_phishing,
            "source": "urlhaus"
        }
            
    except Exception as exc:
        logging.error(f"[ScamDefy] Error calling URLhaus API: {exc}")
        return {
            "url": url,
            "is_phishing": False,
            "verified": False,
            "in_database": False,
            "source": "urlhaus",
            "warning": str(exc)
        }

async def health_check() -> Dict[str, str]:
    try:
        api_key = os.getenv("URLHAUS_API_KEY")
        if not api_key or "YOUR_URLHAUS_API_KEY" in api_key:
            return {"status": "fail", "reason": "Missing URLHaus API key."}
            
        # Check a safe URL
        result = await check_url("https://google.com")
        if result.get("warning"):
            return {"status": "fail", "reason": f"URLHaus Error: {result['warning']}"}
            
        return {"status": "ok", "reason": "URLhaus responded successfully."}
    except Exception as exc:
        return {"status": "fail", "reason": str(exc)}
