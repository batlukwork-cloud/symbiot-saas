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
    "x-actor": "queue-hardening-check",
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
        "auto_process": False,
        "form_data": {
            "goal": "Проверить отмену, повтор и журнал событий очереди.",
            "expected_artifact": "Queue hardening evidence artifact",
            "source_context": "SAAS-1029-QUEUE..SAAS-1038-QUEUE repeatable check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    queue_id = queue_response["queue_item"]["id"]
    task_run_id = queue_response["task_run"]["id"]
    cancel_response = request_json(
        f"/api/task-runs/queue/{queue_id}/cancel",
        "POST",
        {
            "actor": "queue-hardening-check",
            "reason": "Repeatable check validates manual cancel.",
            "auto_process": False,
        },
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{queue_id}/retry",
        "POST",
        {
            "actor": "queue-hardening-check",
            "reason": "Repeatable check validates manual retry.",
            "auto_process": True,
        },
    )
    recovery_status = request_json("/api/task-runs/queue/recover-stale?max_age_seconds=1", "POST")
    queue_status = request_json("/api/task-runs/queue/status")
    task_run = request_json(f"/api/task-runs/{task_run_id}")
    result_center = request_json(f"/api/task-runs/{task_run_id}/result-center")
    queue_events = request_json(f"/api/task-runs/queue/{queue_id}/events")
    event_types = [event["event_type"] for event in queue_events]

    checks = {
        "queued_without_auto_process": queue_response["queue_item"]["status"] == "queued",
        "manual_cancel_recorded": cancel_response["queue_item"]["status"] == "cancelled",
        "manual_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "task_run_completed_after_retry": task_run["status"] == "completed",
        "result_center_ready": result_center["product_status"] == "ready_for_acceptance",
        "event_log_has_enqueued": "enqueued" in event_types,
        "event_log_has_cancelled": "cancelled" in event_types,
        "event_log_has_manual_retry": "manual_retry" in event_types,
        "event_log_has_completed": "completed" in event_types,
        "stale_recovery_endpoint_available": recovery_status["mode"] == "sqlite_mvp_queue",
    }
    evidence = {
        "task": "SAAS-1029-QUEUE..SAAS-1038-QUEUE",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_id": queue_id,
        "task_run_id": task_run_id,
        "artifact_id": task_run["artifact_id"],
        "queue_item_status": retry_response["queue_item"]["status"],
        "queue_status": {
            "total": queue_status["total"],
            "queued": queue_status["queued"],
            "running": queue_status["running"],
            "retrying": queue_status["retrying"],
            "completed": queue_status["completed"],
            "failed": queue_status["failed"],
            "cancelled": queue_status["cancelled"],
            "events_returned": len(queue_status.get("events", [])),
        },
        "event_types_for_queue": event_types,
        "result_center_status": result_center["product_status"],
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1038_QUEUE_HARDENING_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
