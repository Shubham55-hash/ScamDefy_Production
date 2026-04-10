from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import Optional
import numpy as np
import io
import uuid
from datetime import datetime, timezone
import soundfile as sf
from services import voice_service
from services.voice_service import analyze_audio, load_model
from utils.threat_logger import log_threat

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ACCEPTED_FORMATS = {'.wav', '.mp3', '.ogg', '.m4a', '.webm', '.aac', '.flac', '.opus'}


@router.post("/voice/analyze")
async def process_voice(audio: UploadFile = File(...), api_key: Optional[str] = Form(None)):
    # Log incoming request for Antigravity tracing
    from services.voice_service import logger as vlogger
    vlogger.info(f"[Voice] Processing upload: {audio.filename} (type: {audio.content_type})")

    # Return 503 while the pretrained model is still being downloaded.
    if voice_service._model_loading and not voice_service.pretrained_available:
        raise HTTPException(
            status_code=503,
            detail="Model is loading, please retry in a few seconds",
        )

    if not audio.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Robust extension check
    from pathlib import Path
    ext = Path(audio.filename).suffix.lower()
    
    if ext not in ACCEPTED_FORMATS and not any(audio.filename.lower().endswith(fmt) for fmt in ACCEPTED_FORMATS):
        vlogger.warning(f"[Voice] Rejected unsupported format: {audio.filename} (ext: {ext})")
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported audio format. Accepted: {', '.join(sorted(ACCEPTED_FORMATS))}"
        )

    file_bytes = await audio.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    result = await analyze_audio(file_bytes, audio.filename, api_key)
    if result["verdict"] == "ERROR":
        raise HTTPException(status_code=500, detail=result.get("warning", "Analysis failed"))

    verdict = result.get("verdict", "UNKNOWN")
    confidence = float(result.get("confidence", 0.0))
    reason = result.get("reason") or result.get("fingerprint_reason") or "Analysis inconclusive"
    
    # Log to Surveillance if synthetic
    if verdict == "SYNTHETIC":
        log_threat(
            id=str(uuid.uuid4()),
            url=f"Voice Payload: {audio.filename}",
            risk_level="CRITICAL",
            score=float(round(confidence * 100, 1)),
            scam_type="AI Voice Clone",
            explanation=reason,
            signals=["AI_SYNTHETIC_ARTIFACTS", "NEURAL_PROSODY_MATCH"]
        )

    return {
        "id":             str(uuid.uuid4()),
        "verdict":        verdict,
        "confidence":     confidence,
        "confidence_pct": round(confidence * 100, 1),
        "model_loaded":   voice_service.pretrained_available,
        "warning":        result.get("warning"),
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        # pass-through fields used by VoiceResult.tsx
        "low_confidence":   result.get("low_confidence", False),
        "reason":           reason,
    }


@router.get("/voice/health")
async def health_check():
    """
    Lightweight status check — does NOT run the full audio pipeline.
    Returns ok if model is loaded or still loading, fail only on hard errors.
    """
    if voice_service.pretrained_available:
        return {
            "status": "ok",
            "reason": f"Model loaded: {voice_service.PRETRAINED_MODEL_ID}",
        }
    if voice_service._model_loading:
        return {
            "status": "ok",
            "reason": "Model is downloading in background",
        }
    if voice_service._model_load_error:
        return {
            "status": "fail",
            "reason": voice_service._model_load_error,
        }
    # Model hasn't started loading yet — still ok, will load on first request
    return {
        "status": "ok",
        "reason": "Voice module ready (model will load on first use)",
    }