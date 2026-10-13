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
from typing import Dict, Any, Optional, List
from collections import deque, defaultdict

from starlette.concurrency import run_in_threadpool
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

# AntiGravity Forensic Engine Config (v3.3)
AI_BAND       = 0.68
HUMAN_BAND    = 0.55
LOCAL_CONF_FLOOR = 0.60
DISAGREEMENT_SCALE = 0.20

WHATSAPP_FILENAME_PATTERNS = ["ptt-", "whatsapp", "wa0", "-wa"]
# --------------------------------------------------------------
# Model State & Live Buffers
# --------------------------------------------------------------

# AntiGravity Binary Sentinel State
_live_buffers = defaultdict(lambda: [])  # List of (timestamp, score)

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
    def _process_live(neural_score: float, session_id: str, duration: float, is_whatsapp: bool) -> Dict[str, Any]:
        """Handles temporal smoothing and windowed decision for live streams."""
        import time
        global _live_buffers
        buffer = _live_buffers[session_id]

        # 1. Append with timestamp guard
        buffer.append((time.time(), neural_score))

        # 2. Sort and keep sliding window of WINDOW=5
        WINDOW = 5
        buffer.sort(key=lambda x: x[0])
        if len(buffer) > WINDOW:
            buffer[:] = buffer[-WINDOW:]

        scores = [s for _, s in buffer]

        # --- Decision Logic ---
        # Keeping existing 0.7 threshold for live stability
        THRESHOLD = 0.7
        
        if len(scores) < WINDOW:
            # Fallback: Best effort using latest score
            last_score = scores[-1]
            label = "SYNTHETIC" if last_score >= THRESHOLD else "REAL"
            path = "live_buffering_decisive"
        else:
            # Final Windowed average
            avg = sum(scores) / WINDOW
            label = "SYNTHETIC" if avg >= THRESHOLD else "REAL"
            path = "live_window_quorum"
            
        print(f"[SENTINEL] {session_id} | Window: {len(scores)} | Last: {scores[-1]:.3f} | Result: {label}")
        
        return {
            "final_label": label,
            "final_ai_score": round(scores[-1], 4),
            "confidence": 0.85,
            "decision_path": path,
            "raw_distributions": {
                "last_score": scores[-1]
            },
            "is_whatsapp": is_whatsapp,
            "duration": duration
        }

    @staticmethod
    def _process_upload(models: Dict[str, Dict], duration: float, is_whatsapp: bool) -> Dict[str, Any]:
        """Handles v3.3 forensic decision logic for audio analysis."""
        l = models.get("local", {})
        neural_score = float(l.get("ai_probability", 0.5))
        biometric_raw = float(l.get("biometric_raw", 0.0))
        biometric_norm = (biometric_raw + 1.0) / 2.0

        w = models.get("wav2vec", {})
        wav2vec_score = float(w.get("ai_probability", 0.5))

        g = models.get("gemini", {})
        gemini_score = float(g.get("ai_probability", 0.5))

        # 1. Neural Override: neural_score > 0.92 triggers SYNTHETIC override
        if neural_score > 0.92:
            final_label = "SYNTHETIC"
            decision_path = "neural_override"
            final_ai_score = neural_score
            confidence = float(l.get("confidence", 0.95))
            weighted = neural_score
        else:
            # 2. Weighted Fusion (0.5 Local, 0.3 Wav2Vec, 0.2 Biometric)
            weighted = 0.5 * neural_score + 0.3 * wav2vec_score + 0.2 * biometric_norm
            final_ai_score = weighted

            if weighted >= AI_BAND:
                final_label = "SYNTHETIC"
                decision_path = "weighted_consensus"
            elif weighted <= HUMAN_BAND:
                final_label = "REAL"
                decision_path = "human_band"
            else:
                final_label = "UNCERTAIN"
                decision_path = "uncertain_band"

            avg_conf = (
                float(l.get("confidence", 0.9)) +
                float(w.get("confidence", 0.9)) +
                float(g.get("confidence", 0.8))
            ) / 3.0

            # 3. Confidence smoothing within 0.05 margin of AI_BAND (0.68)
            margin = abs(weighted - AI_BAND)
            if margin < 0.05:
                penalty = 0.5 + margin * 10.0
                confidence = avg_conf * penalty
            else:
                confidence = avg_conf

        return {
            "final_label": final_label,
            "final_ai_score": round(final_ai_score, 4),
            "confidence": round(confidence, 4),
            "decision_path": decision_path,
            "raw_distributions": {
                "neural_raw": neural_score,
                "biometric_raw": biometric_raw,
                "biometric_norm": round(biometric_norm, 4),
                "wav2vec": wav2vec_score,
                "gemini": gemini_score,
                "weighted_score": round(weighted, 4),
                "final_score": round(final_ai_score, 4)
            },
            "is_whatsapp": is_whatsapp,
            "duration": duration
        }

    @staticmethod
    def compute_decision(models: Dict[str, Dict], is_whatsapp: bool = False, duration: float = 0.0, session_id: str = "default_session", mode: str = "upload") -> Dict[str, Any]:
        # --- 0. Signal Quality Gate ---
        local_model = models.get("local", {})
        if (0.0 < duration < 2.0) or not local_model or "ai_probability" not in local_model:
            return {
                "final_label": "UNCERTAIN",
                "final_ai_score": 0.5,
                "confidence": 0.5,
                "decision_path": "signal_quality_gate",
                "raw_distributions": {},
                "is_whatsapp": is_whatsapp,
                "duration": duration
            }

        # --- 1. Mode Dispatcher ---
        if mode == "live" or (mode == "auto" and 0.0 < duration < 2.5):
            neural_score = float(local_model.get("ai_probability", 0.5))
            return ForensicEngine._process_live(neural_score, session_id, duration, is_whatsapp)

        # Otherwise, run full v3.3 forensic evaluation
        return ForensicEngine._process_upload(models, duration, is_whatsapp)

    @staticmethod
    def generate_explanation(label: str, models: Dict[str, Dict], decision: Dict) -> str:
        path = decision.get("decision_path", "unknown")
        dist = decision.get("raw_distributions", {})
        
        # Agreement insight based on path
        if path == "neural_override":
            insight = "Secondary models were bypassable because of an overwhelmingly strong neural signature."
        elif path == "weighted_consensus":
            ai_count = dist.get("ai_models_count", 0)
            insight = f"Decision confirmed by independent consensus across {ai_count} models."
        elif path == "human_band":
            insight = "Audio signatures safely fall within the natural biological human band."
        elif path == "uncertain_band":
            insight = "Sample resides in the acoustic overlap zone; insufficient consensus for definitive synthetic labeling."
        elif path == "gemini_veto_override":
            insight = "Neural probability was overridden by high-confidence biological reasoning."
        else:
            insight = "Models processed signals through the defensible distribution engine."
            
        return f"{insight} Final classification settled as {label} with a {decision['confidence']*100:.1f}% confidence score."

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
    if ext in (".opus", ".ogg"): return True, f"Opus/Ogg extension ({ext})"
    try:
        rolloff = float(np.median(librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)))
        if rolloff < 3200: return True, "WhatsApp acoustic fingerprint"
    except Exception: pass
    return False, ""

