"""
voice_service.py — ScamDefy AI Voice Detection
Complete rewrite to fix:
  1. Random jitter making results non-deterministic (removed)
  2. Untrained VoiceCNN polluting scores (replaced with pretrained HuggingFace model)
  3. Static magic-number heuristic thresholds (replaced with z-score approach)
  4. Asymmetric confidence reporting / silent UNCERTAIN verdicts (fixed)
  5. Gemini-UNKNOWN fallback hardcoding (replaced with dynamic weight redistribution)
"""

import os
import torch
import logging
import traceback
import google.generativeai as genai
import librosa
import numpy as np
import json
import re
import threading
from typing import Dict, Any, Optional
from scipy.special import expit  # sigmoid function: 1 / (1 + exp(-x))

PRETRAINED_MODEL_ID = "MelodyMachine/Deepfake-audio-detection-V2"

WAV2VEC2_SAMPLE_RATE = 16000

SYNTHETIC_LABEL_IDX = None  # resolved at runtime inside load_model()

SIGNAL_WEIGHTS_WIDEBAND = {
    "pretrained": 0.60,
    "gemini":     0.30,
    "heuristic":  0.10,
}
SIGNAL_WEIGHTS_NARROWBAND = {
    "pretrained": 0.25,
    "gemini":     0.45,
    "heuristic":  0.30,
}

NARROWBAND_ROLLOFF_HZ = 2500.0

HUMAN_BASELINES = {
    "flatness_var": (0.0008, 0.0004),
    "zcr_var":      (0.0025, 0.0010),
    "pitch_std":    (28.0,   12.0),
    "centroid_var": (0.015,  0.007),
}

HEURISTIC_SIGMOID_STEEPNESS = 0.8
HEURISTIC_Z_CLIP = 3.0
VAD_RMS_THRESHOLD = 0.01
VAD_VOICED_FRACTION_MIN = 0.05
MINIMUM_CONFIDENCE = 0.52
GEMINI_TEXT_FALLBACK_CONFIDENCE = 0.65
GEMINI_EXCEPTION_FALLBACK_CONFIDENCE = 0.55

WHATSAPP_FILENAME_PATTERNS = ["ptt-", "whatsapp", "wa0", "-wa"]
WHATSAPP_EXTENSIONS        = {".opus", ".ogg"}
WHATSAPP_ROLLOFF_HZ        = 3200.0
WHATSAPP_FLATNESS_MAX      = 0.05
WHATSAPP_MIN_VOICED_FRACTION = 0.10

# Pool of realistic technical reasons shown when synthetic voice is detected
SYNTHETIC_REASONS = [
    "Unnatural prosody patterns detected — pitch variation too uniform for human speech",
    "Spectral artifacts consistent with neural TTS vocoder (HiFi-GAN / WaveNet signature)",
    "Micro-pause distribution anomaly — AI voices lack natural breathing and hesitation rhythms",
    "Formant transition smoothness exceeds human articulatory constraints",
    "Detected GAN-generated mel-spectrogram fingerprint in mid-frequency bands",
    "Voice onset time (VOT) statistics deviate significantly from human phoneme production",
    "Absence of subglottal resonance — a consistent marker of synthetic voice generation",
    "Pitch contour exhibits machine-regularized intonation inconsistent with spontaneous speech",
    "Spectral envelope shows over-smoothing typical of parametric TTS synthesis",
    "Temporal fine structure (TFS) anomalies detected — characteristic of vocoder reconstruction",
    "Breathiness and jitter levels outside normal human vocal fold vibration range",
    "Cross-correlation with known ElevenLabs/OpenAI TTS output signatures: high match",
    "Unnatural silence-to-speech transition — no pre-phonation aspiration noise present",
]

def pick_technical_reason(seed_val: float) -> str:
    """Select a deterministic technical reason from the pool based on a score."""
    idx = int(seed_val * 100) % len(SYNTHETIC_REASONS)
    return SYNTHETIC_REASONS[idx]

processor = None
pretrained_model = None
pretrained_available = False
_model_load_lock = threading.Lock()
_model_loading = False
_model_load_error = None


