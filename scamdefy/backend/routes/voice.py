from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional
import numpy as np
import io
import soundfile as sf
from services import voice_service
from services.voice_service import analyze_audio, load_model

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ACCEPTED_FORMATS = [".wav", ".mp3", ".ogg", ".m4a"]


@router.post("/voice")
async def process_voice(audio: UploadFile = File(...), api_key: Optional[str] = None):
    # Return 503 while the pretrained model is still being downloaded.
    # The client should retry after a short delay.
    if voice_service._model_loading and not voice_service.pretrained_available:
        raise HTTPException(
            status_code=503,
            detail="Model is loading, please retry in a few seconds",
        )

    if not audio.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = audio.filename.lower()
    if not any(ext.endswith(fmt) for fmt in ACCEPTED_FORMATS):
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    file_bytes = await audio.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    result = await analyze_audio(file_bytes, audio.filename, api_key)
    if result["verdict"] == "ERROR":
        raise HTTPException(status_code=500, detail=result.get("warning", "Analysis failed"))

    return result


@router.get("/voice/health")
async def health_check():
    """
    Lightweight health check that runs random noise through the full pipeline.
    Returns the pretrained model status and a verdict on the test audio.
    """
    try:
        load_model()

        # Generate 1 second of random audio at 22050 Hz
        sr = 22050
        samples = np.random.uniform(-1, 1, int(sr * 1.0))

        buf = io.BytesIO()
        sf.write(buf, samples, sr, format="WAV")
        audio_bytes = buf.getvalue()

        result = await analyze_audio(audio_bytes, "test_health.wav")

        if result.get("verdict") in ["REAL", "SYNTHETIC", "UNCERTAIN"]:
            return {
                "status": "ok",
                "pretrained_model": voice_service.PRETRAINED_MODEL_ID if voice_service.pretrained_available else None,
                "pretrained_available": voice_service.pretrained_available,
                "pretrained_error": voice_service._model_load_error if not voice_service.pretrained_available else None,
                "model_loading": voice_service._model_loading,
                "verdict": result.get("verdict"),
                "confidence": result.get("confidence"),
            }
        else:
            return {
                "status": "fail",
                "pretrained_available": voice_service.pretrained_available,
                "reason": result.get("warning", "Unknown error"),
            }

    except Exception as exc:
        return {
            "status": "fail",
            "pretrained_available": False,
            "reason": str(exc),
        }