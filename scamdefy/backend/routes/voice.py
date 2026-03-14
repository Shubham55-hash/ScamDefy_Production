from fastapi import APIRouter, UploadFile, File, HTTPException
import numpy as np
import io
import soundfile as sf
from typing import Optional
from services.voice_service import analyze_audio, load_model, model_loaded, weights_warning

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024 # 10MB
ACCEPTED_FORMATS = [".wav", ".mp3", ".ogg", ".m4a"]

@router.post("/voice")
async def process_voice(audio: UploadFile = File(...), api_key: Optional[str] = None):
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
         raise HTTPException(status_code=500, detail=result["warning"])
         
    return result

@router.get("/voice/health")
async def health_check():
    try:
        load_model()
        # Generate 1 second of random audio in memory (22050 Hz)
        sr = 22050
        duration = 1.0
        samples = np.random.uniform(-1, 1, int(sr * duration))
        
        # Write to memory buffer as wav
        buf = io.BytesIO()
        sf.write(buf, samples, sr, format='WAV')
        audio_bytes = buf.getvalue()
        
        # Run through pipeline
        result = await analyze_audio(audio_bytes, "test_health.wav")
        
        if result.get("verdict") in ["REAL", "SYNTHETIC"]:
            return {
                "status": "ok", 
                "model_loaded": result["model_loaded"], 
                "weights_available": result["model_loaded"],
                "reason": "Voice analysis pipeline returned valid verdict on random noise"
            }
        else:
            return {
                "status": "fail", 
                "model_loaded": result["model_loaded"], 
                "weights_available": result["model_loaded"],
                "reason": result.get("warning", "Unknown error")
            }
            
    except Exception as exc:
        return {
             "status": "fail", 
             "model_loaded": False, 
             "weights_available": False,
             "reason": str(exc)
        }
