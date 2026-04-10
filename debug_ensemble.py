import os
import sys
# Add 'api' to path so internal imports within the api package work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))

import asyncio
import numpy as np
from api.services.voice_service import analyze_audio

import os

async def debug_scores():
    # Case 1: Pure Sine (Extreme Synthetic)
    sr = 22050
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration))
    y_synth = np.sin(2 * np.pi * 150 * t).astype(np.float32)
    
    # Case 2: Realistic Noise (Human-like)
    y_human = np.random.normal(0, 0.01, int(sr * duration)).astype(np.float32)
    
    async def run_test(y, name):
        temp_path = f"debug_{name}.wav"
        import soundfile as sf
        sf.write(temp_path, y, sr)
        try:
            with open(temp_path, "rb") as f:
                data = f.read()
                result = await analyze_audio(data, temp_path)
            
            mr = result.get('model_results', {})
            print(f"\n=== {name.upper()} VOICE RESULT ===")
            print(f"Verdict:   {result.get('verdict')}")
            print(f"Confidence: {result.get('confidence')*100:.1f}%")
            print(f"Final Score: {mr.get('final_score')}")
            print(f"  Local:      {mr.get('local_score')} (method={mr.get('local_method')})")
            print(f"  Pretrained: {mr.get('pretrained_prob')}")
            print(f"  Gemini:     {mr.get('gemini_verdict')} (conf={mr.get('gemini_confidence')})")
            print(f"Weights: {mr.get('effective_weights')}")
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    await run_test(y_synth, "synthetic_dummy")
    await run_test(y_human, "human_dummy")

if __name__ == "__main__":
    asyncio.run(debug_scores())
