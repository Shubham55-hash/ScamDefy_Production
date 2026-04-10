"""
ScamDefy Local Voice Detector
==============================
A self-contained, calibrated acoustic feature extractor + ensemble classifier
for distinguishing AI-generated voices from real human speech.

Does NOT require internet access or a GPU. Works offline as a reliable fallback
when the HuggingFace pretrained model or Gemini are unavailable.

Feature set (34 features) based on peer-reviewed deepfake audio detection research:
  - Pitch jitter & shimmer (primary AI markers)
  - Spectral flatness variance (AI: too uniform)
  - MFCC delta smoothness (AI: overly smooth transitions)
  - Pause regularity (AI: machine-regular pauses)
  - Harmonic-to-Noise Ratio (AI: unnaturally clean)
  - Voiced fraction (AI: unusually high)
  - Energy envelope variation (AI: too consistent)
  - Spectral contrast (5 bands)
"""

import numpy as np
import librosa
import logging
import os
import pickle
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

FEATURE_COUNT = 34
MODEL_PATH = os.path.join(os.path.dirname(__file__), "scamdefy_voice.pkl")

# ─────────────────────────────────────────────────────────────
# Research-calibrated thresholds for rule-based scoring
# Sources: ASVspoof 2019 challenge feature analysis,
#          "Audio Deepfake Detection" (Yi et al., 2022)
# ─────────────────────────────────────────────────────────────
THRESHOLDS = {
    # Low pitch_cv → AI (pitch coefficient of variation, human: 0.05-0.25)
    # Tightened: Neural vocoders have extremely uniform pitch
    "pitch_cv":              {"ai_low": 0.035, "human_high": 0.10,  "weight": 2.5},
    # Low pitch_jitter → AI (human RAP jitter: 0.5%-3%)
    # Tightened: Modern TTS has near-zero jitter
    "pitch_jitter":          {"ai_low": 0.005, "human_high": 0.020, "weight": 3.0},
    # Low rms_cv → AI (amplitude variation, human: 0.4-1.2)
    "rms_cv":                {"ai_low": 0.30,  "human_high": 0.65,  "weight": 2.0},
    # Low flatness_std → AI (spectral flatness too uniform in AI voices)
    "flatness_std":          {"ai_low": 0.003, "human_high": 0.010, "weight": 2.0},
    # Low delta_smoothness → AI (MFCC deltas very smooth in TTS)
    "delta_smoothness":      {"ai_low": 2.0,   "human_high": 8.0,   "weight": 2.5},
    # Very high voiced_frac → AI (no natural breathing interruptions)
    "voiced_frac":           {"ai_high": 0.90, "human_low": 0.35,   "weight": 1.5},
    # Low pause_cv → AI (machine-regular pauses)
    "pause_cv":              {"ai_low": 0.20,  "human_high": 0.60,  "weight": 2.0},
    # Low pitch_entropy → AI (robotic periodicity)
    "pitch_entropy":         {"ai_low": 0.80,  "human_high": 1.50,  "weight": 2.5},
    # High hnr → AI (unnaturally clean speech)
    "hnr":                   {"ai_high": 120.0, "human_low": 60.0,  "weight": 1.5},
    # Low rolloff_std → AI (extremely consistent frequency balance)
    "rolloff_std":           {"ai_low": 0.005, "human_high": 0.015, "weight": 2.0},
}


