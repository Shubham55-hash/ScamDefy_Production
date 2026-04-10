from api.models.voice_detector import get_detector
import numpy as np

SR = 22050
n = SR * 2
rng = np.random.default_rng(99)

# AI-like audio: uniform vibrato, minimal jitter, clean
t = np.linspace(0, 2, n, endpoint=False)
pitch_hz = 160 + 0.3 * np.sin(2 * 3.14159 * 5.5 * t)
jitter = 1.0 + rng.normal(0, 0.0005, n)
phase = 2 * 3.14159 * np.cumsum(pitch_hz * jitter) / SR
y_ai = (np.sin(phase) + 0.35*np.sin(2*phase) + 0.18*np.sin(3*phase)).astype(np.float32)
y_ai = y_ai / (float(np.max(np.abs(y_ai))) + 1e-8)

# Human-like audio: variable pitch walk, high jitter, and NOISE (essential for human HNR)
pitch_steps = rng.normal(0, 15, n)
pitch_hz2 = np.cumsum(pitch_steps)/SR + 140.0
pitch_hz2 = np.clip(pitch_hz2, 80, 280)
jitter2 = 1.0 + rng.normal(0, 0.04, n)
phase2 = 2 * 3.14159 * np.cumsum(pitch_hz2 * jitter2) / SR
y_human = np.sin(phase2)
# Add human timbre (harmonics)
y_human += 0.3 * np.sin(2 * phase2) + 0.1 * np.sin(3 * phase2)
# Add breathiness/background noise (lowers HNR to human levels < 60)
y_human += rng.normal(0, 0.08, n) 
y_human = (y_human / np.max(np.abs(y_human))).astype(np.float32)
y_human += rng.normal(0, 0.01, n).astype(np.float32)
y_human = y_human / (float(np.max(np.abs(y_human))) + 1e-8)

det = get_detector()
print(f"Model method: {det.model is not None and 'trained_model' or 'rule_based'}")

SR = 16000 # defined at top

print("=== AI-like audio ===")
from api.models.voice_detector import extract_features
feats_ai = extract_features(y_ai, SR)
print(f"  HNR: {feats_ai[13]:.2f}, Jitter: {feats_ai[2]:.4f}")
r_ai = det.predict(y_ai, SR)

print("=== Human-like audio ===")
feats_human = extract_features(y_human, SR)
print(f"  HNR: {feats_human[13]:.2f}, Jitter: {feats_human[2]:.4f}")
r_human = det.predict(y_human, SR)

print("=== AI-like audio ===")
print(f"  Score: {r_ai['score']:.3f}  Confidence: {r_ai['confidence']:.3f}  Method: {r_ai['method']}")
print(f"  Verdict: {'SYNTHETIC' if r_ai['score'] > 0.5 else 'REAL'}")
if 'rule_reason' in r_ai: print(f"  Rule Reason: {r_ai['rule_reason']}")
print()
print("=== Human-like audio ===")
print(f"  Score: {r_human['score']:.3f}  Confidence: {r_human['confidence']:.3f}  Method: {r_human['method']}")
print(f"  Verdict: {'SYNTHETIC' if r_human['score'] > 0.5 else 'REAL'}")
if 'rule_reason' in r_human: print(f"  Rule Reason: {r_human['rule_reason']}")
