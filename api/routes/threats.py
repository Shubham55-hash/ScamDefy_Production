from fastapi import APIRouter, Header, HTTPException
from typing import Optional
import os
from utils.threat_logger import ThreatEntry, get_all_threats, clear_all_threats, log_threat

router = APIRouter()


def _verify_admin_key(x_admin_key: Optional[str] = Header(None)):
    """Verify the admin API key for destructive operations."""
    expected = os.getenv("SCAMDEFY_ADMIN_KEY")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Admin key not configured on server",
        )
    if not x_admin_key or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing admin key")

@router.get("/threats/stats")
async def get_stats():
    db = get_all_threats()
    total_detected = len(db)
    today_detected = len(db) 
    total_blocked = sum(1 for t in db if t.blocked)
    
    return {
        "total_detected": total_detected,
        "today_detected": today_detected,
        "total_blocked": total_blocked
    }

@router.get("/threats")
async def get_threats(limit: int = 50, risk_level: Optional[str] = None):
    db = get_all_threats()
    results = db
    if risk_level:
        results = [t for t in results if t.risk_level == risk_level]
    
    # Return latest threats first 
    results = results[::-1][:limit]
    return {"threats": results, "total": len(db)}

@router.delete("/threats")
async def clear_threats(x_admin_key: Optional[str] = Header(None)):
    _verify_admin_key(x_admin_key)
    clear_all_threats()
    return {"message": "Threats cleared successfully"}

@router.post("/threats")
async def add_threat(threat: ThreatEntry, x_admin_key: Optional[str] = Header(None)):
    _verify_admin_key(x_admin_key)
    log_threat(
        id=threat.id,
        url=threat.url,
        risk_level=threat.risk_level,
        score=threat.score,
        scam_type=threat.scam_type,
        explanation=threat.explanation,
        signals=threat.signals,
        breakdown=threat.breakdown
    )
    return {"message": "Threat added successfully"}
