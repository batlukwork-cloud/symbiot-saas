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
    "x-actor": "queue-admin-action-audit-check",
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


def post_runbook_action(step_id: str, reason: str) -> dict:
    return request_json(
        f"/api/task-runs/queue/operations-runbook/actions/{step_id}",
        "POST",
        {
            "actor": "queue-admin-action-audit-check",
            "reason": reason,
            "interval_seconds": 0.2,
        },
    )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    before = request_json("/api/task-runs/queue/admin-action-audit")

    safe_stop_response = post_runbook_action(
        "runbook-safe-stop",
        "SAAS-1199-ACTION-AUDIT proof: safe local scheduler stop must be audited.",
    )
    after_safe_stop = request_json("/api/task-runs/queue/admin-action-audit")

    review_response = post_runbook_action(
        "runbook-audit-proof",
        "SAAS-1200-ACTION-AUDIT proof: review-only action request must also be audited.",
    )
    after_review = request_json("/api/task-runs/queue/admin-action-audit")
    command_center = request_json("/api/task-runs/queue/admin-command-center")

    latest_events = after_review["events"][:3]
    source_ids = {source["id"] for source in command_center["sources"]}
    checks = [
        {
            "id": "admin-action-audit-endpoint-ready",
            "passed": after_review["mode"] == "sqlite_mvp_queue_admin_action_audit",
            "evidence": after_review["mode"],
        },
        {
            "id": "safe-stop-action-audited",
            "passed": after_safe_stop["events_total"] >= before["events_total"] + 1
            and any(event["action_id"] == "runbook-safe-stop" and event["executed"] for event in after_safe_stop["events"]),
            "evidence": safe_stop_response,
        },
        {
            "id": "review-only-action-audited",
            "passed": after_review["events_total"] >= after_safe_stop["events_total"] + 1
            and any(event["action_id"] == "runbook-audit-proof" and not event["executed"] for event in after_review["events"]),
            "evidence": review_response,
        },
        {
            "id": "admin-action-audit-chain-valid",
            "passed": after_review["chain_valid"] is True and after_review["head_hash"] != "GENESIS",
            "evidence": {"head_hash": after_review["head_hash"], "latest_event_id": after_review["latest_event_id"]},
        },
        {
            "id": "audit-events-have-decision-context",
            "passed": all(event["actor"] and event["reason"] and event["status_before"] and event["status_after"] for event in latest_events),
            "evidence": latest_events,
        },
        {
            "id": "command-center-links-admin-action-audit",
            "passed": "admin-action-audit" in source_ids and command_center["sources_total"] >= 8,
            "evidence": {"sources_total": command_center["sources_total"], "source_ids": sorted(source_ids)},
        },
        {
            "id": "admin-action-audit-safe-scope",
            "passed": all("production" not in event["message"].lower() and "secret" not in event["message"].lower() for event in latest_events),
            "evidence": [event["message"] for event in latest_events],
        },
        {
            "id": "admin-action-audit-gates-pass",
            "passed": all(gate["status"] == "passed" for gate in after_review["gates"]),
            "evidence": after_review["gates"],
        },
        {
            "id": "runbook-response-contract-unchanged",
            "passed": safe_stop_response["status"] == "completed" and review_response["status"] == "review_required",
            "evidence": {"safe_stop": safe_stop_response["status"], "review": review_response["status"]},
        },
        {
            "id": "admin-action-audit-ui-ready-data",
            "passed": after_review["events_total"] > 0 and len(after_review["events"]) > 0,
            "evidence": {"events_total": after_review["events_total"], "visible_events": len(after_review["events"])},
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1208-QUEUE_ADMIN_ACTION_AUDIT_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "after_safe_stop": after_safe_stop,
        "after_review": after_review,
        "command_center_summary": {
            "status": command_center["status"],
            "operator_mode": command_center["operator_mode"],
            "sources_total": command_center["sources_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1208_QUEUE_ADMIN_ACTION_AUDIT_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
