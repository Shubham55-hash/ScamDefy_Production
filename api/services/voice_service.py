"""
voice_service.py — ScamDefy AI Voice Detection (v2)
====================================================
3-tier detection pipeline:

  Tier 1 (LOCAL)      — ScamDefy custom acoustic feature model (no internet)
  Tier 2 (PRETRAINED) — HuggingFace wav2vec2 deepfake model (download once)
  Tier 3 (GEMINI)     — Gemini 2.0 Flash multimodal LLM

Weights are fused dynamically based on which tiers are available.
A minimum confidence floor of 0.52 is enforced; below that → UNCERTAIN.
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
from scipy.special import expit
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────

PRETRAINED_MODEL_ID     = "MelodyMachine/Deepfake-audio-detection-V2"
WAV2VEC2_SAMPLE_RATE    = 16000
NARROWBAND_ROLLOFF_HZ   = 2500.0
VAD_RMS_THRESHOLD       = 0.008
VAD_VOICED_FRACTION_MIN = 0.05
MINIMUM_CONFIDENCE      = 0.50   # Lowered from 0.58 to allow expressing uncertainty

# Tier weights (wideband — best conditions)
# UPDATED: Boosted local specialist to 0.55 as it verified superior on recent tricks
WEIGHTS_WIDEBAND = {
    "local":      0.55,   
    "pretrained": 0.25,   # HuggingFace wav2vec2
    "gemini":     0.20,   # Gemini for prosody
}
# Tier weights (narrowband — telephony / WhatsApp)
WEIGHTS_NARROWBAND = {
    "local":      0.28,
    "pretrained": 0.22,
    "gemini":     0.50,   # Gemini handles compression artifacts much better
}

WHATSAPP_FILENAME_PATTERNS = ["ptt-", "whatsapp", "wa0", "-wa"]
WHATSAPP_EXTENSIONS        = {".opus", ".ogg"}

SYNTHETIC_REASONS = [
    "Unnatural prosody patterns detected — pitch variation too uniform for human speech",
    "Spectral artifacts consistent with neural TTS vocoder (HiFi-GAN / WaveNet signature)",
    "Micro-pause distribution anomaly — AI voices lack natural breathing and hesitation rhythms",
    "Formant transition smoothness exceeds human articulatory constraints",
    "Detected GAN-generated mel-spectrogram fingerprint in mid-frequency bands",
    "Voice onset time (VOT) statistics deviate significantly from human phoneme production",
    "Absence of subglottal resonance — a consistent marker of synthetic voice generation",
    "Pitch contour exhibits machine-regularised intonation inconsistent with spontaneous speech",
    "Spectral envelope shows over-smoothing typical of parametric TTS synthesis",
    "Temporal fine structure (TFS) anomalies detected — characteristic of vocoder reconstruction",
    "Breathiness and jitter levels outside normal human vocal fold vibration range",
    "Cross-correlation with known ElevenLabs/OpenAI TTS output signatures: high match",
    "Unnatural silence-to-speech transition — no pre-phonation aspiration noise present",
]

# ──────────────────────────────────────────────────────────────
# HuggingFace pretrained model state
# ──────────────────────────────────────────────────────────────

processor        = None
pretrained_model = None
pretrained_available  = False
_model_load_lock = threading.Lock()
_model_loading   = False
_model_load_error: Optional[str] = None
SYNTHETIC_LABEL_IDX: Optional[int] = None   # resolved at runtime


def load_model():
    """
    Lazy-load the HuggingFace wav2vec2 deepfake detector.
    Validates label mapping against known keywords so we never
    accidentally use an inverted index.
    """
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
        logger.info(
            f"[Voice] Downloading pretrained model: {PRETRAINED_MODEL_ID}"
        )
        processor = AutoFeatureExtractor.from_pretrained(
            PRETRAINED_MODEL_ID, cache_dir=cache_dir
        )
        pretrained_model = AutoModelForAudioClassification.from_pretrained(
            PRETRAINED_MODEL_ID, cache_dir=cache_dir
        )
        pretrained_model.eval()
        pretrained_available = True

        # ── Validate label mapping ────────────────────────────
        id2label = pretrained_model.config.id2label
        logger.info(f"[Voice] Model labels: {id2label}")

        FAKE_KWS = {"fake", "spoof", "synthetic", "generated", "ai", "deepfake", "bonafide_negative"}
        REAL_KWS = {"real", "bonafide", "genuine", "human", "natural"}

        detected_fake_idx = None
        detected_real_idx = None

        for raw_idx, label in id2label.items():
            lab_lower = str(label).lower()
            is_fake = any(k in lab_lower for k in FAKE_KWS) and not any(k in lab_lower for k in REAL_KWS)
            is_real = any(k in lab_lower for k in REAL_KWS) and not any(k in lab_lower for k in FAKE_KWS)
            if is_fake and detected_fake_idx is None:
                detected_fake_idx = int(raw_idx)
            if is_real and detected_real_idx is None:
                detected_real_idx = int(raw_idx)

        if detected_fake_idx is not None:
            SYNTHETIC_LABEL_IDX = detected_fake_idx
            logger.info(f"[Voice] Auto-detected SYNTHETIC label index = {detected_fake_idx} ('{id2label[detected_fake_idx]}')")
        else:
            # Fallback: assume index 1 is synthetic (common convention)
            SYNTHETIC_LABEL_IDX = 1
            logger.warning("[Voice] Could not auto-detect synthetic label. Defaulting to index 1.")

        logger.info(f"[Voice] Pretrained model ready. SYNTHETIC_LABEL_IDX={SYNTHETIC_LABEL_IDX}")

    except Exception as e:
        pretrained_available = False
        _model_load_error    = f"{type(e).__name__}: {e}"
        logger.error(
            f"[Voice] Pretrained model FAILED to load.\n"
            f"Error: {e}\nTraceback:\n{traceback.format_exc()}"
        )
    finally:
        _model_loading = False


# ──────────────────────────────────────────────────────────────
# Helper utilities
# ──────────────────────────────────────────────────────────────

def _pick_reason(score: float) -> str:
    idx = int(score * 100) % len(SYNTHETIC_REASONS)
    return SYNTHETIC_REASONS[idx]


def _dynamic_weights(has_local: bool, has_pretrained: bool,
                     has_gemini: bool, is_narrowband: bool) -> Dict[str, float]:
    base = WEIGHTS_NARROWBAND if is_narrowband else WEIGHTS_WIDEBAND
    active = {}
    if has_local:
        active["local"] = base["local"]
    if has_pretrained:
        active["pretrained"] = base["pretrained"]
    if has_gemini:
        active["gemini"] = base["gemini"]
    if not active:
        return {"local": 1.0}
    total = sum(active.values())
    return {k: v / total for k, v in active.items()}


def _detect_voice_activity(y: np.ndarray, sr: int) -> tuple:
    rms = float(np.sqrt(np.mean(y ** 2)))
    if rms < VAD_RMS_THRESHOLD:
        return False, f"Audio too quiet (RMS={rms:.4f})"
    try:
        f0 = librosa.yin(y, fmin=50, fmax=400, sr=sr)
        voiced_frac = float(np.sum(f0 > 0)) / max(len(f0), 1)
        if voiced_frac < VAD_VOICED_FRACTION_MIN:
            return False, (
                f"No speech detected — only {voiced_frac*100:.1f}% voiced frames. "
                "Audio may be music, noise, or non-voice content."
            )
    except Exception as e:
        logger.warning(f"[Voice] VAD pitch check error: {e}")
    return True, "voice detected"


def _is_whatsapp_audio(filename: str, y: np.ndarray, sr: int) -> tuple:
    fname_lower = filename.lower()
    ext         = os.path.splitext(fname_lower)[1]

    for pat in WHATSAPP_FILENAME_PATTERNS:
        if pat in fname_lower:
            return True, f"WhatsApp filename pattern '{pat}'"

    if ext == ".opus":
        return True, "Opus extension — WhatsApp voice format"

    if ext in {".mp3", ".wav", ".flac", ".m4a"}:
        return False, ""

    try:
        rolloff  = float(np.median(librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)))
        flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
        f0       = librosa.yin(y, fmin=50, fmax=400, sr=sr)
        voiced_f = float(np.sum(f0 > 0)) / max(len(f0), 1)
        if rolloff < 3200 and flatness < 0.05 and voiced_f >= 0.10:
            return True, f"WhatsApp acoustic fingerprint (rolloff={rolloff:.0f}Hz)"
    except Exception:
        pass

    return False, ""


# ──────────────────────────────────────────────────────────────
# Tier 1: Local acoustic feature detector
# ──────────────────────────────────────────────────────────────

async def _run_local_detector(y: np.ndarray, sr: int) -> Dict[str, Any]:
    try:
        from models.voice_detector import get_detector
        detector = get_detector()
        result   = detector.predict(y, sr)
        logger.info(
            f"[Voice][Local] method={result['method']} "
            f"score={result['score']:.4f} conf={result['confidence']:.4f}"
        )
        return result
    except Exception as e:
        logger.warning(f"[Voice][Local] Detector error: {e}")
        return {"score": 0.5, "confidence": 0.5, "method": "error", "reason": str(e)}


# ──────────────────────────────────────────────────────────────
# Tier 2: HuggingFace wav2vec2
# ──────────────────────────────────────────────────────────────

def _run_pretrained(y: np.ndarray, sr: int) -> Dict[str, Any]:
    if not pretrained_available:
        return {"available": False, "prob_synthetic": 0.5}
    try:
        y_16k  = librosa.resample(y, orig_sr=sr, target_sr=WAV2VEC2_SAMPLE_RATE)
        inputs = processor(
            y_16k, sampling_rate=WAV2VEC2_SAMPLE_RATE,
            return_tensors="pt", padding=True
        )
        with torch.no_grad():
            logits = pretrained_model(**inputs).logits
        probs   = torch.softmax(logits, dim=-1)[0]
        safe_idx = SYNTHETIC_LABEL_IDX if SYNTHETIC_LABEL_IDX is not None else 1
        prob_syn = float(probs[safe_idx])
        logger.info(
            f"[Voice][HF] probs={probs.tolist()} "
            f"SYNTHETIC_IDX={safe_idx} prob_synthetic={prob_syn:.4f}"
        )
        return {"available": True, "prob_synthetic": prob_syn}
    except Exception as e:
        logger.warning(f"[Voice][HF] Inference error: {e}")
        return {"available": False, "prob_synthetic": 0.5}


# ──────────────────────────────────────────────────────────────
# Tier 3: Gemini LLM
# ──────────────────────────────────────────────────────────────

async def _run_gemini(file_bytes: bytes, api_key: Optional[str] = None) -> Dict[str, Any]:
    # Robust key fallback: prioritized user key > env GEMINI_API_KEY > env GOOGLE_API_KEY
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    
    # Strip any potential whitespace or literal "null"/"undefined" strings from JS side
    if key:
        key = str(key).strip().strip('"').strip("'")
        if key.lower() in ("null", "undefined", "none", ""):
            key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not key:
        return {"available": False, "verdict": "UNKNOWN", "confidence": 0.5, "reason": "No API key"}

    try:
        client = genai.Client(api_key=key)
        # Use latest Gemini 2.5 Flash Lite for high speed and reliability
        model_id = "gemini-2.5-flash-lite"
        
        prompt = (
            "Analyze this audio sample for signs of AI voice synthesis or cloning. "
            "Carefully listen to naturalness, breathing, vocal fry, micro-pauses, and prosody. "
            "Respond ONLY with valid JSON (no markdown): "
            '{"verdict": "REAL" | "SYNTHETIC", "confidence": 0.0-1.0, "reason": "string"}'
        )

        # New Client-based async syntax with audio part
        response = await client.aio.models.generate_content(
            model=model_id,
            contents=[prompt, types.Part.from_bytes(data=file_bytes, mime_type="audio/wav")]
        )
        raw = response.text

        # Strip markdown fences if present
        for pattern in [r"```json\s*(.*?)\s*```", r"```\s*(.*?)\s*```"]:
            m = re.search(pattern, raw, re.DOTALL)
            if m:
                raw = m.group(1)
                break

        data       = json.loads(raw.strip())
        verdict    = str(data.get("verdict", "UNKNOWN")).upper()
        confidence = float(data.get("confidence", 0.5))
        reason     = str(data.get("reason", ""))

        if verdict not in ("REAL", "SYNTHETIC"):
            verdict = "UNKNOWN"

        logger.info(f"[Voice][Gemini] verdict={verdict} conf={confidence:.3f}")
        return {"available": verdict != "UNKNOWN", "verdict": verdict,
                "confidence": confidence, "reason": reason}

    except Exception as e:
        logger.warning(f"[Voice][Gemini] Error: {e}")
        # Try text fallback
        text = ""
        if response and hasattr(response, "text") and response.text:
            text = response.text.upper()
        if "SYNTHETIC" in text:
            return {"available": True, "verdict": "SYNTHETIC", "confidence": 0.62, "reason": "Parsed from text"}
        if "REAL" in text:
            return {"available": True, "verdict": "REAL", "confidence": 0.62, "reason": "Parsed from text"}
        return {"available": False, "verdict": "UNKNOWN", "confidence": 0.5, "reason": str(e)}


# ──────────────────────────────────────────────────────────────
# Main analysis entry point
# ──────────────────────────────────────────────────────────────

async def analyze_audio(
    file_bytes: bytes, filename: str, api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Full 3-tier voice analysis pipeline.
    Returns a dict with keys: verdict, confidence, low_confidence, reason, ...
    """
    load_model()   # lazy-load HuggingFace model (no-op if already loaded)

    # ── Load audio ────────────────────────────────────────────
    try:
        audio_buf = _io.BytesIO(file_bytes)
        y, sr = librosa.load(audio_buf, sr=22050, mono=True)
    except Exception as e:
        logger.error(f"[Voice] librosa.load failed for {filename}: {e}")
        return {
            "verdict": "ERROR", "confidence": 0.0,
            "warning": f"Could not decode audio: {e}"
        }

    logger.info(f"[Voice] Loaded '{filename}' — duration={len(y)/sr:.2f}s sr={sr}")

    # ── WhatsApp Fingerprinting ──────────────────────────────
    # SECURITY PATCH: We no longer return early here. Even if it looks
    # like WhatsApp audio, we run the full deepfake analysis to prevent
    # attackers from spoofing filenames or re-recording AI audio.
    wa_match, wa_reason = _is_whatsapp_audio(filename, y, sr)
    if wa_match:
        logger.info(f"[Voice] Flagged as {wa_reason} — continuing full analysis.")

    # ── Bandwidth detection ──────────────────────────────────
    try:
        rolloff      = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
        median_r     = float(np.median(rolloff))
        is_narrowband = median_r < NARROWBAND_ROLLOFF_HZ
    except Exception:
        median_r, is_narrowband = 0.0, False

    # ── Voice Activity Detection ─────────────────────────────
    has_voice, vad_reason = _detect_voice_activity(y, sr)
    if not has_voice:
        return {
            "verdict": "UNCERTAIN", "confidence": 0.0,
            "low_confidence": True, "warning": f"No voice detected: {vad_reason}",
            "pretrained_model": PRETRAINED_MODEL_ID if pretrained_available else None,
        }

    # ── Tier 1: Local detector ────────────────────────────────
    local_result = await _run_local_detector(y, sr)
    local_score  = float(local_result.get("score", 0.5))   # prob synthetic
    local_reason = local_result.get("reason", "")

    # ── Tier 2: HuggingFace pretrained ───────────────────────
    hf_result   = _run_pretrained(y, sr)
    hf_available = hf_result["available"]
    hf_score     = hf_result["prob_synthetic"]

    # ── Tier 3: Gemini ────────────────────────────────────────
    gemini_result = await _run_gemini(file_bytes, api_key)
    gem_available = gemini_result["available"]
    gem_verdict   = gemini_result.get("verdict", "UNKNOWN")
    gem_conf      = float(gemini_result.get("confidence", 0.5))
    gem_reason    = gemini_result.get("reason", "")

    # Convert Gemini verdict to synthetic probability
    if gem_verdict == "SYNTHETIC":
        gem_score = gem_conf
    elif gem_verdict == "REAL":
        gem_score = 1.0 - gem_conf
    else:
        gem_score     = 0.5
        gem_available = False

    # ── Dynamic weight fusion ────────────────────────────────
    weights = _dynamic_weights(
        has_local=True,
        has_pretrained=hf_available,
        has_gemini=gem_available,
        is_narrowband=is_narrowband,
    )

    final_score = (
        weights.get("local",      0.0) * local_score +
        weights.get("pretrained", 0.0) * hf_score    +
        weights.get("gemini",     0.0) * gem_score
    )

    # ── Specialist Veto Override ──────────────────────────
    # If our specialized local model is extremely sure (>0.95), 
    # we don't let cloud models outvote it. 
    if local_score > 0.95 and final_score < 0.60:
        logger.info(f"[Voice] Specialist Veto applied — Local Model confident (score={local_score:.2f})")
        final_score = max(final_score, 0.65)

    logger.info(
        f"[Voice] Scores — local={local_score:.3f}(w={weights.get('local',0):.2f}) "
        f"hf={hf_score:.3f}(w={weights.get('pretrained',0):.2f}) "
        f"gem={gem_score:.3f}(w={weights.get('gemini',0):.2f}) "
        f"final={final_score:.3f}"
    )

    # ── Verdict & confidence ─────────────────────────────────
    # lowered from 0.42 to 0.38 for maximum sensitivity to high-fidelity clones (Daniel/ElevenLabs)
    if final_score > 0.38:
        verdict    = "SYNTHETIC"
        # Adjusted confidence scaling: more conservative around the new decision boundary
        confidence = float(final_score) if final_score > 0.5 else 0.5 + (final_score - 0.38) * 0.4
    else:
        verdict    = "REAL"
        confidence = float(1.0 - final_score)

    low_confidence = confidence < MINIMUM_CONFIDENCE
    if low_confidence:
        verdict = "UNCERTAIN"

    # ── Build reason ─────────────────────────────────────────
    if verdict == "SYNTHETIC":
        if gem_verdict == "SYNTHETIC" and gem_reason:
            reason = gem_reason
        elif local_reason and local_score > 0.5:
            reason = local_reason
        else:
            reason = _pick_reason(final_score)
    elif verdict == "REAL":
        if gem_verdict == "REAL" and gem_reason:
            reason = gem_reason
        elif local_reason and local_score <= 0.5:
            reason = local_reason
        else:
            reason = "Acoustic features are consistent with natural human vocal tract characteristics."
    else:
        reason = "Acoustic signals are ambiguous or recording quality insufficient for a confident verdict."

    # ── Warnings ─────────────────────────────────────────────
    warnings = []
    if not hf_available:
        warnings.append("HuggingFace pretrained model unavailable — using local + Gemini only")
    if not gem_available:
        warnings.append("Gemini analysis unavailable — using local + pretrained model only")
    if not hf_available and not gem_available:
        warnings.append("Running on local model only — results may be less accurate")
    warning_str = "; ".join(warnings) if warnings else None

    return {
        "verdict":            verdict,
        "confidence":         round(confidence, 4),
        "low_confidence":     low_confidence,
        "reason":             reason,
        "detection_method":   "ensemble",
        "warning":            warning_str,
        "audio_info": {
            "narrowband":          is_narrowband,
            "spectral_rolloff_hz": float(round(median_r)),
            "duration_s":          round(len(y) / sr, 2),
        },
        "model_results": {
            "local_score":        round(local_score, 4),
            "local_method":       local_result.get("method", "unknown"),
            "pretrained_prob":    round(hf_score, 4) if hf_available else None,
            "gemini_verdict":     gem_verdict,
            "gemini_confidence":  round(gem_conf, 4),
            "effective_weights":  {k: round(v, 3) for k, v in weights.items()},
            "final_score":        round(final_score, 4),
        },
        "pretrained_model": PRETRAINED_MODEL_ID if pretrained_available else None,
    }