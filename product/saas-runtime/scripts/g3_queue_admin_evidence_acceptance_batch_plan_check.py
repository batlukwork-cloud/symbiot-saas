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
    "x-actor": "queue-admin-evidence-acceptance-batch-plan-check",
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
    source_ref = f"direct-evidence-acceptance-batch-plan-{run_token}"

    before = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance batch plan proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1328 proof: batch plan must group actionable pending blockers.",
            "evidence_ref": f"evidence-acceptance-batch-plan-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-batch-plan-{run_token}",
        },
    )
    during = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    first_target = during["first_action_target"] or "/api/task-runs/queue/evidence-review?status=pending"
    pending_slice = request_json(f"{first_target}&limit=100")
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-batch-plan-check",
            "reason": "Cleanup acceptance batch plan proof case after grouped action routing is verified.",
            "review_note": "Acceptance batch plan proof accepted: pending blockers were grouped into first batch action.",
        },
    )
    after = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")
    during_groups = during["groups"]
    first_group = during_groups[0] if during_groups else {}

    checks = [
        {
            "id": "batch-plan-endpoint-responds",
            "passed": before["mode"] == "queue_evidence_acceptance_batch_plan"
            and len(before["package_hash"]) == 64,
            "evidence": before,
        },
        {
            "id": "batch-plan-groups-actionable-items",
            "passed": all(group["action_kind"] != "none" and group["items_total"] > 0 for group in during_groups),
            "evidence": during_groups,
        },
        {
            "id": "batch-plan-prioritizes-pending-first",
            "passed": during["status"] == "critical"
            and first_group.get("action_kind") == "filter_pending"
            and "no-pending-review" in first_group.get("item_ids", []),
            "evidence": first_group,
        },
        {
            "id": "batch-plan-first-action-target-opens-review-slice",
            "passed": any(item["id"] == review["id"] and item["status"] == "pending" for item in pending_slice["items"]),
            "evidence": {"review_id": review["id"], "slice_total": pending_slice["total"], "target": first_target},
        },
        {
            "id": "batch-plan-counters-visible",
            "passed": during["groups_total"] == len(during_groups)
            and during["blockers_total"] >= 1
            and during["warnings_total"] >= 0,
            "evidence": {
                "groups_total": during["groups_total"],
                "blockers_total": during["blockers_total"],
                "warnings_total": during["warnings_total"],
            },
        },
        {
            "id": "batch-plan-gates-visible",
            "passed": {
                "queue-evidence-acceptance-batch-plan-groups-actionable",
                "queue-evidence-acceptance-batch-plan-first-action",
                "queue-evidence-acceptance-batch-plan-safe-scope",
            }.issubset({gate["id"] for gate in during["gates"]}),
            "evidence": during["gates"],
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-batch-plan-check",
            "evidence": approved,
        },
        {
            "id": "batch-plan-after-cleanup-responds",
            "passed": after["mode"] == "queue_evidence_acceptance_batch_plan",
            "evidence": after,
        },
        {
            "id": "batch-plan-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "План разбора",
                    "evidenceAcceptanceBatchPlan",
                    "loadEvidenceAcceptanceBatchPlan",
                    "evidence-acceptance-batch-plan",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-plan-css-markers-exist",
            "passed": all(
                marker in style_source
                for marker in (
                    ".evidence-acceptance-batch-plan",
                    ".evidence-acceptance-batch-group",
                    ".evidence-acceptance-batch-plan-critical",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-plan-safe-local-scope",
            "passed": all((group.get("action_target") or "").startswith("/api/task-runs/queue/evidence-review") for group in during_groups)
            and all(not (group.get("action_target") or "").startswith(("http://", "https://")) for group in during_groups),
            "evidence": {"scope": "local acceptance aggregation only", "targets": [group.get("action_target") for group in during_groups]},
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    payload = {
        "id": "SAAS-1328-QUEUE_EVIDENCE_ACCEPTANCE_BATCH_PLAN_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "review_id": review["id"],
        "checks_total": len(checks),
        "checks_passed": passed,
        "status": "passed" if passed == len(checks) else "failed",
        "checks": checks,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1328_QUEUE_EVIDENCE_ACCEPTANCE_BATCH_PLAN_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "checks": f"{passed}/{len(checks)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
