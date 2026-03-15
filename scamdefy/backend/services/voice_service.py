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

# ---------------------------------------------------------------------------
# Model checkpoint — swap this string to use a different wav2vec2-based
# deepfake classifier without touching any other logic in this file.
# MelodyMachine/Deepfake-audio-detection-V2 is used because it:
#   - Has a valid AutoFeatureExtractor config (unlike mo-thecreator which lacks one)
#   - Is publicly available without authentication
#   - Label mapping: {0: 'fake', 1: 'real'} — index 0 is the synthetic class
# ---------------------------------------------------------------------------
PRETRAINED_MODEL_ID = "MelodyMachine/Deepfake-audio-detection-V2"

# This model's feature extractor expects 16000 Hz — keep separate from the
# librosa heuristic pipeline which stays at 22050 Hz.
# Do not change this without also changing PRETRAINED_MODEL_ID.
WAV2VEC2_SAMPLE_RATE = 16000

# Label index for the SYNTHETIC/FAKE class in the chosen model.
# Tested empirically: MelodyMachine model actually uses 0=real, 1=fake
# (the comment in the original code had this backwards)
# Real voice -> probs[0][1] near 0 (low fake probability) ✓
# AI voice   -> probs[0][1] near 1 (high fake probability) ✓
SYNTHETIC_LABEL_IDX = 1

# ---------------------------------------------------------------------------
# Signal weights for the fusion score.
# Two weight sets — selected dynamically based on audio bandwidth.
# get_effective_weights() normalises automatically so weights always sum to 1.0.
#
# WIDEBAND: clean studio/microphone audio (rolloff > NARROWBAND_ROLLOFF_HZ)
#   pretrained model is reliable on clean audio.
#
# NARROWBAND: phone/compressed audio (WhatsApp Opus, telephone, low-bitrate)
#   The pretrained model (MelodyMachine) was trained on ASVspoof2019 studio audio.
#   Opus/phone codec artifacts at 8kHz resampled to 16kHz look like synthesis
#   artifacts to the model — it gives 0.9999 synthetic prob for real phone speech.
#   So we drastically reduce its weight and rely more on Gemini + heuristics.
# ---------------------------------------------------------------------------
SIGNAL_WEIGHTS_WIDEBAND = {
    "gemini":     0.55,
    "pretrained": 0.38,
    "heuristic":  0.07,
}
SIGNAL_WEIGHTS_NARROWBAND = {
    "gemini":     0.70,
    "pretrained": 0.10,
    "heuristic":  0.20,
}

# Spectral rolloff frequency (Hz) below which audio is considered narrowband.
# Phone/WhatsApp Opus audio rolls off below ~3500 Hz.
# Clean microphone audio rolls off above ~6000 Hz.
# Using 4000 Hz as the boundary (well below clean audio, well above phone audio).
NARROWBAND_ROLLOFF_HZ = 4000.0

# ---------------------------------------------------------------------------
# Reference distributions for human voice acoustic features.
# Derived from published acoustic phonetics research on read/spontaneous speech.
# Format: { feature_name: (mean, std) }
# A positive z-score means "more robotic than typical human speech".
# Update these if you collect real-world calibration data.
# ---------------------------------------------------------------------------
HUMAN_BASELINES = {
    "flatness_var": (0.0008, 0.0004),  # spectral flatness variance
    "zcr_var":      (0.0025, 0.0010),  # zero-crossing-rate variance
    "pitch_std":    (28.0,   12.0),    # pitch standard deviation in Hz
    "centroid_var": (0.015,  0.007),   # spectral centroid variance (normalised by Nyquist)
}

# Controls sigmoid steepness for the heuristic output score.
HEURISTIC_SIGMOID_STEEPNESS = 0.8

# Z-score clipping threshold — standard practice in anomaly detection.
# Without this, audio with extreme acoustic features (noise, music, silence)
# produces z-scores of -10 to -15, which sigmoid maps to ~0.0000001.
# That artificially pushes confidence to 99.99% REAL.
# Clipping to [-3, 3] keeps the heuristic in a meaningful range.
HEURISTIC_Z_CLIP = 3.0

# Minimum RMS energy for audio to be considered as containing voice.
# Below this threshold the audio is silence or near-silence — no analysis possible.
VAD_RMS_THRESHOLD = 0.01

# Minimum fraction of frames that must have detected pitch (f0 > 0).
# Below this, audio has no voiced speech (could be music, noise, whisper, silence).
VAD_VOICED_FRACTION_MIN = 0.05

