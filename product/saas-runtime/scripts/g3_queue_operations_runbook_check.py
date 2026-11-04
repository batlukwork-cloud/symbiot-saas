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
    "x-actor": "queue-runbook-check",
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
                "goal": "Проверить Queue Operations Runbook.",
                "expected_artifact": "Queue operations runbook evidence artifact",
                "source_context": "SAAS-1129-RUNBOOK..SAAS-1138-RUNBOOK repeatable check",
                "urgency": "normal",
                **form_data,
            },
            "document_ids": ["doc-demo-001"],
        },
    )


def cleanup_runtime() -> None:
    request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "queue-runbook-check", "reason": "Reset scheduler before runbook proof.", "interval_seconds": 0.2},
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "queue-runbook-check", "reason": "Cleanup open DLQ before runbook proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "queue-runbook-check", "reason": "Cleanup DLQ before runbook proof.", "auto_process": True},
            )
    for _ in range(6):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "queue-runbook-check", "reason": "Cleanup active queue before runbook proof.", "interval_seconds": 0.2},
        )


def step_by_id(runbook: dict, step_id: str) -> dict:
    return next(step for step in runbook["steps"] if step["id"] == step_id)


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    baseline = request_json("/api/task-runs/queue/operations-runbook")
    routes = request_json("/api/task-runs/queue/notifications/routing")

    backlog_response = enqueue(auto_process=False, form_data={"runbook_case": "scheduler_stopped_with_backlog"})
    backlog_queue_id = backlog_response["queue_item"]["id"]
    backlog_runbook = request_json("/api/task-runs/queue/operations-runbook")
    backlog_step = step_by_id(backlog_runbook, "runbook-queue-stopped")
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "queue-runbook-check", "reason": "Clear backlog after runbook proof.", "interval_seconds": 0.2},
    )

    dlq_response = enqueue(
        auto_process=True,
        form_data={"runbook_case": "dlq_manual_review", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    dlq_queue_id = dlq_response["queue_item"]["id"]
    dlq_runbook = request_json("/api/task-runs/queue/operations-runbook")
    dlq_step = step_by_id(dlq_runbook, "runbook-dlq-open")
    critical_step = step_by_id(dlq_runbook, "runbook-critical-alert")

    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == dlq_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "queue-runbook-check", "reason": "Acknowledge runbook proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{dlq_queue_id}/retry",
        "POST",
        {"actor": "queue-runbook-check", "reason": "Resolve runbook proof incident.", "auto_process": True},
    )
    final_runbook = request_json("/api/task-runs/queue/operations-runbook")
    final_alert_center = request_json("/api/task-runs/queue/admin-alerts")
    final_delivery = request_json("/api/task-runs/queue/notifications/status")

    checks = {
        "baseline_has_steps": baseline["steps_total"] >= 8 and len(baseline["steps"]) == baseline["steps_total"],
        "baseline_has_evidence_and_endpoints": all(step["evidence_source"] and step["action"] for step in baseline["steps"]),
        "baseline_has_required_gate_evidence": len(baseline["gates"]) >= 2,
        "routing_available_for_runbook": routes["status"] == "normal" and routes["active_routes"] >= 2,
        "backlog_step_detected": backlog_step["status"] == "needs_attention" and backlog_step["owner_role"] == "runtime-operator",
        "backlog_step_has_scheduler_endpoint": backlog_step["endpoint"] == "/api/task-runs/queue/scheduler/start",
        "dlq_step_detected": dlq_step["status"] == "needs_attention" and dlq_step["severity"] == "critical",
        "critical_alert_step_detected": critical_step["status"] == "needs_attention",
        "emergency_stop_on_critical": dlq_runbook["emergency_stop_required"] is True and dlq_runbook["status"] == "critical",
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_runtime_normal": final_runbook["status"] == "normal"
        and final_alert_center["status"] == "normal"
        and final_delivery["failed"] == 0,
    }
    evidence = {
        "task": "SAAS-1129-RUNBOOK..SAAS-1138-RUNBOOK",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "backlog_queue_id": backlog_queue_id,
        "dlq_queue_id": dlq_queue_id,
        "dead_letter_id": dead_letter["id"],
        "baseline": baseline,
        "backlog_runbook": backlog_runbook,
        "dlq_runbook": dlq_runbook,
        "final": {
            "runbook_status": final_runbook["status"],
            "runbook_steps_needing_attention": final_runbook["steps_needing_attention"],
            "alert_center_status": final_alert_center["status"],
            "delivery_status": final_delivery["status"],
            "delivery_failed": final_delivery["failed"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1138_QUEUE_OPERATIONS_RUNBOOK_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
