import os
import httpx
import time
import json
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger("AntigravityFlows")

BASE_URL = "http://127.0.0.1:8000"

def run_flow(name, func):
    logger.info(f">> STARTING FLOW: {name}")
    t0 = time.time()
    try:
        result = func()
        duration = round(time.time() - t0, 3)
        logger.info(f"[PASS] FLOW: {name} ({duration}s)")
        return {"name": name, "status": "PASS", "duration": duration, "result": result}
    except Exception as e:
        duration = round(time.time() - t0, 3)
        logger.error(f"[FAIL] FLOW: {name} ({duration}s) - {str(e)}")
        return {"name": name, "status": "FAIL", "duration": duration, "error": str(e)}

# --- URL Flow --------------------------------------------------------------

def flow_url_scan_phishing():
    """Simulate scanning a known phishing URL."""
    url = "http://scamdefy-test-block.com"
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        resp = client.post("/api/scan", json={"url": url})
        resp.raise_for_status()
        data = resp.json()
        
        # Validation
        if data["verdict"] != "BLOCKED":
            raise ValueError(f"Expected BLOCKED verdict for {url}, got {data['verdict']}")
        if data["score"] < 80:
            raise ValueError(f"Score {data['score']} too low for binary block test")
        
        return data

def flow_url_scan_safe():
    """Simulate scanning a safe URL."""
    url = "https://www.google.com"
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        resp = client.post("/api/scan", json={"url": url})
        resp.raise_for_status()
        data = resp.json()
        
        # Validation
        if data["verdict"] == "BLOCKED":
            raise ValueError(f"False positive: {url} was blocked")
        
        return data

# --- Message Flow -----------------------------------------------------------

def flow_message_scam():
    """Simulate analyzing a scam SMS."""
    text = "Your bank account has been suspended. Click here to verify: http://evil.com"
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        resp = client.post("/api/analyze-message", json={"text": text})
        resp.raise_for_status()
        data = resp.json()
        
        # Validation
        if data["risk_level"] not in ["HIGH", "CRITICAL"]:
            raise ValueError(f"Expected HIGH/CRITICAL risk for scam message, got {data['risk_level']}")
        
        return data

# --- Voice Flow ------------------------------------------------------------

def flow_voice_analyze():
    """Simulate uploading a voice sample for AI detection."""
    # We'll use the fake.mp3 if it exists or generate a small blob
    import os
    fake_path = os.path.join(os.path.dirname(__file__), "..", "api", "fake.mp3")
    
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as client:
        with open(fake_path, "rb") as f:
            files = {"audio": ("fake.mp3", f, "audio/mpeg")}
            resp = client.post("/api/voice/analyze", files=files)
            resp.raise_for_status()
            data = resp.json()
            
            # Validation
            if "verdict" not in data:
                raise ValueError("Response missing 'verdict' field")
            
            return data

# --- Master Runner ----------------------------------------------------------

def run_all_flows():
    flows = [
        ("URL Phishing Scan", flow_url_scan_phishing),
        ("URL Safe Scan", flow_url_scan_safe),
        ("Message Scam Analysis", flow_message_scam),
        ("Voice AI Detection", flow_voice_analyze),
    ]
    
    results = []
    for name, func in flows:
        results.append(run_flow(name, func))
    
    # Export summary for Antigravity dashboard
    summary = {
        "timestamp": datetime.now().isoformat(),
        "total": len(results),
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
        "results": results
    }
    
    with open(os.path.join(os.path.dirname(__file__), "e2e_results.json"), "w") as f:
        json.dump(summary, f, indent=2)
    
    return summary

if __name__ == "__main__":
    run_all_flows()
