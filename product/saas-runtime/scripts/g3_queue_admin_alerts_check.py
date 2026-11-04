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
    "x-actor": "queue-admin-alerts-check",
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
                "goal": "Проверить Queue Admin UX / Alerts.",
                "expected_artifact": "Queue admin alert evidence",
                "source_context": "SAAS-1079-ALERTS..SAAS-1088-ALERTS repeatable check",
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
        {"actor": "queue-admin-alerts-check", "reason": "Reset scheduler before admin alert proof.", "interval_seconds": 0.2},
    )
    normal_before = request_json("/api/task-runs/queue/admin-alerts")

    backlog_response = enqueue(
        auto_process=False,
        form_data={"alert_case": "scheduler_stopped_with_backlog"},
    )
    backlog_queue_id = backlog_response["queue_item"]["id"]
    backlog_alerts = request_json("/api/task-runs/queue/admin-alerts")
    tick_status = request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "queue-admin-alerts-check", "reason": "Clear backlog warning through one scheduler tick.", "interval_seconds": 0.2},
    )
    backlog_item = request_json(f"/api/task-runs/queue/{backlog_queue_id}")

    failure_response = enqueue(
        auto_process=True,
        form_data={"alert_case": "dlq_critical", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = failure_response["queue_item"]["id"]
    failed_task_run_id = failure_response["task_run"]["id"]
    critical_alerts = request_json("/api/task-runs/queue/admin-alerts")
    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    matching = [item for item in dlq_status["items"] if item["queue_id"] == failed_queue_id]
    if not matching:
        raise RuntimeError(f"DLQ item for {failed_queue_id} was not created.")
    dead_letter = matching[0]
    acknowledged = request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "queue-admin-alerts-check", "reason": "Validate admin alert critical acknowledgement."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {
            "actor": "queue-admin-alerts-check",
            "reason": "Clean alert proof DLQ item after acknowledgement.",
            "auto_process": True,
        },
    )
    final_alerts = request_json("/api/task-runs/queue/admin-alerts")

    backlog_alert_ids = [alert["id"] for alert in backlog_alerts["alerts"]]
    critical_sources = [alert["source"] for alert in critical_alerts["alerts"] if alert["severity"] == "critical"]
    action_ids = [action["id"] for action in critical_alerts["actions"]]
    checks = {
        "admin_alert_endpoint_ready": normal_before["mode"] == "sqlite_mvp_queue_admin_alert_center",
        "normal_state_has_info_alert": normal_before["status"] in {"normal", "warning"} and bool(normal_before["alerts"]),
        "backlog_without_scheduler_warns": backlog_alerts["status"] == "warning"
        and "alert-scheduler-stopped-with-backlog" in backlog_alert_ids,
        "admin_actions_exposed": {"start-scheduler", "stop-scheduler", "manual-tick", "review-dlq"}.issubset(set(action_ids)),
        "manual_tick_clears_backlog": backlog_item["status"] == "completed" and tick_status["queue_status"]["queued"] == 0,
        "critical_dlq_alert_created": critical_alerts["status"] == "critical" and "dead_letter_queue" in critical_sources,
        "critical_alert_has_recommended_action": all(alert["recommended_action"] for alert in critical_alerts["alerts"]),
        "acknowledge_and_retry_cleanup": acknowledged["item"]["status"] == "acknowledged" and retry_response["queue_item"]["status"] == "completed",
        "final_alerts_have_no_open_critical": final_alerts["critical_alerts"] == 0 and final_alerts["dead_letter_queue"]["open"] == 0,
        "gates_present": len(final_alerts["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1079-ALERTS..SAAS-1088-ALERTS",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "normal_before": {
            "status": normal_before["status"],
            "summary": normal_before["summary"],
            "open_alerts": normal_before["open_alerts"],
        },
        "backlog_queue_id": backlog_queue_id,
        "backlog_alerts": {
            "status": backlog_alerts["status"],
            "alerts": backlog_alerts["alerts"],
        },
        "failed_queue_id": failed_queue_id,
        "failed_task_run_id": failed_task_run_id,
        "dead_letter_id": dead_letter["id"],
        "critical_alerts": {
            "status": critical_alerts["status"],
            "critical_alerts": critical_alerts["critical_alerts"],
            "alerts": critical_alerts["alerts"],
            "actions": critical_alerts["actions"],
        },
        "final_alerts": {
            "status": final_alerts["status"],
            "open_alerts": final_alerts["open_alerts"],
            "critical_alerts": final_alerts["critical_alerts"],
            "warning_alerts": final_alerts["warning_alerts"],
            "dlq_open": final_alerts["dead_letter_queue"]["open"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1088_QUEUE_ADMIN_ALERTS_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
