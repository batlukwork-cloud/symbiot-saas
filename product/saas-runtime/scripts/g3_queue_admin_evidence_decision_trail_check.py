from __future__ import annotations

import json
import os
import urllib.parse
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
    "x-actor": "queue-admin-evidence-decision-trail-check",
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


def query(path: str, params: dict[str, str | int]) -> dict:
    return request_json(f"{path}?{urllib.parse.urlencode(params)}")


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    run_token = started_at.replace(":", "").replace("-", "").replace(".", "")
    source_ref = f"direct-evidence-decision-trail-{run_token}"
    rework_note = "Decision trail proof: evidence has weak source linkage and must be corrected."
    approve_note = "Decision trail proof: corrected evidence is accepted and can close the gate."

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Decision trail evidence",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1258 proof: evidence decisions must expose summary, next action and audit trail.",
            "evidence_ref": f"decision-trail-proof-{run_token}",
            "related_action_id": f"command-evidence-decision-trail-{run_token}",
        },
    )
    pending_slice = query("/api/task-runs/queue/evidence-review", {"limit": 100, "source_query": source_ref})
    reworked = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/rework",
        "POST",
        {
            "actor": "queue-admin-evidence-decision-trail-check",
            "reason": "Return decision trail proof case for rework.",
            "review_note": rework_note,
        },
    )
    rework_slice = query("/api/task-runs/queue/evidence-review", {"limit": 100, "source_query": source_ref})
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-decision-trail-check",
            "reason": "Accept corrected decision trail proof case.",
            "review_note": approve_note,
        },
    )
    approved_slice = query("/api/task-runs/queue/evidence-review", {"limit": 100, "source_query": source_ref})
    action_audit = request_json("/api/task-runs/queue/admin-action-audit")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    pending_item = next((item for item in pending_slice["items"] if item["id"] == review["id"]), None)
    rework_item = next((item for item in rework_slice["items"] if item["id"] == review["id"]), None)
    approved_item = next((item for item in approved_slice["items"] if item["id"] == review["id"]), None)
    decision_events = approved_slice.get("decision_events", [])
    related_events = [
        event for event in decision_events
        if event.get("evidence_ref") == review["evidence_ref"] or review["id"] in event.get("action_id", "")
    ]

    checks = [
        {
            "id": "decision-fields-pending-visible",
            "passed": pending_item is not None
            and pending_item["decision_quality"] == "needs_decision"
            and "next_action" in pending_item
            and pending_item["next_action"],
            "evidence": pending_item,
        },
        {
            "id": "decision-fields-rework-visible",
            "passed": reworked["status"] == "rework"
            and rework_item is not None
            and rework_item["decision_quality"] == "needs_rework"
            and rework_note in rework_item["decision_summary"],
            "evidence": {"reworked": reworked, "rework_item": rework_item},
        },
        {
            "id": "decision-fields-approved-visible",
            "passed": approved["status"] == "approved"
            and approved_item is not None
            and approved_item["decision_quality"] == "accepted"
            and approve_note == approved_item["review_note"],
            "evidence": {"approved": approved, "approved_item": approved_item},
        },
        {
            "id": "decision-trail-events-visible",
            "passed": len(related_events) >= 2
            and any(event["status_after"] == "rework" for event in related_events)
            and any(event["status_after"] == "approved" for event in related_events),
            "evidence": {"related_events": related_events, "decision_events": decision_events},
        },
        {
            "id": "decision-trail-gate-visible",
            "passed": "queue-evidence-review-decision-trail-visible" in {gate["id"] for gate in approved_slice["gates"]},
            "evidence": approved_slice["gates"],
        },
        {
            "id": "admin-action-audit-chain-still-valid",
            "passed": action_audit["chain_valid"] is True,
            "evidence": {"head_hash": action_audit["head_hash"], "events_total": action_audit["events_total"]},
        },
        {
            "id": "decision-trail-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Комментарий решения QA/admin",
                    "История решений evidence",
                    "decision_quality",
                    "next_action",
                    "evidenceReviewDecisionNote",
                )
            ),
            "evidence": "Decision trail controls are present in Product Workbench source.",
        },
        {
            "id": "decision-trail-ui-styles-exist",
            "passed": ".evidence-review-decision-note" in style_source
            and ".evidence-review-decision-trail" in style_source,
            "evidence": "Decision trail CSS classes exist.",
        },
        {
            "id": "decision-trail-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (review, reworked, approved, approved_slice)
            ),
            "evidence": "Decision trail uses local runtime API and admin UI only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1258-QUEUE_ADMIN_EVIDENCE_DECISION_TRAIL_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "review": review,
        "reworked": reworked,
        "approved": approved,
        "approved_slice": approved_slice,
        "action_audit_summary": {
            "chain_valid": action_audit["chain_valid"],
            "events_total": action_audit["events_total"],
            "head_hash": action_audit["head_hash"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1258_QUEUE_ADMIN_EVIDENCE_DECISION_TRAIL_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
