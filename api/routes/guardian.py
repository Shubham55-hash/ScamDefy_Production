"""
guardian.py — Safety Circle API route
POST /api/guardian/notify  — trigger alert emails to trusted guardians
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from typing import List, Optional
import re

from services.guardian_service import send_alert

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class GuardianContact(BaseModel):
    name: str
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not EMAIL_RE.match(v.strip()):
            raise ValueError(f"Invalid email address: {v!r}")
        return v.strip().lower()

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 80:
            raise ValueError("Guardian name must be 1–80 characters")
        return v


class NotifyRequest(BaseModel):
    guardians: List[GuardianContact]
    alert_type: str                       # e.g. "URL_SCAN" | "MESSAGE_SCAN" | "VOICE_SCAN" | "QR_SCAN"
    scam_type: str                        # e.g. "Phishing" | "Financial Fraud" | "Voice Scam"
    risk_score: int                       # 0–100
    user_name: Optional[str] = "A user"
    is_escalation: bool = False

    @field_validator("guardians")
    @classmethod
    def validate_guardian_count(cls, v: list) -> list:
        if len(v) > 2:
            raise ValueError("Maximum 2 guardians allowed")
        if len(v) == 0:
            raise ValueError("At least one guardian is required")
        return v

    @field_validator("risk_score")
    @classmethod
    def validate_risk_score(cls, v: int) -> int:
        if not (0 <= v <= 100):
            raise ValueError("risk_score must be between 0 and 100")
        # Safety: only allow notifications for genuinely high-risk events
        if v < 65:
            raise ValueError("risk_score too low to trigger guardian alert (minimum 65)")
        return v

    @field_validator("user_name")
    @classmethod
    def sanitize_user_name(cls, v: Optional[str]) -> str:
        if not v:
            return "A ScamDefy user"
        # Strip to first 40 chars, no HTML
        return v.strip()[:40].replace("<", "&lt;").replace(">", "&gt;")


@router.post("/guardian/notify")
async def notify_guardians(req: NotifyRequest):
    """
    Sends a privacy-preserving alert email to each guardian.
    Enforces per-guardian 30-min rate limiting server-side.
    """
    results = []
    sent_count = 0
    skipped_count = 0

    for guardian in req.guardians:
        result = await send_alert(
            guardian_name=guardian.name,
            guardian_email=guardian.email,
            user_name=req.user_name,
            alert_type=req.alert_type,
            scam_type=req.scam_type,
            risk_score=req.risk_score,
            is_escalation=req.is_escalation,
        )
        results.append({
            "guardian_email": guardian.email[:3] + "***",  # Mask for response privacy
            "guardian_name": guardian.name,
            "sent": result["sent"],
            "reason": result["reason"],
        })
        if result["sent"]:
            sent_count += 1
        else:
            skipped_count += 1

    return {
        "status": "processed",
        "sent": sent_count,
        "skipped": skipped_count,
        "details": results,
    }
