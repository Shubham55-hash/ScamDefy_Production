"""
conftest.py — Shared pytest fixtures for ScamDefy Antigravity tests
"""
import io
import struct
import wave
import pytest
from fastapi.testclient import TestClient

# ── Import app ─────────────────────────────────────────────────
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from index import app


@pytest.fixture(scope="session")
def client():
    """FastAPI test client (session-scoped — booted once for all tests)."""
    with TestClient(app) as c:
        yield c


# ── Known test URLs ────────────────────────────────────────────
SAFE_URL          = "https://www.google.com"
TEST_BLOCK_URL    = "http://scamdefy-test-block.com"
INVALID_URL       = "not-a-real-url-xyz-12345"

# ── Known scam/safe messages ───────────────────────────────────
SCAM_MESSAGE_OTP  = "Your OTP is 847291. Share it immediately to verify your account."
SCAM_MESSAGE_KYC  = "Dear customer, your KYC verification is pending. Click here to avoid account suspension."
SCAM_MESSAGE_CARD = "Kindly share your CVV and card number to claim your refund of Rs.5000."
SAFE_MESSAGE      = "Hey, are you coming to the meeting at 3pm today?"
LONG_MESSAGE      = "Hello there. " * 500         # 6500 chars — edge case
EMOJI_MESSAGE     = "🎉🎁💰🔗🎲🎯🔔💎"         # emojis only
MIXED_LANG_MSG    = "आपका OTP है 123456. Please share immediately urgently."


# ── Minimal valid WAV bytes (0.5 s, 16kHz, mono, 16-bit) ──────
def _make_wav(duration_s: float = 0.5, sr: int = 16000, freq_hz: float = 440.0) -> bytes:
    import math
    n_samples = int(sr * duration_s)
    buf = io.BytesIO()
    with wave.open(buf, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        for i in range(n_samples):
            sample = int(32767 * math.sin(2 * math.pi * freq_hz * i / sr))
            wf.writeframes(struct.pack("<h", sample))
    return buf.getvalue()


@pytest.fixture(scope="session")
def valid_wav_bytes():
    return _make_wav(duration_s=1.5, sr=16000)


@pytest.fixture(scope="session")
def oversized_wav_bytes():
    """Creates a stub bytestring > 10 MB to test file-size rejection."""
    return b"RIFF" + b"\x00" * (10 * 1024 * 1024 + 100)


REQUIRED_SCAN_FIELDS    = {"id", "url", "score", "verdict", "risk_level", "flags", "timestamp", "scan_time_ms"}
REQUIRED_MESSAGE_FIELDS = {"scan_type", "risk_level", "risk_score", "scam_category", "signals_triggered"}
REQUIRED_VOICE_FIELDS   = {"verdict", "confidence"}
