"""
ScamDefy Kaggle Dataset Trainer: Deep Voice Deepfake Recognition
==============================================================
Trains a production-grade local voice detector using the 3.69GB Kaggle dataset.
Refactored to v2.4.1 Parity (PCA, Calibration, Bulletproof Caching).
"""

import logging
import os
import sys

# Silence noisy ML libraries
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import pickle
import numpy as np
import librosa
from tqdm import tqdm
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
try:
    from sklearn.calibration import FrozenEstimator
except ImportError:
    from sklearn.frozen import FrozenEstimator
from sklearn.metrics import roc_curve
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor, as_completed

# --- Configuration ---
KAGGLE_PATH = r"C:\Users\Shubham Shah\.cache\kagglehub\datasets\birdy654\deep-voice-deepfake-voice-recognition\versions\2"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, API_DIR)

from models.voice_detector import extract_features, FEATURE_COUNT

# Cache Paths
X_CACHE_PATH = os.path.join(API_DIR, "data", "X_kaggle_v2_4.npy")
Y_CACHE_PATH = os.path.join(API_DIR, "data", "y_kaggle_v2_4.npy")
INTERMEDIATE_CACHE = os.path.join(API_DIR, "data", "intermediate_kaggle.pkl")
MODEL_OUT = os.path.join(API_DIR, "models", "scamdefy_voice_kaggle_pro.pkl")

# Configuration
LITE_MODE = False # Set to True for quick verification (50 samples per class)
LITE_LIMIT = 50

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def compute_eer(y_true, y_scores):
    fpr, tpr, thresholds = roc_curve(y_true, y_scores)
    fnr = 1 - tpr
    idx = np.nanargmin(np.abs(fnr - fpr))
    eer = (fpr[idx] + fnr[idx]) / 2
    return eer, thresholds[idx]

def _worker_extract(args):
    fpath, start_sec, duration_sec, is_real, sr_target = args
    try:
        y, sr = librosa.load(fpath, sr=sr_target, offset=start_sec, duration=duration_sec, mono=True)
        if len(y) < sr_target: return None
        
        feats = extract_features(y, sr)
        results = [(feats, 0 if is_real else 1)]
        
        # Audio Augmentation (Opus simulation for REAL)
        if is_real:
            y_aug = y.copy()
            y_lowpass = librosa.resample(y_aug, orig_sr=sr, target_sr=8000)
            y_lowpass = librosa.resample(y_lowpass, orig_sr=8000, target_sr=sr)
            noise = np.random.normal(0, 0.003, len(y_lowpass))
            y_aug = np.clip(y_lowpass + noise, -1.0, 1.0)
            feats_aug = extract_features(y_aug, sr)
            results.append((feats_aug, 0))

        return results
    except Exception:
        return None

