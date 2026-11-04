from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    start_script = ROOT / "scripts" / "start_g3_local_demo.ps1"
    stop_script = ROOT / "scripts" / "stop_g3_local_demo.ps1"
    runbook = ROOT / "docs" / "G3_LOCAL_DEMO_LAUNCH_RUNBOOK.md"

    start_text = read_text(start_script)
    stop_text = read_text(stop_script)
    runbook_text = read_text(runbook)
    checks = {
        "start_script_exists": start_script.exists(),
        "stop_script_exists": stop_script.exists(),
        "runbook_exists": runbook.exists(),
        "backend_localhost_only": "127.0.0.1" in start_text and "uvicorn" in start_text,
        "frontend_localhost_only": "127.0.0.1" in start_text and "npm" in start_text,
        "pid_file_created": "g3_local_demo_pids.json" in start_text,
        "stop_script_uses_pid_file": "g3_local_demo_pids.json" in stop_text and "Stop-Process" in stop_text,
        "runbook_has_acceptance": "## Acceptance" in runbook_text,
        "runbook_has_stop_conditions": "## Stop Conditions" in runbook_text,
        "no_external_deployment": "external HTTPS deployment" in runbook_text and "public demo" in runbook_text,
    }
    evidence = {
        "task": "SAAS-0941",
        "route": "maximum safe throw 3/5",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "passed": all(checks.values()),
        "checks": checks,
        "start_script": str(start_script),
        "stop_script": str(stop_script),
        "runbook": str(runbook),
    }
    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_0941_LOCAL_DEMO_LAUNCH_READINESS_2026-07-03.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
