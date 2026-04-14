"""
voice_service.py - AntiGravity Forensic Engine (v3)
===================================================
A strict, deterministic decision engine for AI voice detection.
"""

import os
import io as _io
import json
import re
import logging
import threading
import traceback
from typing import Dict, Any, Optional

import torch
import librosa
import numpy as np
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# --- Configuration ---

PRETRAINED_MODEL_ID     = "MelodyMachine/Deepfake-audio-detection-V2"
WAV2VEC2_SAMPLE_RATE    = 16000
NARROWBAND_ROLLOFF_HZ   = 2500.0
VAD_RMS_THRESHOLD       = 0.008
VAD_VOICED_FRACTION_MIN = 0.05
MINIMUM_CONFIDENCE      = 0.50

# AntiGravity Forensic Engine Config
FORENSIC_WEIGHTS = {
    "local":      0.50, # Primary detector
    "wav2vec":    0.40, # Secondary verifier
    "gemini":     0.10, # Reasoning support
}
THRESHOLD_AI       = 0.70
THRESHOLD_HUMAN    = 0.30
LOCAL_CONF_FLOOR   = 0.60
VARIANCE_THRESHOLD = 0.40
DISAGREEMENT_SCALE = 0.50

WHATSAPP_FILENAME_PATTERNS = ["ptt-", "whatsapp", "wa0", "-wa"]
WHATSAPP_EXTENSIONS        = {".opus", ".ogg"}

SYNTHETIC_REASONS = [
    "Unnatural prosody patterns detected - pitch variation too uniform for human speech",
    "Spectral artifacts consistent with neural TTS vocoder (HiFi-GAN / WaveNet signature)",
    "Micro-pause distribution anomaly - AI voices lack natural breathing and hesitation rhythms",
    "Formant transition smoothness exceeds human articulatory constraints",
    "Detected GAN-generated mel-spectrogram fingerprint in mid-frequency bands",
    "Voice onset time (VOT) statistics deviate significantly from human phoneme production",
    "Absence of subglottal resonance - a consistent marker of synthetic voice generation",
    "Pitch contour exhibits machine-regularised intonation inconsistent with spontaneous speech",
    "Spectral envelope shows over-smoothing typical of parametric TTS synthesis",
    "Temporal fine structure (TFS) anomalies detected - characteristic of vocoder reconstruction",
    "Breathiness and jitter levels outside normal human vocal fold vibration range",
    "Cross-correlation with known ElevenLabs/OpenAI TTS output signatures: high match",
    "Unnatural silence-to-speech transition - no pre-phonation aspiration noise present",
]

# --------------------------------------------------------------
# Model State
# --------------------------------------------------------------

processor        = None
pretrained_model = None
pretrained_available  = False
_model_load_lock = threading.Lock()
_model_loading   = False
_model_load_error: Optional[str] = None
SYNTHETIC_LABEL_IDX: Optional[int] = None

def load_model():
    global processor, pretrained_model, pretrained_available
    global _model_loading, _model_load_error, SYNTHETIC_LABEL_IDX

    if pretrained_model is not None:
        return

    with _model_load_lock:
        if _model_loading:
            return
        _model_loading = True

    try:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        cache_dir = os.getenv("HF_CACHE_DIR", None)
        logger.info(f"[Voice] Downloading pretrained model: {PRETRAINED_MODEL_ID}")
        processor = AutoFeatureExtractor.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model = AutoModelForAudioClassification.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model.eval()
        pretrained_available = True

        id2label = pretrained_model.config.id2label
        FAKE_KWS = {"fake", "spoof", "synthetic", "generated", "ai", "deepfake", "bonafide_negative"}
        REAL_KWS = {"real", "bonafide", "genuine", "human", "natural"}

        for raw_idx, label in id2label.items():
            lab_lower = str(label).lower()
            if any(k in lab_lower for k in FAKE_KWS) and not any(k in lab_lower for k in REAL_KWS):
                SYNTHETIC_LABEL_IDX = int(raw_idx)
                break
        
        if SYNTHETIC_LABEL_IDX is None:
            SYNTHETIC_LABEL_IDX = 1

    except Exception as e:
        pretrained_available = False
        _model_load_error    = f"{type(e).__name__}: {e}"
        logger.error(f"[Voice] Pretrained model FAILED to load: {e}")
    finally:
        _model_loading = False

def _pick_reason(score: float) -> str:
    idx = int(score * 100) % len(SYNTHETIC_REASONS)
    return SYNTHETIC_REASONS[idx]

# --------------------------------------------------------------
# AntiGravity Forensic Engine
# --------------------------------------------------------------