def extract_features(y: np.ndarray, sr: int) -> np.ndarray:
    """
    Extract 24 acoustic features from raw audio waveform.
    Returns a 1D numpy array of length FEATURE_COUNT.
    """
    features: list = []

    # ── 1-3: Pitch / F0 features ─────────────────────────────
    try:
        f0 = librosa.yin(y, fmin=60, fmax=400, sr=sr)
        voiced_f0 = f0[f0 > 0]
        if len(voiced_f0) > 10:
            pitch_mean = float(np.mean(voiced_f0))
            pitch_std  = float(np.std(voiced_f0))
            pitch_cv   = pitch_std / (pitch_mean + 1e-6)
            # Jitter: mean |diff| between consecutive f0 periods
            pitch_jitter = float(
                np.mean(np.abs(np.diff(voiced_f0))) / (pitch_mean + 1e-6)
            )
        else:
            pitch_mean, pitch_std, pitch_cv, pitch_jitter = 150.0, 0.0, 0.0, 0.0
        features.extend([pitch_std, pitch_cv, pitch_jitter])   # 3 features
    except Exception:
        features.extend([0.0, 0.0, 0.0])

    # ── 4-5: RMS Energy / Shimmer features ───────────────────
    try:
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        rms_mean = float(np.mean(rms))
        rms_std  = float(np.std(rms))
        rms_cv   = rms_std / (rms_mean + 1e-6)
        features.extend([rms_std, rms_cv])                     # 2 features
    except Exception:
        features.extend([0.0, 0.5])

    # ── 6-7: Spectral flatness ────────────────────────────────
    try:
        flatness = librosa.feature.spectral_flatness(y=y)[0]
        features.extend([
            float(np.mean(flatness)),
            float(np.std(flatness)),
        ])                                                      # 2 features
    except Exception:
        features.extend([0.01, 0.0])

    # ── 8-9: Zero-crossing rate ───────────────────────────────
    try:
        zcr = librosa.feature.zero_crossing_rate(y, hop_length=512)[0]
        features.extend([float(np.mean(zcr)), float(np.std(zcr))])  # 2 features
    except Exception:
        features.extend([0.05, 0.0])

    # ── 10-11: Spectral centroid ──────────────────────────────
    try:
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        features.extend([
            float(np.mean(centroid)) / (sr / 2),               # normalised
            float(np.std(centroid))  / (sr / 2),
        ])                                                      # 2 features
    except Exception:
        features.extend([0.3, 0.0])

    # ── 12: MFCC delta smoothness ─────────────────────────────
    # Low smoothness = AI (uniform deltas)
    try:
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        delta_mfcc = librosa.feature.delta(mfccs)
        delta_smoothness = float(np.mean(np.var(delta_mfcc, axis=1)))
        features.append(delta_smoothness)                      # 1 feature
    except Exception:
        features.append(3.0)

    # ── 13: Spectral bandwidth variation ──────────────────────
    try:
        bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
        features.append(float(np.std(bandwidth)))              # 1 feature
    except Exception:
        features.append(0.0)

    # ── 14-15: Harmonic-to-noise ratio proxy ─────────────────
    try:
        S = np.abs(librosa.stft(y, n_fft=1024))
        harmonic, percussive = librosa.decompose.hpss(S)
        h_power = float(np.sum(harmonic ** 2))
        p_power = float(np.sum(percussive ** 2))
        hnr_approx = h_power / (p_power + 1e-6)
        features.append(min(hnr_approx, 200.0))               # 1 feature

        # Harmonic consistency (AI: very stable harmonics)
        harm_col_energy = np.sum(harmonic ** 2, axis=0)
        features.append(float(np.std(harm_col_energy)))        # 1 feature

        # ── 16: Spectral Rolloff ─────────────────────────────
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
        features.append(float(np.mean(rolloff)) / (sr / 2))    # 1 feature
        features.append(float(np.std(rolloff))  / (sr / 2))    # 1 feature
    except Exception:
        features.extend([10.0, 0.0])

    # ── 16: Voiced fraction ───────────────────────────────────
    try:
        f0 = librosa.yin(y, fmin=60, fmax=400, sr=sr)
        voiced_frac = float(np.sum(f0 > 0) / max(len(f0), 1))
        features.append(voiced_frac)                           # 1 feature
    except Exception:
        features.append(0.6)

    # ── 17-18: Pause regularity ───────────────────────────────
    try:
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        sil_threshold = float(np.mean(rms)) * 0.12
        is_silent = rms < sil_threshold
        runs: list = []
        run = 0
        for s in is_silent:
            if s:
                run += 1
            elif run > 0:
                runs.append(run)
                run = 0
        if run > 0:
            runs.append(run)
        if len(runs) >= 3:
            pause_cv = float(np.std(runs) / (np.mean(runs) + 1e-6))
        else:
            pause_cv = 1.0   # assume variable (human-like) if no pauses
        features.append(pause_cv)                              # 1 feature

        silence_ratio = float(np.sum(is_silent) / max(len(is_silent), 1))
        features.append(silence_ratio)                         # 1 feature
    except Exception:
        features.extend([0.5, 0.25])

    try:
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=8)
        for i in range(8):
            features.append(float(np.std(mfccs[i])))          # 8 features
    except Exception:
        features.extend([5.0, 3.0, 2.0, 1.5, 1.0, 0.8, 0.5, 0.4])

    # ── 27: Pitch Period Entropy ──────────────────────────────
    try:
        f0 = librosa.yin(y, fmin=60, fmax=400, sr=sr)
        voiced_f0 = f0[f0 > 0]
        if len(voiced_f0) > 20:
            diffs = np.diff(voiced_f0)
            hist, _ = np.histogram(diffs, bins=10, density=True)
            hist = hist[hist > 0]
            entropy = -np.sum(hist * np.log2(hist))
            features.append(float(entropy))                    # 1 feature
        else:
            features.append(0.0)
    except Exception:
        features.append(0.0)

    # ── 28-32: Spectral Moments ───────────────────────────────
    try:
        # Higher order moments catch the "crispness" of synthesized audio
        spec_m = librosa.feature.spectral_contrast(y=y, sr=sr, n_bands=4)
        for i in range(5):
             features.append(float(np.mean(spec_m[i])))       # 5 features
    except Exception:
        features.extend([0.0, 0.0, 0.0, 0.0, 0.0])

    arr = np.array(features, dtype=np.float32)
    # Pad or truncate to FEATURE_COUNT
    if len(arr) < FEATURE_COUNT:
        arr = np.pad(arr, (0, FEATURE_COUNT - len(arr)))
    return arr[:FEATURE_COUNT]


