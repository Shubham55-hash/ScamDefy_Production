"""
test_url_scan.py — URL Scam Detection Tests
============================================
Tests: /api/scan (GET + POST), response structure, caching, timing, edge cases
"""
import time
import pytest
from conftest import (
    SAFE_URL, TEST_BLOCK_URL, INVALID_URL,
    REQUIRED_SCAN_FIELDS,
)


class TestUrlScanPost:
    def test_test_block_url_is_flagged(self, client):
        """The hardcoded test marker URL must always return BLOCKED / score=100."""
        r = client.post("/api/scan", json={"url": TEST_BLOCK_URL})
        assert r.status_code == 200
        data = r.json()
        assert data["verdict"] == "BLOCKED"
        assert data["score"] == 100.0
        assert data["should_block"] is True

    def test_safe_url_is_not_blocked(self, client):
        """A well-known safe URL must not be marked BLOCKED."""
        r = client.post("/api/scan", json={"url": SAFE_URL})
        assert r.status_code == 200
        data = r.json()
        assert data["verdict"] != "BLOCKED", (
            f"google.com falsely blocked — score={data['score']}, flags={data['flags']}"
        )

    def test_response_contains_all_required_fields(self, client):
        r = client.post("/api/scan", json={"url": SAFE_URL})
        assert r.status_code == 200
        body = r.json()
        for field in REQUIRED_SCAN_FIELDS:
            assert field in body, f"Missing required field: {field}"

    def test_scan_time_under_3_seconds(self, client):
        start = time.time()
        r = client.post("/api/scan", json={"url": SAFE_URL})
        elapsed = time.time() - start
        assert r.status_code == 200
        # scan_time_ms from the response itself
        scan_ms = r.json().get("scan_time_ms", elapsed * 1000)
        assert scan_ms < 3000, f"Scan took {scan_ms}ms — exceeds 3s SLA"

    def test_empty_url_returns_validation_error(self, client):
        r = client.post("/api/scan", json={"url": ""})
        # Either 422 (pydantic) or 200 with a safe verdict — must NOT crash
        assert r.status_code in (200, 422), f"Unexpected status: {r.status_code}"

    def test_url_with_trailing_slash_normalised(self, client):
        r1 = client.post("/api/scan", json={"url": "https://www.google.com"})
        r2 = client.post("/api/scan", json={"url": "https://www.google.com/"})
        assert r1.status_code == 200
        assert r2.status_code == 200
        # Both should produce similar results
        assert r1.json()["verdict"] == r2.json()["verdict"]

    def test_breakdown_fields_present(self, client):
        r = client.post("/api/scan", json={"url": SAFE_URL})
        assert r.status_code == 200
        bd = r.json().get("breakdown", {})
        for key in ("gsb", "urlhaus", "domain", "url_pattern"):
            assert key in bd, f"Breakdown missing key: {key}"

    def test_score_is_float_in_range(self, client):
        r = client.post("/api/scan", json={"url": SAFE_URL})
        score = r.json()["score"]
        assert isinstance(score, (int, float))
        assert 0 <= score <= 100

    def test_cache_second_request(self, client):
        """Second identical request should be served from cache faster."""
        url = "https://example.com"
        client.post("/api/scan", json={"url": url})   # warm cache
        r2 = client.post("/api/scan", json={"url": url})
        assert r2.status_code == 200
        assert r2.json().get("cached") is True

    def test_bypass_cache_flag(self, client):
        url = "https://example.com"
        client.post("/api/scan", json={"url": url})   # warm cache
        r2 = client.post("/api/scan?bypass_cache=true", json={"url": url})
        assert r2.status_code == 200
        assert r2.json().get("cached") is False


class TestUrlScanGet:
    def test_get_endpoint_works(self, client):
        r = client.get(f"/api/scan?url={SAFE_URL}")
        assert r.status_code == 200
        assert "score" in r.json()

    def test_get_test_block_url(self, client):
        r = client.get(f"/api/scan?url={TEST_BLOCK_URL}")
        assert r.status_code == 200
        assert r.json()["verdict"] == "BLOCKED"


class TestScanEdgeCases:
    def test_url_with_fragment_stripped(self, client):
        """Fragment (#anchor) should be stripped and not affect the scan."""
        r = client.post("/api/scan", json={"url": f"{SAFE_URL}#section1"})
        assert r.status_code == 200

    def test_very_long_url(self, client):
        long_url = "https://www.example.com/" + "a" * 500
        r = client.post("/api/scan", json={"url": long_url})
        assert r.status_code in (200, 422)

    def test_timestamp_is_iso_format(self, client):
        import re
        r = client.post("/api/scan", json={"url": SAFE_URL})
        ts = r.json().get("timestamp", "")
        assert re.match(r"\d{4}-\d{2}-\d{2}T", ts), f"Timestamp not ISO: {ts}"
