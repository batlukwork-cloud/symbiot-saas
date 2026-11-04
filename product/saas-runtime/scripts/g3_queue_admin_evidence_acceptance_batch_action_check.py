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
    "x-actor": "queue-admin-evidence-acceptance-batch-action-check",
    "x-role": "admin",
    "x-department": "quality",
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
    source_ref = f"direct-evidence-acceptance-batch-action-{run_token}"

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance batch action proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1338 proof: batch action session must open pending review slice and audit the action.",
            "evidence_ref": f"evidence-acceptance-batch-action-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-batch-action-{run_token}",
        },
    )
    plan = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    group = plan["groups"][0]
    session = request_json(
        "/api/task-runs/queue/evidence-review/acceptance-batch-action",
        "POST",
        {
            "group_id": group["id"],
            "action_kind": group["action_kind"],
            "action_label": group["action_label"],
            "action_target": group["action_target"],
            "item_ids": group["item_ids"],
            "owner_roles": group["owner_roles"],
            "reason": "Proof opens first acceptance batch action session.",
            "actor": "queue-admin-evidence-acceptance-batch-action-check",
        },
    )
    audit = request_json("/api/task-runs/queue/admin-action-audit")
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-batch-action-check",
            "reason": "Cleanup acceptance batch action proof case after session routing is verified.",
            "review_note": "Acceptance batch action proof accepted: pending batch session opened and audited.",
        },
    )
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "batch-action-plan-has-first-group",
            "passed": plan["mode"] == "queue_evidence_acceptance_batch_plan"
            and group["action_kind"] == "filter_pending",
            "evidence": group,
        },
        {
            "id": "batch-action-endpoint-responds",
            "passed": session["mode"] == "queue_evidence_acceptance_batch_action_session"
            and session["status"] == "completed",
            "evidence": session,
        },
        {
            "id": "batch-action-opens-pending-review-slice",
            "passed": any(item["id"] == review["id"] and item["status"] == "pending" for item in session["review_status"]["items"]),
            "evidence": {"review_id": review["id"], "returned": [item["id"] for item in session["review_status"]["items"][:5]]},
        },
        {
            "id": "batch-action-audit-event-recorded",
            "passed": session["audit_event"]["action_kind"] == "evidence_acceptance_batch_action"
            and session["audit_event"]["executed"] is True
            and len(session["audit_event"]["event_hash"]) == 64,
            "evidence": session["audit_event"],
        },
        {
            "id": "batch-action-audit-visible-in-status",
            "passed": any(event["id"] == session["audit_event"]["id"] for event in audit["events"]),
            "evidence": {"latest_event_id": audit["latest_event_id"], "events_total": audit["events_total"]},
        },
        {
            "id": "batch-action-gates-visible",
            "passed": {
                "queue-evidence-acceptance-batch-action-group-found",
                "queue-evidence-acceptance-batch-action-safe-target",
                "queue-evidence-acceptance-batch-action-audited",
            }.issubset({gate["id"] for gate in session["gates"]}),
            "evidence": session["gates"],
        },
        {
            "id": "batch-action-safe-local-target",
            "passed": str(session["action_target"]).startswith("/api/task-runs/queue/evidence-review")
            and not str(session["action_target"]).startswith(("http://", "https://")),
            "evidence": {"target": session["action_target"]},
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-batch-action-check",
            "evidence": approved,
        },
        {
            "id": "batch-action-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Batch-сессия разбора",
                    "evidenceAcceptanceBatchAction",
                    "QueueEvidenceAcceptanceBatchActionResponse",
                    "acceptance-batch-action",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-action-css-markers-exist",
            "passed": all(
                marker in style_source
                for marker in (
                    ".evidence-acceptance-batch-session",
                    ".evidence-acceptance-batch-session-review_required",
                    ".evidence-acceptance-batch-session-blocked",
                )
            ),
            "evidence": {"markers": "present"},
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    payload = {
        "id": "SAAS-1338-QUEUE_EVIDENCE_ACCEPTANCE_BATCH_ACTION_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "review_id": review["id"],
        "batch_group_id": group["id"],
        "audit_event_id": session["audit_event"]["id"],
        "checks_total": len(checks),
        "checks_passed": passed,
        "status": "passed" if passed == len(checks) else "failed",
        "checks": checks,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1338_QUEUE_EVIDENCE_ACCEPTANCE_BATCH_ACTION_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "checks": f"{passed}/{len(checks)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
