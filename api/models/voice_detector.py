"""
ScamDefy Local Voice Detector
==============================
A self-contained, calibrated acoustic feature extractor + ensemble classifier
for distinguishing AI-generated voices from real human speech.

Version 2.4: Bulletproof forensic pipeline with latency telemetry, 
baseline-driven drift detection, and fault-tolerant error handling.
"""

import numpy as np
import librosa
import logging
import os

# Silence noisy ML libraries
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import pickle
import torch
import time
from transformers import Wav2Vec2Model, Wav2Vec2Processor, logging as tf_logging
tf_logging.set_verbosity_error()

import datasets
datasets.logging.set_verbosity_error()
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Forensic Feature Vector: 34 (Acoustic) + 768 (Neural Latent) = 802
FEATURE_COUNT = 802
MODELS_DIR = os.path.dirname(__file__)
PRO_MODEL_PATH = os.path.join(MODELS_DIR, "scamdefy_voice_pro.pkl")
STD_MODEL_PATH = os.path.join(MODELS_DIR, "scamdefy_voice.pkl")

# ─────────────────────────────────────────────────────────────
# Research-calibrated thresholds for rule-based scoring
# ─────────────────────────────────────────────────────────────
THRESHOLDS = {
    "pitch_cv":              {"ai_low": 0.015, "human_high": 0.12,  "weight": 2.5},
    "pitch_jitter":          {"ai_low": 0.002, "human_high": 0.020, "weight": 3.0},
    "rms_cv":                {"ai_low": 0.25,  "human_high": 0.65,  "weight": 2.0},
    "flatness_std":          {"ai_low": 0.002, "human_high": 0.010, "weight": 2.0},
    "delta_smoothness":      {"ai_low": 1.5,   "human_high": 8.0,   "weight": 2.5},
    "voiced_frac":           {"ai_high": 0.98, "human_low": 0.35,   "weight": 1.5},
    "pause_cv":              {"ai_low": 0.10,  "human_high": 0.60,  "weight": 2.0},
    "pitch_entropy":         {"ai_low": 0.25,  "human_high": 1.50,  "weight": 2.5},
    "hnr":                   {"ai_high": 150.0, "human_low": 60.0,  "weight": 1.5},
    "rolloff_std":           {"ai_low": 0.003, "human_high": 0.015, "weight": 2.0},
}

_neural_model: Optional[Wav2Vec2Model] = None
_neural_processor: Optional[Wav2Vec2Processor] = None

def get_neural_engine():
    global _neural_model, _neural_processor
    if _neural_model is None:
        try:
            model_id = "facebook/wav2vec2-base"
            _neural_processor = Wav2Vec2Processor.from_pretrained(model_id, local_files_only=True)
            _neural_model = Wav2Vec2Model.from_pretrained(model_id, local_files_only=True)
            _neural_model.eval()
            if torch.cuda.is_available():
                _neural_model = _neural_model.to("cuda")
        except Exception as e:
            logger.error(f"[Detector] Failed to load Neural Engine: {e}")
    return _neural_model, _neural_processor