def train_from_kaggle():
    logger.info("=== ScamDefy Production Trainer (Kaggle Dataset) v2.4.1 ===")
    
    # 1. Feature Cache Check
    if os.path.exists(X_CACHE_PATH) and os.path.exists(Y_CACHE_PATH):
        logger.info(f"Loading cached Kaggle features from {X_CACHE_PATH}...")
        X = np.load(X_CACHE_PATH)
        y = np.load(Y_CACHE_PATH)
        logger.info(f"Loaded {len(X)} samples from disk.")
    else:
        if not os.path.exists(KAGGLE_PATH):
            audio_root = KAGGLE_PATH
        else:
            audio_root = os.path.join(KAGGLE_PATH, "KAGGLE", "AUDIO")
            if not os.path.exists(audio_root): audio_root = KAGGLE_PATH

        if not os.path.exists(audio_root):
             logger.error(f"Kaggle dataset not found at {audio_root}")
             return

        # Gather file segments
        classes = {"REAL": 0, "FAKE": 1}
        SEGMENT_SEC = 5.0
        extract_jobs = []
        
        rc, fc = 0, 0
        limit = LITE_LIMIT if LITE_MODE else float('inf')

        for class_name, label in classes.items():
            class_dir = os.path.join(audio_root, class_name)
            if not os.path.exists(class_dir): continue
            
            files = [f for f in os.listdir(class_dir) if f.endswith(('.wav', '.mp3', '.ogg'))]
            logger.info(f"Scanning {label}: {len(files)} files...")
            
            for fname in files:
                if label == 0 and rc >= limit: break
                if label == 1 and fc >= limit: break
                
                fpath = os.path.join(class_dir, fname)
                try:
                    duration = librosa.get_duration(path=fpath)
                    for start_sec in np.arange(0, duration - SEGMENT_SEC, SEGMENT_SEC):
                        if start_sec > 300: break # Max 5 mins per file
                        extract_jobs.append((fpath, start_sec, SEGMENT_SEC, label == 0, 16000))
                except Exception: pass
                
                if label == 0: rc += 1
                if label == 1: fc += 1

        logger.info(f"Generated {len(extract_jobs)} chunk jobs.")

        completed_indices = set()
        X_dict, y_dict = {}, {}

        if os.path.exists(INTERMEDIATE_CACHE):
            try:
                logger.info(f"Checking for intermediate cache...")
                with open(INTERMEDIATE_CACHE, "rb") as f:
                    cached = pickle.load(f)
                    completed_indices = cached.get("completed_indices", set())
                    X_dict = cached.get("X_dict", {})
                    y_dict = cached.get("y_dict", {})
                logger.info(f"Resuming: {len(completed_indices)} jobs already completed.")
            except Exception: pass

        num_workers = min(4, max(1, mp.cpu_count() // 3))
        logger.info(f"Extracting with {num_workers} parallel workers...")
        
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            futures = {}
            for idx, job in enumerate(extract_jobs):
                if idx not in completed_indices:
                    futures[executor.submit(_worker_extract, job)] = idx
            
            logger.info(f"Remaining jobs: {len(futures)}")
            
            # Use i for tracking enumeration
            for i, future in enumerate(tqdm(as_completed(futures), total=len(futures), desc="Extracting Kaggle")):
                idx = futures[future]
                results = future.result()
                if results is not None:
                    # Results can contain original + augmented
                    X_dict[idx] = [r[0] for r in results]
                    y_dict[idx] = [r[1] for r in results]
                completed_indices.add(idx)

                if i > 0 and i % 250 == 0:
                    with open(INTERMEDIATE_CACHE, "wb") as f:
                        pickle.dump({"completed_indices": completed_indices, "X_dict": X_dict, "y_dict": y_dict}, f)

        # Final Cache Merge
        with open(INTERMEDIATE_CACHE, "wb") as f:
            pickle.dump({"completed_indices": completed_indices, "X_dict": X_dict, "y_dict": y_dict}, f)

        X_list, y_final = [], []
        for idx in sorted(X_dict.keys()):
            X_list.extend(X_dict[idx])
            y_final.extend(y_dict[idx])

        X = np.array(X_list, dtype=np.float32)
        y = np.array(y_final, dtype=np.int32)
        
        logger.info(f"Saving {len(X)} Kaggle features to disk...")
        np.save(X_CACHE_PATH, X)
        np.save(Y_CACHE_PATH, y)

    # 2. Data Split (70/15/15)
    logger.info("Splitting Kaggle Dataset...")
    X_train_full, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42, stratify=y)
    X_val_full, X_test_full, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp)

    # 3. Modular Scaling & PCA
    X_train_acc, X_train_w2v = X_train_full[:, :34], X_train_full[:, 34:]
    X_val_acc,   X_val_w2v   = X_val_full[:, :34],   X_val_full[:, 34:]
    X_test_acc,  X_test_w2v  = X_test_full[:, :34],  X_test_full[:, 34:]

    logger.info("Fitting PCA on Neural Features...")
    pca = PCA(n_components=0.95, random_state=42)
    X_train_w2v_pca = pca.fit_transform(X_train_w2v)
    X_val_w2v_pca   = pca.transform(X_val_w2v)
    X_test_w2v_pca  = pca.transform(X_test_w2v)
    logger.info(f"PCA Compression: 768 -> {pca.n_components_} dims.")

    scaler_neural = StandardScaler()
    X_train_w2v_s = scaler_neural.fit_transform(X_train_w2v_pca)
    X_val_w2v_s   = scaler_neural.transform(X_val_w2v_pca)
    X_test_w2v_s  = scaler_neural.transform(X_test_w2v_pca)

    scaler_acoustic = StandardScaler()
    X_train_acc_s   = scaler_acoustic.fit_transform(X_train_acc)
    X_val_acc_s     = scaler_acoustic.transform(X_val_acc)
    X_test_acc_s    = scaler_acoustic.transform(X_test_acc)

    X_train = np.hstack([X_train_acc_s, X_train_w2v_s])
    X_val   = np.hstack([X_val_acc_s,   X_val_w2v_s])
    X_test  = np.hstack([X_test_acc_s,  X_test_w2v_s])

    # 4. Training
    logger.info("Training Kaggle Production Model (GradientBoosting)...")
    base_model = GradientBoostingClassifier(n_estimators=300, max_depth=5, learning_rate=0.05, subsample=0.8, random_state=42)
    base_model.fit(X_train, y_train)

    logger.info("Calibrating on Validation set...")
    calibrator = CalibratedClassifierCV(FrozenEstimator(base_model), method='sigmoid', cv=None)
    calibrator.fit(X_val, y_val)

    # 5. Evaluation
    y_scores_test = calibrator.predict_proba(X_test)[:, 1]
    eer, threshold = compute_eer(y_test, y_scores_test)
    
    y_train_scores = calibrator.predict_proba(X_train)[:, 1]
    baseline_stats = {
        "mean": float(np.mean(y_train_scores)),
        "std":  float(np.std(y_train_scores))
    }

    logger.info(f"✅ FINAL EER: {eer*100:.2f}% | Threshold: {threshold:.4f}")

    # 6. Save Artifact
    payload = {
        "model": calibrator,
        "pca": pca,
        "scaler_acoustic": scaler_acoustic,
        "scaler_neural": scaler_neural,
        "threshold": float(threshold),
        "baseline_stats": baseline_stats,
        "version": "v2.5",
        "feature_schema": {"acoustic_dim": 34, "neural_dim": 768, "final_dim": int(X_train.shape[1])},
        "source": "Kaggle: birdy654/deep-voice-deepfake-voice-recognition"
    }
    
    with open(MODEL_OUT, "wb") as f:
        pickle.dump(payload, f)
    
    logger.info(f"\n🚀 SUCCESS: Production Kaggle model saved to {MODEL_OUT}")

if __name__ == "__main__":
    mp.freeze_support() # Good practice on Windows
    train_from_kaggle()
