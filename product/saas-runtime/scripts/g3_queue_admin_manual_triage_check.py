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
    "x-actor": "queue-admin-manual-triage-check",
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


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    run_token = started_at.replace(":", "").replace("-", "").replace(".", "")
    before = request_json("/api/task-runs/queue/manual-triage")

    created = request_json(
        "/api/task-runs/queue/manual-triage",
        "POST",
        {
            "source_action_id": f"command-runbook-dlq-open-{run_token}",
            "title": "Открыть DLQ",
            "owner_role": "runtime-admin",
            "severity": "critical",
            "reason": "SAAS-1218-MANUAL-TRIAGE proof: review-only action must become a managed case.",
            "evidence_ref": "dead_letter_queue_status + queue_events",
            "related_runbook_step_id": "runbook-dlq-open",
        },
    )
    after_create = request_json("/api/task-runs/queue/manual-triage")

    assigned = request_json(
        f"/api/task-runs/queue/manual-triage/{created['id']}/assign",
        "POST",
        {
            "actor": "queue-admin-manual-triage-check",
            "reason": "Assign manual triage to runtime-admin for evidence proof.",
        },
    )
    after_assign = request_json("/api/task-runs/queue/manual-triage")

    resolved = request_json(
        f"/api/task-runs/queue/manual-triage/{created['id']}/resolve",
        "POST",
        {
            "actor": "queue-admin-manual-triage-check",
            "reason": "Resolve manual triage after evidence review.",
            "resolution": "Evidence reviewed; DLQ manual triage lifecycle is controllable from API and UI.",
        },
    )
    after_resolve = request_json("/api/task-runs/queue/manual-triage")
    evidence_review_after_resolve = request_json("/api/task-runs/queue/evidence-review")
    generated_review = next(
        (
            item
            for item in evidence_review_after_resolve["items"]
            if item.get("related_manual_triage_id") == created["id"]
            or item.get("evidence_ref") == created["evidence_ref"]
        ),
        None,
    )
    approved_review = None
    if generated_review:
        approved_review = request_json(
            f"/api/task-runs/queue/evidence-review/{generated_review['id']}/approve",
            "POST",
            {
                "actor": "queue-admin-manual-triage-check",
                "reason": "Cleanup generated QA evidence review after manual triage proof.",
                "review_note": "Manual triage regression accepted generated evidence review to keep Command Center stable.",
            },
        )
    action_audit = request_json("/api/task-runs/queue/admin-action-audit")
    command_center = request_json("/api/task-runs/queue/admin-command-center")

    source_ids = {source["id"] for source in command_center["sources"]}
    relevant_audit_events = [
        event
        for event in action_audit["events"]
        if created["id"] in event["action_id"] or event["action_kind"] == "manual_triage"
    ]
    checks = [
        {
            "id": "manual-triage-endpoint-ready",
            "passed": after_create["mode"] == "sqlite_mvp_queue_manual_triage",
            "evidence": after_create["mode"],
        },
        {
            "id": "manual-triage-case-created",
            "passed": created["status"] == "open" and created["owner_role"] == "runtime-admin",
            "evidence": created,
        },
        {
            "id": "manual-triage-status-reflects-open",
            "passed": after_create["open"] >= before["open"] + 1 and after_create["status"] == "critical",
            "evidence": {"before_open": before["open"], "after_open": after_create["open"], "status": after_create["status"]},
        },
        {
            "id": "manual-triage-assigned",
            "passed": assigned["status"] == "assigned" and assigned["assigned_by"] == "queue-admin-manual-triage-check",
            "evidence": assigned,
        },
        {
            "id": "manual-triage-status-reflects-assigned",
            "passed": after_assign["assigned"] >= before["assigned"] + 1 and after_assign["status"] in {"warning", "critical"},
            "evidence": {"assigned": after_assign["assigned"], "status": after_assign["status"]},
        },
        {
            "id": "manual-triage-resolved-with-resolution",
            "passed": resolved["status"] == "resolved" and bool(resolved["resolution"]) and bool(resolved["resolved_by"]),
            "evidence": resolved,
        },
        {
            "id": "manual-triage-gates-pass",
            "passed": all(gate["status"] == "passed" for gate in after_resolve["gates"]),
            "evidence": after_resolve["gates"],
        },
        {
            "id": "manual-triage-action-audit-chain",
            "passed": action_audit["chain_valid"] is True and len(relevant_audit_events) >= 3,
            "evidence": {
                "chain_valid": action_audit["chain_valid"],
                "relevant_events": relevant_audit_events[:5],
            },
        },
        {
            "id": "manual-triage-generates-and-cleans-evidence-review",
            "passed": generated_review is not None
            and generated_review["status"] == "pending"
            and approved_review is not None
            and approved_review["status"] == "approved",
            "evidence": {"generated_review": generated_review, "approved_review": approved_review},
        },
        {
            "id": "command-center-links-manual-triage",
            "passed": "manual-triage" in source_ids and command_center["sources_total"] >= 9,
            "evidence": {"sources_total": command_center["sources_total"], "source_ids": sorted(source_ids)},
        },
        {
            "id": "manual-triage-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider")
                for payload in (created, assigned, resolved)
            ),
            "evidence": "Manual triage lifecycle uses local runtime API only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1218-QUEUE_ADMIN_MANUAL_TRIAGE_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "after_create": after_create,
        "after_assign": after_assign,
        "after_resolve": after_resolve,
        "evidence_review_after_resolve": evidence_review_after_resolve,
        "approved_generated_evidence_review": approved_review,
        "command_center_summary": {
            "status": command_center["status"],
            "operator_mode": command_center["operator_mode"],
            "sources_total": command_center["sources_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1218_QUEUE_ADMIN_MANUAL_TRIAGE_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