def rule_based_score(feats: np.ndarray) -> Tuple[float, str]:
    """
    Compute a probability-of-synthetic score [0, 1] using
    research-calibrated thresholds.

    Returns (score, explanation)
    """
    idx = {
        "pitch_std": 0, "pitch_cv": 1, "pitch_jitter": 2,
        "rms_std": 3,   "rms_cv": 4,
        "flatness_mean": 5, "flatness_std": 6,
        "zcr_mean": 7, "zcr_std": 8,
        "centroid_mean": 9, "centroid_std": 10,
        "delta_smoothness": 11,
        "bw_std": 12,
        "hnr": 13, "harm_consistency": 14,
        "rolloff_mean": 15, "rolloff_std": 16,
        "voiced_frac": 17,
        "pause_cv": 18, "silence_ratio": 19,
        "mfcc0": 20, "mfcc1": 21, "mfcc2": 22, "mfcc3": 23,
        "mfcc4": 24, "mfcc5": 25, "mfcc6": 26, "mfcc7": 27,
        "pitch_entropy": 28,
        "contrast0": 29, "contrast1": 30, "contrast2": 31, "contrast3": 32, "contrast4": 33
    }

    signals = []
    total_weight = 0.0
    ai_weight = 0.0
    reasons = []

    def note(name: str, val: float, is_ai: bool, w: float, reason: str):
        nonlocal ai_weight, total_weight
        total_weight += w
        if is_ai:
            ai_weight += w
            reasons.append(reason)

    pitch_cv    = float(feats[idx["pitch_cv"]])
    pitch_jitter = float(feats[idx["pitch_jitter"]])
    rms_cv      = float(feats[idx["rms_cv"]])
    flatness_std = float(feats[idx["flatness_std"]])
    delta_s     = float(feats[idx["delta_smoothness"]])
    voiced_frac = float(feats[idx["voiced_frac"]])
    pause_cv    = float(feats[idx["pause_cv"]])

    pitch_entropy = float(feats[idx["pitch_entropy"]])
    hnr           = float(feats[idx["hnr"]])
    rolloff_std   = float(feats[idx["rolloff_std"]])

    note("pitch_cv", pitch_cv,
         pitch_cv < THRESHOLDS["pitch_cv"]["ai_low"], 2.0,
         "Pitch variation too uniform for human speech")

    note("pitch_jitter", pitch_jitter,
         pitch_jitter < THRESHOLDS["pitch_jitter"]["ai_low"], 2.5,
         "Vocal jitter (RAP) below human physiological minimum")

    note("rms_cv", rms_cv,
         rms_cv < THRESHOLDS["rms_cv"]["ai_low"], 1.5,
         "Amplitude variation (shimmer proxy) too consistent")

    note("pitch_entropy", pitch_entropy,
         pitch_entropy < THRESHOLDS["pitch_entropy"]["ai_low"], 2.5,
         "Neural periodicity detected (entropy too low)")

    note("hnr", hnr,
         hnr > THRESHOLDS["hnr"]["ai_high"], 1.0,
         "Unnaturally clean background (possible digital synthesis)")

    note("rolloff_std", rolloff_std,
         rolloff_std < THRESHOLDS["rolloff_std"]["ai_low"], 2.0,
         "Spectral frequency balance too stable (machine-made)")

    note("flatness_std", flatness_std,
         flatness_std < THRESHOLDS["flatness_std"]["ai_low"], 1.5,
         "Spectral flatness variance absent — characteristic of TTS vocoder")

    note("delta_smoothness", delta_s,
         delta_s < THRESHOLDS["delta_smoothness"]["ai_low"], 2.0,
         "MFCC delta transitions overly smooth — neural TTS artifact")

    note("voiced_frac", voiced_frac,
         voiced_frac > THRESHOLDS["voiced_frac"]["ai_high"], 1.0,
         "Voiced fraction abnormally high — no natural breathing pauses")

    note("pause_cv", pause_cv,
         pause_cv < THRESHOLDS["pause_cv"]["ai_low"], 1.5,
         "Pause timing too regular — machine-generated prosody pattern")

    if total_weight == 0:
        return 0.5, "Insufficient acoustic data for analysis"

    score = float(ai_weight / total_weight)
    explanation = "; ".join(reasons) if reasons else \
        "Acoustic features fall within normal human speech parameters"

    return score, explanation


