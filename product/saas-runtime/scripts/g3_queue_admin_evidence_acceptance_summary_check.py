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
    "x-actor": "queue-admin-evidence-acceptance-summary-check",
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
    source_ref = f"direct-evidence-acceptance-summary-{run_token}"

    before = request_json("/api/task-runs/queue/evidence-review/acceptance-summary")
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance summary proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1308 proof: acceptance summary must expose primary blocker and first admin action.",
            "evidence_ref": f"evidence-acceptance-summary-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-summary-{run_token}",
        },
    )
    during = request_json("/api/task-runs/queue/evidence-review/acceptance-summary")
    checklist = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    pending_slice = request_json(f"{during['primary_action_target']}&limit=100")
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-summary-check",
            "reason": "Cleanup acceptance summary proof case after primary action routing is verified.",
            "review_note": "Acceptance summary proof accepted: primary blocker and action were visible.",
        },
    )
    after = request_json("/api/task-runs/queue/evidence-review/acceptance-summary")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "summary-endpoint-responds",
            "passed": before["mode"] == "queue_evidence_acceptance_summary"
            and len(before["package_hash"]) == 64
            and before["checklist_items_total"] >= 8,
            "evidence": before,
        },
        {
            "id": "summary-selects-primary-blocker",
            "passed": during["status"] == "critical"
            and during["primary_blocker_id"] == "no-pending-review"
            and during["primary_action_kind"] == "filter_pending",
            "evidence": during,
        },
        {
            "id": "summary-counters-reconcile",
            "passed": during["blockers_total"] + during["warnings_total"] + during["passed_total"] == during["checklist_items_total"],
            "evidence": {
                "blockers": during["blockers_total"],
                "warnings": during["warnings_total"],
                "passed": during["passed_total"],
                "total": during["checklist_items_total"],
            },
        },
        {
            "id": "summary-action-opens-pending-slice",
            "passed": any(item["id"] == review["id"] and item["status"] == "pending" for item in pending_slice["items"]),
            "evidence": {"review_id": review["id"], "slice_total": pending_slice["total"], "target": during["primary_action_target"]},
        },
        {
            "id": "summary-and-checklist-package-contracts-are-valid",
            "passed": during["package_id"].startswith("queue-evidence-package-")
            and checklist["package_id"].startswith("queue-evidence-package-")
            and len(during["package_hash"]) == 64
            and len(checklist["package_hash"]) == 64
            and during["checklist_items_total"] == len(checklist["items"]),
            "evidence": {"summary": during["package_id"], "checklist": checklist["package_id"]},
        },
        {
            "id": "summary-gates-visible",
            "passed": {
                "queue-evidence-acceptance-summary-primary-action",
                "queue-evidence-acceptance-summary-counts",
                "queue-evidence-acceptance-summary-safe-scope",
            }.issubset({gate["id"] for gate in during["gates"]}),
            "evidence": during["gates"],
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-summary-check",
            "evidence": approved,
        },
        {
            "id": "summary-after-cleanup-responds",
            "passed": after["mode"] == "queue_evidence_acceptance_summary" and after["checklist_items_total"] == before["checklist_items_total"],
            "evidence": after,
        },
        {
            "id": "summary-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Сводка приемки",
                    "evidenceAcceptanceSummary",
                    "runEvidenceAcceptanceSummaryPrimaryAction",
                    "evidence-acceptance-summary",
                )
            ),
            "evidence": "Acceptance summary UI markers are present.",
        },
        {
            "id": "summary-styles-exist",
            "passed": ".evidence-acceptance-summary" in style_source
            and ".evidence-acceptance-summary-primary" in style_source,
            "evidence": "Acceptance summary CSS classes exist.",
        },
        {
            "id": "summary-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (before, during, after)
            ),
            "evidence": "Acceptance summary composes local checklist state only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1308-QUEUE_EVIDENCE_ACCEPTANCE_SUMMARY_SEGMENT",
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
        "checklist": checklist,
        "pending_slice": pending_slice,
        "approved": approved,
        "after": after,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1308_QUEUE_EVIDENCE_ACCEPTANCE_SUMMARY_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
