"""
ScamDefy Antigravity — Master Test Runner
==========================================
Run from the project root:
    python antigravity/runner.py

Or from inside the antigravity/ folder:
    python runner.py

Outputs:
  • Coloured terminal summary (PASS / PARTIAL / FAIL)
  • antigravity/report.json
"""

import subprocess
import sys
import os
import json
import time
from datetime import datetime, timezone
from pathlib import Path

# ─── Paths ───────────────────────────────────────────────────
ROOT_DIR  = Path(__file__).parent.parent
API_DIR   = ROOT_DIR / "api"
TESTS_DIR = API_DIR / "tests"
REPORT_PATH = Path(__file__).parent / "report.json"

# ─── ANSI colours ────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
DIM    = "\033[2m"

def c(text: str, colour: str) -> str:
    return f"{colour}{text}{RESET}"


# ─── Test suites ─────────────────────────────────────────────
SUITES = [
    {
        "id":       "url_detection",
        "label":    "URL Detection",
        "file":     "test_url_scan.py",
        "critical": True,
    },
    {
        "id":       "message_detection",
        "label":    "Message Detection",
        "file":     "test_message.py",
        "critical": True,
    },
    {
        "id":       "voice_detection",
        "label":    "Voice Detection",
        "file":     "test_voice.py",
        "critical": True,
    },
    {
        "id":       "api_integration",
        "label":    "API Integration",
        "file":     "test_api_health.py",
        "critical": True,
    },
    {
        "id":       "e2e_flows",
        "label":    "E2E User Flows",
        "file":     "automated_flows.py",
        "critical": True,
        "type":     "script"
    },
]


def run_suite(suite: dict) -> dict:
    if suite.get("type") == "script":
        return run_script_suite(suite)

    test_file = TESTS_DIR / suite["file"]
    if not test_file.exists():
        return {
            "id": suite["id"], "label": suite["label"],
            "status": "SKIP", "passed": 0, "failed": 0, "total": 0,
            "duration_s": 0, "error": f"Test file not found: {test_file}",
        }

    result_json_path = Path(__file__).parent / f"_result_{suite['id']}.json"
    cmd = [
        sys.executable, "-m", "pytest",
        str(test_file),
        "--tb=short",
        "--quiet",
        f"--json-report",
        f"--json-report-file={result_json_path}",
        "--override-ini=asyncio_mode=auto",
        "-x",    # stop on first failure within suite (but continue across suites)
    ]

    t0 = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(API_DIR),
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(API_DIR)},
    )
    duration = round(time.time() - t0, 2)

    # Parse pytest-json-report if available, else fall back to return code
    passed = failed = total = 0
    details = []

    if result_json_path.exists():
        try:
            report = json.loads(result_json_path.read_text())
            passed  = report.get("summary", {}).get("passed",  0)
            failed  = report.get("summary", {}).get("failed",  0)
            errors  = report.get("summary", {}).get("errors",  0)
            total   = report.get("summary", {}).get("total",   0)
            failed += errors
            for test in report.get("tests", []):
                details.append({
                    "name":    test.get("nodeid", "").split("::")[-1],
                    "outcome": test.get("outcome", "unknown"),
                })
            result_json_path.unlink(missing_ok=True)
        except Exception:
            pass
    else:
        # Fallback: parse stdout
        for line in proc.stdout.splitlines():
            if " passed" in line or " failed" in line:
                import re
                mp = re.search(r"(\d+) passed", line)
                mf = re.search(r"(\d+) failed", line)
                if mp:
                    passed = int(mp.group(1))
                if mf:
                    failed = int(mf.group(1))
                total = passed + failed

    # Determine status
    if total == 0:
        status = "SKIP"
    elif failed == 0:
        status = "PASS"
    elif passed / max(total, 1) >= 0.70:
        status = "PARTIAL"
    else:
        status = "FAIL"

    return {
        "id":         suite["id"],
        "label":      suite["label"],
        "status":     status,
        "passed":     passed,
        "failed":     failed,
        "total":      total,
        "duration_s": duration,
        "stdout":     proc.stdout[-2000:] if proc.stdout else "",
        "stderr":     proc.stderr[-500:]  if proc.stderr else "",
        "details":    details,
    }


