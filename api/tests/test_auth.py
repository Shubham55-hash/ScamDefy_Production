"""
test_auth.py — Login route user-store tests
"""
import json


def test_login_rejects_when_user_store_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_USERS_FILE", str(tmp_path / "missing.json"))
    r = client.post("/api/auth/login", json={"email": "admin@scamdefy.io", "password": "admin123"})
    assert r.status_code == 401


def test_login_uses_auth_users_file_override(client, monkeypatch, tmp_path):
    users_file = tmp_path / "users.json"
    users_file.write_text(json.dumps({
        "ops@example.com": {"password": "s3cret-pass", "name": "Ops", "role": "ADMIN"}
    }))
    monkeypatch.setenv("AUTH_USERS_FILE", str(users_file))

    ok = client.post("/api/auth/login", json={"email": "Ops@Example.com ", "password": "s3cret-pass"})
    assert ok.status_code == 200
    assert ok.json()["user"]["role"] == "ADMIN"

    bad = client.post("/api/auth/login", json={"email": "ops@example.com", "password": "wrong"})
    assert bad.status_code == 401

    default_admin = client.post("/api/auth/login", json={"email": "admin@scamdefy.io", "password": "admin123"})
    assert default_admin.status_code == 401
