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
    "x-actor": "admin-notifications-sla-check",
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
                "goal": "Проверить Admin Notifications / SLA.",
                "expected_artifact": "SLA evidence artifact",
                "source_context": "SAAS-1089-SLA..SAAS-1098-SLA repeatable check",
                "urgency": "normal",
                **form_data,
            },
            "document_ids": ["doc-demo-001"],
        },
    )


def has_sla_fields(alert: dict, *, expected_owner: str, expected_minutes: int) -> bool:
    return bool(
        alert["owner_role"] == expected_owner
        and alert["response_minutes"] == expected_minutes
        and alert["response_due_at"]
        and alert["sla_status"] == "within_sla"
        and alert["escalation_target"]
        and alert["notification_draft"]
    )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "admin-notifications-sla-check", "reason": "Reset scheduler before SLA proof.", "interval_seconds": 0.2},
    )

    warning_response = enqueue(auto_process=False, form_data={"sla_case": "warning_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_center = request_json("/api/task-runs/queue/admin-alerts")
    warning_alert = next(alert for alert in warning_center["alerts"] if alert["id"] == "alert-scheduler-stopped-with-backlog")
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "admin-notifications-sla-check", "reason": "Clear warning backlog.", "interval_seconds": 0.2},
    )

    critical_response = enqueue(
        auto_process=True,
        form_data={"sla_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = critical_response["queue_item"]["id"]
    critical_center = request_json("/api/task-runs/queue/admin-alerts")
    critical_alerts = [alert for alert in critical_center["alerts"] if alert["severity"] == "critical"]
    dlq_critical = next(alert for alert in critical_alerts if alert["source"] == "dead_letter_queue")
    failed_critical = next(alert for alert in critical_alerts if alert["source"] == "queue")
    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == failed_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "admin-notifications-sla-check", "reason": "Acknowledge SLA proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "admin-notifications-sla-check", "reason": "Resolve SLA proof incident.", "auto_process": True},
    )
    final_center = request_json("/api/task-runs/queue/admin-alerts")

    checks = {
        "warning_alert_has_sla": has_sla_fields(warning_alert, expected_owner="runtime-operator", expected_minutes=60),
        "critical_dlq_alert_has_sla": has_sla_fields(dlq_critical, expected_owner="runtime-admin", expected_minutes=15),
        "critical_failed_alert_has_sla": has_sla_fields(failed_critical, expected_owner="runtime-admin", expected_minutes=15),
        "notification_draft_mentions_action": "Action:" in dlq_critical["notification_draft"],
        "warning_escalates_to_runtime_admin": "Runtime Admin" in warning_alert["escalation_target"],
        "critical_escalates_to_cto": "CTO" in dlq_critical["escalation_target"],
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_center_normal": final_center["status"] == "normal" and final_center["critical_alerts"] == 0,
        "final_dlq_open_zero": final_center["dead_letter_queue"]["open"] == 0,
        "gates_present": len(final_center["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1089-SLA..SAAS-1098-SLA",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "failed_queue_id": failed_queue_id,
        "dead_letter_id": dead_letter["id"],
        "warning_alert": warning_alert,
        "critical_dlq_alert": dlq_critical,
        "critical_failed_alert": failed_critical,
        "final_center": {
            "status": final_center["status"],
            "open_alerts": final_center["open_alerts"],
            "critical_alerts": final_center["critical_alerts"],
            "warning_alerts": final_center["warning_alerts"],
            "dlq_open": final_center["dead_letter_queue"]["open"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1098_ADMIN_NOTIFICATIONS_SLA_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
