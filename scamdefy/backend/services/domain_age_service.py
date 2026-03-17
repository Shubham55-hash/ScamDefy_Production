"""
domain_age_service.py — ScamDefy Domain Age Detection
Uses RDAP (Registration Data Access Protocol) — free, no API key needed.
"""

import asyncio
import httpx
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, Optional

RDAP_BOOTSTRAP = "https://rdap.org/domain/"
RDAP_TIMEOUT   = 5.0


def _extract_hostname(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc or parsed.path
        return host.split(":")[0].lower().replace("www.", "")
    except Exception:
        return url


def _root_domain(hostname: str) -> str:
    parts = hostname.split(".")
    if len(parts) <= 2:
        return hostname
    
    # Handle common multi-level TLDs (e.g., .co.uk, .gov.in, .edu.au)
    # This is a heuristic; for production, use 'tldextract'
    second_to_last = parts[-2].lower()
    if second_to_last in ("com", "co", "gov", "org", "edu", "net", "ac"):
        return ".".join(parts[-3:])
    
    return ".".join(parts[-2:])


def _parse_date(date_str: str) -> Optional[datetime]:
    formats = [
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%d-%b-%Y",
        "%d/%m/%Y",
        "%Y%m%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def get_domain_age(url: str) -> Dict[str, Any]:
    hostname = _extract_hostname(url)
    root     = _root_domain(hostname)

    result: Dict[str, Any] = {
        "domain":        root,
        "age_days":      None,
        "registered_on": None,
        "source":        "unknown",
        "error":         None,
    }

    try:
        rdap_url = f"{RDAP_BOOTSTRAP}{root}"
        async with httpx.AsyncClient(timeout=RDAP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(rdap_url, headers={"Accept": "application/json"})

        if resp.status_code == 200:
            data = resp.json()
            creation_date = None

            for event in data.get("events", []):
                action = event.get("eventAction", "").lower()
                if action in ("registration", "created"):
                    creation_date = event.get("eventDate")
                    break

            if not creation_date:
                for entity in data.get("entities", []):
                    for event in entity.get("events", []):
                        if event.get("eventAction", "").lower() in ("registration", "created"):
                            creation_date = event.get("eventDate")
                            break
                    if creation_date:
                        break

            if creation_date:
                dt = _parse_date(creation_date)
                if dt:
                    now      = datetime.now(timezone.utc)
                    age_days = (now - dt).days
                    result.update({
                        "age_days":      max(age_days, 0),
                        "registered_on": dt.strftime("%Y-%m-%d"),
                        "source":        "rdap",
                    })
                    logging.info(f"[ScamDefy][DomainAge] {root} → {age_days} days old (RDAP)")
                    return result

        elif resp.status_code == 404:
            result["error"] = "Domain not found in RDAP"
        else:
            result["error"] = f"RDAP HTTP {resp.status_code}"

    except asyncio.TimeoutError:
        result["error"] = "RDAP timeout"
        logging.warning(f"[ScamDefy][DomainAge] RDAP timeout for {root}")
    except Exception as exc:
        result["error"] = f"RDAP error: {exc}"
        logging.warning(f"[ScamDefy][DomainAge] RDAP failed for {root}: {exc}")

    return result
