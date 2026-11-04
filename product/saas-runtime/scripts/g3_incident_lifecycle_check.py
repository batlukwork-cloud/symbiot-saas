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
    "x-actor": "incident-lifecycle-check",
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
                "goal": "Проверить Incident Lifecycle.",
                "expected_artifact": "Incident lifecycle evidence artifact",
                "source_context": "SAAS-1099-INC..SAAS-1108-INC repeatable check",
                "urgency": "normal",
                **form_data,
            },
            "document_ids": ["doc-demo-001"],
        },
    )


def cleanup_runtime() -> None:
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    for item in dead_letters["items"]:
        if item["status"] == "resolved":
            continue
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "incident-lifecycle-check", "reason": "Pre-clean open incident before repeatable proof."},
            )
        request_json(
            f"/api/task-runs/queue/{item['queue_id']}/retry",
            "POST",
            {"actor": "incident-lifecycle-check", "reason": "Pre-clean incident before repeatable proof.", "auto_process": True},
        )
    for _ in range(5):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "incident-lifecycle-check", "reason": "Pre-clean active queue before repeatable proof.", "interval_seconds": 0.2},
        )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    request_json(
        "/api/task-runs/queue/scheduler/stop",
        "POST",
        {"actor": "incident-lifecycle-check", "reason": "Reset scheduler before incident lifecycle proof.", "interval_seconds": 0.2},
    )
    cleanup_runtime()

    warning_response = enqueue(auto_process=False, form_data={"incident_case": "warning_backlog"})
    warning_queue_id = warning_response["queue_item"]["id"]
    warning_incidents = request_json("/api/task-runs/queue/incidents")
    warning_item = next(item for item in warning_incidents["incidents"] if item["severity"] == "warning")

    request_json(
        "/api/task-runs/queue/scheduler/tick",
        "POST",
        {"actor": "incident-lifecycle-check", "reason": "Clear warning backlog before critical incident.", "interval_seconds": 0.2},
    )

    critical_response = enqueue(
        auto_process=True,
        form_data={"incident_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = critical_response["queue_item"]["id"]
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dead_letters["items"] if item["queue_id"] == failed_queue_id)
    critical_incidents = request_json("/api/task-runs/queue/incidents")
    critical_item = next(
        item
        for item in critical_incidents["incidents"]
        if item["source"] == "dead_letter_queue" and item["evidence_ref"] == dead_letter["id"]
    )
    acknowledged = request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "incident-lifecycle-check", "reason": "Acknowledge incident lifecycle proof item."},
    )
    acknowledged_incidents = request_json("/api/task-runs/queue/incidents")
    acknowledged_item = next(item for item in acknowledged_incidents["incidents"] if item["related_queue_id"] == failed_queue_id)

    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "incident-lifecycle-check", "reason": "Resolve incident lifecycle proof item.", "auto_process": True},
    )
    resolved_dead_letter = request_json(f"/api/task-runs/queue/dead-letters/{dead_letter['id']}")
    resolved_incidents = request_json("/api/task-runs/queue/incidents")
    final_alerts = request_json("/api/task-runs/queue/admin-alerts")

    checks = {
        "warning_incident_visible": warning_incidents["status"] == "warning" and warning_item["status"] == "open",
        "warning_has_owner_sla_action": bool(
            warning_item["owner_role"] == "runtime-operator"
            and warning_item["sla_status"] == "within_sla"
            and warning_item["next_action"]
        ),
        "critical_incident_visible": critical_incidents["status"] == "critical" and critical_item["status"] == "open",
        "critical_has_owner_sla_evidence": bool(
            critical_item["owner_role"] == "runtime-admin"
            and critical_item["response_due_at"]
            and critical_item["evidence_ref"] == dead_letter["id"]
            and critical_item["action_endpoint"].endswith("/acknowledge")
        ),
        "acknowledge_moves_incident_to_review": acknowledged["item"]["status"] == "acknowledged"
        and acknowledged_item["status"] == "acknowledged"
        and acknowledged_item["current_step"] == "В ручном разборе",
        "retry_resolves_incident": retry_response["queue_item"]["status"] == "completed"
        and resolved_dead_letter["status"] == "resolved"
        and resolved_dead_letter["resolved_by"] == "incident-lifecycle-check",
        "final_lifecycle_normal": resolved_incidents["status"] == "normal"
        and resolved_incidents["open"] == 0
        and resolved_incidents["acknowledged"] == 0,
        "final_alert_center_normal": final_alerts["status"] == "normal" and final_alerts["critical_alerts"] == 0,
        "gates_present": len(resolved_incidents["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1099-INC..SAAS-1108-INC",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "warning_queue_id": warning_queue_id,
        "failed_queue_id": failed_queue_id,
        "dead_letter_id": dead_letter["id"],
        "warning_incident": warning_item,
        "critical_incident": critical_item,
        "acknowledged_incident": acknowledged_item,
        "resolved_dead_letter": resolved_dead_letter,
        "final_lifecycle": {
            "status": resolved_incidents["status"],
            "total": resolved_incidents["total"],
            "open": resolved_incidents["open"],
            "acknowledged": resolved_incidents["acknowledged"],
            "resolved": resolved_incidents["resolved"],
            "overdue": resolved_incidents["overdue"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1108_INCIDENT_LIFECYCLE_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
