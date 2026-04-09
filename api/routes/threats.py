from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from utils.threat_logger import ThreatEntry, get_all_threats, clear_all_threats, log_threat

VALID_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL", "SUSPICIOUS", "SAFE"}

router = APIRouter()

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
async def get_threats(
    limit: int = Query(default=50, ge=1, le=500, description="Max threats to return (1-500)"),
    risk_level: Optional[str] = None,
):
    if risk_level and risk_level.upper() not in VALID_RISK_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid risk_level '{risk_level}'. Must be one of: {', '.join(sorted(VALID_RISK_LEVELS))}",
        )
    db = get_all_threats()
    results = db
    if risk_level:
        results = [t for t in results if t.risk_level == risk_level.upper()]
    
    # Return latest threats first 
    results = results[::-1][:limit]
    return {"threats": results, "total": len(db)}

@router.delete("/threats")
async def clear_threats():
    clear_all_threats()
    return {"message": "Threats cleared successfully"}

@router.post("/threats")
async def add_threat(threat: ThreatEntry):
    if threat.score < 0 or threat.score > 100:
        raise HTTPException(status_code=400, detail="score must be between 0 and 100")
    if threat.risk_level.upper() not in VALID_RISK_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid risk_level '{threat.risk_level}'. Must be one of: {', '.join(sorted(VALID_RISK_LEVELS))}",
        )
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