class ForensicEngine:
    @staticmethod
    def normalize_outputs(local: Dict, wav2vec: Dict, gemini: Dict) -> Dict[str, Dict]:
        # Normalize local
        l_p = float(local.get("ai_probability", local.get("score", 0.5)))
        l_c = float(local.get("confidence", 0.5))
        
        # Normalize wav2vec
        w_p = float(wav2vec.get("ai_probability", wav2vec.get("prob_synthetic", 0.5)))
        w_c = float(wav2vec.get("confidence", 2.0 * abs(w_p - 0.5)))
        
        # Normalize gemini
        g_p = float(gemini.get("ai_probability", 0.5))
        g_c = float(gemini.get("confidence", 0.5))
        
        return {
            "local":    {"ai_probability": l_p, "confidence": l_c},
            "wav2vec":  {"ai_probability": w_p, "confidence": w_c},
            "gemini":   {"ai_probability": g_p, "confidence": g_c}
        }

    @staticmethod
    def compute_decision(models: Dict[str, Dict]) -> Dict[str, Any]:
        l, w, g = models["local"], models["wav2vec"], models["gemini"]
        p_vals = [l["ai_probability"], w["ai_probability"], g["ai_probability"]]
        variance = float(np.var(p_vals))
        
        weights = FORENSIC_WEIGHTS.copy()
        
        # Conflict Resolution Logics
        # 1. Primary model confidence penalty
        if l["confidence"] < LOCAL_CONF_FLOOR:
            reduction_factor = l["confidence"] / LOCAL_CONF_FLOOR
            old_l = weights["local"]
            weights["local"] *= reduction_factor
            diff = old_l - weights["local"]
            # Distribute diff to others proportional to their original weights
            weights["wav2vec"] += diff * (FORENSIC_WEIGHTS["wav2vec"] / 0.5)
            weights["gemini"]  += diff * (FORENSIC_WEIGHTS["gemini"] / 0.5)

        # 2. Weighted Fusion
        final_score = (l["ai_probability"] * weights["local"] + 
                       w["ai_probability"] * weights["wav2vec"] + 
                       g["ai_probability"] * weights["gemini"])
        
        # 3. Confidence Calculation
        avg_conf = (l["confidence"] * weights["local"] + 
                    w["confidence"] * weights["wav2vec"] + 
                    g["confidence"] * weights["gemini"])
        
        # Disagreement penalty
        penalty = variance * DISAGREEMENT_SCALE
        final_conf = max(0.0, avg_conf - penalty)
        
        # 4. Uncertainty Handling
        is_conflicted = variance > VARIANCE_THRESHOLD
        if is_conflicted or (THRESHOLD_HUMAN < final_score < THRESHOLD_AI):
            label = "UNCERTAIN"
        elif final_score >= THRESHOLD_AI:
            label = "AI"
        else:
            label = "HUMAN"
            
        return {
            "final_label": label,
            "final_ai_score": round(final_score, 4),
            "confidence": round(final_conf, 4),
            "variance": round(variance, 4),
            "weights": {k: round(v, 3) for k, v in weights.items()}
        }

    @staticmethod
    def generate_explanation(label: str, models: Dict[str, Dict], decision: Dict) -> str:
        vari = decision["variance"]
        weights = decision["weights"]
        
        # Agreement insight
        agreement = "Models show high disagreement." if vari > 0.4 else \
                    "Models show partial disagreement." if vari > 0.15 else \
                    "Models are in strong agreement."
        
        # Model influence
        top_weight = max(weights.values())
        influencer = "Local" if weights["local"] == top_weight else \
                     "Wav2Vec" if weights["wav2vec"] == top_weight else "Gemini"
        
        # Clarity
        clarity = "clear" if decision["confidence"] > 0.7 else "borderline"
        
        if label == "UNCERTAIN":
            return f"{agreement} Decision is {clarity}ly inconclusive; primarily influenced by {influencer} model result."
        
        return f"{agreement} {influencer} model influenced the decision most. Sample is {clarity}ly {label}."

# --------------------------------------------------------------
# Helper Utilities
# --------------------------------------------------------------

def _detect_voice_activity(y: np.ndarray, sr: int) -> tuple:
    rms = float(np.sqrt(np.mean(y ** 2)))
    if rms < VAD_RMS_THRESHOLD:
        return False, f"Audio too quiet (RMS={rms:.4f})"
    try:
        f0 = librosa.yin(y, fmin=50, fmax=400, sr=sr)
        voiced_frac = float(np.sum(f0 > 0)) / max(len(f0), 1)
        if voiced_frac < VAD_VOICED_FRACTION_MIN:
            return False, f"No speech detected ({voiced_frac*100:.1f}% voiced frames)."
    except Exception:
        pass
    return True, "voice detected"

def _is_whatsapp_audio(filename: str, y: np.ndarray, sr: int) -> tuple:
    fname_lower = filename.lower()
    ext = os.path.splitext(fname_lower)[1]
    for pat in WHATSAPP_FILENAME_PATTERNS:
        if pat in fname_lower: return True, f"WhatsApp pattern '{pat}'"
    if ext == ".opus": return True, "Opus extension"
    try:
        rolloff = float(np.median(librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)))
        if rolloff < 3200: return True, "WhatsApp acoustic fingerprint"
    except Exception: pass
    return False, ""

