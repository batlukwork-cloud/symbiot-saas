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
    "x-actor": "notification-delivery-check",
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
                "goal": "Проверить Notification Delivery Channels.",
                "expected_artifact": "Notification delivery evidence artifact",
                "source_context": "SAAS-1109-NOTIFY..SAAS-1118-NOTIFY repeatable check",
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
        {
            "actor": "notification-delivery-check",
            "reason": "Reset scheduler before notification delivery proof.",
            "interval_seconds": 0.2,
        },
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "notification-delivery-check", "reason": "Cleanup open DLQ before notification proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "notification-delivery-check", "reason": "Cleanup DLQ before notification proof.", "auto_process": True},
            )
    for _ in range(5):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "notification-delivery-check", "reason": "Cleanup active queue before notification proof.", "interval_seconds": 0.2},
        )


def has_local_delivery(delivery: dict, incident_id: str) -> bool:
    return any(
        item["incident_id"] == incident_id
        and item["channel_id"] == "local-log"
        and item["channel_type"] == "local_log"
        and item["status"] == "delivered"
        and item["dry_run"] is True
        and item["evidence_ref"]
        for item in delivery["items"]
    )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    channels_before = request_json("/api/task-runs/queue/notifications/status")

    warning_response = enqueue(auto_process=False, form_data={"notify_case": "warning_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_lifecycle = request_json("/api/task-runs/queue/incidents")
    warning_incident = next(item for item in warning_lifecycle["incidents"] if item["severity"] == "warning")
    warning_delivery = request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "notification-delivery-check", "reason": "Dispatch warning incident to local-log."},
    )
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "notification-delivery-check", "reason": "Clear warning queue after notification proof.", "interval_seconds": 0.2},
    )

    critical_response = enqueue(
        auto_process=True,
        form_data={"notify_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = critical_response["queue_item"]["id"]
    critical_lifecycle = request_json("/api/task-runs/queue/incidents")
    critical_incident = next(item for item in critical_lifecycle["incidents"] if item["severity"] == "critical")
    critical_delivery = request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "notification-delivery-check", "reason": "Dispatch critical incident to local-log."},
    )

    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == failed_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "notification-delivery-check", "reason": "Acknowledge notification proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "notification-delivery-check", "reason": "Resolve notification proof incident.", "auto_process": True},
    )
    final_lifecycle = request_json("/api/task-runs/queue/incidents")
    final_delivery = request_json("/api/task-runs/queue/notifications/status")
    final_alert_center = request_json("/api/task-runs/queue/admin-alerts")

    enabled_channels = [channel for channel in channels_before["channels"] if channel["enabled"]]
    external_channels = [channel for channel in channels_before["channels"] if channel["channel_type"] != "local_log"]
    checks = {
        "local_log_is_only_enabled_channel": len(enabled_channels) == 1 and enabled_channels[0]["id"] == "local-log",
        "external_channels_are_not_configured": all(channel["delivery_mode"] == "external_not_configured" for channel in external_channels),
        "warning_incident_delivered_to_local_log": has_local_delivery(warning_delivery, warning_incident["id"]),
        "critical_incident_delivered_to_local_log": has_local_delivery(critical_delivery, critical_incident["id"]),
        "delivery_items_have_owner_and_evidence": all(
            item["owner_role"] and item["message"] and item["evidence_ref"]
            for item in critical_delivery["items"]
            if item["incident_id"] in {warning_incident["id"], critical_incident["id"]}
        ),
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_lifecycle_normal": final_lifecycle["status"] == "normal" and final_lifecycle["open"] == 0,
        "final_alert_center_normal": final_alert_center["status"] == "normal" and final_alert_center["critical_alerts"] == 0,
        "final_delivery_has_no_failed": final_delivery["failed"] == 0,
        "gates_present": len(final_delivery["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1109-NOTIFY..SAAS-1118-NOTIFY",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "failed_queue_id": failed_queue_id,
        "dead_letter_id": dead_letter["id"],
        "warning_incident": warning_incident,
        "critical_incident": critical_incident,
        "warning_delivery": {
            "status": warning_delivery["status"],
            "delivered": warning_delivery["delivered"],
            "active_incidents": warning_delivery["active_incidents"],
        },
        "critical_delivery": {
            "status": critical_delivery["status"],
            "delivered": critical_delivery["delivered"],
            "active_incidents": critical_delivery["active_incidents"],
        },
        "channels": channels_before["channels"],
        "final": {
            "lifecycle_status": final_lifecycle["status"],
            "alert_center_status": final_alert_center["status"],
            "delivery_status": final_delivery["status"],
            "delivery_total": final_delivery["total"],
            "delivery_failed": final_delivery["failed"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1118_NOTIFICATION_DELIVERY_CHANNELS_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