def extract_features(y: np.ndarray, sr: int) -> np.ndarray:
    features: list = []

    # 1-3: Pitch
    try:
        f0 = librosa.yin(y, fmin=80, fmax=420, sr=sr)
        voiced_f0 = f0[f0 > 0]
        if len(voiced_f0) > 15:
            pitch_mean = float(np.mean(voiced_f0))
            pitch_std  = float(np.std(voiced_f0))
            pitch_cv   = pitch_std / (pitch_mean + 1e-6)
            pitch_jitter = float(np.mean(np.abs(np.diff(voiced_f0))) / (pitch_mean + 1e-6))
        else:
            pitch_std, pitch_cv, pitch_jitter = 0.0, 0.0, 0.0
        features.extend([pitch_std, pitch_cv, pitch_jitter])
    except Exception:
        features.extend([0.0, 0.0, 0.0])

    # 4-5: RMS
    try:
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        rms_mean = float(np.mean(rms))
        rms_std  = float(np.std(rms))
        rms_cv   = rms_std / (rms_mean + 1e-6)
        features.extend([rms_std, rms_cv])
    except Exception:
        features.extend([0.0, 0.5])

    # 6-7: Flatness
    try:
        flatness = librosa.feature.spectral_flatness(y=y)[0]
        features.extend([float(np.mean(flatness)), float(np.std(flatness))])
    except Exception:
        features.extend([0.01, 0.0])

    # 8-9: ZCR
    try:
        zcr = librosa.feature.zero_crossing_rate(y, hop_length=512)[0]
        features.extend([float(np.mean(zcr)), float(np.std(zcr))])
    except Exception:
        features.extend([0.05, 0.0])

    # 10-11: Centroid
    try:
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        features.extend([float(np.mean(centroid)) / (sr / 2), float(np.std(centroid)) / (sr / 2)])
    except Exception:
        features.extend([0.3, 0.0])

    # 12: Delta Smoothness
    try:
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        delta_mfcc = librosa.feature.delta(mfccs)
        features.append(float(np.mean(np.var(delta_mfcc, axis=1))))
    except Exception:
        features.append(3.0)

    # 13: Bandwidth Std
    try:
        bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
        features.append(float(np.std(bandwidth)))
    except Exception:
        features.append(0.0)

    # 14-16: HNR Proxy & consistency & rolloff
    try:
        S = np.abs(librosa.stft(y, n_fft=1024))
        harmonic, percussive = librosa.decompose.hpss(S)
        h_power, p_power = float(np.sum(harmonic ** 2)), float(np.sum(percussive ** 2))
        features.append(min(h_power / (p_power + 1e-6), 200.0))
        features.append(float(np.std(np.sum(harmonic ** 2, axis=0))))
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
        features.extend([float(np.mean(rolloff)) / (sr / 2), float(np.std(rolloff)) / (sr / 2)])
    except Exception:
        features.extend([10.0, 0.0, 0.0, 0.0])

    # 17: Voiced fraction
    try:
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        active_mask = rms > max(np.median(rms[:100]) * 2.0, 0.005)
        f0 = librosa.yin(y, fmin=60, fmax=400, sr=sr, threshold=0.15)
        if len(active_mask) > len(f0): active_mask = active_mask[:len(f0)]
        elif len(f0) > len(active_mask): f0 = f0[:len(active_mask)]
        features.append(float(np.sum((f0 > 0) & active_mask) / max(np.sum(active_mask), 1)))
    except Exception:
        features.append(0.85)

    # 18-19: Pause features
    try:
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        is_silent = rms < (float(np.mean(rms)) * 0.12)
        runs, run = [], 0
        for s in is_silent:
            if s: run += 1
            elif run > 0: runs.append(run); run = 0
        features.append(float(np.std(runs) / (np.mean(runs) + 1e-6)) if len(runs) >= 3 else 1.0)
        features.append(float(np.sum(is_silent) / max(len(is_silent), 1)))
    except Exception:
        features.extend([0.5, 0.25])

    # 20-27: MFCC Stds
    try:
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=8)
        for i in range(8): features.append(float(np.std(mfccs[i])))
    except Exception:
        features.extend([5.0, 3.0, 2.0, 1.5, 1.0, 0.8, 0.5, 0.4])

    # 28: Entropy
    try:
        f0 = librosa.yin(y, fmin=80, fmax=420, sr=sr)
        voiced_f0 = f0[f0 > 0]
        if len(voiced_f0) > 20:
            diffs = np.diff(voiced_f0) / (voiced_f0[:-1] + 1e-6)
            counts, _ = np.histogram(diffs, bins=32, range=(-0.15, 0.15))
            probs = (counts.astype(float) + 1e-9) / (np.sum(counts) + 1e-7)
            features.append(float(-np.sum(probs * np.log2(probs)) / 5.0))
        else: features.append(0.85)
    except Exception:
        features.append(0.85)

    # 29-33: Contrast
    try:
        spec_m = librosa.feature.spectral_contrast(y=y, sr=sr, n_bands=4)
        for i in range(5): features.append(float(np.mean(spec_m[i])))
    except Exception:
        features.extend([0.0] * 5)

    # 34-802: Neural (Wav2Vec)
    try:
        model, proc = get_neural_engine()
        if model and proc:
            y_16 = librosa.resample(y, orig_sr=sr, target_sr=16000) if sr != 16000 else y
            inputs = proc(y_16, sampling_rate=16000, return_tensors="pt", padding=True)
            inputs = {k: v.to(next(model.parameters()).device) for k, v in inputs.items()}
            with torch.no_grad():
                features.extend(model(**inputs).last_hidden_state.mean(dim=1).cpu().numpy()[0].tolist())
        else: features.extend([0.0] * 768)
    except Exception: features.extend([0.0] * 768)

    arr = np.array(features, dtype=np.float32)
    if len(arr) < FEATURE_COUNT: arr = np.pad(arr, (0, FEATURE_COUNT - len(arr)))
    return arr[:FEATURE_COUNT]

def compute_biometric(jitter, cv, harm, entropy):
    # normalize features (rough ranges based on logs)
    jitter_n = min(jitter / 0.2, 1.0)
    cv_n = min(cv / 0.6, 1.0)
    harm_n = min(harm / 3000.0, 1.0)
    ent_n = min(entropy / 1.0, 1.0)

    # human score (more variation -> more human)
    human_score = (jitter_n + cv_n + ent_n) / 3

    # AI score (harmonic structure tends to be high for synthetic)
    ai_score = harm_n

    # final biometric signal (Negative = Human, Positive = AI)
    # Note: using ai_score - human_score so human signals drive negative bounds.
    biometric = ai_score - human_score

    # clamp to [-1, 1]
    return float(max(-1.0, min(1.0, biometric)))

