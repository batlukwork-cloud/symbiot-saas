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
    "x-actor": "queue-admin-evidence-acceptance-checklist-check",
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


def item_map(checklist: dict) -> dict[str, dict]:
    return {item["id"]: item for item in checklist["items"]}


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    run_token = started_at.replace(":", "").replace("-", "").replace(".", "")
    source_ref = f"direct-evidence-acceptance-checklist-{run_token}"

    before = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    before_items = item_map(before)
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance checklist proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1288 proof: checklist must block internal acceptance while a pending review case exists.",
            "evidence_ref": f"evidence-acceptance-checklist-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-checklist-{run_token}",
        },
    )
    during = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    during_items = item_map(during)
    archived = request_json("/api/task-runs/queue/evidence-review/package/archive", "POST", {})
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-checklist-check",
            "reason": "Cleanup acceptance checklist proof case after blocked state is verified.",
            "review_note": "Acceptance checklist proof accepted: pending blocker was visible before cleanup.",
        },
    )
    after = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    after_items = item_map(after)
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    required_items = {
        "package-built",
        "internal-only",
        "archive-history-present",
        "no-pending-review",
        "no-rework-review",
        "no-overdue-review",
        "decision-trail-linked",
        "package-gates-pass",
    }
    required_gates = {
        "queue-evidence-acceptance-checklist-complete",
        "queue-evidence-acceptance-checklist-ready-state",
        "queue-evidence-acceptance-checklist-safe-scope",
    }
    checks = [
        {
            "id": "checklist-endpoint-responds",
            "passed": before["mode"] == "queue_evidence_acceptance_checklist"
            and len(before["package_hash"]) == 64
            and before["package_id"].startswith("queue-evidence-package-"),
            "evidence": before,
        },
        {
            "id": "checklist-has-required-items",
            "passed": required_items.issubset(set(after_items)),
            "evidence": sorted(after_items),
        },
        {
            "id": "pending-blocker-is-visible",
            "passed": during_items["no-pending-review"]["status"] == "failed"
            and during["ready_for_internal_acceptance"] is False
            and during["status"] == "critical",
            "evidence": {"review": review, "during_item": during_items["no-pending-review"], "during_status": during["status"]},
        },
        {
            "id": "pending-blocker-count-visible-during-proof",
            "passed": int(during_items["no-pending-review"]["reason"].split("=")[-1].rstrip(".")) >= 1
            and during_items["no-pending-review"]["status"] == "failed"
            and during["ready_for_internal_acceptance"] is False,
            "evidence": {"before": before_items["no-pending-review"], "during": during_items["no-pending-review"]},
        },
        {
            "id": "archive-history-is-accounted",
            "passed": archived["id"].startswith("queue-evidence-package-archive-")
            and after["archive_entries_total"] >= before["archive_entries_total"],
            "evidence": {"archived": archived, "after_archive_entries_total": after["archive_entries_total"]},
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-checklist-check",
            "evidence": approved,
        },
        {
            "id": "checklist-gates-visible",
            "passed": required_gates.issubset({gate["id"] for gate in after["gates"]}),
            "evidence": after["gates"],
        },
        {
            "id": "checklist-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (before, during, after)
            ),
            "evidence": "Acceptance checklist reads local package/archive state only.",
        },
        {
            "id": "checklist-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Чек-лист приемки",
                    "Чек-лист приемки evidence",
                    "evidenceAcceptanceChecklist",
                    "loadEvidenceAcceptanceChecklist",
                )
            ),
            "evidence": "Acceptance checklist UI markers are present in Product Workbench source.",
        },
        {
            "id": "checklist-ui-styles-exist",
            "passed": ".evidence-acceptance-checklist" in style_source
            and ".evidence-acceptance-checklist-item-failed" in style_source,
            "evidence": "Acceptance checklist CSS classes exist.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1288-QUEUE_EVIDENCE_ACCEPTANCE_CHECKLIST_SEGMENT",
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
        "archived": archived,
        "approved": approved,
        "after": after,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1288_QUEUE_EVIDENCE_ACCEPTANCE_CHECKLIST_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
