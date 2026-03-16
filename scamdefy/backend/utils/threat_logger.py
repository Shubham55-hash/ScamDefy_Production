
from pydantic import BaseModel
from typing import List, Optional
import datetime
import uuid
import logging

logger = logging.getLogger("uvicorn")

class ThreatEntry(BaseModel):
    id: str
    url: str
    risk_level: str
    score: float
    scam_type: str
    explanation: str
    signals: List[str]
    user_proceeded: bool
    blocked: bool
    timestamp: str
    breakdown: Optional[dict] = None

# Centralized in-memory threat database
threats_db: List[ThreatEntry] = []

def log_threat(id: str, url: str, risk_level: str, score: float, scam_type: str, explanation: str, signals: List[str] = None, breakdown: Optional[dict] = None):
    """Internal helper to add a threat from any module."""
    entry = ThreatEntry(
        id=id,
        url=url,
        risk_level=risk_level,
        score=score,
        scam_type=scam_type,
        explanation=explanation,
        signals=signals or [],
        user_proceeded=False,
        blocked=True if risk_level in ["HIGH", "CRITICAL"] else False,
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        breakdown=breakdown
    )
    
    logger.info(f"[ScamDefy] Logging centralized threat: {scam_type} for {url}")
    
    # Check for duplicates
    if not any(t.id == entry.id for t in threats_db):
        threats_db.append(entry)
        logger.info(f"[ScamDefy] Global threats_db now has {len(threats_db)} entries.")
    else:
        logger.info(f"[ScamDefy] Global threat {entry.id} already exists.")

def get_all_threats():
    return threats_db

def clear_all_threats():
    threats_db.clear()
