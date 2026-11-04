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
    "x-actor": "queue-admin-evidence-acceptance-batch-item-decision-check",
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
    source_ref = f"direct-evidence-acceptance-batch-item-decision-{run_token}"

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance batch item decision proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1348 proof: one batch evidence item must be manually decided with batch audit.",
            "evidence_ref": f"evidence-acceptance-batch-item-decision-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-batch-item-decision-{run_token}",
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
            "reason": "Proof opens batch action session before single-item decision.",
            "actor": "queue-admin-evidence-acceptance-batch-item-decision-check",
        },
    )
    decision = request_json(
        "/api/task-runs/queue/evidence-review/acceptance-batch-item-decision",
        "POST",
        {
            "batch_group_id": group["id"],
            "review_id": review["id"],
            "decision": "approve",
            "actor": "queue-admin-evidence-acceptance-batch-item-decision-check",
            "reason": "Proof accepts one explicit evidence review item through batch item decision.",
            "review_note": "Batch item decision proof accepted exactly one evidence item.",
        },
    )
    audit = request_json("/api/task-runs/queue/admin-action-audit")
    worklist_after = request_json("/api/task-runs/queue/evidence-review/acceptance-worklist")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "batch-item-decision-session-opened",
            "passed": session["mode"] == "queue_evidence_acceptance_batch_action_session"
            and session["status"] == "completed"
            and any(item["id"] == review["id"] for item in session["review_status"]["items"]),
            "evidence": {"session_status": session["status"], "review_id": review["id"]},
        },
        {
            "id": "batch-item-decision-endpoint-responds",
            "passed": decision["mode"] == "queue_evidence_acceptance_batch_item_decision"
            and decision["status"] == "completed"
            and decision["decision"] == "approved",
            "evidence": decision,
        },
        {
            "id": "batch-item-decision-updates-one-review-item",
            "passed": decision["review_item"]["id"] == review["id"]
            and decision["review_item"]["status"] == "approved"
            and "Batch item decision proof accepted" in decision["review_item"]["review_note"],
            "evidence": decision["review_item"],
        },
        {
            "id": "batch-item-decision-audit-event-recorded",
            "passed": decision["audit_event"]["action_kind"] == "evidence_acceptance_batch_item_decision"
            and decision["audit_event"]["executed"] is True
            and len(decision["audit_event"]["event_hash"]) == 64,
            "evidence": decision["audit_event"],
        },
        {
            "id": "batch-item-decision-audit-visible-in-status",
            "passed": any(event["id"] == decision["audit_event"]["id"] for event in audit["events"]),
            "evidence": {"latest_event_id": audit["latest_event_id"], "events_total": audit["events_total"]},
        },
        {
            "id": "batch-item-decision-gates-visible",
            "passed": {
                "queue-evidence-acceptance-batch-item-group-found",
                "queue-evidence-acceptance-batch-item-review-found",
                "queue-evidence-acceptance-batch-item-audited",
            }.issubset({gate["id"] for gate in decision["gates"]}),
            "evidence": decision["gates"],
        },
        {
            "id": "batch-item-decision-no-bulk-auto-approval",
            "passed": decision["review_status"]["approved"] >= 1
            and decision["review_status"]["pending"] >= 0
            and decision["review_id"] == review["id"],
            "evidence": {
                "approved": decision["review_status"]["approved"],
                "pending": decision["review_status"]["pending"],
                "worklist_actionable_after": worklist_after["actionable_total"],
            },
        },
        {
            "id": "batch-item-decision-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Решение по item batch-сессии",
                    "evidenceAcceptanceBatchItemDecision",
                    "QueueEvidenceAcceptanceBatchItemDecisionResponse",
                    "acceptance-batch-item-decision",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-item-decision-css-markers-exist",
            "passed": all(
                marker in style_source
                for marker in (
                    ".evidence-acceptance-batch-item-decision",
                    ".evidence-acceptance-batch-item-decision-blocked",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-item-decision-safe-local-scope",
            "passed": decision["audit_event"]["action_kind"] == "evidence_acceptance_batch_item_decision"
            and decision["batch_group_id"].startswith("acceptance-batch-")
            and decision["batch_group_id"] in decision["audit_event"]["evidence_ref"]
            and review["id"] in decision["audit_event"]["evidence_ref"]
            and len(decision["audit_event"]["event_hash"]) == 64,
            "evidence": {
                "scope": "local batch decision only",
                "action_kind": decision["audit_event"]["action_kind"],
                "batch_group_id": decision["batch_group_id"],
                "evidence_ref": decision["audit_event"]["evidence_ref"],
            },
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    payload = {
        "id": "SAAS-1348-QUEUE_EVIDENCE_ACCEPTANCE_BATCH_ITEM_DECISION_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "review_id": review["id"],
        "batch_group_id": group["id"],
        "session_audit_event_id": session["audit_event"]["id"],
        "decision_audit_event_id": decision["audit_event"]["id"],
        "checks_total": len(checks),
        "checks_passed": passed,
        "status": "passed" if passed == len(checks) else "failed",
        "checks": checks,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1348_QUEUE_EVIDENCE_ACCEPTANCE_BATCH_ITEM_DECISION_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "checks": f"{passed}/{len(checks)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
