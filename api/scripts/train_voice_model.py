"""
ScamDefy Voice Model Trainer
==============================
Generates synthetic training data (AI-like vs Human-like audio features),
trains a GradientBoosting classifier, and saves it to api/models/scamdefy_voice.pkl

Run from the api/ directory:
    python scripts/train_voice_model.py

Requirements: librosa, numpy, scipy, scikit-learn
"""

import sys
import os
import pickle
import logging
import numpy as np

# ── Ensure api/ is on sys.path so we can import models.voice_detector ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API_DIR    = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, API_DIR)

from models.voice_detector import extract_features, FEATURE_COUNT

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Synthetic audio generators
# ──────────────────────────────────────────────────────────────────────────────

SR = 22050   # sample rate for all generated samples
DURATION = 2  # seconds per sample


def generate_human_audio(rng: np.random.Generator) -> np.ndarray:
    """
    Simulate a human voice waveform with high entropy and natural noise.
    """
    n = int(SR * DURATION)
    
    # Fundamental pitch with natural "walk"
    pitch_base     = rng.uniform(80, 260)
    pitch_walk_std = rng.uniform(5, 30)
    pitch_steps    = rng.normal(0, pitch_walk_std, n)
    pitch_hz       = np.cumsum(pitch_steps) * (1 / SR)
    pitch_hz       = pitch_hz - np.mean(pitch_hz) + pitch_base
    pitch_hz       = np.clip(pitch_hz, 60, 350)

    # Human jitter: non-uniform rapid frequency variation
    jitter_strength = rng.uniform(0.01, 0.08)
    jitter          = 1.0 + rng.normal(0, jitter_strength, n)

    phase = 2 * np.pi * np.cumsum(pitch_hz * jitter) / SR
    y     = np.sin(phase)

    # Varied harmonics (timbre)
    n_harmonics = rng.integers(3, 8)
    for h in range(2, n_harmonics + 2):
        amp = rng.uniform(0.01, 0.4) / (h ** 0.8)
        # Random phase shift prevents machine-perfect alignment
        y += amp * np.sin(h * phase + rng.uniform(0, 2*np.pi))

    # Shimmer: rapid amplitude variations (vocal fold instability)
    shimmer_std = rng.uniform(0.05, 0.25)
    frame_len   = int(SR * 0.02)
    n_frames    = int(np.ceil(n / frame_len))
    amp_env     = np.ones(n_frames)
    for i in range(1, n_frames):
        amp_env[i] = amp_env[i - 1] * (1 + rng.normal(0, shimmer_std))
        amp_env[i] = np.clip(amp_env[i], 0.2, 3.0)
    amp_env = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, n_frames), amp_env)
    y *= amp_env

    # Natural pauses/gasps
    if rng.random() > 0.3:
        p_start = int(rng.uniform(0.1, 0.8) * n)
        p_len   = int(rng.uniform(0.05, 0.2) * SR)
        y[p_start:p_start + p_len] *= rng.uniform(0.0, 0.1)

    # Background noise (essential for avoiding "digital silence" bias)
    snr_db   = rng.uniform(20, 45)
    noise_amp = 10 ** (-snr_db / 20)
    y        += rng.normal(0, noise_amp, n)

    peak = float(np.max(np.abs(y))) + 1e-8
    return (y / peak).astype(np.float32)


def generate_ai_audio(rng: np.random.Generator) -> np.ndarray:
    """
    Stealthier AI TTS generator mimicking Neural Vocoder artifacts.
    """
    n = int(SR * DURATION)
    t = np.linspace(0, DURATION, n, endpoint=False)

    pitch_base    = rng.uniform(100, 240)
    # Machine-regular vibrato
    vibrato_rate  = rng.uniform(4.5, 6.5)
    vibrato_depth = rng.uniform(0.05, 0.8)
    pitch_hz      = pitch_base + vibrato_depth * np.sin(2 * np.pi * vibrato_rate * t)

    # Extremely low jitter (Vocoder signature)
    jitter_strength = rng.uniform(0.0001, 0.002)
    jitter          = 1.0 + rng.normal(0, jitter_strength, n)

    phase = 2 * np.pi * np.cumsum(pitch_hz * jitter) / SR
    y     = np.sin(phase)

    # Harmonic consistency: precise ratios, often zero phase-offset (unnatural)
    for h in [2, 3, 4, 5, 6]:
        amp = rng.uniform(0.1, 0.4) / h
        # AI often lacks the phase randomization of real vocal folds
        phase_offset = 0 if rng.random() > 0.3 else rng.uniform(0, 0.1)
        y += amp * np.sin(h * phase + phase_offset)

    # Minimal shimmer (amplitude too consistent)
    shimmer_std = rng.uniform(0.001, 0.015)
    y *= (1.0 + rng.normal(0, shimmer_std, n))

    # Digital silence (absolute zero)
    if rng.random() > 0.5:
        p_start = int(rng.uniform(0.4, 0.6) * n)
        p_len   = int(rng.uniform(0.05, 0.1) * SR)
        y[p_start:p_start + p_len] = 0.0

    # Very clean background
    snr_db   = rng.uniform(55, 90)
    noise_amp = 10 ** (-snr_db / 20)
    y        += rng.normal(0, noise_amp, n)

    peak = float(np.max(np.abs(y))) + 1e-8
    return (y / peak).astype(np.float32)


