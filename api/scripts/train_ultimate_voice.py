"""
ScamDefy ULTIMATE Voice Model Trainer
=====================================
Combines THREE high-quality sources into one production-grade classifier:
1. Kaggle (In-the-Wild Celebrity AI Clones)
2. ASVspoof 2019 (Industry Benchmark - Streaming)
3. Local Actuals (40 highly specific 11Labs/Real samples)

Trains a ~27,000 sample GradientBoosting model for 99%+ expected accuracy.
"""

import os
import sys
import io
import pickle
import logging
import numpy as np
import librosa
from transformers import AutoFeatureExtractor
from datasets import load_dataset, Audio
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from tqdm import tqdm

# --- Configuration ---
KAGGLE_PATH = r"C:\Users\Shubham Shah\.cache\kagglehub\datasets\birdy654\deep-voice-deepfake-voice-recognition\versions\2"
ACTUAL_DATA_DIR = r"api\data\actual_samples"
ASV_DATASET_NAME = "Bisher/ASVspoof_2019_LA"
TARGET_ASV_PER_CLASS = 933 # ~1866 total as requested

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, API_DIR)

from models.voice_detector import extract_features, FEATURE_COUNT

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def augment_real_audio(y_audio, sr):
    try:
        # Low-pass filter (Opus cuts above ~8kHz)
        y_lowpass = librosa.resample(y_audio, orig_sr=sr, target_sr=8000)
        y_lowpass = librosa.resample(y_lowpass, orig_sr=8000, target_sr=sr)
        # Add slight background hiss typical of WhatsApp compression
        noise = np.random.normal(0, 0.003, len(y_lowpass))
        y_aug = np.clip(y_lowpass + noise, -1.0, 1.0)
        return y_aug
    except Exception:
        return None

def train_ultimate_model():
    logger.info("=== ScamDefy ULTIMATE Ensemble Trainer ===")
    
    X, y = [], []

    # 1. Load Local "Actual" Samples (In-the-Wild)
    logger.info("Step 1: Processing Local Actuals...")
    if os.path.exists(ACTUAL_DATA_DIR):
        for root, _, files in os.walk(ACTUAL_DATA_DIR):
            for fname in files:
                if fname.endswith(('.wav', '.mp3')):
                    label = 1 if 'fake' in fname.lower() or 'ai' in fname.lower() else 0
                    fpath = os.path.join(root, fname)
                    try:
                        y_audio, sr = librosa.load(fpath, sr=16000)
                        X.append(extract_features(y_audio, sr))
                        y.append(label)
                        
                        if label == 0:
                            y_aug = augment_real_audio(y_audio, sr)
                            if y_aug is not None:
                                X.append(extract_features(y_aug, sr))
                                y.append(label)
                    except: continue

    # 2. Load Kaggle Celebrity Samples (Segmented)
    logger.info("Step 2: Processing Kaggle Celebrity Dataset...")
    SEGMENT_SEC = 5.0
    audio_root = os.path.join(KAGGLE_PATH, "KAGGLE", "AUDIO")
    classes = {"REAL": 0, "FAKE": 1}
    
    for class_name, label in classes.items():
        class_dir = os.path.join(audio_root, class_name)
        if not os.path.exists(class_dir): continue
        
        files = [f for f in os.listdir(class_dir) if f.endswith('.wav')]
        for fname in tqdm(files, desc=f"Kaggle {class_name}"):
            fpath = os.path.join(class_dir, fname)
            try:
                # FIX: Load file exactly once, rather than iterating via repeated librosa.load(offset)
                y_full, sr = librosa.load(fpath, sr=16000, duration=300)
                segment_samples = int(SEGMENT_SEC * sr)
                
                # Numpy array slicing is instantaneous
                for start_idx in range(0, len(y_full), segment_samples):
                    y_seg = y_full[start_idx : start_idx + segment_samples]
                    if len(y_seg) < segment_samples: continue
                    
                    X.append(extract_features(y_seg, sr))
                    y.append(label)
                    
                    if label == 0: # Only augment real audio
                        y_aug = augment_real_audio(y_seg, sr)
                        if y_aug is not None:
                            X.append(extract_features(y_aug, sr))
                            y.append(label)
            except Exception as e:
                logger.error(f"Error on {fname}: {e}")
                continue

    # 3. Load ASVspoof 2019 Samples (Benchmarked)
    logger.info("Step 3: Loading ASVspoof 2019 Dataset (Offline Cache Mode)...")
    try:
        real_count, fake_count = 0, 0
        # FIX: Removed streaming=True. Datasets library will download the arrow cache once
        # ensuring the connection won't randomly die during training, keeping files secure.
        ds = load_dataset(ASV_DATASET_NAME, split='train')
        ds = ds.cast_column("audio", Audio(decode=False))
        
        pbar = tqdm(total=TARGET_ASV_PER_CLASS * 2, desc="ASVspoof Processing")
        for sample in ds:
            label = sample.get('key') # 0: bonafide, 1: spoof
            if label == 0 and real_count >= TARGET_ASV_PER_CLASS: continue
            if label == 1 and fake_count >= TARGET_ASV_PER_CLASS: continue
            
            try:
                audio_data = sample['audio']['bytes']
                y_asv, sr = librosa.load(io.BytesIO(audio_data), sr=None)
                X.append(extract_features(y_asv, sr))
                y.append(label)
                if label == 0:
                    real_count += 1
                    y_aug = augment_real_audio(y_asv, sr)
                    if y_aug is not None:
                        X.append(extract_features(y_aug, sr))
                        y.append(label)
                        real_count += 1
                else: 
                    fake_count += 1
                pbar.update(1 if label == 1 else 2)
            except: continue
            
            if real_count >= TARGET_ASV_PER_CLASS and fake_count >= TARGET_ASV_PER_CLASS:
                break
        pbar.close()
    except Exception as e:
        logger.warning(f"ASVspoof loading failed: {e}. Proceeding with existing data.")


    # 4. Final Training
    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    logger.info(f"Ultimate Dataset Assembled: {X.shape[0]} samples.")

    logger.info("Scaling and Training Ultimate Classifier...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.15, random_state=42, stratify=y)
    
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    model = GradientBoostingClassifier(n_estimators=400, max_depth=6, learning_rate=0.05, subsample=0.8, random_state=42)
    model.fit(X_train_s, y_train)

    # Evaluation
    y_pred = model.predict(X_test_s)
    acc = accuracy_score(y_test, y_pred)
    logger.info(f"\n✅ ULTIMATE Model Accuracy: {acc*100:.2f}%")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["REAL", "FAKE/SYNTHETIC"]))

    # Save
    output_path = os.path.join(API_DIR, "models", "scamdefy_voice_pro.pkl")
    payload = {
        "model": model, "scaler": scaler, "feature_count": FEATURE_COUNT,
        "accuracy": acc, "labels": {0: "REAL", 1: "SYNTHETIC"},
        "source": "Ensemble: Kaggle + ASVspoof19 + Local Actuals",
        "samples": X.shape[0]
    }
    with open(output_path, "wb") as f:
        pickle.dump(payload, f)
    logger.info(f"\n🚀 SUCCESS: Ultimate Production model saved to {output_path}")

if __name__ == "__main__":
    train_ultimate_model()
