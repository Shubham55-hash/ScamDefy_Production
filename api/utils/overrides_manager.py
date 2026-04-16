"""
overrides_manager.py — ScamDefy Developer Overrides
Stores manual 'Force Block' or 'Force Safe' decisions made by the developer.
These take precedence over all automated scans.
"""

import os
import json
import logging
import threading
import urllib.parse
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Store in api/data/ directory
_DATA_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
_DATA_FILE = os.path.join(_DATA_DIR, "overrides.json")
_lock = threading.Lock()

# In-memory cache: { "normalized_url": "SAFE" | "BLOCKED" }
_overrides: Dict[str, str] = {}
_loaded = False


def _normalize_url(url: str) -> str:
    """Consistency for override keys."""
    try:
        p = urllib.parse.urlparse(url.lower().strip())
        host = p.netloc or p.path
        return host.replace("www.", "").rstrip("/")
    except Exception:
        return url.lower().strip()


def _load() -> None:
    global _overrides, _loaded
    if _loaded:
        return
    os.makedirs(_DATA_DIR, exist_ok=True)
    if os.path.exists(_DATA_FILE):
        try:
            with open(_DATA_FILE, "r", encoding="utf-8") as f:
                _overrides = json.load(f)
            logger.info(f"[Overrides] Loaded {len(_overrides)} manual verdicts.")
        except Exception as e:
            logger.warning(f"[Overrides] Failed to load overrides.json: {e}")
            _overrides = {}
    else:
        _overrides = {}
    _loaded = True


def _save() -> None:
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(_overrides, f, indent=2)
    except Exception as e:
        logger.error(f"[Overrides] Failed to save overrides.json: {e}")


def set_override(url: str, verdict: str) -> None:
    """
    Set a manual override. 
    verdict: 'SAFE' | 'BLOCKED'
    """
    with _lock:
        _load()
        key = _normalize_url(url)
        _overrides[key] = verdict.upper()
        _save()
        logger.info(f"[Overrides] Manual verdict '{verdict}' set for {key}")


def get_override(url: str) -> Optional[str]:
    """Check if a manual override exists for a URL."""
    with _lock:
        _load()
        key = _normalize_url(url)
        return _overrides.get(key)


def delete_override(url: str) -> None:
    """Remove a manual override."""
    with _lock:
        _load()
        key = _normalize_url(url)
        if key in _overrides:
            del _overrides[key]
            _save()
            logger.info(f"[Overrides] Manual verdict cleared for {key}")


def get_all_overrides() -> Dict[str, str]:
    """Returns the full list of overrides."""
    with _lock:
        _load()
        return dict(_overrides)
