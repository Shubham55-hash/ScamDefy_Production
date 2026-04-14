import sys
import os
import asyncio
import numpy as np

# Add api and root directory to path for robust imports
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API_DIR = os.path.join(ROOT_DIR, "api")
if API_DIR not in sys.path:
    sys.path.append(API_DIR)
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from services.voice_service import analyze_audio
from unittest.mock import patch, MagicMock

async def test_confidence():
    print("=== ScamDefy Voice Confidence Calibration Test ===")
    
    file_bytes = b"dummy_audio_bytes"
    filename = "test_audio.wav"
    
    # We mock librosa and VAD to pass the initial checks
    with patch("librosa.load") as mock_load, \
         patch("services.voice_service._detect_voice_activity") as mock_vad:
        
        mock_load.return_value = (np.random.uniform(-0.1, 0.1, 22050), 22050)
        mock_vad.return_value = (True, "voice detected")

        # CASE 1: Specialist Veto Scenario
        # Local model is 0.98 sure (AI), Cloud models are neutral (0.50)
        # OLD BEHAVIOR: 0.65 confidence
        # NEW BEHAVIOR: >= 0.85 confidence
        with patch("services.voice_service._run_local_detector") as mock_local, \
             patch("services.voice_service._run_pretrained") as mock_hf, \
             patch("services.voice_service._run_gemini") as mock_gemini:
            
            mock_local.return_value = {"score": 0.98, "confidence": 0.98, "method": "mock"}
            mock_hf.return_value = {"available": True, "prob_synthetic": 0.5}
            mock_gemini.return_value = {"available": False, "verdict": "UNKNOWN", "confidence": 0.5}
            
            result = await analyze_audio(file_bytes, filename)
            print(f"\n[Case 1: Specialist Veto (Local 0.98, Others 0.50)]")
            print(f"Verdict:    {result['verdict']}")
            print(f"Confidence: {result['confidence'] * 100:.1f}%")
            print(f"Score:      {result['model_results']['final_score']:.3f}")

        # CASE 2: Balanced Detection
        # Ensemble average is 0.65 (AI)
        # OLD BEHAVIOR: 0.65 confidence
        # NEW BEHAVIOR: ~0.86 confidence (boosted)
        with patch("services.voice_service._run_local_detector") as mock_local, \
             patch("services.voice_service._run_pretrained") as mock_hf, \
             patch("services.voice_service._run_gemini") as mock_gemini:
            
            # Weighted average will be around 0.65
            mock_local.return_value = {"score": 0.70, "confidence": 0.70}
            mock_hf.return_value = {"available": True, "prob_synthetic": 0.60}
            mock_gemini.return_value = {"available": True, "verdict": "SYNTHETIC", "confidence": 0.60}
            
            result = await analyze_audio(file_bytes, filename)
            print(f"\n[Case 2: Balanced Ensemble (Avg ~0.65)]")
            print(f"Verdict:    {result['verdict']}")
            print(f"Confidence: {result['confidence'] * 100:.1f}%")

        # CASE 3: Near Threshold
        # Ensemble average is 0.45 (just above 0.38 decision boundary)
        # OLD BEHAVIOR: ~0.53 confidence
        # NEW BEHAVIOR: ~0.60 confidence (moderate boost)
        with patch("services.voice_service._run_local_detector") as mock_local, \
             patch("services.voice_service._run_pretrained") as mock_hf, \
             patch("services.voice_service._run_gemini") as mock_gemini:
            
            mock_local.return_value = {"score": 0.45, "confidence": 0.45}
            mock_hf.return_value = {"available": False, "prob_synthetic": 0.5}
            mock_gemini.return_value = {"available": False}
            
            result = await analyze_audio(file_bytes, filename)
            print(f"\n[Case 3: Near Threshold (Avg 0.45)]")
            print(f"Verdict:    {result['verdict']}")
            print(f"Confidence: {result['confidence'] * 100:.1f}%")

        # CASE 4: Extreme Disagreement (Defensible specialist)
        # Local model is 0.99 (certain synthetic), Cloud models say Real (0.15)
        # Expected: Specialist Veto should kick in and provide high confidence.
        with patch("services.voice_service._run_local_detector") as mock_local, \
             patch("services.voice_service._run_pretrained") as mock_hf, \
             patch("services.voice_service._run_gemini") as mock_gemini:
            
            mock_local.return_value = {"score": 0.995, "confidence": 0.98, "method": "mock_assertive"}
            mock_hf.return_value = {"available": True, "prob_synthetic": 0.15}
            mock_gemini.return_value = {"available": True, "verdict": "REAL", "confidence": 0.85}
            
            result = await analyze_audio(file_bytes, filename)
            print(f"\n[Case 4: Extreme Disagreement (Local 0.995, Cloud ~0.15)]")
            print(f"Verdict:    {result['verdict']}")
            print(f"Confidence: {result['confidence'] * 100:.1f}%")
            print(f"Local Score: {result['model_results']['local_score']}")
            print(f"Final Score: {result['model_results']['final_score']}")

if __name__ == "__main__":
    asyncio.run(test_confidence())