# Minimum confidence to issue a REAL or SYNTHETIC verdict.
# Below this threshold return UNCERTAIN.
MINIMUM_CONFIDENCE = 0.62

# Confidence assigned when Gemini returns valid JSON with a verdict.
# Gemini's self-reported confidence is used directly — this is only a fallback
# when JSON parsing fails and we resort to scanning the raw text.
GEMINI_TEXT_FALLBACK_CONFIDENCE = 0.65

# Confidence assigned when Gemini throws an exception but the raw response
# text still contains a verdict keyword — last-resort partial signal.
GEMINI_EXCEPTION_FALLBACK_CONFIDENCE = 0.55

# ---------------------------------------------------------------------------
# Pretrained model globals — lazy-loaded on first request
# ---------------------------------------------------------------------------
processor = None
pretrained_model = None
pretrained_available = False
_model_load_lock = threading.Lock()
_model_loading = False
_model_load_error = None  # stores the last error message if loading failed


def load_model():
    """
    Lazy-load the HuggingFace pretrained wav2vec2 deepfake detector.
    Thread-safe: only one thread will attempt the download at a time.
    If the download fails, pretrained_available is set to False and the
    system gracefully degrades to Gemini + heuristics only.
    NOTE: The old VoiceCNN (voice_cnn_model.py) is intentionally NOT used
    for inference — it has untrained/dummy weights. It is retained in the
    codebase so a future developer can train it on a real dataset.
    """
    global processor, pretrained_model, pretrained_available, _model_loading, _model_load_error

    if pretrained_model is not None:
        return  # already loaded

    with _model_load_lock:
        if _model_loading:
            return  # another thread is already downloading
        _model_loading = True

    try:
        # Use AutoFeatureExtractor — works with any wav2vec2-based model regardless
        # of whether the repo has a tokenizer_config.json (Wav2Vec2Processor requires
        # that file; AutoFeatureExtractor does not).
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        # Optional: set HF_CACHE_DIR in .env to persist model to a mounted volume
        cache_dir = os.getenv("HF_CACHE_DIR", None)

        logging.info(
            f"[ScamDefy] Downloading pretrained model from HuggingFace "
            f"— this is a one-time download: {PRETRAINED_MODEL_ID}"
        )
        processor = AutoFeatureExtractor.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model = AutoModelForAudioClassification.from_pretrained(PRETRAINED_MODEL_ID, cache_dir=cache_dir)
        pretrained_model.eval()
        pretrained_available = True
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


# ---------------------------------------------------------------------------
# Weight redistribution
# ---------------------------------------------------------------------------

def get_effective_weights(gemini_available: bool, pretrained_available_flag: bool, is_narrowband: bool = False) -> dict:
    """
    Returns adjusted signal weights that always sum to 1.0.
    Selects wideband or narrowband weight set based on audio bandwidth.

    Narrowband (phone/WhatsApp/compressed) audio: pretrained model weight is
    reduced to 0.10 because MelodyMachine was trained on clean studio recordings
    and gives near-1.0 synthetic probability for codec-compressed real speech.

    Redistributes weight from unavailable signals proportionally to available ones.
    """
    base = SIGNAL_WEIGHTS_NARROWBAND if is_narrowband else SIGNAL_WEIGHTS_WIDEBAND

    active = {}
    if gemini_available:
        active["gemini"] = base["gemini"]
    if pretrained_available_flag:
        active["pretrained"] = base["pretrained"]
    # heuristic is always available
    active["heuristic"] = base["heuristic"]

    total = sum(active.values())
    return {k: v / total for k, v in active.items()}


# ---------------------------------------------------------------------------
# Adaptive heuristics using z-scores
# ---------------------------------------------------------------------------