def run_script_suite(suite: dict) -> dict:
    """Run a custom python script and parse its output."""
    script_path = Path(__file__).parent / suite["file"]
    if not script_path.exists():
        return {
            "id": suite["id"], "label": suite["label"],
            "status": "SKIP", "passed": 0, "failed": 0, "total": 0,
            "duration_s": 0, "error": f"Script not found: {script_path}",
        }

    t0 = time.time()
    proc = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).parent)
    )
    duration = round(time.time() - t0, 2)

    passed = failed = total = 0
    details = []

    # Try to parse e2e_results.json if generated
    results_json = Path(__file__).parent / "e2e_results.json"
    if results_json.exists():
        try:
            data = json.loads(results_json.read_text())
            passed = data.get("passed", 0)
            failed = data.get("failed", 0)
            total  = data.get("total", 0)
            for res in data.get("results", []):
                details.append({
                    "name": res["name"],
                    "outcome": "passed" if res["status"] == "PASS" else "failed"
                })
            results_json.unlink(missing_ok=True)
        except Exception:
            pass
    
    if total == 0:
        # Fallback if no JSON
        status = "PASS" if proc.returncode == 0 else "FAIL"
    else:
        status = "PASS" if failed == 0 else "PARTIAL" if passed / total >= 0.7 else "FAIL"

    return {
        "id":         suite["id"],
        "label":      suite["label"],
        "status":     status,
        "passed":     passed,
        "failed":     failed,
        "total":      total,
        "duration_s": duration,
        "stdout":     proc.stdout[-2000:] if proc.stdout else "",
        "stderr":     proc.stderr[-500:]  if proc.stderr else "",
        "details":    details,
    }


STATUS_ICONS = {
    "PASS":    "[PASS]",
    "PARTIAL": "[PARTIAL]",
    "FAIL":    "[FAIL]",
    "SKIP":    "[SKIP]",
}
STATUS_COLOURS = {
    "PASS":    GREEN,
    "PARTIAL": YELLOW,
    "FAIL":    RED,
    "SKIP":    DIM,
}


def print_header():
    print()
    print(c("  +------------------------------------------+", CYAN))
    print(c("  |        ANTIGRAVITY // SCANNER E2E        |", CYAN + BOLD))
    print(c("  +------------------------------------------+", CYAN))
    print(c(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", DIM))
    print()


def print_suite_result(res: dict):
    status    = res["status"]
    icon      = STATUS_ICONS.get(status, status)
    colour    = STATUS_COLOURS.get(status, RESET)
    label     = res["label"]
    p, f, t   = res["passed"], res["failed"], res["total"]
    dur       = res["duration_s"]

    line = f"  {label:<22} >>  {c(icon, colour)}   ({p}/{t} tests)  {c(f'{dur}s', DIM)}"
    print(line)

    # Print failed test names
    for d in res.get("details", []):
        if d["outcome"] != "passed":
            print(c(f"        x {d['name']}", RED))


def print_summary(results: list):
    print()
    print(c("  -- Summary ----------------------------------", CYAN))
    passed_suites  = sum(1 for r in results if r["status"] == "PASS")
    total_tests    = sum(r["total"]  for r in results)
    passed_tests   = sum(r["passed"] for r in results)
    failed_tests   = sum(r["failed"] for r in results)
    success_rate   = (passed_tests / max(total_tests, 1)) * 100

    print(f"  Suites   : {passed_suites}/{len(results)} passed")
    print(f"  Tests    : {c(str(passed_tests), GREEN)} passed  "
          f"{c(str(failed_tests), RED if failed_tests else GREEN)} failed  "
          f"/ {total_tests} total")

    rate_colour = GREEN if success_rate >= 95 else YELLOW if success_rate >= 70 else RED
    print(f"  Success  : {c(f'{success_rate:.1f}%', rate_colour)}  "
          f"(target >= 95%)")

    overall = "PASS" if success_rate >= 95 else "PARTIAL" if success_rate >= 70 else "FAIL"
    ov_col  = STATUS_COLOURS[overall]
    print(f"\n  Overall  : {c(BOLD + STATUS_ICONS[overall], ov_col)}")
    print()

    if failed_tests > 0:
        print(c("  Priority Fixes:", YELLOW))
        for r in results:
            if r["status"] == "FAIL":
                print(c(f"  [!] {r['label']} - critical failures", RED))
            elif r["status"] == "PARTIAL":
                print(c(f"  [-] {r['label']} - partial failures ({r['failed']} tests)", YELLOW))
        print()


def save_report(results: list):
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "suites":        results,
        "summary": {
            "total_tests":  sum(r["total"]  for r in results),
            "passed_tests": sum(r["passed"] for r in results),
            "failed_tests": sum(r["failed"] for r in results),
            "success_rate": round(
                sum(r["passed"] for r in results) /
                max(sum(r["total"] for r in results), 1) * 100, 1
            ),
        },
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2))
    print(c(f"  Report saved >> {REPORT_PATH}", DIM))


def check_dependencies():
    """Install pytest-json-report if missing."""
    try:
        import pytest_jsonreport  # noqa
    except ImportError:
        print(c("  Installing pytest-json-report...", DIM))
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "pytest-json-report", "-q"],
            check=False
        )


def main():
    print_header()
    check_dependencies()

    all_results = []
    for suite in SUITES:
        print(c(f"  Running: {suite['label']}...", DIM), end="\r", flush=True)
        res = run_suite(suite)
        print_suite_result(res)
        all_results.append(res)

    print_summary(all_results)
    save_report(all_results)

    # Exit code
    any_fail = any(r["status"] == "FAIL" for r in all_results)
    sys.exit(1 if any_fail else 0)


if __name__ == "__main__":
    main()
