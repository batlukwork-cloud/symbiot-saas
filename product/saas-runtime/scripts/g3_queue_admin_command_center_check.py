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
    "x-actor": "queue-admin-command-center-check",
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
                "goal": "Проверить admin command center.",
                "expected_artifact": "Queue admin command center evidence artifact",
                "source_context": "SAAS-1189-COMMAND..SAAS-1198-COMMAND repeatable check",
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
        {"actor": "queue-admin-command-center-check", "reason": "Reset scheduler before command center proof.", "interval_seconds": 0.2},
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "queue-admin-command-center-check", "reason": "Cleanup open DLQ before command center proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "queue-admin-command-center-check", "reason": "Cleanup DLQ before command center proof.", "auto_process": True},
            )
    for _ in range(8):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "queue-admin-command-center-check", "reason": "Cleanup active queue before command center proof.", "interval_seconds": 0.2},
        )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    warning_response = enqueue(auto_process=False, form_data={"command_center_case": "scheduler_stopped_with_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    command_warning = request_json("/api/task-runs/queue/admin-command-center")
    primary_action = command_warning["actions"][0]

    if primary_action["enabled"] and primary_action.get("endpoint"):
        request_json(
            primary_action["endpoint"],
            "POST",
            {
                "actor": "queue-admin-command-center-check",
                "reason": "Execute command center primary guided action.",
                "interval_seconds": 0.2,
            },
        )
    completed_warning_item = wait_for_queue_status(warning_queue_id, {"completed"})
    command_after_guided = request_json("/api/task-runs/queue/admin-command-center")

    critical_response = enqueue(
        auto_process=True,
        form_data={"command_center_case": "manual_triage_dead_letter", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    critical_queue_id = critical_response["queue_item"]["id"]
    failed_item = wait_for_queue_status(critical_queue_id, {"failed"})
    command_critical = request_json("/api/task-runs/queue/admin-command-center")
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dead_letters["items"] if item["queue_id"] == critical_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "queue-admin-command-center-check", "reason": "Acknowledge DLQ after command center proof."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{critical_queue_id}/retry",
        "POST",
        {"actor": "queue-admin-command-center-check", "reason": "Resolve DLQ after command center proof.", "auto_process": True},
    )
    command_final = request_json("/api/task-runs/queue/admin-command-center")
    final_queue = request_json("/api/task-runs/queue/status")

    checks = {
        "warning_command_center_guides_operator": command_warning["status"] == "warning"
        and command_warning["operator_mode"] == "guided_recovery"
        and command_warning["primary_action_id"] is not None,
        "warning_primary_action_is_executable": primary_action["action_kind"] == "guided_action"
        and primary_action["enabled"] is True
        and "/operations-runbook/actions/" in primary_action["endpoint"],
        "warning_action_completes_queue": completed_warning_item["status"] == "completed",
        "normal_after_guided_action": command_after_guided["status"] == "normal"
        and command_after_guided["operator_mode"] == "monitor",
        "critical_command_center_blocks": failed_item["status"] == "failed"
        and command_critical["status"] == "critical"
        and command_critical["operator_mode"] in {"manual_triage", "emergency_stop"}
        and command_critical["blockers_total"] >= 1,
        "critical_action_is_review_or_manual": command_critical["actions"][0]["action_kind"] in {"review_only", "admin_action"},
        "sources_cover_admin_layers": command_warning["sources_total"] >= 7
        and {"admin-alert-center", "recovery-plan", "operations-runbook", "incident-lifecycle", "incident-timeline", "notification-policy-audit", "dead-letter-queue"}.issubset(
            {source["id"] for source in command_warning["sources"]}
        ),
        "all_sources_have_evidence": all(source["evidence_source"] for source in command_warning["sources"]),
        "gates_pass": all(gate["status"] == "passed" for gate in command_warning["gates"])
        and all(gate["status"] == "passed" for gate in command_critical["gates"]),
        "safe_scope_gate_mentions_no_production": any(
            gate["id"] == "queue-admin-command-center-safe-scope"
            and "production deploy" in gate["reason"].lower()
            and "secrets" in gate["reason"].lower()
            for gate in command_warning["gates"]
        ),
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_command_center_monitor": command_final["status"] == "normal" and command_final["operator_mode"] == "monitor",
        "final_queue_has_no_active_items": final_queue["queued"] + final_queue["running"] + final_queue["retrying"] == 0,
    }
    evidence = {
        "task": "SAAS-1189-COMMAND..SAAS-1198-COMMAND",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "critical_queue_id": critical_queue_id,
        "dead_letter_id": dead_letter["id"],
        "command_warning": command_warning,
        "command_after_guided": command_after_guided,
        "command_critical": command_critical,
        "command_final": command_final,
        "final_queue": final_queue,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1198_QUEUE_ADMIN_COMMAND_CENTER_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