def detect_voice_activity(y: np.ndarray, sr: int) -> tuple[bool, str]:
    """
    Voice Activity Detection — checks if the audio actually contains speech.
    Returns (has_voice: bool, reason: str).

    Deepfake detection only makes sense on audio that contains human voice.
    Running it on music, noise, or silence produces meaningless results.
    This is standard practice in all production deepfake detectors.
    """
    # Check 1: RMS energy — silence / very quiet audio
    rms = float(np.sqrt(np.mean(y ** 2)))
    if rms < VAD_RMS_THRESHOLD:
        return False, f"Audio too quiet (RMS={rms:.4f} < {VAD_RMS_THRESHOLD})"

    # Check 2: Voiced frame fraction using pitch detection
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
    """
    Compute a synthetic-voice probability [0, 1] using z-score anomaly detection.

    Each feature's deviation from a typical human baseline is expressed as a z-score.
    A positive z means "more robotic than human baseline".

    Z-scores are clipped to [-HEURISTIC_Z_CLIP, +HEURISTIC_Z_CLIP] before the sigmoid.
    Without clipping, audio with extreme feature values (noise, music) produces
    z-scores of -10 to -15, which sigmoid maps to near 0.0 — making the heuristic
    falsely declare near-100% confidence for REAL on any non-speech audio.
    Clipping is standard practice in z-score anomaly detection pipelines.
    """
    z_scores = []

    # -- Feature 1: spectral flatness variance --
    try:
        flatness_var = float(np.var(librosa.feature.spectral_flatness(y=y)))
        mean, std = HUMAN_BASELINES["flatness_var"]
        # Synthetic voices have LOWER flatness variance — so we negate:
        # below-human baseline → positive z → higher synthetic probability
        z_scores.append(-(flatness_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] flatness_var extraction failed: {e}")

    # -- Feature 2: zero-crossing rate variance --
    try:
        zcr_var = float(np.var(librosa.feature.zero_crossing_rate(y=y)))
        mean, std = HUMAN_BASELINES["zcr_var"]
        # Synthetic voices have LOWER zcr variance → negate
        z_scores.append(-(zcr_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] zcr_var extraction failed: {e}")

    # -- Feature 3: pitch standard deviation --
    try:
        # librosa.yin returns 0 for unvoiced frames — exclude those
        f0 = librosa.yin(y, fmin=50, fmax=400)
        voiced_f0 = [p for p in f0 if p > 0]
        if len(voiced_f0) > 1:
            pitch_std = float(np.std(voiced_f0))
            mean, std = HUMAN_BASELINES["pitch_std"]
            # Synthetic voices have LOWER pitch variation → negate
            z_scores.append(-(pitch_std - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] pitch_std extraction failed: {e}")

    # -- Feature 4: spectral centroid variance (normalised by Nyquist) --
    try:
        centroid_var = float(np.var(librosa.feature.spectral_centroid(y=y, sr=sr))) / (sr / 2)
        mean, std = HUMAN_BASELINES["centroid_var"]
        # Synthetic voices have LOWER centroid variance → negate
        z_scores.append(-(centroid_var - mean) / std)
    except Exception as e:
        logging.warning(f"[ScamDefy] centroid_var extraction failed: {e}")

    if not z_scores:
        logging.warning("[ScamDefy] All heuristic features failed — returning neutral 0.5")
        return 0.5

    # Clip each z-score to [-HEURISTIC_Z_CLIP, +HEURISTIC_Z_CLIP]
    # This prevents audio with extreme acoustic properties (noise, music)
    # from saturating the sigmoid and producing false near-100% confidence.
    clipped_z = [max(-HEURISTIC_Z_CLIP, min(HEURISTIC_Z_CLIP, z)) for z in z_scores]
    aggregate_z = float(np.mean(clipped_z))
    score = float(expit(HEURISTIC_SIGMOID_STEEPNESS * aggregate_z))
    return score


# ---------------------------------------------------------------------------
# Gemini analysis
# ---------------------------------------------------------------------------

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

        # Strip markdown code fences if Gemini wraps the JSON
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
            # Fallback text scan if JSON parse fails
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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

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
    # Ensure the pretrained model is loaded (or attempted) before analysis.
    # load_model() is idempotent and thread-safe.
    load_model()

    try:
        # ---------------------------------------------------------------
        # Step A: Load audio — supports wav, mp3, ogg, m4a
        # Using librosa.load() directly because the compiled feature_extractor
        # uses soundfile which does NOT support .ogg or .mp3.
        # librosa.load() handles all formats via audioread as fallback.
        # ---------------------------------------------------------------
        import io as _io
        audio_buf = _io.BytesIO(file_bytes)
        try:
            y, sr = librosa.load(audio_buf, sr=22050, mono=True)
        except Exception as load_err:
            logging.error(f"[ScamDefy] librosa.load failed for {filename}: {load_err}")
            return {"verdict": "ERROR", "confidence": 0.0, "warning": f"Could not decode audio file: {load_err}"}

        logging.info(f"[ScamDefy] Loaded audio: {filename}, duration={len(y)/sr:.2f}s, sr={sr}")

        # ---------------------------------------------------------------
        # Step A1: Detect audio bandwidth
        # Phone/WhatsApp audio is narrowband (Opus 8kHz) — the pretrained model
        # is unreliable on this type of audio, so we switch to narrowband weights.
        # Spectral rolloff at 85% captures the effective frequency range.
        # ---------------------------------------------------------------
        try:
            rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)
            median_rolloff = float(np.median(rolloff))
            is_narrowband = median_rolloff < NARROWBAND_ROLLOFF_HZ
            logging.info(f"[ScamDefy] Spectral rolloff={median_rolloff:.0f}Hz narrowband={is_narrowband}")
        except Exception as e:
            logging.warning(f"[ScamDefy] Bandwidth detection failed: {e} — assuming wideband")
            is_narrowband = False
            median_rolloff = 0.0

        # ---------------------------------------------------------------
        # Step A2: Voice Activity Detection
        # Deepfake detection only makes sense on audio containing speech.
        # Music, noise, silence, or non-voice content should return UNCERTAIN.
        # ---------------------------------------------------------------
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

        # ---------------------------------------------------------------
        # Step B: Pretrained model inference at 16000 Hz
        # Resample independently from the heuristic pipeline — the two
        # sample rates serve different purposes and must stay separate.
        # ---------------------------------------------------------------
        pretrained_prob = 0.5  # neutral fallback if model unavailable
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
            # Model returns raw logits — softmax to get probabilities.
            # SYNTHETIC_LABEL_IDX = 1 (empirically verified: MelodyMachine uses 1=fake, 0=real)
            probs = torch.softmax(logits, dim=-1)
            pretrained_prob = float(probs[0][SYNTHETIC_LABEL_IDX])
        else:
            pretrained_warning = "Pretrained model unavailable — using Gemini + heuristics"

        # ---------------------------------------------------------------
        # Step C: Adaptive heuristics (z-score based, 22050 Hz audio)
        # ---------------------------------------------------------------
        heuristic_score = run_heuristics(y, sr)

        # ---------------------------------------------------------------
        # Step D: Gemini analysis
        # ---------------------------------------------------------------
        gemini_result = await analyze_with_gemini(file_bytes, api_key)
        gemini_verdict = gemini_result.get("verdict", "UNKNOWN")

        # Convert Gemini verdict + confidence to a synthetic probability [0, 1]
        gemini_conf = gemini_result.get("confidence", 0.5)
        if gemini_verdict == "SYNTHETIC":
            gemini_score = gemini_conf
            gemini_available = True
        elif gemini_verdict == "REAL":
            gemini_score = 1.0 - gemini_conf
            gemini_available = True
        else:
            # UNKNOWN — treat Gemini as unavailable so its weight is redistributed.
            # Do NOT use a hardcoded fallback value here.
            gemini_score = 0.0  # unused; gemini_available=False prevents its use
            gemini_available = False

        # ---------------------------------------------------------------
        # Step E: Dynamic weight fusion
        # ---------------------------------------------------------------
        low_confidence = False
        weights = get_effective_weights(
            gemini_available=gemini_available,
            pretrained_available_flag=pretrained_available,
            is_narrowband=is_narrowband,
        )

        # If only heuristic is available, flag low confidence
        if not gemini_available and not pretrained_available:
            low_confidence = True

        final_score = 0.0
        if "gemini" in weights:
            final_score += weights["gemini"] * gemini_score
        if "pretrained" in weights:
            final_score += weights["pretrained"] * pretrained_prob
        if "heuristic" in weights:
            final_score += weights["heuristic"] * heuristic_score

        # ---------------------------------------------------------------
        # Step F: Verdict and confidence
        # ---------------------------------------------------------------
        if final_score > 0.5:
            verdict = "SYNTHETIC"
            confidence = final_score
        else:
            verdict = "REAL"
            confidence = 1.0 - final_score

        if confidence < MINIMUM_CONFIDENCE:
            verdict = "UNCERTAIN"
            low_confidence = True

        # ---------------------------------------------------------------
        # Build response — additive new fields only, existing schema unchanged
        # ---------------------------------------------------------------
        response: Dict[str, Any] = {
            "verdict": verdict,
            "confidence": float(confidence),
            "low_confidence": low_confidence,
            "audio_info": {
                "narrowband": is_narrowband,
                "spectral_rolloff_hz": round(median_rolloff, 0),
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