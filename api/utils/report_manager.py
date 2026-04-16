"""
report_manager.py — ScamDefy Community Reporting
Stores and retrieves user reports in a persistent JSON file.
Reports survive server restarts and reflect real community data.
"""

import os
import json
import time
import hashlib
import logging
import threading
import urllib.parse
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

# Store in api/data/ directory
_DATA_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
_DATA_FILE = os.path.join(_DATA_DIR, "reports.json")
_lock = threading.Lock()

# In-memory cache for fast reads
_reports: Dict[str, List[Dict[str, Any]]] = {}
_loaded = False


def _normalize_url(url: str) -> str:
    """Strip scheme and trailing slashes so http/https and paths match."""
    try:
        p = urllib.parse.urlparse(url.lower().strip())
        host = p.netloc or p.path
        return host.replace("www.", "").rstrip("/")
    except Exception:
        return url.lower().strip()


def _load() -> None:
    global _reports, _loaded
    if _loaded:
        return
    os.makedirs(_DATA_DIR, exist_ok=True)
    if os.path.exists(_DATA_FILE):
        try:
            with open(_DATA_FILE, "r", encoding="utf-8") as f:
                _reports = json.load(f)
            logger.info(f"[Reports] Loaded {sum(len(v) for v in _reports.values())} reports from disk.")
        except Exception as e:
            logger.warning(f"[Reports] Failed to load reports.json: {e}")
            _reports = {}
    else:
        _reports = {}
    _loaded = True


def _save() -> None:
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(_reports, f, indent=2)
    except Exception as e:
        logger.error(f"[Reports] Failed to save reports.json: {e}")


def add_report(url: str, report_type: str, reason: str = "") -> Dict[str, Any]:
    """
    Add a user report for a URL.
    report_type: 'scam' | 'false_positive'
    Returns updated counts.
    """
    with _lock:
        _load()
        key = _normalize_url(url)
        if key not in _reports:
            _reports[key] = []

        report = {
            "id":       hashlib.md5(f"{key}{time.time()}".encode()).hexdigest()[:8],
            "type":     report_type,  # 'scam' or 'false_positive'
            "reason":   reason[:200] if reason else "",
            "timestamp": time.time(),
        }
        _reports[key].append(report)
        _save()

        counts = _get_counts(key)
        logger.info(f"[Reports] New '{report_type}' report for {key}. Total: {counts}")
        return counts


def get_report_counts(url: str) -> Dict[str, int]:
    """Returns scam_reports and false_positive_reports for a URL."""
    with _lock:
        _load()
        key = _normalize_url(url)
        return _get_counts(key)


def _get_counts(key: str) -> Dict[str, int]:
    entries = _reports.get(key, [])
    scam_count = sum(1 for r in entries if r.get("type") == "scam")
    fp_count   = sum(1 for r in entries if r.get("type") == "false_positive")
    return {
        "scam_reports":           scam_count,
        "false_positive_reports": fp_count,
        "total_reports":          scam_count + fp_count,
    }


def get_all_reports() -> List[Dict[str, Any]]:
    """
    Returns a flattened list of all reports across all URLs,
    sorted by timestamp (most recent first).
    """
    with _lock:
        _load()
        flattened = []
        for url_key, reports in _reports.items():
            for r in reports:
                # Add the URL context to each report entry
                full_report = r.copy()
                full_report["url"] = url_key
                flattened.append(full_report)
        
        # Sort by timestamp descending
        flattened.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return flattened
