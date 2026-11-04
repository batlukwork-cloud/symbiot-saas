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
    "x-actor": "notification-policy-audit-check",
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
                "goal": "Проверить Notification Policy Audit.",
                "expected_artifact": "Notification policy audit evidence artifact",
                "source_context": "SAAS-1149-POLICY..SAAS-1158-POLICY repeatable check",
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
            "actor": "notification-policy-audit-check",
            "reason": "Reset scheduler before policy audit proof.",
            "interval_seconds": 0.2,
        },
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "notification-policy-audit-check", "reason": "Cleanup open DLQ before policy audit proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "notification-policy-audit-check", "reason": "Cleanup DLQ before policy audit proof.", "auto_process": True},
            )
    for _ in range(5):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "notification-policy-audit-check", "reason": "Cleanup active queue before policy audit proof.", "interval_seconds": 0.2},
        )


def item_by_id(policy: dict, item_id: str) -> dict:
    return next(item for item in policy["items"] if item["id"] == item_id)


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    initial_policy = request_json("/api/task-runs/queue/notifications/policy-audit")
    routing = request_json("/api/task-runs/queue/notifications/routing")
    channels = request_json("/api/task-runs/queue/notifications/status")["channels"]

    warning_response = enqueue(auto_process=False, form_data={"policy_case": "warning_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_lifecycle = request_json("/api/task-runs/queue/incidents")
    warning_incident = next(item for item in warning_lifecycle["incidents"] if item["severity"] == "warning")
    warning_delivery = request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "notification-policy-audit-check", "reason": "Dispatch warning incident for policy audit proof."},
    )
    warning_delivery_item = next(item for item in warning_delivery["items"] if item["incident_id"] == warning_incident["id"])
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "notification-policy-audit-check", "reason": "Clear warning queue before critical policy audit proof.", "interval_seconds": 0.2},
    )

    critical_response = enqueue(
        auto_process=True,
        form_data={"policy_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
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
        {"actor": "notification-policy-audit-check", "reason": "Dispatch critical DLQ incident for policy audit proof."},
    )
    critical_delivery_item = next(item for item in critical_delivery["items"] if item["incident_id"] == critical_incident["id"])
    active_policy = request_json("/api/task-runs/queue/notifications/policy-audit")

    dlq_status = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dlq_status["items"] if item["queue_id"] == failed_queue_id)
    request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "notification-policy-audit-check", "reason": "Acknowledge policy audit proof incident."},
    )
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "notification-policy-audit-check", "reason": "Resolve policy audit proof incident.", "auto_process": True},
    )
    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "notification-policy-audit-check", "reason": "Clear warning queue after policy audit proof.", "interval_seconds": 0.2},
    )
    final_policy = request_json("/api/task-runs/queue/notifications/policy-audit")
    final_lifecycle = request_json("/api/task-runs/queue/incidents")
    final_delivery = request_json("/api/task-runs/queue/notifications/status")

    checks = {
        "initial_policy_normal": initial_policy["status"] == "normal",
        "external_delivery_not_allowed": not initial_policy["external_delivery_allowed"]
        and all(not channel["enabled"] for channel in channels if channel["channel_type"] != "local_log"),
        "production_gate_required": initial_policy["production_gate_required"] is True,
        "enabled_routes_local_log_only": all(
            route["channel_ids"] == ["local-log"] and route["delivery_mode"] == "local_log_only"
            for route in routing["routes"]
            if route["enabled"]
        ),
        "critical_route_owner_sla_escalation": item_by_id(active_policy, "policy-critical-route-owner-sla-escalation")["status"]
        == "passed",
        "delivery_evidence_linked_after_dispatch": bool(warning_delivery_item["evidence_ref"])
        and bool(critical_delivery_item["evidence_ref"]),
        "audit_items_have_evidence": all(item["evidence_source"] for item in active_policy["items"]),
        "cleanup_retry_completed": retry_response["queue_item"]["status"] == "completed",
        "final_policy_normal": final_policy["status"] == "normal" and final_lifecycle["status"] == "normal" and final_delivery["failed"] == 0,
        "gates_present": len(final_policy["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1149-POLICY..SAAS-1158-POLICY",
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
        "warning_delivery_item": warning_delivery_item,
        "critical_delivery_item": critical_delivery_item,
        "active_policy": active_policy,
        "final_policy": final_policy,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1158_NOTIFICATION_POLICY_AUDIT_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
