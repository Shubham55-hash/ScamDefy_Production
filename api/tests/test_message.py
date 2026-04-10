"""
test_message.py — Message Scam Detection Tests
===============================================
Tests: /api/analyze-message — risk levels, signals, edge cases
"""
import pytest
from conftest import (
    SCAM_MESSAGE_OTP, SCAM_MESSAGE_KYC, SCAM_MESSAGE_CARD,
    SAFE_MESSAGE, LONG_MESSAGE, EMOJI_MESSAGE, MIXED_LANG_MSG,
    REQUIRED_MESSAGE_FIELDS,
)


class TestMessageDetectionPositive:
    def test_otp_request_is_critical(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_OTP})
        assert r.status_code == 200
        data = r.json()
        assert data["risk_level"] in ("CRITICAL", "HIGH"), (
            f"OTP message not flagged correctly: {data['risk_level']}"
        )
        assert data["risk_score"] >= 40

    def test_kyc_message_is_flagged(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_KYC})
        assert r.status_code == 200
        data = r.json()
        assert data["risk_level"] in ("CRITICAL", "HIGH", "SUSPICIOUS"), (
            f"KYC message risk level too low: {data['risk_level']}"
        )
        assert data["risk_score"] >= 20

    def test_card_credentials_request_is_critical(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_CARD})
        assert r.status_code == 200
        data = r.json()
        assert data["risk_score"] >= 50, (
            f"Card credential request not scored critically: {data['risk_score']}"
        )

    def test_signals_list_populated_for_scam(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_OTP})
        assert r.status_code == 200
        signals = r.json().get("signals_triggered", [])
        assert len(signals) > 0, "No signals triggered for obvious scam message"

    def test_signal_has_name_and_points(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_OTP})
        for sig in r.json().get("signals_triggered", []):
            assert "name" in sig
            assert "points" in sig
            assert isinstance(sig["points"], (int, float))


class TestMessageDetectionNegative:
    def test_safe_message_is_safe(self, client):
        r = client.post("/api/analyze-message", json={"text": SAFE_MESSAGE})
        assert r.status_code == 200
        data = r.json()
        assert data["risk_level"] == "SAFE", (
            f"Normal message falsely flagged: {data['risk_level']} (score={data['risk_score']})"
        )

    def test_safe_message_score_is_low(self, client):
        r = client.post("/api/analyze-message", json={"text": SAFE_MESSAGE})
        assert r.json()["risk_score"] < 15


class TestMessageEdgeCases:
    def test_empty_message_returns_valid_response(self, client):
        r = client.post("/api/analyze-message", json={"text": ""})
        assert r.status_code in (200, 422)
        if r.status_code == 200:
            assert r.json()["risk_score"] == 0

    def test_long_message_doesnt_crash(self, client):
        r = client.post("/api/analyze-message", json={"text": LONG_MESSAGE})
        assert r.status_code == 200
        assert "risk_level" in r.json()

    def test_emoji_only_message(self, client):
        r = client.post("/api/analyze-message", json={"text": EMOJI_MESSAGE})
        assert r.status_code == 200
        assert "risk_level" in r.json()

    def test_mixed_language_message(self, client):
        r = client.post("/api/analyze-message", json={"text": MIXED_LANG_MSG})
        assert r.status_code == 200
        data = r.json()
        assert data["risk_level"] in ("CRITICAL", "HIGH", "SUSPICIOUS", "SAFE")

    def test_response_structure_complete(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_KYC})
        assert r.status_code == 200
        body = r.json()
        for field in REQUIRED_MESSAGE_FIELDS:
            assert field in body, f"Missing field: {field}"

    def test_risk_score_capped_at_100(self, client):
        # Send a message with many signals to test capping
        mega_scam = (
            "URGENT: Your OTP is 123456, share your PIN, CVV, card number, "
            "Aadhaar, password. Click here. You won a lottery prize. "
            "KYC required, account blocked, refund pending. "
            "Install TeamViewer for remote access. Gift card payment needed."
        )
        r = client.post("/api/analyze-message", json={"text": mega_scam})
        assert r.status_code == 200
        assert r.json()["risk_score"] <= 100

    def test_recommendation_always_present(self, client):
        r = client.post("/api/analyze-message", json={"text": SAFE_MESSAGE})
        assert r.status_code == 200
        assert "recommendation" in r.json()
        assert len(r.json()["recommendation"]) > 5

    def test_scam_category_always_string(self, client):
        r = client.post("/api/analyze-message", json={"text": SCAM_MESSAGE_OTP})
        assert isinstance(r.json().get("scam_category"), str)
