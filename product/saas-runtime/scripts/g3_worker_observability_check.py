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
    "x-actor": "worker-observability-check",
    "x-role": "runtime-operator",
    "x-department": "sales",
    "x-access-level": "standard",
}


def request_json(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path}: {error.code} {detail}") from error


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": False,
        "form_data": {
            "goal": "Проверить worker observability.",
            "expected_artifact": "Worker observability evidence artifact",
            "source_context": "SAAS-1039-OBS..SAAS-1048-OBS repeatable check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queued_response = request_json("/api/task-runs/queue", "POST", payload)
    queue_id = queued_response["queue_item"]["id"]
    queued_observability = request_json("/api/task-runs/queue/observability")
    cancel_response = request_json(
        f"/api/task-runs/queue/{queue_id}/cancel",
        "POST",
        {
            "actor": "worker-observability-check",
            "reason": "Validate observability attention item.",
            "auto_process": False,
        },
    )
    cancelled_observability = request_json("/api/task-runs/queue/observability")
    retry_response = request_json(
        f"/api/task-runs/queue/{queue_id}/retry",
        "POST",
        {
            "actor": "worker-observability-check",
            "reason": "Validate observability recovery.",
            "auto_process": True,
        },
    )
    final_observability = request_json("/api/task-runs/queue/observability")
    queue_status = request_json("/api/task-runs/queue/status")

    checks = {
        "observability_endpoint_ready": final_observability["mode"] == "sqlite_mvp_observability",
        "worker_health_present": final_observability["health"] in {"healthy", "degraded", "attention_required"},
        "summary_is_human_readable": bool(final_observability["summary"]),
        "totals_include_attention": "attention" in final_observability["totals"],
        "recommendations_present": bool(final_observability["recommendations"]),
        "queue_status_embedded": final_observability["queue_status"]["mode"] == "sqlite_mvp_queue",
        "queued_state_seen": queued_observability["totals"]["queued"] + queued_observability["totals"]["retrying"] >= 1,
        "cancel_attention_seen": any(item["queue_id"] == queue_id for item in cancelled_observability["attention_items"]),
        "retry_completed": retry_response["queue_item"]["status"] == "completed",
        "event_log_visible": queue_status["events"] and final_observability["recent_events_total"] >= len(queue_status["events"]),
    }
    evidence = {
        "task": "SAAS-1039-OBS..SAAS-1048-OBS",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_id": queue_id,
        "task_run_id": queued_response["task_run"]["id"],
        "cancel_status": cancel_response["queue_item"]["status"],
        "retry_status": retry_response["queue_item"]["status"],
        "observability": {
            "health": final_observability["health"],
            "summary": final_observability["summary"],
            "totals": final_observability["totals"],
            "recommendations": final_observability["recommendations"],
            "attention_items_total": len(final_observability["attention_items"]),
            "recent_events_total": final_observability["recent_events_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1048_WORKER_OBSERVABILITY_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
