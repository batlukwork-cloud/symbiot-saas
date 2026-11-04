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
    "x-actor": "dead-letter-queue-check",
    "x-role": "runtime-operator",
    "x-department": "sales",
    "x-access-level": "standard",
}


def request_json(path: str, method: str = "GET", payload: dict | None = None) -> dict | list:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
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
        "max_attempts": 1,
        "timeout_seconds": 30,
        "auto_process": False,
        "form_data": {
            "goal": "Проверить Dead Letter Queue.",
            "expected_artifact": "DLQ evidence artifact",
            "source_context": "SAAS-1059-DLQ..SAAS-1068-DLQ repeatable check",
            "urgency": "normal",
            "simulate_worker_failure_attempts": 1,
        },
        "document_ids": ["doc-demo-001"],
    }
    queued_response = request_json("/api/task-runs/queue", "POST", payload)
    queue_id = queued_response["queue_item"]["id"]
    task_run_id = queued_response["task_run"]["id"]
    request_json("/api/task-runs/queue/process-next", "POST")
    failed_item = request_json(f"/api/task-runs/queue/{queue_id}")
    dlq_status_after_failure = request_json("/api/task-runs/queue/dead-letters")
    matching_items = [item for item in dlq_status_after_failure["items"] if item["queue_id"] == queue_id]
    if not matching_items:
        raise RuntimeError(f"DLQ item for {queue_id} was not created.")
    dead_letter = matching_items[0]
    dead_letter_detail = request_json(f"/api/task-runs/queue/dead-letters/{dead_letter['id']}")
    acknowledged = request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {
            "actor": "dead-letter-queue-check",
            "reason": "Validate admin acknowledgement before manual retry.",
        },
    )
    manual_retry = request_json(
        f"/api/task-runs/queue/{queue_id}/retry",
        "POST",
        {
            "actor": "dead-letter-queue-check",
            "reason": "Validate manual retry resolves DLQ after root cause is controlled.",
            "auto_process": True,
        },
    )
    resolved_detail = request_json(f"/api/task-runs/queue/dead-letters/{dead_letter['id']}")
    dlq_status_after_retry = request_json("/api/task-runs/queue/dead-letters")
    observability = request_json("/api/task-runs/queue/observability")
    queue_events = request_json(f"/api/task-runs/queue/{queue_id}/events")
    event_types = [event["event_type"] for event in queue_events]
    result_center = request_json(f"/api/task-runs/{task_run_id}/result-center")

    checks = {
        "failed_item_created": failed_item["status"] == "failed",
        "dead_letter_created": dead_letter["status"] == "open",
        "dead_letter_detail_matches_queue": dead_letter_detail["queue_id"] == queue_id,
        "acknowledge_changes_status": acknowledged["item"]["status"] == "acknowledged",
        "manual_retry_completes_queue_item": manual_retry["queue_item"]["status"] == "completed",
        "manual_retry_resolves_dead_letter": resolved_detail["status"] == "resolved",
        "events_include_dead_lettered": "dead_lettered" in event_types,
        "events_include_acknowledged": "dead_letter_acknowledged" in event_types,
        "events_include_resolved": "dead_letter_resolved" in event_types,
        "result_center_ready_after_resolution": result_center["product_status"] == "ready_for_acceptance",
    }
    evidence = {
        "task": "SAAS-1059-DLQ..SAAS-1068-DLQ",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_id": queue_id,
        "task_run_id": task_run_id,
        "dead_letter_id": dead_letter["id"],
        "failed_item": failed_item,
        "dead_letter_after_failure": dead_letter,
        "acknowledged_item": acknowledged["item"],
        "manual_retry_status": manual_retry["queue_item"]["status"],
        "resolved_item": resolved_detail,
        "dlq_totals_after_retry": {
            "total": dlq_status_after_retry["total"],
            "open": dlq_status_after_retry["open"],
            "acknowledged": dlq_status_after_retry["acknowledged"],
            "resolved": dlq_status_after_retry["resolved"],
        },
        "observability_health_after_resolution": observability["health"],
        "event_types_for_queue": event_types,
        "result_center_status": result_center["product_status"],
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1068_DEAD_LETTER_QUEUE_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
