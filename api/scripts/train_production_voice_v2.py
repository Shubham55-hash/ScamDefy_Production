
import os
import sys
import pickle
import io
import numpy as np
import librosa
from tqdm import tqdm
from datasets import load_from_disk
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

# ── Setup ──
# Robust absolute path handling
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API_DIR    = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, API_DIR)

from models.voice_detector import extract_features, FEATURE_COUNT

# Cache Paths (Bulletproof v2.4.1)
CACHE_DIR    = os.path.join(API_DIR, "data", "asvspoof_cache")
X_CACHE_PATH = os.path.join(API_DIR, "data", "X_v2_4.npy")
Y_CACHE_PATH = os.path.join(API_DIR, "data", "y_v2_4.npy")
INTERMEDIATE_CACHE = os.path.join(API_DIR, "data", "intermediate_cache.pkl")
MODEL_OUT    = os.path.join(API_DIR, "models", "scamdefy_voice_pro_v2.pkl")

# Configuration
LITE_MODE = False # Set to True for quick verification (1000 samples)
LITE_LIMIT = 500  # Per class

def compute_eer(y_true, y_scores):
    fpr, tpr, thresholds = roc_curve(y_true, y_scores)
    fnr = 1 - tpr
    idx = np.nanargmin(np.abs(fnr - fpr))
    eer = (fpr[idx] + fnr[idx]) / 2
    return eer, thresholds[idx]

def _worker_extract(audio_bytes, sr_target=None):
    """
    Parallel worker for feature extraction.
    """
    try:
        # Compatibility with raw bytes from HuggingFace
        audio_array, sr = librosa.load(io.BytesIO(audio_bytes), sr=sr_target)
        return extract_features(audio_array, sr)
    except Exception:
        return None

