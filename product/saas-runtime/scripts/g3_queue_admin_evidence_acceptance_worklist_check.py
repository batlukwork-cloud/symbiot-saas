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
    "x-actor": "queue-admin-evidence-acceptance-worklist-check",
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
    source_ref = f"direct-evidence-acceptance-worklist-{run_token}"

    before = request_json("/api/task-runs/queue/evidence-review/acceptance-worklist")
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance worklist proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1318 proof: worklist must expose actionable pending blocker first.",
            "evidence_ref": f"evidence-acceptance-worklist-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-worklist-{run_token}",
        },
    )
    during = request_json("/api/task-runs/queue/evidence-review/acceptance-worklist")
    pending_slice = request_json(f"{during['items'][0]['action_target']}&limit=100")
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-worklist-check",
            "reason": "Cleanup acceptance worklist proof case after worklist action routing is verified.",
            "review_note": "Acceptance worklist proof accepted: pending blocker was first actionable item.",
        },
    )
    after = request_json("/api/task-runs/queue/evidence-review/acceptance-worklist")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "worklist-endpoint-responds",
            "passed": before["mode"] == "queue_evidence_acceptance_blocker_worklist"
            and len(before["package_hash"]) == 64,
            "evidence": before,
        },
        {
            "id": "worklist-actionable-only",
            "passed": all(item["status"] in {"failed", "warning"} and item["action_kind"] != "none" for item in during["items"]),
            "evidence": during["items"],
        },
        {
            "id": "worklist-prioritizes-pending-first",
            "passed": during["status"] == "critical"
            and during["items"][0]["id"] == "no-pending-review"
            and during["items"][0]["action_kind"] == "filter_pending",
            "evidence": during["items"][:3],
        },
        {
            "id": "worklist-counters-reconcile",
            "passed": during["blockers_total"] + during["warnings_total"] == during["actionable_total"] == len(during["items"]),
            "evidence": {
                "blockers": during["blockers_total"],
                "warnings": during["warnings_total"],
                "actionable": during["actionable_total"],
                "items": len(during["items"]),
            },
        },
        {
            "id": "worklist-first-action-opens-pending-slice",
            "passed": any(item["id"] == review["id"] and item["status"] == "pending" for item in pending_slice["items"]),
            "evidence": {"review_id": review["id"], "slice_total": pending_slice["total"]},
        },
        {
            "id": "worklist-gates-visible",
            "passed": {
                "queue-evidence-acceptance-worklist-actionable-only",
                "queue-evidence-acceptance-worklist-prioritized",
                "queue-evidence-acceptance-worklist-safe-scope",
            }.issubset({gate["id"] for gate in during["gates"]}),
            "evidence": during["gates"],
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-worklist-check",
            "evidence": approved,
        },
        {
            "id": "worklist-after-cleanup-responds",
            "passed": after["mode"] == "queue_evidence_acceptance_blocker_worklist",
            "evidence": after,
        },
        {
            "id": "worklist-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Список блокеров",
                    "evidenceAcceptanceWorklist",
                    "loadEvidenceAcceptanceWorklist",
                    "evidence-acceptance-worklist",
                )
            ),
            "evidence": "Acceptance worklist UI markers are present.",
        },
        {
            "id": "worklist-styles-exist",
            "passed": ".evidence-acceptance-worklist" in style_source
            and ".evidence-acceptance-worklist-item" in style_source,
            "evidence": "Acceptance worklist CSS classes exist.",
        },
        {
            "id": "worklist-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (before, during, after)
            ),
            "evidence": "Acceptance worklist composes local checklist state only.",
        },
    ]
    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1318-QUEUE_EVIDENCE_ACCEPTANCE_WORKLIST_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "review": review,
        "during": during,
        "pending_slice": pending_slice,
        "approved": approved,
        "after": after,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1318_QUEUE_EVIDENCE_ACCEPTANCE_WORKLIST_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
