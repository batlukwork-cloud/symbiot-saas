from __future__ import annotations

import json
import os
import time
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
    "x-actor": "persistent-worker-scheduler-check",
    "x-role": "admin",
    "x-department": "management",
    "x-access-level": "admin",
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


def wait_for_queue_status(queue_id: str, statuses: set[str], timeout_seconds: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    last_item: dict | None = None
    while time.monotonic() < deadline:
        last_item = request_json(f"/api/task-runs/queue/{queue_id}")
        if last_item["status"] in statuses:
            return last_item
        time.sleep(0.25)
    raise RuntimeError(f"Queue item {queue_id} did not reach {statuses}. Last item: {last_item}")


def enqueue(auto_process: bool, form_data: dict, max_attempts: int = 2) -> dict:
    return request_json(
        "/api/task-runs/queue",
        "POST",
        {
            "process_id": "commercial-proposal",
            "profile_id": "demo-tenant-working",
            "max_attempts": max_attempts,
            "timeout_seconds": 30,
            "auto_process": auto_process,
            "form_data": {
                "goal": "Проверить Persistent Worker Scheduler.",
                "expected_artifact": "Scheduler evidence artifact",
                "source_context": "SAAS-1069-SCHED..SAAS-1078-SCHED repeatable check",
                "urgency": "normal",
                **form_data,
            },
            "document_ids": ["doc-demo-001"],
        },
    )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "persistent-worker-scheduler-check", "reason": "Reset scheduler before proof.", "interval_seconds": 0.2},
    )
    scheduler_before = request_json("/api/task-runs/queue/scheduler/status")
    processed_before = int(scheduler_before["processed_total"])
    errors_before = int(scheduler_before["error_total"])
    scheduler_started = request_json(
        "/api/task-runs/queue/scheduler/start",
        "POST",
        {"actor": "persistent-worker-scheduler-check", "reason": "Start persistent scheduler proof.", "interval_seconds": 0.2},
    )

    queued_response = enqueue(
        auto_process=False,
        form_data={"scheduler_case": "complete_without_manual_process_next"},
    )
    queue_id = queued_response["queue_item"]["id"]
    task_run_id = queued_response["task_run"]["id"]
    completed_item = wait_for_queue_status(queue_id, {"completed"})
    result_center = request_json(f"/api/task-runs/{task_run_id}/result-center")
    events = request_json(f"/api/task-runs/queue/{queue_id}/events")

    failed_response = enqueue(
        auto_process=False,
        form_data={"scheduler_case": "dead_letter_without_manual_process_next", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = failed_response["queue_item"]["id"]
    failed_task_run_id = failed_response["task_run"]["id"]
    failed_item = wait_for_queue_status(failed_queue_id, {"failed"})
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    matching_dead_letters = [item for item in dead_letters["items"] if item["queue_id"] == failed_queue_id]
    if not matching_dead_letters:
        raise RuntimeError(f"Scheduler did not create a DLQ item for {failed_queue_id}.")
    dead_letter = matching_dead_letters[0]

    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {
            "actor": "persistent-worker-scheduler-check",
            "reason": "Clean scheduler DLQ proof item after terminal failure.",
            "auto_process": True,
        },
    )
    resolved_dead_letter = request_json(f"/api/task-runs/queue/dead-letters/{dead_letter['id']}")
    scheduler_stopped = request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "persistent-worker-scheduler-check", "reason": "Stop after proof.", "interval_seconds": 0.2},
    )
    scheduler_after = request_json("/api/task-runs/queue/scheduler/status")
    queue_status_after = request_json("/api/task-runs/queue/status")
    observability = request_json("/api/task-runs/queue/observability")

    event_types = [event["event_type"] for event in events]
    checks = {
        "scheduler_started_running": scheduler_started["running"] is True and scheduler_started["status"] == "running",
        "queued_item_was_not_auto_processed_on_enqueue": queued_response["processed"] is False,
        "scheduler_completed_item_without_process_next": completed_item["status"] == "completed",
        "events_show_scheduler_actor": any(event["actor"] == "worker-scheduler" for event in events),
        "result_center_ready": result_center["product_status"] == "ready_for_acceptance",
        "scheduler_processed_counter_increased": int(scheduler_after["processed_total"]) > processed_before,
        "scheduler_has_heartbeat_and_tick": bool(scheduler_after["heartbeat_at"]) and bool(scheduler_after["last_tick_at"]),
        "scheduler_created_dlq_for_terminal_failure": failed_item["status"] == "failed" and dead_letter["status"] in {"open", "acknowledged", "resolved"},
        "cleanup_retry_resolved_dlq": retry_response["queue_item"]["status"] == "completed" and resolved_dead_letter["status"] == "resolved",
        "scheduler_stops_safely": scheduler_stopped["running"] is False and scheduler_after["status"] == "stopped",
        "queue_has_no_active_items_after_proof": queue_status_after["queued"] + queue_status_after["running"] + queue_status_after["retrying"] == 0,
        "scheduler_errors_not_increased": int(scheduler_after["error_total"]) == errors_before,
    }
    evidence = {
        "task": "SAAS-1069-SCHED..SAAS-1078-SCHED",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "completed_queue_id": queue_id,
        "completed_task_run_id": task_run_id,
        "failed_queue_id": failed_queue_id,
        "failed_task_run_id": failed_task_run_id,
        "dead_letter_id": dead_letter["id"],
        "scheduler_before": scheduler_before,
        "scheduler_started": scheduler_started,
        "scheduler_after": scheduler_after,
        "queue_status_after": queue_status_after,
        "observability_health_after_proof": observability["health"],
        "completed_item": completed_item,
        "failed_item": failed_item,
        "event_types_for_completed_item": event_types,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1078_PERSISTENT_WORKER_SCHEDULER_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
