import pytest
import numpy as np
from services.voice_service import ForensicEngine, AI_BAND, HUMAN_BAND

def test_weighted_fusion_clear_ai():
    # In v3.3: Neural (0.95), Wav2Vec (0.92), Biometric_raw (0.8 -> norm=0.9)
    # weighted = 0.5*0.95 + 0.3*0.92 + 0.2*0.9 = 0.475 + 0.276 + 0.18 = 0.931
    models = {
        "local":    {"ai_probability": 0.95, "confidence": 0.95, "biometric_raw": 0.8},
        "wav2vec":  {"ai_probability": 0.92, "confidence": 0.90},
        "gemini":   {"ai_probability": 0.90, "confidence": 0.85, "label": "SYNTHETIC"}
    }
    decision = ForensicEngine.compute_decision(models, duration=3.0)
    assert decision["final_label"] == "SYNTHETIC"
    assert decision["decision_path"] == "neural_override" # 0.95 > 0.92

def test_weighted_consensus_v33():
    # Neural (0.75), Wav2Vec (0.72), Biometric_raw (-0.8 -> norm=0.1)
    # weighted = 0.5*0.75 + 0.3*0.72 + 0.2*0.1 = 0.375 + 0.216 + 0.02 = 0.611
    # 0.611 is in UNCERTAIN band (0.55 - 0.68)
    models = {
        "local":    {"ai_probability": 0.75, "confidence": 0.90, "biometric_raw": -0.8},
        "wav2vec":  {"ai_probability": 0.72, "confidence": 0.90},
        "gemini":   {"ai_probability": 0.50, "confidence": 0.80}
    }
    decision = ForensicEngine.compute_decision(models, duration=3.0)
    assert decision["final_label"] == "UNCERTAIN"
    assert decision["decision_path"] == "uncertain_band"

def test_human_band_v33():
    # Clear human case
    models = {
        "local":    {"ai_probability": 0.10, "confidence": 0.95, "biometric_raw": -0.9},
        "wav2vec":  {"ai_probability": 0.15, "confidence": 0.90},
        "gemini":   {"ai_probability": 0.10, "confidence": 0.90}
    }
    decision = ForensicEngine.compute_decision(models, duration=3.0)
    assert decision["final_label"] == "REAL"
    assert decision["decision_path"] == "human_band"

def test_neural_override_v33():
    # neural_score > 0.92 should trigger SYNTHETIC even if others are low
    models = {
        "local":    {"ai_probability": 0.94, "confidence": 0.95, "biometric_raw": -0.8},
        "wav2vec":  {"ai_probability": 0.30, "confidence": 0.85},
        "gemini":   {"ai_probability": 0.20, "confidence": 0.80}
    }
    decision = ForensicEngine.compute_decision(models, duration=3.0)
    assert decision["final_label"] == "SYNTHETIC"
    assert decision["decision_path"] == "neural_override"

def test_signal_quality_gate_v33():
    models = {"local": {}, "wav2vec": {}, "gemini": {}}
    decision = ForensicEngine.compute_decision(models, duration=1.5)
    assert decision["final_label"] == "UNCERTAIN"
    assert decision["decision_path"] == "signal_quality_gate"

def test_confidence_smoothing_v33():
    # Case within 0.05 margin of 0.68 (e.g., 0.67)
    # neural 0.7, wav2vec 0.6, biometric_norm 0.7 -> weighted = 0.5*0.7 + 0.3*0.6 + 0.2*0.7 = 0.35 + 0.18 + 0.14 = 0.67
    # margin = 0.01. Penalty = (0.5 + 0.01 * 10) = 0.6x
    models = {
        "local":    {"ai_probability": 0.7, "confidence": 1.0, "biometric_raw": 0.4},
        "wav2vec":  {"ai_probability": 0.6, "confidence": 1.0},
        "gemini":   {"ai_probability": 0.5, "confidence": 1.0}
    }
    decision = ForensicEngine.compute_decision(models, duration=3.0)
    # raw avg conf is 1.0. penalized should be around 0.6
    assert decision["confidence"] < 0.7
    assert decision["confidence"] > 0.5

def test_normalization():
    local = {"score": 0.9, "confidence": 0.8}
    wav2vec = {"prob_synthetic": 0.1}
    gemini = {"ai_probability": 0.5, "confidence": 0.5}
    norm = ForensicEngine.normalize_outputs(local, wav2vec, gemini)
    assert norm["local"]["ai_probability"] == 0.9
    assert norm["wav2vec"]["ai_probability"] == 0.1
    # wav2vec confidence should be calculated as 2*abs(0.1-0.5) = 0.8
    assert norm["wav2vec"]["confidence"] == pytest.approx(0.8)
