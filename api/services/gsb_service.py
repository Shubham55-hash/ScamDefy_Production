import os
import httpx
import logging
from typing import Dict, Any

async def check_url(url: str, api_key: str = None) -> Dict[str, Any]:
    if not api_key:
        api_key = os.getenv("GOOGLE_SAFE_BROWSING_API_KEY")
        
    if not api_key:
        logging.warning("[ScamDefy] GSB API key missing. Operating in degraded mode.")
        return {
            "url": url,
            "is_threat": False,
            "threat_type": None,
            "threat_confidence": 0.0,
            "source": "google_safe_browsing",
            "warning": "API Key Missing - Check disabled"
        }

    endpoint = f"https://safebrowsing.googleapis.com/v4/threatMatches:find?key={api_key}"
    payload = {
        "client": { "clientId": "scamdefy", "clientVersion": "1.0" },
        "threatInfo": {
            "threatTypes": [
                "MALWARE","SOCIAL_ENGINEERING",
                "UNWANTED_SOFTWARE","POTENTIALLY_HARMFUL_APPLICATION"
            ],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{ "url": url }]
        }
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(endpoint, json=payload)
            
            if response.status_code == 403:
                logging.warning("[ScamDefy] GSB API Key invalid/403. Degraded mode.")
                return {
                    "url": url, "is_threat": False, "threat_type": None, 
                    "threat_confidence": 0.0, "source": "google_safe_browsing", "warning": "API Key Invalid"
                }

            if response.status_code == 400:
                logging.warning(f"[ScamDefy] GSB 400 Bad Request for {url}.")
                return {
                    "url": url, "is_threat": False, "threat_type": None, 
                    "threat_confidence": 0.0, "source": "google_safe_browsing",
                    "warning": f"GSB API 400 Bad Request — check payload/key"
                }

            response.raise_for_status()
            data = response.json()
            
        matches = data.get("matches", [])
        if matches:
            # Threat found
            threat = matches[0] # Take the first match
            return {
                "url": url,
                "is_threat": True,
                "threat_type": threat.get("threatType"),
                "threat_confidence": 1.0, # GSB matches are highly confident
                "source": "google_safe_browsing"
            }
        
        # Clean
        return {
            "url": url,
            "is_threat": False,
            "threat_type": None,
            "threat_confidence": 0.0,
            "source": "google_safe_browsing"
        }
            
    except Exception as exc:
        logging.error(f"[ScamDefy] Error calling GSB API: {exc}")
        return {
            "url": url, "is_threat": False, "threat_type": None, 
            "threat_confidence": 0.0, "source": "google_safe_browsing", "warning": str(exc)
        }


async def health_check(api_key: str = None) -> Dict[str, str]:
    # Call GSB with known safe URL
    try:
        if not api_key:
            api_key = os.getenv("GOOGLE_SAFE_BROWSING_API_KEY")
            
        if not api_key:
            return {"status": "fail", "reason": "Missing GSB API key. Check degraded."}
            
        result = await check_url("https://google.com", api_key=api_key)
        if result.get("warning"):
            return {"status": "fail", "reason": f"GSB Error: {result['warning']}"}
            
        if not result.get("is_threat"):
            return {"status": "ok", "reason": "GSB responded successfully for safe URL."}
        else:
            return {"status": "fail", "reason": "GSB unexpectedly flagged google.com as threat."}
            
    except Exception as exc:
        return {"status": "fail", "reason": str(exc)}

