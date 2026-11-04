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
    "x-actor": "admin-incident-timeline-check",
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
                "goal": "Проверить Admin Incident Timeline.",
                "expected_artifact": "Admin incident timeline evidence artifact",
                "source_context": "SAAS-1159-TIMELINE..SAAS-1168-TIMELINE repeatable check",
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
            "actor": "admin-incident-timeline-check",
            "reason": "Reset scheduler before incident timeline proof.",
            "interval_seconds": 0.2,
        },
    )
    dlq = request_json("/api/task-runs/queue/dead-letters")
    for item in dlq["items"]:
        if item["status"] == "open":
            request_json(
                f"/api/task-runs/queue/dead-letters/{item['id']}/acknowledge",
                "POST",
                {"actor": "admin-incident-timeline-check", "reason": "Cleanup open DLQ before incident timeline proof."},
            )
        if item["status"] in {"open", "acknowledged"}:
            request_json(
                f"/api/task-runs/queue/{item['queue_id']}/retry",
                "POST",
                {"actor": "admin-incident-timeline-check", "reason": "Cleanup DLQ before incident timeline proof.", "auto_process": True},
            )
    for _ in range(5):
        status = request_json("/api/task-runs/queue/status")
        if status["queued"] == 0 and status["retrying"] == 0 and status["running"] == 0:
            break
        request_json(
            "/api/task-runs/queue/scheduler/tick",
            "POST",
            {"actor": "admin-incident-timeline-check", "reason": "Cleanup active queue before incident timeline proof.", "interval_seconds": 0.2},
        )


def event_types(timeline: dict) -> set[str]:
    return {event["event_type"] for event in timeline["timeline"]}


def timestamps_sorted(timeline: dict) -> bool:
    values = [event["timestamp"] for event in timeline["timeline"]]
    return values == sorted(values)


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    cleanup_runtime()

    critical_response = enqueue(
        auto_process=True,
        form_data={"timeline_case": "critical_dlq", "simulate_worker_failure_attempts": 1},
        max_attempts=1,
    )
    failed_queue_id = critical_response["queue_item"]["id"]
    dead_letters = request_json("/api/task-runs/queue/dead-letters")
    dead_letter = next(item for item in dead_letters["items"] if item["queue_id"] == failed_queue_id)
    request_json(
        "/api/task-runs/queue/notifications/dispatch",
        "POST",
        {"actor": "admin-incident-timeline-check", "reason": "Dispatch critical incident before timeline proof."},
    )
    active_timeline = request_json("/api/task-runs/queue/incidents/timeline?limit=200")

    acknowledged = request_json(
        f"/api/task-runs/queue/dead-letters/{dead_letter['id']}/acknowledge",
        "POST",
        {"actor": "admin-incident-timeline-check", "reason": "Acknowledge incident timeline proof item."},
    )
    acknowledged_timeline = request_json("/api/task-runs/queue/incidents/timeline?limit=200")
    retry_response = request_json(
        f"/api/task-runs/queue/{failed_queue_id}/retry",
        "POST",
        {"actor": "admin-incident-timeline-check", "reason": "Resolve incident timeline proof item.", "auto_process": True},
    )
    final_timeline = request_json("/api/task-runs/queue/incidents/timeline?limit=200")
    final_lifecycle = request_json("/api/task-runs/queue/incidents")

    combined_types = event_types(active_timeline) | event_types(acknowledged_timeline) | event_types(final_timeline)
    final_related_events = [
        event for event in final_timeline["timeline"] if event.get("related_queue_id") == failed_queue_id
    ]
    checks = {
        "active_timeline_critical": active_timeline["status"] == "critical" and active_timeline["unresolved_events"] > 0,
        "has_incident_open_event": "incident_open" in combined_types,
        "has_notification_delivered_event": "notification_delivered" in combined_types,
        "has_runbook_action_event": "runbook_action" in combined_types,
        "has_acknowledge_event": "dlq_acknowledged" in combined_types,
        "has_manual_retry_event": "manual_retry" in combined_types,
        "has_resolved_event": "incident_resolved" in combined_types,
        "events_are_chronological": timestamps_sorted(final_timeline),
        "events_have_evidence_refs": all(event.get("evidence_ref") for event in active_timeline["timeline"])
        and all(event.get("evidence_ref") for event in final_timeline["timeline"]),
        "final_timeline_normal": final_timeline["status"] == "normal"
        and final_timeline["unresolved_events"] == 0
        and final_lifecycle["status"] == "normal",
        "retry_completed": retry_response["queue_item"]["status"] == "completed" and acknowledged["item"]["status"] == "acknowledged",
        "queue_id_traceable_after_resolution": bool(final_related_events),
        "gates_present": len(final_timeline["gates"]) >= 2,
    }
    evidence = {
        "task": "SAAS-1159-TIMELINE..SAAS-1168-TIMELINE",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "failed_queue_id": failed_queue_id,
        "dead_letter_id": dead_letter["id"],
        "active_timeline": active_timeline,
        "acknowledged_timeline": acknowledged_timeline,
        "final_timeline": final_timeline,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1168_ADMIN_INCIDENT_TIMELINE_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
