import os
import sys
import pickle
import logging
import numpy as np
from datasets import load_dataset, Audio
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ── Ensure api/ is on sys.path so we can import models.voice_detector ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
API_DIR    = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, API_DIR)

try:
    from models.voice_detector import extract_features, FEATURE_COUNT
except ImportError:
    logger = logging.getLogger(__name__)
    logger.error("Could not import models.voice_detector. Ensure you are running from the api/ folder.")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def train_on_lite_dataset():
    logger.info("=== ScamDefy Lite Voice Trainer (HF Dataset) ===")
    
    # 1. Load Dataset (Automatic Download)
    # The 'datasets' library handles all downloading and caching for you.
    # You do NOT need to download anything manually from the website.
    logger.info("Downloading/Loading 'garystafford/deepfake-audio-detection' dataset...")
    try:
        ds = load_dataset("garystafford/deepfake-audio-detection", split="train")
        ds = ds.cast_column("audio", Audio(decode=False))
    except Exception as e:
        logger.error(f"Failed to load dataset: {e}")
        logger.info("Try running: pip install datasets multiprocess")
        return

    X, y = [], []
    
    # 2. Extract Features
    total = len(ds)
    logger.info(f"Processing {total} samples. This typically takes 5-10 minutes...")
    
    import io
    import librosa
    
    for i, item in enumerate(ds):
        label = item['label'] # 0: real, 1: synthetic
        
        audio_info = item['audio']
        try:
            if 'bytes' in audio_info and audio_info['bytes']:
                audio_data, sr = librosa.load(io.BytesIO(audio_info['bytes']), sr=None)
            elif 'path' in audio_info and audio_info['path']:
                audio_data, sr = librosa.load(audio_info['path'], sr=None)
            else:
                raise ValueError("No valid audio bytes or path found.")
        except Exception as e:
            logger.warning(f"Error decoding sample {i}: {e}")
            continue
        
        try:
            feats = extract_features(audio_data, sr)
            X.append(feats)
            y.append(label)
        except Exception as e:
            logger.warning(f"Skipping sample {i} due to error: {e}")
        
        if (i + 1) % 200 == 0:
            logger.info(f"  Processed {i+1}/{total} samples...")

    if not X:
        logger.error("No features extracted. Training aborted.")
        return

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    # 3. Train Model
    logger.info(f"Training on {X.shape[0]} samples...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    # Using GradientBoosting for robust performance on acoustic features
    model = GradientBoostingClassifier(
        n_estimators=150, 
        max_depth=4, 
        learning_rate=0.1, 
        random_state=42
    )
    model.fit(X_train_s, y_train)

    # 4. Evaluation
    y_pred = model.predict(X_test_s)
    acc = accuracy_score(y_test, y_pred)
    logger.info(f"\nFinal Test Accuracy: {acc*100:.1f}%")
    logger.info("\nClassification Report:")
    logger.info("\n" + classification_report(y_test, y_pred, target_names=["REAL", "SYNTHETIC"]))

    # 5. Save Model
    output_path = os.path.join(API_DIR, "models", "scamdefy_voice.pkl")
    payload = {
        "model":         model,
        "scaler":        scaler,
        "feature_count": FEATURE_COUNT,
        "accuracy":      acc,
        "labels":        {0: "REAL", 1: "SYNTHETIC"},
    }
    
    with open(output_path, "wb") as f:
        pickle.dump(payload, f)
    
    logger.info(f"\n✅ SUCCESS: Model saved to {output_path}")
    logger.info("Restart your ScamDefy API to start using the new model.")

if __name__ == "__main__":
    train_on_lite_dataset()
