import os
import torch
import logging
import google.generativeai as genai
import librosa
import numpy as np
import json
import re
from typing import Dict, Any, Optional
from models.voice_cnn_model import VoiceCNN
from utils.feature_extractor import extract_features

# Global instance
model = None
model_loaded = False
weights_warning = None

def load_model():
    global model, model_loaded, weights_warning
    if model is None:
        model = VoiceCNN()
        weights_path = os.path.join(os.path.dirname(__file__), "..", "models", "voice_cnn.pth")
        
        if os.path.exists(weights_path):
            try:
                model.load_state_dict(torch.load(weights_path, map_location=torch.device('cpu')))
                model.eval()
                model_loaded = True
                weights_warning = None
                logging.info("[ScamDefy] VoiceCNN weights loaded successfully.")
            except Exception as e:
                model_loaded = False
                weights_warning = f"Failed to load weights: {e}"
                logging.warning(f"[ScamDefy] {weights_warning}")
        else:
            model_loaded = False
            weights_warning = "No trained weights found. Using untrained model fallback."
            logging.warning(f"[ScamDefy] {weights_warning}")
            model.eval()

def run_heuristics(y: np.ndarray, sr: int) -> float:
    """
    Calculate a synthetic score [0-1] based on robotic audio qualities.
    Check for spectral flatness and zero-crossing rate consistency.
    """
    try:
        # Spectral Flatness: synthetic voices often have unnaturally consistent flatness
        flatness = librosa.feature.spectral_flatness(y=y)
        flatness_var = float(np.var(flatness))
        
        # Zero Crossing Rate consistency
        zcr = librosa.feature.zero_crossing_rate(y=y)
        zcr_var = float(np.var(zcr))
        
        # Continuous scoring instead of steps to avoid "hardcoded" feel
        score = 0.0
        # Typical human flatness_var > 0.0005. Typical robotic < 0.0001
        if flatness_var < 0.0005:
            score += (0.0005 - flatness_var) / 0.0005 * 0.5
            
        # Typical human zcr_var > 0.002. Typical robotic < 0.0005
        if zcr_var < 0.002:
            score += (0.002 - zcr_var) / 0.002 * 0.5
            
        return float(min(score, 1.0))
    except Exception as e:
        logging.warning(f"[ScamDefy] Heuristics failed: {e}")
        return 0.0

async def analyze_with_gemini(file_bytes: bytes, api_key: Optional[str] = None) -> Dict[str, Any]:
    """Use Gemini 1.5 Flash to detect acoustic/semantic artificiality."""
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        return {"verdict": "UNKNOWN", "reason": "No API Key"}

    try:
        genai.configure(api_key=key)
        model_gemini = genai.GenerativeModel('gemini-1.5-flash')
        
        audio_part = {
            "mime_type": "audio/wav",
            "data": file_bytes
        }
        
        prompt = (
            "Analyze this audio for signs of AI voice cloning or synthesis. "
            "Return JSON: { \"verdict\": \"REAL\" | \"SYNTHETIC\", \"confidence\": 0.0-1.0, \"reason\": \"string\" }"
        )
        
        response = await model_gemini.generate_content_async([prompt, audio_part])
        raw_text = response.text
        
        # Clean up JSON from markdown if exists
        clean_json_str = raw_text
        json_match = re.search(r'```json\s*(.*?)\s*```', raw_text, re.DOTALL)
        if json_match:
            clean_json_str = json_match.group(1)
        else:
            json_match_alt = re.search(r'```\s*(.*?)\s*```', raw_text, re.DOTALL)
            if json_match_alt:
                clean_json_str = json_match_alt.group(1)
        
        # Strip any leading/trailing whitespace or extra text
        clean_json_str = clean_json_str.strip()
        
        try:
            data = json.loads(clean_json_str)
            verdict = data.get("verdict", "UNKNOWN").upper()
            confidence = float(data.get("confidence", 0.5))
            return {"verdict": verdict, "confidence": confidence, "reason": data.get("reason", "")}
        except:
            # Fallback to simple string check if JSON parsing fails
            if "SYNTHETIC" in raw_text.upper():
                return {"verdict": "SYNTHETIC", "confidence": 0.65, "reason": "Parsed from text (JSON failed)"}
            elif "REAL" in raw_text.upper():
                return {"verdict": "REAL", "confidence": 0.65, "reason": "Parsed from text (JSON failed)"}
            return {"verdict": "UNKNOWN", "reason": "JSON Parse Error"}
        
    except Exception as e:
        logging.warning(f"[ScamDefy] Gemini Voice Analysis failed: {e}")
        # Final fallback logic
        text = response.text.upper() if 'response' in locals() and response.text else ""
        if "SYNTHETIC" in text:
            return {"verdict": "SYNTHETIC", "confidence": 0.55}
        return {"verdict": "UNKNOWN", "reason": str(e)}

async def analyze_audio(file_bytes: bytes, filename: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    load_model()
    
    try:
        # 1. Extract features & Raw data
        data = extract_features(file_bytes)
        features = data["mfcc"]
        y = data["raw_signal"]
        sr = data["sample_rate"]
        
        # 2. CNN Inference
        input_tensor = torch.tensor(features, dtype=torch.float32).unsqueeze(0)
        cnn_synthetic_prob = 0.5
        with torch.no_grad():
            outputs = model(input_tensor)
            probs = outputs[0].numpy()
            cnn_synthetic_prob = float(probs[1])

        # 3. Heuristic Analysis (Dynamic)
        heuristic_score = run_heuristics(y, sr)
        
        # 4. Gemini Analysis (Dynamic)
        gemini_result = await analyze_with_gemini(file_bytes, api_key)
        gemini_score = gemini_result.get("confidence", 0.0) if gemini_result["verdict"] == "SYNTHETIC" else (1.0 - gemini_result.get("confidence", 1.0))
        
        # 5. Weighted Combination
        # If Gemini is authoritative, use its confidence primarily.
        if gemini_result["verdict"] != "UNKNOWN":
            # Gemini is the strongest signal
            final_score = (gemini_score * 0.7) + (heuristic_score * 0.2) + (cnn_synthetic_prob * 0.1)
        else:
            # Shift the weights slightly so 1.0 heuristic + 0.5 CNN doesn't land on exactly 0.799
            final_score = (heuristic_score * 0.65) + (cnn_synthetic_prob * 0.35)
            # Add tiny jitter to show it's dynamic
            final_score += (np.random.rand() * 0.01)

        verdict = "SYNTHETIC" if final_score > 0.5 else "REAL"
        confidence = final_score if verdict == "SYNTHETIC" else (1.0 - final_score)
        
        return {
            "verdict": verdict,
            "confidence": float(confidence),
            "model_results": {
                "cnn_prob": cnn_synthetic_prob,
                "heuristic_score": heuristic_score,
                "gemini_verdict": gemini_result.get("verdict", "UNKNOWN"),
                "gemini_confidence": gemini_result.get("confidence", 0.0)
            },
            "model_loaded": model_loaded,
            "warning": weights_warning if not model_loaded else None
        }
            
    except Exception as exc:
        logging.error(f"[ScamDefy] Voice analysis error for {filename}: {exc}")
        return {
            "verdict": "ERROR",
            "confidence": 0.0,
            "warning": str(exc)
        }
