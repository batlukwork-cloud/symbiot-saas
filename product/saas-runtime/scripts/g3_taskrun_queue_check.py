from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8020").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "queue-check",
    "x-role": "runtime-operator",
    "x-department": "sales",
    "x-access-level": "standard",
}


def request_json(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path}: {error.code} {detail}") from error


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": True,
        "form_data": {
            "goal": "Проверить reliable queue layer.",
            "expected_artifact": "Reliable queue layer evidence artifact",
            "source_context": "SAAS-1019-QUEUE repeatable check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    task_run_id = queue_response["task_run"]["id"]
    artifact_id = queue_response["task_run"]["artifact_id"]
    queue_status = request_json("/api/task-runs/queue/status")
    task_run = request_json(f"/api/task-runs/{task_run_id}")
    result_center = request_json(f"/api/task-runs/{task_run_id}/result-center")
    runtime_evidence = request_json(f"/api/runtime/evidence/{task_run_id}")

    checks = {
        "queue_item_created": bool(queue_response["queue_item"]["id"]),
        "queue_processed": queue_response["processed"] is True,
        "queue_completed": queue_response["queue_item"]["status"] == "completed",
        "task_run_completed": task_run["status"] == "completed",
        "artifact_attached": bool(artifact_id),
        "result_center_ready": result_center["product_status"] == "ready_for_acceptance",
        "queue_status_exposed": queue_status["total"] >= 1 and "items" in queue_status,
        "runtime_evidence_exposed": runtime_evidence["task_run_id"] == task_run_id,
        "created_queue_not_failed": queue_response["queue_item"]["status"] != "failed",
    }
    evidence = {
        "task": "SAAS-1019-QUEUE..SAAS-1028-QUEUE",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_item_id": queue_response["queue_item"]["id"],
        "queue_item_status": queue_response["queue_item"]["status"],
        "task_run_id": task_run_id,
        "artifact_id": artifact_id,
        "queue_status": {
            "total": queue_status["total"],
            "queued": queue_status["queued"],
            "running": queue_status["running"],
            "retrying": queue_status["retrying"],
            "completed": queue_status["completed"],
            "failed": queue_status["failed"],
        },
        "result_center_status": result_center["product_status"],
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1028_QUEUE_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
