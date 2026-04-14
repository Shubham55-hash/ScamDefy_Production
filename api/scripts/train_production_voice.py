"""
ScamDefy Production Voice Model Trainer (High-Variety ASVspoof 2019)
===================================================================
Uses HuggingFace Streaming Mode to train on 20,000 samples from the 
ASVspoof 2019 LA benchmark without consuming GBs of disk space.

Run from api/ folder: python scripts/train_production_voice.py
"""

import os
import sys
import io
import pickle
import logging
import numpy as np
import librosa
from datasets import load_dataset, Audio
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from tqdm import tqdm

# ── Ensure api/ is on sys.path ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API_DIR    = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, API_DIR)

try:
    from models.voice_detector import extract_features, FEATURE_COUNT
except ImportError:
    print("Error: Could not import models.voice_detector. Run from api/ folder.")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DATASET_NAME = "Bisher/ASVspoof_2019_LA"
TARGET_SAMPLES_PER_CLASS = 10000
TOTAL_TARGET = TARGET_SAMPLES_PER_CLASS * 2

def train_production_model():
    logger.info("=== ScamDefy Production Voice Trainer (Streaming) ===")
    logger.info(f"Source: {DATASET_NAME}")
    logger.info(f"Goal: {TOTAL_TARGET} samples (10k Real / 10k Synthetic)")

    X, y = [], []
    real_count = 0
    fake_count = 0

    # 1. Load Streams
    # We use streaming=True to avoid 10GB+ disk usage
    logger.info("Opening dataset streams...")
    try:
        ds = load_dataset(DATASET_NAME, split='train', streaming=True)
        # Disable auto-decode to manage memory and avoid torchcodec issues
        ds = ds.cast_column("audio", Audio(decode=False))
    except Exception as e:
        logger.error(f"Failed to load dataset stream: {e}")
        return

    # 2. Extract Features with Progress Bar
    pbar = tqdm(total=TOTAL_TARGET, desc="Extracting Features")
    
    for sample in ds:
        label = sample.get('key') # 0: bonafide, 1: spoof
        
        # Check if we need more of this class
        if label == 0 and real_count >= TARGET_SAMPLES_PER_CLASS: continue
        if label == 1 and fake_count >= TARGET_SAMPLES_PER_CLASS: continue

        # Decode audio
        try:
            audio_data = sample['audio']['bytes']
            audio_array, sr = librosa.load(io.BytesIO(audio_data), sr=None)
            
            # Extract features (consistent with detection engine)
            feats = extract_features(audio_array, sr)
            X.append(feats)
            y.append(label)

            if label == 0: real_count += 1
            else: fake_count += 1
            
            pbar.update(1)
        except Exception as e:
            # Skip corrupted samples
            continue

        if real_count >= TARGET_SAMPLES_PER_CLASS and fake_count >= TARGET_SAMPLES_PER_CLASS:
            break

    pbar.close()

    if not X:
        logger.error("No features extracted. Aborting.")
        return

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    logger.info(f"Dataset assembled: {X.shape[0]} samples. (Real: {real_count}, Synthetic: {fake_count})")

    # 3. Train Model
    logger.info("Splitting and Scaling...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    logger.info("Training GradientBoosting (200 estimators, depth 5)...")
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        random_state=42
    )
    model.fit(X_train_s, y_train)

    # 4. Evaluation
    y_pred = model.predict(X_test_s)
    acc = accuracy_score(y_test, y_pred)
    logger.info(f"\n✅ Production Test Accuracy: {acc*100:.2f}%")
    logger.info("\nClassification Report:")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["REAL", "SYNTHETIC"]))

    # 5. Save Model
    output_path = os.path.join(API_DIR, "models", "scamdefy_voice_pro.pkl")
    payload = {
        "model":         model,
        "scaler":        scaler,
        "feature_count": FEATURE_COUNT,
        "accuracy":      acc,
        "labels":        {0: "REAL", 1: "SYNTHETIC"},
        "source":        DATASET_NAME,
        "samples":       TOTAL_TARGET
    }
    
    with open(output_path, "wb") as f:
        pickle.dump(payload, f)
    
    logger.info(f"\n🚀 SUCCESS: Production model saved to {output_path}")
    logger.info("The system will automatically prefer this 'pro' model on next restart.")

if __name__ == "__main__":
    train_production_model()