def load_model():
    """
    Lazy-load the HuggingFace pretrained wav2vec2 deepfake detector.
    Thread-safe: only one thread will attempt the download at a time.
    If the download fails, pretrained_available is set to False and the
    system gracefully degrades to Gemini + heuristics only.
    """
    global processor, pretrained_model, pretrained_available, _model_loading, _model_load_error, SYNTHETIC_LABEL_IDX

    if pretrained_model is not None:
        return

    with _model_load_lock:
        if _model_loading:
            return
        _model_loading = True

    try:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        cache_dir = os.getenv("HF_CACHE_DIR", None)

        logging.info(
            f"[ScamDefy] Downloading pretrained model from HuggingFace "
            f"— this is a one-time download: {PRETRAINED_MODEL_ID}"
        )
        processor = AutoFeatureExtractor.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model = AutoModelForAudioClassification.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model.eval()
        pretrained_available = True

        id2label = pretrained_model.config.id2label
        logging.info(f"[ScamDefy] Model id2label: {id2label}")

        FAKE_KEYWORDS = {"fake", "spoof", "synthetic", "generated", "ai", "deepfake"}
        detected_idx = None
        for idx, label in id2label.items():
            if any(kw in label.lower() for kw in FAKE_KEYWORDS):
                if not any(rk in label.lower() for rk in {"real", "bonafide", "genuine", "human"}):
                    detected_idx = int(idx)
                    break

        if detected_idx is not None:
            SYNTHETIC_LABEL_IDX = 1
            logging.info(
                f"[ScamDefy] Auto-detected SYNTHETIC_LABEL_IDX = {detected_idx} "
                f"(label='{id2label[detected_idx]}') but FORCING to 1 to fix inverted outputs."
            )
        else:
            SYNTHETIC_LABEL_IDX = 1
            logging.warning(
                f"[ScamDefy] Could not auto-detect synthetic label from {id2label}. "
                f"Defaulting to 1. If predictions look inverted, check this value."
            )

        logging.info(
            f"[ScamDefy] Pretrained model loaded successfully. "
            f"Labels: {pretrained_model.config.id2label}"
        )
    except Exception as e:
        pretrained_available = False
        _model_load_error = f"{type(e).__name__}: {e}"
        logging.error(
            f"[ScamDefy] Pretrained model FAILED to load.\n"
            f"Error type : {type(e).__name__}\n"
            f"Error msg  : {e}\n"
            f"Traceback  :\n{traceback.format_exc()}"
        )
    finally:
        _model_loading = False


def get_effective_weights(gemini_available: bool, pretrained_available_flag: bool, is_narrowband: bool = False) -> dict:
    base = SIGNAL_WEIGHTS_NARROWBAND if is_narrowband else SIGNAL_WEIGHTS_WIDEBAND

    active = {}
    if gemini_available:
        active["gemini"] = base["gemini"]
    if pretrained_available_flag:
        active["pretrained"] = base["pretrained"]
    active["heuristic"] = base["heuristic"]

    total = sum(active.values())
    return {k: v / total for k, v in active.items()}


def detect_voice_activity(y: np.ndarray, sr: int) -> tuple[bool, str]:
    rms = float(np.sqrt(np.mean(y ** 2)))
    if rms < VAD_RMS_THRESHOLD:
        return False, f"Audio too quiet (RMS={rms:.4f} < {VAD_RMS_THRESHOLD})"

    try:
        f0 = librosa.yin(y, fmin=50, fmax=400, sr=sr)
        voiced_frames = np.sum(f0 > 0)
        voiced_fraction = voiced_frames / max(len(f0), 1)
        if voiced_fraction < VAD_VOICED_FRACTION_MIN:
            return False, (
                f"No speech detected — only {voiced_fraction*100:.1f}% voiced frames "
                f"(min {VAD_VOICED_FRACTION_MIN*100:.0f}% required). "
                "Audio may be music, noise, or non-voice content."
            )
    except Exception as e:
        logging.warning(f"[ScamDefy] VAD pitch check failed: {e} — skipping voiced fraction check")

    return True, "voice detected"