class LocalVoiceDetector:
    """
    Trained or rule-based local voice detector.

    Priority:
      1. If a trained sklearn model exists at MODEL_PATH → use it
      2. Otherwise fall back to calibrated rule-based scoring
    """

    def __init__(self):
        self.model = None
        self.scaler = None
        self._load_trained_model()

    def _load_trained_model(self):
        if os.path.exists(MODEL_PATH):
            try:
                with open(MODEL_PATH, "rb") as f:
                    payload = pickle.load(f)
                self.model  = payload.get("model")
                self.scaler = payload.get("scaler")
                logger.info(f"[ScamDefy] Loaded trained local voice model from {MODEL_PATH}")
            except Exception as e:
                logger.warning(f"[ScamDefy] Could not load local voice model: {e}")
                self.model = None

    def predict(self, y: np.ndarray, sr: int) -> Dict[str, Any]:
        """
        Returns:
          score       — float [0, 1], probability this voice is synthetic
          confidence  — float [0, 1], confidence in the prediction
          method      — "trained_model" | "rule_based"
          reason      — human-readable explanation
        """
        feats = extract_features(y, sr)

        if self.model is not None and self.scaler is not None:
            try:
                X = self.scaler.transform(feats.reshape(1, -1))
                proba = self.model.predict_proba(X)[0]
                score = float(proba[1]) if len(proba) > 1 else float(proba[0])
                rule_score, rule_reason = rule_based_score(feats)
                
                # Blend the ML score and the Rule-Based score
                # If the physical rules detect strong AI markers (rule_score > 0.6),
                # we don't let the ML model override it blindly.
                blended_score = max(score, rule_score) if rule_score > 0.65 else score
                
                # If they greatly diverge (e.g. ML=0.01, Rules=0.8), confidence drops
                divergence = abs(score - rule_score)
                confidence = float(max(proba))
                if divergence > 0.5:
                    confidence = max(0.5, confidence - (divergence / 2))

                return {
                    "score":     blended_score,
                    "confidence": confidence,
                    "method":    "trained_model_blended",
                    "reason":    rule_reason if blended_score > 0.5 else
                                 "Acoustic features consistent with human speech",
                    "features":  feats.tolist(),
                }
            except Exception as e:
                logger.warning(f"[ScamDefy] Trained model inference failed: {e}. Falling back to rules.")

        # Rule-based fallback
        score, reason = rule_based_score(feats)
        # Softer confidence scaling: avoid jumpy 100% results
        confidence = 0.5 + abs(score - 0.5) * 1.1
        confidence = float(min(confidence, 0.88))  # Cap rule-based slightly lower
        return {
            "score":     score,
            "confidence": confidence,
            "method":    "rule_based",
            "reason":    reason,
            "features":  feats.tolist(),
        }


# Singleton instance to avoid repeated initialisation
_detector: Optional[LocalVoiceDetector] = None


def get_detector() -> LocalVoiceDetector:
    global _detector
    if _detector is None:
        _detector = LocalVoiceDetector()
    return _detector
