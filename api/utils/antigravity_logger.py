import os
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

LOG_FILE = Path(__file__).parent.parent / "data" / "antigravity.log"

def log_event(event_type: str, data: Dict[str, Any]):
    """Log an Antigravity event for metrics tracking."""
    event = {
        "timestamp": datetime.now().isoformat(),
        "type": event_type,
        "data": data
    }
    
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(event) + "\n")

def get_metrics_summary(days: int = 7) -> Dict[str, Any]:
    """Calculate summary metrics from the logs."""
    if not LOG_FILE.exists():
        return {
            "success_rate": 0.0,
            "avg_latency": 0,
            "total_events": 0,
            "features": {}
        }

    events = []
    with open(LOG_FILE, "r") as f:
        for line in f:
            try:
                events.append(json.loads(line))
            except:
                continue

    # Simple aggregation
    total = len(events)
    if total == 0:
        return {"success_rate": 0, "avg_latency": 0, "total_events": 0}

    latencies = [e["data"].get("latency_ms", 0) for e in events if "latency_ms" in e["data"]]
    successes = [e for e in events if e["data"].get("success") is True]
    
    # Feature breakdown
    features = {}
    for e in events:
        feat = e["data"].get("feature", "unknown")
        if feat not in features:
            features[feat] = {"total": 0, "success": 0}
        features[feat]["total"] += 1
        if e["data"].get("success"):
            features[feat]["success"] += 1

    return {
        "success_rate": round((len(successes) / total) * 100, 1),
        "avg_latency": round(sum(latencies) / len(latencies)) if latencies else 0,
        "total_events": total,
        "features": features
    }