# ──────────────────────────────────────────────────────────────────────────────
# Dataset generation
# ──────────────────────────────────────────────────────────────────────────────

def build_dataset(
    n_human: int = 1000,
    n_ai:    int = 1000,
    seed:    int = 42,
):
    rng = np.random.default_rng(seed)
    X   = []
    y   = []

    logger.info(f"Generating {n_human} human samples...")
    for i in range(n_human):
        audio = generate_human_audio(rng)
        feats = extract_features(audio, SR)
        X.append(feats)
        y.append(0)  # label 0 = real
        if (i + 1) % 300 == 0:
            logger.info(f"  {i+1}/{n_human} human samples done")

    logger.info(f"Generating {n_ai} AI samples...")
    for i in range(n_ai):
        audio = generate_ai_audio(rng)
        feats = extract_features(audio, SR)
        X.append(feats)
        y.append(1)  # label 1 = synthetic
        if (i + 1) % 300 == 0:
            logger.info(f"  {i+1}/{n_ai} AI samples done")

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)


# ──────────────────────────────────────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────────────────────────────────────

def train_and_save():
    try:
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.preprocessing import StandardScaler
        from sklearn.model_selection import RandomizedSearchCV, train_test_split, cross_val_score
        from sklearn.metrics import classification_report, accuracy_score
    except ImportError:
        logger.error("scikit-learn not installed.")
        sys.exit(1)

    logger.info("=== ScamDefy Neural Voice Optimizer ===")
    logger.info("Generating robust 6,000 sample dataset...")

    X, y = build_dataset(n_human=3000, n_ai=3000)
    logger.info(f"Dataset: {X.shape[0]} samples × {X.shape[1]} features")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    logger.info("Training GradientBoostingClassifier (this may take 30-90s)...")
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.8,
        random_state=42,
    )
    model.fit(X_train_s, y_train)

    y_pred  = model.predict(X_test_s)
    acc     = accuracy_score(y_test, y_pred)
    logger.info(f"\nTest accuracy : {acc*100:.1f}%")
    logger.info("\nClassification Report:")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["REAL", "SYNTHETIC"]))

    # 5-fold cross-val
    scores = cross_val_score(model, X_train_s, y_train, cv=5, scoring="accuracy")
    logger.info(f"5-fold CV accuracy: {scores.mean()*100:.1f}% ± {scores.std()*100:.1f}%")

    # Feature importance top-5
    feature_names = [
        "pitch_std", "pitch_cv", "pitch_jitter",
        "rms_std", "rms_cv",
        "flatness_mean", "flatness_std",
        "zcr_mean", "zcr_std",
        "centroid_mean", "centroid_std",
        "delta_smoothness",
        "bw_std", "hnr", "harm_consistency",
        "rolloff_mean", "rolloff_std",
        "voiced_frac",
        "pause_cv", "silence_ratio",
        "mfcc0", "mfcc1", "mfcc2", "mfcc3",
        "mfcc4", "mfcc5", "mfcc6", "mfcc7",
        "pitch_entropy",
        "contrast0", "contrast1", "contrast2", "contrast3", "contrast4"
    ]
    importances = model.feature_importances_
    top5 = np.argsort(importances)[::-1][:5]
    logger.info("\nTop-5 discriminative features:")
    for rank, fi in enumerate(top5, 1):
        name = feature_names[fi] if fi < len(feature_names) else f"feat_{fi}"
        logger.info(f"  {rank}. {name}: {importances[fi]:.4f}")

    # Save
    output_path = os.path.join(API_DIR, "models", "scamdefy_voice.pkl")
    payload = {
        "model":       model,
        "scaler":      scaler,
        "feature_count": FEATURE_COUNT,
        "accuracy":    acc,
        "labels":      {0: "REAL", 1: "SYNTHETIC"},
    }
    with open(output_path, "wb") as f:
        pickle.dump(payload, f)
    logger.info(f"\n✅ Model saved to {output_path}")
    logger.info(f"   Accuracy: {acc*100:.1f}%")

    if acc < 0.80:
        logger.warning("⚠️  Accuracy < 80% — rule-based fallback will still be used.")
    else:
        logger.info("🎯 Model training successful! Voice detection is now active.")


if __name__ == "__main__":
    train_and_save()
