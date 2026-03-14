import json
import os

manifest_path = "extension/manifest.json"

def check_manifest():
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)

    assert manifest.get("manifest_version") == 3, "manifest_version is not 3"
    assert "background" in manifest, "background missing"
    assert "service_worker" in manifest["background"], "background.service_worker missing"
    
    required_permissions = [
        "activeTab", "tabs", "storage", "webNavigation", 
        "declarativeNetRequest", "scripting", "notifications", "alarms"
    ]
    actual_permissions = manifest.get("permissions", [])
    for p in required_permissions:
        assert p in actual_permissions, f"Missing permission: {p}"

    csp = manifest.get("content_security_policy", {}).get("extension_pages", "")
    assert "unsafe-inline" not in csp, "CSP violation: unsafe-inline found"

    print("Manifest health check passed!")

if __name__ == "__main__":
    check_manifest()
