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
    "x-actor": "queue-admin-guided-recovery-check",
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
                "goal": "Проверить admin guided recovery plan.",
                "expected_artifact": "Queue admin guided recovery evidence artifact",
                "source_context": "SAAS-1179-RECOVERY..SAAS-1188-RECOVERY repeatable check",
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
        {"actor": "queue-admin-guided-recovery-check", "reason": "Reset scheduler before guided recovery proof.", "interval_seconds": 0.2},
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "queue-admin-guided-recovery-check", "reason": "Cleanup open DLQ before guided recovery proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "queue-admin-guided-recovery-check", "reason": "Cleanup DLQ before guided recovery proof.", "auto_process": True},
            )
    for _ in range(8):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "queue-admin-guided-recovery-check", "reason": "Cleanup active queue before guided recovery proof.", "interval_seconds": 0.2},
        )


def plan_has(plan: dict, *, action_kind: str | None = None, related_runbook_step_id: str | None = None, status: str | None = None) -> bool:
    for step in plan["plan"]:
        if action_kind is not None and step["action_kind"] != action_kind:
            continue
        if related_runbook_step_id is not None and step.get("related_runbook_step_id") != related_runbook_step_id:
            continue
        if status is not None and step["status"] != status:
            continue
        return True
    return False


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    warning_response = enqueue(
        auto_process=False,
        form_data={"guided_recovery_case": "scheduler_stopped_with_backlog"},
    )
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_plan = request_json("/api/task-runs/queue/admin-recovery-plan")
    start_action = request_json(
        "/api/task-runs/queue/operations-runbook/actions/runbook-queue-stopped",
        "POST",
        {
            "actor": "queue-admin-guided-recovery-check",
            "reason": "Execute guided recovery primary step.",
            "interval_seconds": 0.2,
        },
    )
    completed_warning_item = wait_for_queue_status(warning_queue_id, {"completed"})
    normal_plan_after_guided = request_json("/api/task-runs/queue/admin-recovery-plan")

    critical_response = enqueue(
        auto_process=True,
        form_data={"guided_recovery_case": "dlq_manual_triage", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    critical_queue_id = critical_response["queue_item"]["id"]
    failed_item = wait_for_queue_status(critical_queue_id, {"failed"})
    critical_plan = request_json("/api/task-runs/queue/admin-recovery-plan")
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dead_letters["items"] if item["queue_id"] == critical_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "queue-admin-guided-recovery-check", "reason": "Acknowledge DLQ item after recovery plan proof."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{critical_queue_id}/retry",
        "POST",
        {"actor": "queue-admin-guided-recovery-check", "reason": "Resolve DLQ item after recovery plan proof.", "auto_process": True},
    )
    final_plan = request_json("/api/task-runs/queue/admin-recovery-plan")
    final_queue = request_json("/api/task-runs/queue/status")

    checks = {
        "warning_plan_is_guided_recovery": warning_plan["status"] == "warning"
        and warning_plan["recommended_mode"] == "guided_recovery",
        "warning_plan_has_primary_guided_scheduler_step": warning_plan["primary_step_id"] is not None
        and plan_has(warning_plan, action_kind="guided_action", related_runbook_step_id="runbook-queue-stopped", status="needs_attention"),
        "guided_action_completed_queue": start_action["executed"] is True and completed_warning_item["status"] == "completed",
        "normal_after_guided_action": normal_plan_after_guided["status"] == "normal"
        and normal_plan_after_guided["recommended_mode"] == "monitor",
        "critical_plan_is_manual_triage": failed_item["status"] == "failed"
        and critical_plan["status"] == "critical"
        and critical_plan["recommended_mode"] in {"manual_triage", "emergency_stop"},
        "critical_plan_has_review_only_steps": plan_has(critical_plan, action_kind="review_only", status="needs_attention"),
        "critical_plan_links_queue_or_task": any(
            step.get("related_queue_id") == critical_queue_id or step.get("related_task_run_id") == critical_response["task_run"]["id"]
            for step in critical_plan["plan"]
        ),
        "critical_plan_has_gates": len(critical_plan["gates"]) >= 3
        and all(gate["status"] == "passed" for gate in critical_plan["gates"]),
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_plan_monitor": final_plan["status"] == "normal" and final_plan["recommended_mode"] == "monitor",
        "final_queue_has_no_active_items": final_queue["queued"] + final_queue["running"] + final_queue["retrying"] == 0,
        "no_production_scope": all(
            "does not enable production deploy" in gate["reason"].lower() and "secrets" in gate["reason"].lower()
            for gate in critical_plan["gates"]
            if gate["id"] == "queue-admin-recovery-plan-safe-scope"
        ),
    }
    evidence = {
        "task": "SAAS-1179-RECOVERY..SAAS-1188-RECOVERY",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "critical_queue_id": critical_queue_id,
        "dead_letter_id": dead_letter["id"],
        "warning_plan": warning_plan,
        "start_action": start_action,
        "normal_plan_after_guided": normal_plan_after_guided,
        "critical_plan": critical_plan,
        "final_plan": final_plan,
        "final_queue": final_queue,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1188_QUEUE_ADMIN_GUIDED_RECOVERY_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
