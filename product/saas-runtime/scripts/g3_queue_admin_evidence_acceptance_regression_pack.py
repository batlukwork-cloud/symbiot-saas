from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"

SCRIPTS = [
    "g3_queue_admin_evidence_acceptance_center_check.py",
    "g3_queue_admin_evidence_acceptance_batch_group_closure_check.py",
    "g3_queue_admin_evidence_acceptance_batch_item_decision_check.py",
    "g3_queue_admin_evidence_acceptance_batch_action_check.py",
    "g3_queue_admin_evidence_acceptance_batch_plan_check.py",
    "g3_queue_admin_evidence_acceptance_worklist_check.py",
    "g3_queue_admin_evidence_acceptance_summary_check.py",
    "g3_queue_admin_evidence_acceptance_actions_check.py",
    "g3_queue_admin_evidence_acceptance_checklist_check.py",
    "g3_queue_admin_evidence_package_check.py",
    "g3_queue_admin_evidence_workbench_check.py",
]


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    results = []
    for script in SCRIPTS:
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / script)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=120,
        )
        results.append(
            {
                "script": script,
                "returncode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
                "passed": completed.returncode == 0,
            }
        )
        if completed.returncode != 0:
            break

    passed = sum(1 for item in results if item["passed"])
    payload = {
        "id": "SAAS-1368-QUEUE_EVIDENCE_ACCEPTANCE_REGRESSION_PACK",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "scripts_total": len(SCRIPTS),
        "scripts_executed": len(results),
        "scripts_passed": passed,
        "status": "passed" if passed == len(SCRIPTS) else "failed",
        "results": results,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1368_QUEUE_EVIDENCE_ACCEPTANCE_REGRESSION_PACK_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "scripts": f"{passed}/{len(SCRIPTS)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
