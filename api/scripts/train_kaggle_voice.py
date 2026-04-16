"""
ScamDefy Kaggle Dataset Trainer: Deep Voice Deepfake Recognition
==============================================================
Trains a production-grade local voice detector using the 3.69GB Kaggle dataset.
This script replaces the 'lite' model with a robust, real-world calibrated one.
"""

import os
import sys
import pickle
import logging
import numpy as np
import librosa
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from tqdm import tqdm

# --- Configuration ---
# Update this path after the download finishes
KAGGLE_PATH = r"C:\Users\Shubham Shah\.cache\kagglehub\datasets\birdy654\deep-voice-deepfake-voice-recognition\versions\2"
API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, API_DIR)

from models.voice_detector import extract_features, FEATURE_COUNT

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def train_from_kaggle():
    logger.info("=== ScamDefy Production Trainer (Kaggle Dataset) ===")
    
    if not os.path.exists(KAGGLE_PATH):
        logger.error(f"Kaggle dataset not found at {KAGGLE_PATH}")
        return

    X, y = [], []
    
    # The dataset structure is typically folders for each class
    # birdy654/deep-voice-deepfake-voice-recognition usually has:
    #   /KAGGLE/AUDIO/REAL/
    #   /KAGGLE/AUDIO/FAKE/
    
    audio_root = os.path.join(KAGGLE_PATH, "KAGGLE", "AUDIO")
    if not os.path.exists(audio_root):
        # Alternative structure check
        audio_root = KAGGLE_PATH

    classes = {"REAL": 0, "FAKE": 1}
    
    # 1. Feature Extraction (with Segmentation)
    SEGMENT_SEC = 5.0
    
    for class_name, label in classes.items():
        class_dir = os.path.join(audio_root, class_name)
        if not os.path.exists(class_dir):
            logger.warning(f"Class directory {class_dir} not found. Skipping.")
            continue
            
        files = [f for f in os.listdir(class_dir) if f.endswith(('.wav', '.mp3', '.ogg'))]
        logger.info(f"Processing {len(files)} long-form samples for class '{class_name}'...")
        
        for fname in tqdm(files, desc=f"Segmenting {class_name}"):
            fpath = os.path.join(class_dir, fname)
            try:
                # Get duration first to avoid loading giant file into memory all at once
                duration = librosa.get_duration(path=fpath)
                
                # Load in 5-second segments
                for start_sec in np.arange(0, duration - SEGMENT_SEC, SEGMENT_SEC):
                    # Only take first 5 minutes of each giant file to keep it balanced and fast
                    if start_sec > 300: break 
                    
                    audio_array, sr = librosa.load(
                        fpath, sr=16000, offset=start_sec, duration=SEGMENT_SEC, mono=True
                    )
                    
                    if len(audio_array) < 16000: continue # ignore tiny fragments
                    
                    feats = extract_features(audio_array, sr)
                    X.append(feats)
                    y.append(label)
                    
                    # --- CRITICAL: CODEC SIMULATION AUGMENTATION ---
                    # Simulate WhatsApp/OGG Opus compression artifacts for REAL samples.
                    # This trains the model to recognize compressed human voices as REAL.
                    if label == 0:  # Only augment REAL samples
                        try:
                            # Simulate: low-pass filter (Opus cuts above ~8kHz) + light noise
                            y_aug = audio_array.copy()
                            # Low-pass filter by downsampling and upsampling back
                            y_lowpass = librosa.resample(y_aug, orig_sr=sr, target_sr=8000)
                            y_lowpass = librosa.resample(y_lowpass, orig_sr=8000, target_sr=sr)
                            # Add slight background hiss typical of WhatsApp compression
                            noise = np.random.normal(0, 0.003, len(y_lowpass))
                            y_aug = np.clip(y_lowpass + noise, -1.0, 1.0)
                            
                            feats_aug = extract_features(y_aug, sr)
                            X.append(feats_aug)
                            y.append(label)  # Still REAL (0)
                        except Exception:
                            pass
                    
            except Exception as e:
                logger.debug(f"Error segmenting {fname} at {start_sec}s: {e}")
                continue

    if not X:
        logger.error("No features extracted. Verify Kaggle dataset path and structure.")
        return

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    logger.info(f"Dataset prepared: {X.shape[0]} samples.")

    # 2. Train Model
    logger.info("Splitting and Scaling...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    logger.info("Training Production Model (GradientBoosting)...")
    model = GradientBoostingClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42
    )
    model.fit(X_train_s, y_train)

    # 3. Evaluation
    y_pred = model.predict(X_test_s)
    acc = accuracy_score(y_test, y_pred)
    logger.info(f"\n✅ Kaggle Model Accuracy: {acc*100:.2f}%")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["REAL", "FAKE"]))

    # 4. Save to Production Path
    output_path = os.path.join(API_DIR, "models", "scamdefy_voice_pro.pkl")
    payload = {
        "model": model,
        "scaler": scaler,
        "feature_count": FEATURE_COUNT,
        "accuracy": acc,
        "labels": {0: "REAL", 1: "FAKE"},
        "source": "Kaggle: birdy654/deep-voice-deepfake-voice-recognition"
    }
    
    with open(output_path, "wb") as f:
        pickle.dump(payload, f)
    
    logger.info(f"\n🚀 SUCCESS: Production model saved to {output_path}")

if __name__ == "__main__":
    train_from_kaggle()
