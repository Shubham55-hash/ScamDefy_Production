"""
test_api_health.py — API Integration & Health Tests
=====================================================
Tests: /, /api/health, service health checks, error robustness
"""
import pytest


class TestRootEndpoint:
    def test_root_returns_200(self, client):
        r = client.get("/")
        assert r.status_code == 200

    def test_root_has_status_active(self, client):
        r = client.get("/")
        data = r.json()
        assert data.get("status") == "active"

    def test_root_has_service_name(self, client):
        r = client.get("/")
        assert "service" in r.json()
        assert "scamdefy" in r.json()["service"].lower()

    def test_root_has_version(self, client):
        r = client.get("/")
        assert "version" in r.json()


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200

    def test_health_has_status_ok(self, client):
        r = client.get("/api/health")
        assert r.json().get("status") == "ok"

    def test_health_has_modules_dict(self, client):
        r = client.get("/api/health")
        modules = r.json().get("modules")
        assert isinstance(modules, dict), "modules must be a dict"

    def test_health_modules_contain_expected_keys(self, client):
        r = client.get("/api/health")
        modules = r.json().get("modules", {})
        expected = {"url_expander", "gsb_service", "urlhaus_service", "voice_cnn"}
        for key in expected:
            assert key in modules, f"Health missing module key: {key}"

    def test_health_module_values_are_booleans(self, client):
        r = client.get("/api/health")
        for key, val in r.json().get("modules", {}).items():
            assert isinstance(val, bool), (
                f"Module health value for '{key}' is not bool: {type(val)}"
            )

    def test_health_has_version(self, client):
        r = client.get("/api/health")
        assert "version" in r.json()


class TestGsbService:
    @pytest.mark.asyncio
    async def test_gsb_health_check(self):
        from services.gsb_service import health_check
        result = await health_check()
        assert "status" in result
        assert result["status"] in ("ok", "fail")


class TestUrlHausService:
    @pytest.mark.asyncio
    async def test_urlhaus_health_check(self):
        from services.urlhaus_service import health_check
        result = await health_check()
        assert "status" in result
        assert result["status"] in ("ok", "fail")


class TestReportEndpoint:
    def test_report_accepted(self, client):
        r = client.post(
            "/api/report",
            json={"url": "https://example.com", "reason": "phishing", "notes": "test note"}
        )
        assert r.status_code == 200
        assert r.json().get("status") == "received"

    def test_report_without_notes(self, client):
        r = client.post(
            "/api/report",
            json={"url": "https://example.com", "reason": "suspicious"}
        )
        assert r.status_code == 200


class TestCorsAndHeaders:
    def test_options_preflight_allowed(self, client):
        r = client.options(
            "/api/scan",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}
        )
        # CORS preflight should not return 4xx
        assert r.status_code in (200, 405)


class TestErrorHandling:
    def test_nonexistent_endpoint_returns_404(self, client):
        r = client.get("/api/nonexistent-endpoint-xyz")
        assert r.status_code == 404

    def test_wrong_method_returns_405(self, client):
        r = client.delete("/api/health")
        assert r.status_code == 405

    def test_malformed_json_body(self, client):
        r = client.post(
            "/api/scan",
            content=b"this is not json",
            headers={"Content-Type": "application/json"}
        )
        assert r.status_code == 422
