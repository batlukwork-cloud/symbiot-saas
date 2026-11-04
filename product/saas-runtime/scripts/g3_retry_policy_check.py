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
    "x-actor": "retry-policy-check",
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
    policy = request_json("/api/task-runs/queue/retry-policy")
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": False,
        "form_data": {
            "goal": "Проверить retry policy.",
            "expected_artifact": "Retry policy evidence artifact",
            "source_context": "SAAS-1049-RETRY..SAAS-1058-RETRY repeatable check",
            "urgency": "normal",
            "simulate_worker_failure_attempts": 2,
        },
        "document_ids": ["doc-demo-001"],
    }
    queued_response = request_json("/api/task-runs/queue", "POST", payload)
    queue_id = queued_response["queue_item"]["id"]
    task_run_id = queued_response["task_run"]["id"]
    for _ in range(20):
        request_json("/api/task-runs/queue/process-next", "POST")
        first_item = request_json(f"/api/task-runs/queue/{queue_id}")
        if first_item["status"] != "queued":
            break
    for _ in range(20):
        request_json("/api/task-runs/queue/process-next", "POST")
        second_item = request_json(f"/api/task-runs/queue/{queue_id}")
        if second_item["status"] == "failed":
            break
    failed_observability = request_json("/api/task-runs/queue/observability")
    manual_retry = request_json(
        f"/api/task-runs/queue/{queue_id}/retry",
        "POST",
        {
            "actor": "retry-policy-check",
            "reason": "Validate manual override after retry exhaustion.",
            "auto_process": True,
        },
    )
    result_center = request_json(f"/api/task-runs/{task_run_id}/result-center")
    queue_events = request_json(f"/api/task-runs/queue/{queue_id}/events")
    event_types = [event["event_type"] for event in queue_events]

    checks = {
        "retry_policy_endpoint_ready": policy["mode"] == "sqlite_mvp_retry_policy",
        "policy_has_terminal_failed": policy["terminal_status"] == "failed",
        "first_attempt_retrying": first_item["status"] == "retrying" and first_item["attempts"] == 1,
        "second_attempt_failed": second_item["status"] == "failed" and second_item["attempts"] == 2,
        "observability_attention_after_failed": failed_observability["health"] == "attention_required",
        "event_retry_scheduled": "retry_scheduled" in event_types,
        "event_retry_policy_applied": "retry_policy_applied" in event_types,
        "event_retry_exhausted": "retry_exhausted" in event_types,
        "manual_retry_completes_after_override": manual_retry["queue_item"]["status"] == "completed",
        "result_center_ready_after_retry": result_center["product_status"] == "ready_for_acceptance",
    }
    evidence = {
        "task": "SAAS-1049-RETRY..SAAS-1058-RETRY",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "queue_id": queue_id,
        "task_run_id": task_run_id,
        "policy": {
            "policy_version": policy["policy_version"],
            "max_attempts": policy["max_attempts"],
            "base_delay_seconds": policy["base_delay_seconds"],
            "max_delay_seconds": policy["max_delay_seconds"],
            "backoff_multiplier": policy["backoff_multiplier"],
            "manual_override_allowed": policy["manual_override_allowed"],
        },
        "first_item": first_item,
        "second_item": second_item,
        "manual_retry_status": manual_retry["queue_item"]["status"],
        "event_types_for_queue": event_types,
        "failed_observability_health": failed_observability["health"],
        "result_center_status": result_center["product_status"],
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1058_RETRY_POLICY_SEGMENT_EVIDENCE_2026-07-06.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
