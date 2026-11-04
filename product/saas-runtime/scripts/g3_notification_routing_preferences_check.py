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
    "x-actor": "notification-routing-check",
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
                "goal": "Проверить Notification Routing Preferences.",
                "expected_artifact": "Notification routing evidence artifact",
                "source_context": "SAAS-1119-ROUTE..SAAS-1128-ROUTE repeatable check",
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
            "actor": "notification-routing-check",
            "reason": "Reset scheduler before routing proof.",
            "interval_seconds": 0.2,
        },
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "notification-routing-check", "reason": "Cleanup open DLQ before routing proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "notification-routing-check", "reason": "Cleanup DLQ before routing proof.", "auto_process": True},
            )
    for _ in range(5):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "notification-routing-check", "reason": "Cleanup active queue before routing proof.", "interval_seconds": 0.2},
        )


def route_by_id(routing: dict, route_id: str) -> dict:
    return next(route for route in routing["routes"] if route["id"] == route_id)


def delivery_for_incident(delivery: dict, incident_id: str) -> dict:
    return next(item for item in delivery["items"] if item["incident_id"] == incident_id and item["channel_id"] == "local-log")


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    routing = request_json("/api/task-runs/queue/notifications/routing")
    warning_route = route_by_id(routing, "route-warning-default")
    critical_route = route_by_id(routing, "route-critical-default")
    dlq_route = route_by_id(routing, "route-critical-dlq")

    warning_response = enqueue(auto_process=False, form_data={"routing_case": "warning_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_lifecycle = request_json("/api/task-runs/queue/incidents")
    warning_incident = next(item for item in warning_lifecycle["incidents"] if item["severity"] == "warning")
    warning_delivery = request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "notification-routing-check", "reason": "Dispatch warning incident with routing preference."},
    )
    warning_delivery_item = delivery_for_incident(warning_delivery, warning_incident["id"])
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "notification-routing-check", "reason": "Clear warning queue after routing proof.", "interval_seconds": 0.2},
    )

    critical_response = enqueue(
        auto_process=True,
        form_data={"routing_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = critical_response["queue_item"]["id"]
    critical_lifecycle = request_json("/api/task-runs/queue/incidents")
    critical_incident = next(
        item for item in critical_lifecycle["incidents"] if item["severity"] == "critical" and item["source"] == "dead_letter_queue"
    )
    critical_delivery = request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "notification-routing-check", "reason": "Dispatch critical DLQ incident with routing preference."},
    )
    critical_delivery_item = delivery_for_incident(critical_delivery, critical_incident["id"])

    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == failed_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "notification-routing-check", "reason": "Acknowledge routing proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "notification-routing-check", "reason": "Resolve routing proof incident.", "auto_process": True},
    )
    final_lifecycle = request_json("/api/task-runs/queue/incidents")
    final_delivery = request_json("/api/task-runs/queue/notifications/status")
    final_alert_center = request_json("/api/task-runs/queue/admin-alerts")
    final_routing = request_json("/api/task-runs/queue/notifications/routing")

    checks = {
        "routing_status_normal": routing["status"] == "normal",
        "warning_route_enabled_local_log": warning_route["enabled"] and warning_route["channel_ids"] == ["local-log"],
        "critical_route_enabled_local_log": critical_route["enabled"] and critical_route["owner_role"] == "runtime-admin",
        "dlq_route_has_cto_escalation": dlq_route["enabled"] and "CTO" in dlq_route["escalation_target"],
        "external_routes_not_enabled": all(
            not any(channel_id in {"email", "telegram", "webhook"} for channel_id in route["channel_ids"])
            for route in routing["routes"]
            if route["enabled"]
        ),
        "warning_delivery_mentions_route": "route-warning-default" in warning_delivery_item["message"],
        "critical_delivery_uses_dlq_route": critical_delivery_item["owner_role"] == "runtime-admin"
        and "route-critical-dlq" in critical_delivery_item["message"],
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_runtime_normal": final_lifecycle["status"] == "normal"
        and final_alert_center["status"] == "normal"
        and final_delivery["failed"] == 0,
        "gates_present": len(final_routing["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1119-ROUTE..SAAS-1128-ROUTE",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "failed_queue_id": failed_queue_id,
        "dead_letter_id": dead_letter["id"],
        "routing": routing,
        "warning_incident": warning_incident,
        "warning_delivery_item": warning_delivery_item,
        "critical_incident": critical_incident,
        "critical_delivery_item": critical_delivery_item,
        "final": {
            "routing_status": final_routing["status"],
            "lifecycle_status": final_lifecycle["status"],
            "alert_center_status": final_alert_center["status"],
            "delivery_status": final_delivery["status"],
            "delivery_failed": final_delivery["failed"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1128_NOTIFICATION_ROUTING_PREFERENCES_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
