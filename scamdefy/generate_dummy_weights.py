import torch
import os
import sys

# Add the models directory to path so we can import VoiceCNN
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, "backend")
sys.path.append(backend_dir)
from models.voice_cnn_model import VoiceCNN

def create_dummy_weights():
    model = VoiceCNN()
    weights_dir = os.path.join(os.getcwd(), "backend", "models")
    os.makedirs(weights_dir, exist_ok=True)
    
    weights_path = os.path.join(weights_dir, "voice_cnn.pth")
    
    # Save the untrained state_dict
    torch.save(model.state_dict(), weights_path)
    print(f"Successfully created dummy weights at: {weights_path}")

if __name__ == "__main__":
    create_dummy_weights()
