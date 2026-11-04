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
    "x-actor": "admin-runbook-ux-check",
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
                "goal": "Проверить Admin Runbook UX Refinement.",
                "expected_artifact": "Admin runbook UX refinement evidence artifact",
                "source_context": "SAAS-1139-RUNBOOK-UX..SAAS-1148-RUNBOOK-UX repeatable check",
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
        {"actor": "admin-runbook-ux-check", "reason": "Reset scheduler before UX proof.", "interval_seconds": 0.2},
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "admin-runbook-ux-check", "reason": "Cleanup open DLQ before UX proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "admin-runbook-ux-check", "reason": "Cleanup DLQ before UX proof.", "auto_process": True},
            )
    for _ in range(6):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "admin-runbook-ux-check", "reason": "Cleanup active queue before UX proof.", "interval_seconds": 0.2},
        )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    baseline = request_json("/api/task-runs/queue/operations-runbook")

    backlog_response = enqueue(auto_process=False, form_data={"runbook_ux_case": "operator_action"})
    backlog_queue_id = backlog_response["queue_item"]["id"]
    backlog_runbook = request_json("/api/task-runs/queue/operations-runbook")
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "admin-runbook-ux-check", "reason": "Clear backlog after UX proof.", "interval_seconds": 0.2},
    )

    dlq_response = enqueue(
        auto_process=True,
        form_data={"runbook_ux_case": "emergency_stop", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    dlq_queue_id = dlq_response["queue_item"]["id"]
    dlq_runbook = request_json("/api/task-runs/queue/operations-runbook")

    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == dlq_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "admin-runbook-ux-check", "reason": "Acknowledge UX proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{dlq_queue_id}/retry",
        "POST",
        {"actor": "admin-runbook-ux-check", "reason": "Resolve UX proof incident.", "auto_process": True},
    )
    final_runbook = request_json("/api/task-runs/queue/operations-runbook")

    checks = {
        "baseline_monitor_mode": baseline["status"] == "normal"
        and baseline["response_mode"] == "monitor"
        and baseline["priority_step_ids"] == [],
        "baseline_primary_action_human_readable": "мониторинг" in baseline["primary_action"].lower(),
        "backlog_operator_action_mode": backlog_runbook["status"] == "warning"
        and backlog_runbook["response_mode"] == "operator_action",
        "backlog_priority_has_queue_stopped_first": backlog_runbook["priority_step_ids"][0] == "runbook-queue-stopped",
        "backlog_primary_action_mentions_scheduler": "scheduler" in backlog_runbook["primary_action"].lower(),
        "dlq_emergency_stop_mode": dlq_runbook["status"] == "critical"
        and dlq_runbook["response_mode"] == "emergency_stop"
        and dlq_runbook["emergency_stop_required"] is True,
        "dlq_priority_has_critical_first": dlq_runbook["priority_step_ids"][0] in {"runbook-dlq-open", "runbook-critical-alert"},
        "dlq_primary_action_is_manual_resolution": "dlq" in dlq_runbook["primary_action"].lower()
        or "critical" in dlq_runbook["primary_action"].lower()
        or "владельца" in dlq_runbook["primary_action"].lower(),
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_runbook_returns_monitor": final_runbook["status"] == "normal"
        and final_runbook["response_mode"] == "monitor"
        and final_runbook["steps_needing_attention"] == 0,
    }
    evidence = {
        "task": "SAAS-1139-RUNBOOK-UX..SAAS-1148-RUNBOOK-UX",
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
            "response_mode": final_runbook["response_mode"],
            "priority_step_ids": final_runbook["priority_step_ids"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1148_ADMIN_RUNBOOK_UX_REFINEMENT_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