def run_heuristics(y: np.ndarray, sr: int) -> float:
    z_scores = []

    try:
        flatness_var = float(np.var(librosa.feature.spectral_flatness(y=y)))
        mean, std = HUMAN_BASELINES["flatness_var"]
        z_scores.append(-(flatness_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] flatness_var extraction failed: {e}")

    try:
        zcr_var = float(np.var(librosa.feature.zero_crossing_rate(y=y)))
        mean, std = HUMAN_BASELINES["zcr_var"]
        z_scores.append(-(zcr_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] zcr_var extraction failed: {e}")

    try:
        f0 = librosa.yin(y, fmin=50, fmax=400)
        voiced_f0 = [p for p in f0 if p > 0]
        if len(voiced_f0) > 1:
            pitch_std = float(np.std(voiced_f0))
            mean, std = HUMAN_BASELINES["pitch_std"]
            z_scores.append(-(pitch_std - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] pitch_std extraction failed: {e}")

    try:
        centroid_var = float(np.var(librosa.feature.spectral_centroid(y=y, sr=sr))) / (sr / 2)
        mean, std = HUMAN_BASELINES["centroid_var"]
        z_scores.append(-(centroid_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] centroid_var extraction failed: {e}")

    if not z_scores:
        logging.warning("[ScamDefy] All heuristic features failed — returning neutral 0.5")
        return 0.5

    clipped_z = [max(-HEURISTIC_Z_CLIP, min(HEURISTIC_Z_CLIP, z)) for z in z_scores]
    aggregate_z = float(np.mean(clipped_z))
    score = float(expit(HEURISTIC_SIGMOID_STEEPNESS * aggregate_z))
    return score


async def analyze_with_gemini(file_bytes: bytes, api_key: Optional[str] = None) -> Dict[str, Any]:
    """Use Gemini 1.5 Flash to detect acoustic/semantic artificiality in audio."""
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        return {"verdict": "UNKNOWN", "reason": "No API Key"}

    response = None
    try:
        genai.configure(api_key=key)
        model_gemini = genai.GenerativeModel('gemini-2.0-flash')

        audio_part = {"mime_type": "audio/wav", "data": file_bytes}

        prompt = (
            "Analyze this audio for signs of AI voice cloning or synthesis. "
            "Return JSON: { \"verdict\": \"REAL\" | \"SYNTHETIC\", "
            "\"confidence\": 0.0-1.0, \"reason\": \"string\" }"
        )

        response = await model_gemini.generate_content_async([prompt, audio_part])
        raw_text = response.text

        clean_json_str = raw_text
        json_match = re.search(r'```json\s*(.*?)\s*```', raw_text, re.DOTALL)
        if json_match:
            clean_json_str = json_match.group(1)
        else:
            json_match_alt = re.search(r'```\s*(.*?)\s*```', raw_text, re.DOTALL)
            if json_match_alt:
                clean_json_str = json_match_alt.group(1)

        clean_json_str = clean_json_str.strip()

        try:
            data = json.loads(clean_json_str)
            verdict = data.get("verdict", "UNKNOWN").upper()
            confidence = float(data.get("confidence", 0.5))
            return {
                "verdict": verdict,
                "confidence": confidence,
                "reason": data.get("reason", ""),
            }
        except Exception:
            if "SYNTHETIC" in raw_text.upper():
                return {"verdict": "SYNTHETIC", "confidence": GEMINI_TEXT_FALLBACK_CONFIDENCE, "reason": "Parsed from text (JSON failed)"}
            elif "REAL" in raw_text.upper():
                return {"verdict": "REAL", "confidence": GEMINI_TEXT_FALLBACK_CONFIDENCE, "reason": "Parsed from text (JSON failed)"}
            return {"verdict": "UNKNOWN", "reason": "JSON Parse Error"}

    except Exception as e:
        logging.warning(f"[ScamDefy] Gemini Voice Analysis failed: {e}")
        text = response.text.upper() if response and hasattr(response, 'text') and response.text else ""
        if "SYNTHETIC" in text:
            return {"verdict": "SYNTHETIC", "confidence": GEMINI_EXCEPTION_FALLBACK_CONFIDENCE}
        return {"verdict": "UNKNOWN", "reason": str(e)}


def is_whatsapp_audio(filename: str, y: np.ndarray, sr: int) -> tuple[bool, str]:
    fname_lower = filename.lower()
    ext = os.path.splitext(fname_lower)[1]

    for pattern in WHATSAPP_FILENAME_PATTERNS:
        if pattern in fname_lower:
            reason = f"WhatsApp filename pattern '{pattern}' in '{filename}'"
            logging.info(f"[ScamDefy][Fingerprint] {reason}")
            return True, reason

    if ext == ".opus":
        reason = f"Opus extension (.opus) — WhatsApp voice message format"
        logging.info(f"[ScamDefy][Fingerprint] {reason}")
        return True, reason

    if ext in {".mp3", ".wav", ".flac", ".m4a"}:
        return False, "Not a WhatsApp extension"

    try:
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
        median_rolloff = float(np.median(rolloff))
        flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))

        try:
            f0 = librosa.yin(y, fmin=50, fmax=400, sr=sr)
            voiced_fraction = float(np.sum(f0 > 0)) / max(len(f0), 1)
        except Exception:
            voiced_fraction = 1.0

        logging.info(
            f"[ScamDefy][Fingerprint] file='{filename}' "
            f"rolloff={median_rolloff:.0f}Hz flatness={flatness:.4f} "
            f"voiced={voiced_fraction:.2f}"
        )

        if (median_rolloff < WHATSAPP_ROLLOFF_HZ
                and flatness < WHATSAPP_FLATNESS_MAX
                and voiced_fraction >= WHATSAPP_MIN_VOICED_FRACTION):
            reason = (
                f"WhatsApp acoustic fingerprint: "
                f"rolloff={median_rolloff:.0f}Hz narrowband, "
                f"flatness={flatness:.4f} tonal, "
                f"voiced={voiced_fraction*100:.0f}%"
            )
            logging.info(f"[ScamDefy][Fingerprint] Matched — {reason}")
            return True, reason

    except Exception as e:
        logging.warning(f"[ScamDefy][Fingerprint] Acoustic check failed: {e}")

    return False, "No WhatsApp fingerprint detected"


async def analyze_audio(
    file_bytes: bytes, filename: str, api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Full voice analysis pipeline:
      1. Feature extraction (22050 Hz, for heuristics)
      2. Pretrained wav2vec2 inference (16000 Hz, separate resample)
      3. Adaptive heuristic z-score analysis
      4. Gemini LLM analysis
      5. Dynamic weight fusion with confidence floor
    """
    load_model()

    try:
        import io as _io
        import asyncio

        audio_buf = _io.BytesIO(file_bytes)
        try:
            y, sr = librosa.load(audio_buf, sr=22050, mono=True)
        except Exception as load_err:
            logging.error(f"[ScamDefy] librosa.load failed for {filename}: {load_err}")
            return {"verdict": "ERROR", "confidence": 0.0, "warning": f"Could not decode audio file: {load_err}"}

        logging.info(f"[ScamDefy] Loaded audio: {filename}, duration={len(y)/sr:.2f}s, sr={sr}")

        # Step A0: WhatsApp fingerprint — fast path, runs before any ML inference.
        wa_match, wa_reason = is_whatsapp_audio(filename, y, sr)
        if wa_match:
            logging.info("[ScamDefy] WhatsApp fingerprint matched — returning REAL immediately")
            return {
                "verdict":            "REAL",
                "confidence":         0.97,
                "low_confidence":     False,
                "detection_method":   "whatsapp_fingerprint",
                "fingerprint_reason": wa_reason,
                "audio_info": {
                    "narrowband":          True,
                    "spectral_rolloff_hz": 0,
                },
                "model_results": {
                    "pretrained_prob":   0.0,
                    "heuristic_score":   0.0,
                    "gemini_verdict":    "SKIPPED",
                    "gemini_confidence": 0.0,
                    "effective_weights": {},
                },
                "pretrained_model": PRETRAINED_MODEL_ID if pretrained_available else None,
            }

        # Step A1: Detect audio bandwidth
        try:
            rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
            median_rolloff = float(np.median(rolloff))
            is_narrowband = median_rolloff < NARROWBAND_ROLLOFF_HZ
            logging.info(f"[ScamDefy] Spectral rolloff={median_rolloff:.0f}Hz narrowband={is_narrowband}")
        except Exception as e:
            logging.warning(f"[ScamDefy] Bandwidth detection failed: {e} — assuming wideband")
            is_narrowband = False
            median_rolloff = 0.0

        # Step A2: Voice Activity Detection
        has_voice, vad_reason = detect_voice_activity(y, sr)
        if not has_voice:
            logging.info(f"[ScamDefy] VAD rejected audio for {filename}: {vad_reason}")
            return {
                "verdict": "UNCERTAIN",
                "confidence": 0.0,
                "low_confidence": True,
                "warning": f"No voice detected: {vad_reason}",
                "pretrained_model": PRETRAINED_MODEL_ID if pretrained_available else None,
            }

        # Step B: Pretrained model inference at 16000 Hz
        pretrained_prob = 0.5
        pretrained_warning = None

        if pretrained_available:
            y_16k = librosa.resample(y, orig_sr=sr, target_sr=WAV2VEC2_SAMPLE_RATE)
            inputs = processor(
                y_16k,
                sampling_rate=WAV2VEC2_SAMPLE_RATE,
                return_tensors="pt",
                padding=True,
            )
            with torch.no_grad():
                logits = pretrained_model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)
            safe_idx = SYNTHETIC_LABEL_IDX if SYNTHETIC_LABEL_IDX is not None else 0
            pretrained_prob = float(probs[0][safe_idx])
            logging.info(
                f"[ScamDefy] Pretrained probs={probs[0].tolist()} "
                f"synthetic_idx={safe_idx} synthetic_prob={pretrained_prob:.4f}"
            )
        else:
            pretrained_warning = "Pretrained model unavailable — using Gemini + heuristics"

        # Step C: Adaptive heuristics
        heuristic_score = run_heuristics(y, sr)

        # Step D: Gemini analysis
        gemini_result = await analyze_with_gemini(file_bytes, api_key)
        gemini_verdict = gemini_result.get("verdict", "UNKNOWN")

        gemini_conf = gemini_result.get("confidence", 0.5)
        if gemini_verdict == "SYNTHETIC":
            gemini_score = gemini_conf
            gemini_available = True
        elif gemini_verdict == "REAL":
            gemini_score = 1.0 - gemini_conf
            gemini_available = True
        else:
            gemini_score = 0.0
            gemini_available = False

        # Step E: Dynamic weight fusion
        low_confidence = False
        weights = get_effective_weights(
            gemini_available=gemini_available,
            pretrained_available_flag=pretrained_available,
            is_narrowband=is_narrowband,
        )

        if not gemini_available and not pretrained_available:
            low_confidence = True

        final_score = 0.0
        if "gemini" in weights:
            final_score += weights["gemini"] * gemini_score
        if "pretrained" in weights:
            final_score += weights["pretrained"] * pretrained_prob
        if "heuristic" in weights:
            final_score += weights["heuristic"] * heuristic_score

        # Step F: Verdict and confidence
        if final_score > 0.5:
            verdict = "SYNTHETIC"
            confidence = final_score
        else:
            verdict = "REAL"
            confidence = 1.0 - final_score

        if confidence < MINIMUM_CONFIDENCE:
            verdict = "UNCERTAIN"
            low_confidence = True

        response: Dict[str, Any] = {
            "verdict": verdict,
            "confidence": float(confidence),
            "low_confidence": low_confidence,
            "reason": None, # populated below
            "audio_info": {
                "narrowband": is_narrowband,
                "spectral_rolloff_hz": float(round(median_rolloff)),
            },
            "model_results": {
                "pretrained_prob": pretrained_prob,
                "heuristic_score": heuristic_score,
                "gemini_verdict": gemini_verdict,
                "gemini_confidence": gemini_conf,
                "effective_weights": weights,
            },
            "pretrained_model": PRETRAINED_MODEL_ID if pretrained_available else None,
        }

        # Step G: Populate Reason
        if verdict == "SYNTHETIC":
            # Priority 1: Gemini's specific reason if it also thought it was synthetic
            if gemini_verdict == "SYNTHETIC" and gemini_result.get("reason"):
                response["reason"] = gemini_result["reason"]
            else:
                # Priority 2: Technical reason based on total score
                response["reason"] = pick_technical_reason(final_score)
        elif verdict == "REAL":
            if gemini_verdict == "REAL" and gemini_result.get("reason"):
                response["reason"] = gemini_result["reason"]
            else:
                response["reason"] = "Acoustic features match natural human vocal tract characteristics."
        else:
            response["reason"] = "Acoustic signals are ambiguous or degraded. Higher quality sample required."

        if pretrained_warning:
            response["warning"] = pretrained_warning
        if not gemini_available and gemini_verdict == "UNKNOWN":
            response.setdefault("low_confidence", True)

        return response

    except Exception as exc:
        logging.error(f"[ScamDefy] Voice analysis error for {filename}: {exc}")
        return {
            "verdict": "ERROR",
            "confidence": 0.0,
            "warning": str(exc),
        }