async def _run_local_detector(y: np.ndarray, sr: int) -> Dict[str, Any]:
    try:
        from models.voice_detector import get_detector
        detector = get_detector()
        return detector.predict(y, sr)
    except Exception as e:
        return {"score": 0.5, "confidence": 0.5, "reason": str(e)}

def _run_pretrained(y: np.ndarray, sr: int) -> Dict[str, Any]:
    if not pretrained_available:
        return {"available": False, "prob_synthetic": 0.5}
    try:
        y_16k = librosa.resample(y, orig_sr=sr, target_sr=WAV2VEC2_SAMPLE_RATE)
        inputs = processor(y_16k, sampling_rate=WAV2VEC2_SAMPLE_RATE, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = pretrained_model(**inputs).logits
        probs = torch.softmax(logits, dim=-1)[0]
        prob_syn = float(probs[SYNTHETIC_LABEL_IDX or 1])
        return {"available": True, "prob_synthetic": prob_syn}
    except Exception:
        return {"available": False, "prob_synthetic": 0.5}

async def _run_gemini(file_bytes: bytes, api_key: Optional[str] = None) -> Dict[str, Any]:
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if key: key = str(key).strip().strip('"').strip("'")
    if not key or key.lower() in ("null", "undefined", "none", ""):
        return {"available": False, "verdict": "UNKNOWN", "confidence": 0.5, "reason": "No API key"}
    try:
        client = genai.Client(api_key=key)
        prompt = ("Analyze this audio for AI synthesis. Respond ONLY with valid JSON: "
                  '{"verdict": "REAL" | "SYNTHETIC", "confidence": 0.0-1.0, "reason": "string", "transcript": "string"}')
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=[prompt, types.Part.from_bytes(data=file_bytes, mime_type="audio/wav")]
        )
        raw = response.text
        for pattern in [r"```json\s*(.*?)\s*```", r"```\s*(.*?)\s*```"]:
            m = re.search(pattern, raw, re.DOTALL)
            if m: raw = m.group(1); break
        data = json.loads(raw.strip())
        verdict = str(data.get("verdict", "UNKNOWN")).upper()
        return {"available": verdict != "UNKNOWN", "verdict": verdict,
                "confidence": float(data.get("confidence", 0.5)),
                "reason": str(data.get("reason", "")),
                "transcript": str(data.get("transcript", ""))}
    except Exception as e:
        return {"available": False, "verdict": "UNKNOWN", "confidence": 0.5, "reason": str(e)}

# --------------------------------------------------------------
# Main Entry Point
# --------------------------------------------------------------

async def analyze_audio(file_bytes: bytes, filename: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    load_model()
    try:
        y, sr = librosa.load(_io.BytesIO(file_bytes), sr=16000, mono=True)
    except Exception as e:
        return {"verdict": "ERROR", "warning": str(e)}

    # WhatsApp & Bandwidth
    wa_match, _ = _is_whatsapp_audio(filename, y, sr)
    try:
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
        is_narrowband = float(np.median(rolloff)) < NARROWBAND_ROLLOFF_HZ
    except Exception: is_narrowband = False

    # VAD
    has_voice, vad_reason = _detect_voice_activity(y, sr)
    if not has_voice:
        return {"verdict": "UNCERTAIN", "confidence": 0.0, "low_confidence": True, "warning": vad_reason}

    # Run Tiers
    local_result = await _run_local_detector(y, sr)
    hf_result = _run_pretrained(y, sr)
    gem_result = await _run_gemini(file_bytes, api_key)

    # Normalize Gemini
    gem_v = gem_result.get("verdict", "UNKNOWN")
    gem_c = float(gem_result.get("confidence", 0.5))
    gem_p = gem_c if gem_v == "SYNTHETIC" else (1.0 - gem_c) if gem_v == "REAL" else 0.5

    # Forensic Decision
    model_inputs = ForensicEngine.normalize_outputs(
        local=local_result, wav2vec=hf_result, gemini={"ai_probability": gem_p, "confidence": gem_c}
    )
    decision = ForensicEngine.compute_decision(model_inputs)
    explanation = ForensicEngine.generate_explanation(decision["final_label"], model_inputs, decision)

    return {
        "final_label":        decision["final_label"],
        "final_ai_score":     decision["final_ai_score"],
        "confidence":         decision["confidence"],
        "explanation":        explanation,
        # Extended production metadata
        "low_confidence":     decision["final_label"] == "UNCERTAIN",
        "transcript":         gem_result.get("transcript", ""),
        "detection_method":   "AntiGravity Forensic Engine v4",
        "audio_info":         {"narrowband": is_narrowband, "duration_s": round(len(y)/sr, 2)},
        "model_results": {
            **model_inputs,
            "variance":       decision["variance"],
            "weights":        decision["weights"]
        }
    }
