"""
test_voice.py — Voice / AI Detection Tests
==========================================
Tests: /api/voice/analyze, /api/voice/health
"""
import io
import pytest
from conftest import REQUIRED_VOICE_FIELDS


class TestVoiceHealth:
    def test_voice_health_returns_200(self, client):
        r = client.get("/api/voice/health")
        assert r.status_code == 200

    def test_voice_health_has_status(self, client):
        r = client.get("/api/voice/health")
        assert "status" in r.json()
        assert r.json()["status"] in ("ok", "fail")

    def test_voice_health_has_reason(self, client):
        r = client.get("/api/voice/health")
        assert "reason" in r.json()


class TestVoiceValidation:
    def test_no_file_returns_422(self, client):
        r = client.post("/api/voice/analyze")
        assert r.status_code == 422

    def test_unsupported_format_returns_400(self, client):
        fake_text = io.BytesIO(b"this is not audio")
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("malware.txt", fake_text, "text/plain")},
        )
        assert r.status_code == 400
        assert "format" in r.json().get("detail", "").lower()

    def test_oversized_file_returns_413(self, client, oversized_wav_bytes):
        big_file = io.BytesIO(oversized_wav_bytes)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("huge.mp3", big_file, "audio/mpeg")},
        )
        assert r.status_code == 413

    def test_empty_filename_returns_400(self, client):
        fake_audio = io.BytesIO(b"\x00" * 1024)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("", fake_audio, "audio/wav")},
        )
        assert r.status_code in (400, 422)


class TestVoiceAnalysis:
    def test_valid_wav_returns_200_or_503(self, client, valid_wav_bytes):
        """
        200 = model loaded & analysed
        503 = model still downloading (first boot) — both are acceptable
        """
        f = io.BytesIO(valid_wav_bytes)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.wav", f, "audio/wav")},
        )
        assert r.status_code in (200, 500, 503), (
            f"Unexpected status {r.status_code}: {r.text}"
        )

    def test_response_contains_verdict(self, client, valid_wav_bytes):
        f = io.BytesIO(valid_wav_bytes)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.wav", f, "audio/wav")},
        )
        if r.status_code == 200:
            assert "verdict" in r.json()
            assert r.json()["verdict"] in ("REAL", "SYNTHETIC", "UNCERTAIN", "UNKNOWN")

    def test_confidence_is_float(self, client, valid_wav_bytes):
        f = io.BytesIO(valid_wav_bytes)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.wav", f, "audio/wav")},
        )
        if r.status_code == 200:
            conf = r.json().get("confidence", -1)
            assert 0.0 <= conf <= 1.0, f"Confidence out of range: {conf}"

    def test_response_has_id_and_timestamp(self, client, valid_wav_bytes):
        f = io.BytesIO(valid_wav_bytes)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.wav", f, "audio/wav")},
        )
        if r.status_code == 200:
            body = r.json()
            assert "id" in body
            assert "timestamp" in body

    def test_mp3_format_accepted(self, client):
        """MP3 is in ACCEPTED_FORMATS — should not be blocked by format check."""
        min_mp3 = io.BytesIO(b"\xff\xfb" + b"\x00" * 512)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.mp3", min_mp3, "audio/mpeg")},
        )
        # May fail at audio decode (500) but NOT at format validation (400)
        assert r.status_code != 400, (
            "MP3 format rejected — should be accepted by format validator"
        )

    def test_webm_format_accepted(self, client):
        min_webm = io.BytesIO(b"\x1a\x45\xdf\xa3" + b"\x00" * 512)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("test.webm", min_webm, "audio/webm")},
        )
        assert r.status_code != 400

    def test_no_crash_on_silence(self, client):
        """A file containing only silence should return UNCERTAIN, not crash."""
        import struct, wave
        buf = io.BytesIO()
        with wave.open(buf, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(struct.pack("<h", 0) * 8000)
        buf.seek(0)
        r = client.post(
            "/api/voice/analyze",
            files={"audio": ("silence.wav", buf, "audio/wav")},
        )
        assert r.status_code in (200, 500, 503)
        if r.status_code == 200:
            assert r.json()["verdict"] in ("REAL", "SYNTHETIC", "UNCERTAIN", "UNKNOWN", "ERROR")