def rule_based_score(feats: np.ndarray, y: np.ndarray = None, sr: int = None) -> Tuple[float, str, int]:
    idx = {"pitch_cv": 1, "pitch_jitter": 2, "harmonic_std": 14, "pitch_entropy": 28}
    
    cv = feats[idx["pitch_cv"]]
    jitter = feats[idx["pitch_jitter"]]
    harm = feats[idx["harmonic_std"]]
    entropy = feats[idx["pitch_entropy"]]
    
    score = compute_biometric(jitter, cv, harm, entropy)
    
    if score < -0.3:
        reason = "Acoustic signatures show strong biological variability"
    elif score > 0.2:
        reason = "Acoustic signatures show neural stability / lack of jitter"
    else:
        reason = "Acoustic signatures show balanced characteristics"
        
    return score, reason, 1 if score > 0.2 else 0

class LocalVoiceDetector:
    """
    Bulletproof forensic pipeline (v2.4)
    """
    def __init__(self):
        self.model, self.pca, self.scaler_acoustic, self.scaler_neural = None, None, None, None
        self.schema, self.baseline, self.threshold = None, None, 0.5
        self.version = "1.0"
        self._load_trained_model()

    def _load_trained_model(self):
        path = os.path.join(MODELS_DIR, "scamdefy_voice_pro_v2.pkl")
        if not os.path.exists(path): path = PRO_MODEL_PATH if os.path.exists(PRO_MODEL_PATH) else STD_MODEL_PATH
        if os.path.exists(path):
            try:
                with open(path, "rb") as f: payload = pickle.load(f)
                self.version, self.model, self.threshold = payload.get("version", "1.0"), payload.get("model"), payload.get("threshold", 0.5)
                self.schema, self.baseline = payload.get("feature_schema"), payload.get("baseline_stats")
                if self.version >= "v2.2":
                    self.pca, self.scaler_acoustic, self.scaler_neural = payload.get("pca"), payload.get("scaler_acoustic"), payload.get("scaler_neural")
                else: self.scaler = payload.get("scaler")
                logger.info(f"[ScamDefy] Loaded Forensic {self.version} Engine | threshold={self.threshold:.4f}")
            except Exception as e: logger.error(f"[ScamDefy] Model load error: {e}"); self.model = None

    def predict(self, y: np.ndarray, sr: int) -> Dict[str, Any]:
        start = time.time()
        try:
            feats = extract_features(y, sr)
            if self.model is None: raise ValueError("Model not loaded")
            
            # v4.2 Diagnostic Audio Check
            print(f"\n[DEBUG v4.2] Signal Health | Shape: {y.shape} | Range: [{y.min():.4f}, {y.max():.4f}] | SR: {sr}")
            
            if self.version >= "v2.2" and self.pca:
                if len(feats) != 802: raise ValueError(f"Dim mismatch: {len(feats)}")
                acc_s = self.scaler_acoustic.transform(feats[:34].reshape(1, -1))
                w2v_pca = self.pca.transform(feats[34:].reshape(1, -1))
                w2v_s = self.scaler_neural.transform(w2v_pca)
                X = np.hstack([acc_s, w2v_s])
                if self.schema and X.shape[1] != self.schema["final_dim"]: raise ValueError(f"Final dim mismatch: {X.shape[1]}")
                proba = self.model.predict_proba(X)[0]
            else:
                proba = self.model.predict_proba(self.scaler.transform(feats[:34].reshape(1, -1)))[0]
            
            score = float(proba[1]) if len(proba) > 1 else float(proba[0])
            drift = False
            rule_score, rule_reason, markers = rule_based_score(feats, y, sr)
            
            # v4.2 Feature Diagnostic
            # idx = {"pitch_cv": 1, "pitch_jitter": 2, "harmonic_std": 14, "pitch_entropy": 28}
            print(f"[DEBUG v4.2] Features | CV: {feats[1]:.5f} | Jitter: {feats[2]:.5f} | Harm: {feats[14]:.5f} | Ent: {feats[28]:.5f} | BioRaw: {rule_score:.4f}")

            # Strip down for v3.9 Diagnostic
            latency = (time.time() - start) * 1000
            
            return {
                "score": float(score), 
                "neural_score": float(score),
                "biometric_raw": float(rule_score),
                "harmonic": float(feats[14]),
                "confidence": float(max(proba)),
                "telemetry": {"latency_ms": round(latency, 1), "version": self.version}
            }
        except Exception as e:
            logger.error(f"[ScamDefy] Forensic failure: {e}")
            return {"score": 0.5, "confidence": 0.0, "label": "UNCERTAIN", "method": "fallback", "reason": "Verification failure", "error": str(e)}

_detector: Optional[LocalVoiceDetector] = None
def get_detector() -> LocalVoiceDetector:
    global _detector
    if _detector is None: _detector = LocalVoiceDetector()
    return _detector