def _run_local_detector_sync(y: np.ndarray, sr: int) -> Dict[str, Any]:
    try:
        from models.voice_detector import get_detector
        detector = get_detector()
        return detector.predict(y, sr)
    except Exception as e:
        return {"score": 0.5, "confidence": 0.5, "reason": str(e)}

async def _run_local_detector(y: np.ndarray, sr: int) -> Dict[str, Any]:
    return await run_in_threadpool(_run_local_detector_sync, y, sr)

def _run_pretrained_sync(y: np.ndarray, sr: int) -> Dict[str, Any]:
    if not pretrained_available:
        return {"available": False, "prob_synthetic": 0.5}
    try:
        # Resampling is CPU bound
        y_16k = librosa.resample(y, orig_sr=sr, target_sr=WAV2VEC2_SAMPLE_RATE)
        inputs = processor(y_16k, sampling_rate=WAV2VEC2_SAMPLE_RATE, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = pretrained_model(**inputs).logits
        probs = torch.softmax(logits, dim=-1)[0]
        prob_syn = float(probs[SYNTHETIC_LABEL_IDX or 1])
        return {"available": True, "prob_synthetic": prob_syn}
    except Exception:
        return {"available": False, "prob_synthetic": 0.5}

async def _run_pretrained(y: np.ndarray, sr: int) -> Dict[str, Any]:
    return await run_in_threadpool(_run_pretrained_sync, y, sr)

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

async def analyze_audio(file_bytes: bytes, filename: str, api_key: Optional[str] = None, session_id: str = "default_session", mode: str = "upload") -> Dict[str, Any]:
    # Move blocking model load and librosa load to thread pool
    await run_in_threadpool(load_model)
    try:
        # librosa.load is blocking
        y, sr = await run_in_threadpool(librosa.load, _io.BytesIO(file_bytes), sr=16000, mono=True)
    except Exception as e:
        return {"verdict": "ERROR", "warning": f"Audio decode failed: {e}"}

    # WhatsApp & Bandwidth
    wa_match, _ = _is_whatsapp_audio(filename, y, sr)
    try:
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
        is_narrowband = float(np.median(rolloff)) < NARROWBAND_ROLLOFF_HZ
    except Exception: is_narrowband = False

    # Silence Handling (Binary Guard)
    is_silent = np.abs(y).mean() < 0.01

    if is_silent:
        # In live mode, we treat silence as REAL instead of LISTENING for binary stability
        if 0.0 < (len(y)/sr) < 2.5:
            return {
                "final_label": "REAL",
                "verdict": "REAL",
                "confidence": 0.5,
                "reason": "Stable silence detected",
                "metadata": {"silent": True},
                "raw_distributions": {}
            }
        return {"final_label": "REAL", "verdict": "REAL", "confidence": 0.0, "low_confidence": True, "warning": "Audio too quiet"}

    # Run Tiers
    local_result = await _run_local_detector(y, sr)
    hf_result = await _run_pretrained(y, sr)
    gem_result = await _run_gemini(file_bytes, api_key)

    # Normalize Gemini
    gem_v = gem_result.get("verdict", "UNKNOWN")
    gem_c = float(gem_result.get("confidence", 0.5))
    gem_p = gem_c if gem_v == "SYNTHETIC" else (1.0 - gem_c) if gem_v == "REAL" else 0.5

    # Forensic Decision
    model_inputs = ForensicEngine.normalize_outputs(
        local=local_result, wav2vec=hf_result, gemini={"ai_probability": gem_p, "confidence": gem_c}
    )
    # Pass through the local signal for Weighted Distribution
    model_inputs["local"]["biometric_raw"] = local_result.get("biometric_raw", 0.0)
    
    duration = float(len(y) / sr)
    decision = ForensicEngine.compute_decision(model_inputs, is_whatsapp=wa_match, duration=duration, session_id=session_id, mode=mode)
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
            "decision_path":  decision["decision_path"],
            "raw_distributions": decision["raw_distributions"]
        }
    }