def train_v2_pipeline():
    print("=== ScamDefy Forensic Voice Pipeline v2.4.1 (Bulletproof Cache) ===")
    
    # 1. Feature Cache Check
    if os.path.exists(X_CACHE_PATH) and os.path.exists(Y_CACHE_PATH):
        print(f"DONE: Loading cached features from {X_CACHE_PATH}...")
        X = np.load(X_CACHE_PATH)
        y = np.load(Y_CACHE_PATH)
        print(f"INFO: Loaded {len(X)} samples from disk.")
    else:
        print("INFO: No feature cache found. Initiating extraction...")
        if not os.path.exists(CACHE_DIR):
            print(f"ERROR: Dataset cache not found at {CACHE_DIR}. Run cache_dataset.py first.")
            return

        print(f"INFRA: Extracting features from {CACHE_DIR} using Parallel Processing...")
        ds = load_from_disk(CACHE_DIR)
        
        limit = LITE_LIMIT if LITE_MODE else 10000 
        raw_samples = []
        rc, fc = 0, 0
        
        print(f"Gathering samples (Limit per class: {limit})...")
        for sample in ds:
            label = sample['key']
            if label == 0 and rc < limit:
                raw_samples.append((sample['audio']['bytes'], label))
                rc += 1
            elif label == 1 and fc < limit:
                raw_samples.append((sample['audio']['bytes'], label))
                fc += 1
            if rc >= limit and fc >= limit: break

        completed_indices = set()
        X_dict = {}
        y_dict = {}

        if os.path.exists(INTERMEDIATE_CACHE):
            try:
                print(f"INFO: Checking for intermediate cache at {INTERMEDIATE_CACHE}...")
                with open(INTERMEDIATE_CACHE, "rb") as f:
                    cached_data = pickle.load(f)
                    completed_indices = cached_data.get("completed_indices", set())
                    X_dict = cached_data.get("X_dict", {})
                    y_dict = cached_data.get("y_dict", {})
                print(f"SUCCESS: Resuming extraction... {len(completed_indices)} samples already processed!")
            except Exception as e:
                print(f"WARNING: Failed to load intermediate cache: {e}")

        # Reduce workers to 4 (or 1/3 of cores) to stay within 12GB RAM limit with Wav2Vec2
        num_workers = min(4, max(1, mp.cpu_count() // 3))
        print(f"Spinning up {num_workers} workers...")
        
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            futures = {}
            for idx, s in enumerate(raw_samples):
                if idx not in completed_indices:
                    futures[executor.submit(_worker_extract, s[0])] = (idx, s[1])

            print(f"Remaining samples to process: {len(futures)}")
            
            for i, future in enumerate(tqdm(as_completed(futures), total=len(futures), desc="Extraction")):
                idx, label = futures[future]
                feats = future.result()
                if feats is not None:
                    X_dict[idx] = feats
                    y_dict[idx] = label
                completed_indices.add(idx)

                # Incremental Save
                if i > 0 and i % 250 == 0:
                    with open(INTERMEDIATE_CACHE, "wb") as f:
                        pickle.dump({
                            "completed_indices": completed_indices,
                            "X_dict": X_dict,
                            "y_dict": y_dict
                        }, f)

        # Final save of intermediate state just in case writing .npy fails
        with open(INTERMEDIATE_CACHE, "wb") as f:
            pickle.dump({"completed_indices": completed_indices, "X_dict": X_dict, "y_dict": y_dict}, f)

        print("INFO: Merging features...")
        X_list = [X_dict[i] for i in sorted(X_dict.keys())]
        y_final = [y_dict[i] for i in sorted(y_dict.keys())]

        X = np.array(X_list, dtype=np.float32)
        y = np.array(y_final, dtype=np.int32)
        
        print(f"SAVE: Saving {len(X)} features to permanent cache...")
        np.save(X_CACHE_PATH, X)
        np.save(Y_CACHE_PATH, y)

    # 2. Data Split (70/15/15)
    print("INFO: Performing 70/15/15 Data Split...")
    X_train_full, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42, stratify=y)
    X_val_full, X_test_full, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp)

    # 3. Modular Scaling & PCA
    # Separation: Acoustic (0:34), Neural (34:802)
    X_train_acc, X_train_w2v = X_train_full[:, :34], X_train_full[:, 34:]
    X_val_acc,   X_val_w2v   = X_val_full[:, :34],   X_val_full[:, 34:]
    X_test_acc,  X_test_w2v  = X_test_full[:, :34],  X_test_full[:, 34:]

    # Neural Path: PCA (on Train) -> StandardScaler
    print("INFO: Fitting PCA on Neural Features...")
    pca = PCA(n_components=0.95, random_state=42)
    X_train_w2v_pca = pca.fit_transform(X_train_w2v)
    X_val_w2v_pca   = pca.transform(X_val_w2v)
    X_test_w2v_pca  = pca.transform(X_test_w2v)
    print(f"DATA: PCA Compression: 768 -> {pca.n_components_} dims.")

    scaler_neural = StandardScaler()
    X_train_w2v_s = scaler_neural.fit_transform(X_train_w2v_pca)
    X_val_w2v_s   = scaler_neural.transform(X_val_w2v_pca)
    X_test_w2v_s  = scaler_neural.transform(X_test_w2v_pca)

    # Acoustic Path: StandardScaler
    scaler_acoustic = StandardScaler()
    X_train_acc_s   = scaler_acoustic.fit_transform(X_train_acc)
    X_val_acc_s     = scaler_acoustic.transform(X_val_acc)
    X_test_acc_s    = scaler_acoustic.transform(X_test_acc)

    X_train = np.hstack([X_train_acc_s, X_train_w2v_s])
    X_val   = np.hstack([X_val_acc_s,   X_val_w2v_s])
    X_test  = np.hstack([X_test_acc_s,  X_test_w2v_s])
    
    # 4. Training & Calibration
    print("INFO: Training Base GradientBoosting Model...")
    base_model = GradientBoostingClassifier(n_estimators=200, max_depth=5, learning_rate=0.1, subsample=0.8, random_state=42)
    base_model.fit(X_train, y_train)

    print("INFO: Calibrating Model on Validation set (using FrozenEstimator)...")
    # In sklearn 1.8.0+, cv='prefit' is replaced by FrozenEstimator
    calibrator = CalibratedClassifierCV(FrozenEstimator(base_model), method='sigmoid', cv=None)
    calibrator.fit(X_val, y_val)

    # 5. Forensic Evaluation (EER)
    y_scores_test = calibrator.predict_proba(X_test)[:, 1]
    eer, threshold = compute_eer(y_test, y_scores_test)
    
    # 6. Baseline Stats (for Drift Detection)
    y_train_scores = calibrator.predict_proba(X_train)[:, 1]
    baseline_stats = {
        "mean": float(np.mean(y_train_scores)),
        "std":  float(np.std(y_train_scores))
    }

    print(f"\nDONE: SUCCESS: EER={eer*100:.2f}%, Threshold={threshold:.4f}")
    print(f"DATA: Training Baseline: Mean={baseline_stats['mean']:.4f}, Std={baseline_stats['std']:.4f}")

    # 7. Atomic Persistence
    print(f"SAVE: Saving Bulletproof Artifact to {MODEL_OUT}...")
    artifact = {
        "model":           calibrator,
        "pca":             pca,
        "scaler_acoustic": scaler_acoustic,
        "scaler_neural":   scaler_neural,
        "threshold":       float(threshold),
        "baseline_stats":  baseline_stats,
        "version":         "v2.4",
        "feature_schema":  {"acoustic_dim": 34, "neural_dim": 768, "final_dim": int(X_train.shape[1])}
    }
    with open(MODEL_OUT, "wb") as f:
        pickle.dump(artifact, f)
    print("DONE: PIPELINE COMPLETE")

if __name__ == "__main__":
    train_v2_pipeline()
