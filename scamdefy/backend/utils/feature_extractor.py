import io
import numpy as np
import librosa
import soundfile as sf
import logging

def extract_features(audio_bytes: bytes) -> np.ndarray:
    """
    Extract MFCC features from audio bytes.
    Returns array of shape (1, 40, 128) for the CNN.
    """
    try:
        # Load audio from bytes using soundfile and librosa
        with io.BytesIO(audio_bytes) as audio_io:
            y, sr = sf.read(audio_io)
        
        # If stereo, convert to mono
        if len(y.shape) > 1:
            y = np.mean(y, axis=1)

        # Resample if necessary (librosa default is 22050)
        target_sr = 22050
        if sr != target_sr:
            y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
            sr = target_sr

        # Extract MFCC: n_mfcc=40, hop_length=512, sr=22050
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40, hop_length=512)
        
        # Normalize features to [-1, 1]
        mfcc_normalized = librosa.util.normalize(mfcc)
        
        # Pad/trim to fixed length: 128 frames
        max_pad_len = 128
        if mfcc_normalized.shape[1] > max_pad_len:
            mfcc_normalized = mfcc_normalized[:, :max_pad_len]
        else:
            pad_width = max_pad_len - mfcc_normalized.shape[1]
            mfcc_normalized = np.pad(mfcc_normalized, pad_width=((0, 0), (0, pad_width)), mode='constant')
            
        # Add channel dimension: shape (1, 40, 128)
        mfcc_cnn_input = np.expand_dims(mfcc_normalized, axis=0)
        
        return {
            "mfcc": mfcc_cnn_input,
            "raw_signal": y,
            "sample_rate": sr
        }
        
    except Exception as exc:
        logging.error(f"[ScamDefy] Feature extraction failed: {exc}")
        raise exc
