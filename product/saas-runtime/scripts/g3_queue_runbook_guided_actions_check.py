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
    "x-actor": "queue-runbook-guided-actions-check",
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
                "goal": "Проверить guided runbook actions.",
                "expected_artifact": "Queue runbook guided action evidence artifact",
                "source_context": "SAAS-1169-RUNBOOK-ACTION..SAAS-1178-RUNBOOK-ACTION repeatable check",
                "urgency": "normal",
                **form_data,
            },
            "document_ids": ["doc-demo-001"],
        },
    )


def wait_for_queue_status(queue_id: str, statuses: set[str], timeout_seconds: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    last_item: dict | None = None
    while time.monotonic() < deadline:
        last_item = request_json(f"/api/task-runs/queue/{queue_id}")
        if last_item["status"] in statuses:
            return last_item
        time.sleep(0.25)
    raise RuntimeError(f"Queue item {queue_id} did not reach {statuses}. Last item: {last_item}")


def cleanup_runtime() -> None:
    request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "queue-runbook-guided-actions-check", "reason": "Reset scheduler before guided action proof.", "interval_seconds": 0.2},
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "queue-runbook-guided-actions-check", "reason": "Cleanup open DLQ before guided action proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "queue-runbook-guided-actions-check", "reason": "Cleanup DLQ before guided action proof.", "auto_process": True},
            )
    for _ in range(8):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "queue-runbook-guided-actions-check", "reason": "Cleanup active queue before guided action proof.", "interval_seconds": 0.2},
        )


def step_by_id(runbook: dict, step_id: str) -> dict:
    return next(step for step in runbook["steps"] if step["id"] == step_id)


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    queued_response = enqueue(
        auto_process=False,
        form_data={"runbook_guided_action_case": "scheduler_start_from_runbook"},
    )
    queue_id = queued_response["queue_item"]["id"]
    task_run_id = queued_response["task_run"]["id"]
    runbook_before = request_json("/api/task-runs/queue/operations-runbook")
    start_step = step_by_id(runbook_before, "runbook-queue-stopped")

    start_action = request_json(
        "/api/task-runs/queue/operations-runbook/actions/runbook-queue-stopped",
        "POST",
        {
            "actor": "queue-runbook-guided-actions-check",
            "reason": "Start scheduler from guided runbook proof.",
            "interval_seconds": 0.2,
        },
    )
    completed_item = wait_for_queue_status(queue_id, {"completed"})
    scheduler_after_start = request_json("/api/task-runs/queue/scheduler/status")

    review_only_action = request_json(
        "/api/task-runs/queue/operations-runbook/actions/runbook-dlq-open",
        "POST",
        {
            "actor": "queue-runbook-guided-actions-check",
            "reason": "Verify review-only runbook step is not auto-executed.",
            "interval_seconds": 0.2,
        },
    )

    delivery_before = request_json("/api/task-runs/queue/notifications/status")
    notification_action = request_json(
        "/api/task-runs/queue/operations-runbook/actions/runbook-notification-failed",
        "POST",
        {
            "actor": "queue-runbook-guided-actions-check",
            "reason": "Dispatch local-log notifications from guided runbook proof.",
            "interval_seconds": 0.2,
        },
    )
    delivery_after = request_json("/api/task-runs/queue/notifications/status")

    stop_action = request_json(
        "/api/task-runs/queue/operations-runbook/actions/runbook-safe-stop",
        "POST",
        {
            "actor": "queue-runbook-guided-actions-check",
            "reason": "Stop scheduler from guided runbook proof.",
            "interval_seconds": 0.2,
        },
    )
    scheduler_after_stop = request_json("/api/task-runs/queue/scheduler/status")
    final_runbook = request_json("/api/task-runs/queue/operations-runbook")
    queue_status_after = request_json("/api/task-runs/queue/status")

    final_start_step = step_by_id(final_runbook, "runbook-queue-stopped")
    checks = {
        "runbook_step_has_executable_metadata": start_step["executable"] is True
        and start_step["action_kind"] == "start_scheduler"
        and bool(start_step["action_label"]),
        "start_action_completed": start_action["executed"] is True and start_action["status"] == "completed",
        "scheduler_processed_queue_item": completed_item["status"] == "completed"
        and completed_item["task_run_id"] == task_run_id,
        "review_only_step_not_auto_executed": review_only_action["executed"] is False
        and review_only_action["status"] == "review_required",
        "notification_dispatch_action_completed": notification_action["executed"] is True
        and notification_action["status"] == "completed",
        "notification_status_not_regressed": delivery_after["delivered"] >= delivery_before["delivered"]
        and delivery_after["status"] in {"normal", "warning", "critical"},
        "stop_action_completed": stop_action["executed"] is True and stop_action["status"] == "completed",
        "scheduler_stopped": scheduler_after_stop["running"] is False and scheduler_after_stop["status"] == "stopped",
        "runbook_returns_to_monitor": final_runbook["steps_needing_attention"] == 0
        and final_start_step["status"] == "ready",
        "queue_has_no_active_items_after_proof": queue_status_after["queued"] + queue_status_after["running"] + queue_status_after["retrying"] == 0,
        "action_gates_present": len(start_action["gates"]) >= 2 and len(stop_action["gates"]) >= 2,
        "local_only_scope_preserved": all(
            "production" not in gate["reason"].lower() or "not touched" in gate["reason"].lower()
            for gate in start_action["gates"] + notification_action["gates"] + stop_action["gates"]
        ),
    }
    evidence = {
        "task": "SAAS-1169-RUNBOOK-ACTION..SAAS-1178-RUNBOOK-ACTION",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_id": queue_id,
        "task_run_id": task_run_id,
        "runbook_before": runbook_before,
        "start_action": start_action,
        "scheduler_after_start": scheduler_after_start,
        "review_only_action": review_only_action,
        "notification_action": notification_action,
        "stop_action": stop_action,
        "scheduler_after_stop": scheduler_after_stop,
        "final_runbook": final_runbook,
        "queue_status_after": queue_status_after,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1178_QUEUE_RUNBOOK_GUIDED_ACTIONS_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
