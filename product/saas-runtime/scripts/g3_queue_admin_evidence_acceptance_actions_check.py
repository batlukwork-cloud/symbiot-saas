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
    "x-actor": "queue-admin-evidence-acceptance-actions-check",
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
    source_ref = f"direct-evidence-acceptance-actions-{run_token}"

    before = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    before_items = item_map(before)
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Acceptance action proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1298 proof: checklist action must route QA/admin to the pending review slice.",
            "evidence_ref": f"evidence-acceptance-actions-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-actions-{run_token}",
        },
    )
    during = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    during_items = item_map(during)
    pending_action_target = during_items["no-pending-review"]["action_target"]
    pending_slice = request_json(f"{pending_action_target}&limit=100")
    archived = request_json("/api/task-runs/queue/evidence-review/package/archive", "POST", {})
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-acceptance-actions-check",
            "reason": "Cleanup acceptance action proof case after action routing is verified.",
            "review_note": "Acceptance action proof accepted: pending action routed to the expected workbench slice.",
        },
    )
    after = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "checklist-items-have-action-contract",
            "passed": all(item.get("action_label") and item.get("action_kind") for item in before["items"]),
            "evidence": before["items"],
        },
        {
            "id": "pending-blocker-action-is-filter",
            "passed": during_items["no-pending-review"]["status"] == "failed"
            and during_items["no-pending-review"]["action_kind"] == "filter_pending"
            and "status=pending" in during_items["no-pending-review"]["action_target"],
            "evidence": during_items["no-pending-review"],
        },
        {
            "id": "pending-action-target-opens-workbench-slice",
            "passed": any(item["id"] == review["id"] and item["status"] == "pending" for item in pending_slice["items"]),
            "evidence": {"review_id": review["id"], "slice_total": pending_slice["total"], "slice_items": pending_slice["items"][:3]},
        },
        {
            "id": "archive-action-contract-exists",
            "passed": before_items["archive-history-present"]["action_kind"] == "save_archive"
            and before_items["archive-history-present"]["action_target"] == "/api/task-runs/queue/evidence-review/package/archive",
            "evidence": before_items["archive-history-present"],
        },
        {
            "id": "package-action-contracts-exist",
            "passed": before_items["package-built"]["action_kind"] == "refresh_package"
            and before_items["package-gates-pass"]["action_kind"] == "review_package_gates",
            "evidence": {"package_built": before_items["package-built"], "package_gates": before_items["package-gates-pass"]},
        },
        {
            "id": "archive-action-still-saves-package",
            "passed": archived["id"].startswith("queue-evidence-package-archive-") and len(archived["package_hash"]) == 64,
            "evidence": archived,
        },
        {
            "id": "cleanup-approval-recorded",
            "passed": approved["status"] == "approved" and approved["reviewed_by"] == "queue-admin-evidence-acceptance-actions-check",
            "evidence": approved,
        },
        {
            "id": "checklist-after-cleanup-still-responds",
            "passed": after["mode"] == "queue_evidence_acceptance_checklist"
            and {item["id"] for item in after["items"]} == {item["id"] for item in before["items"]},
            "evidence": after,
        },
        {
            "id": "acceptance-action-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "runEvidenceAcceptanceAction",
                    "item.action_label",
                    "item.action_target",
                    "evidence-acceptance-action",
                )
            ),
            "evidence": "Acceptance action UI markers are present.",
        },
        {
            "id": "acceptance-action-styles-exist",
            "passed": ".evidence-acceptance-action" in style_source,
            "evidence": "Acceptance action CSS class exists.",
        },
        {
            "id": "acceptance-actions-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (before, during, after)
            ),
            "evidence": "Acceptance actions route local admin UI/API only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1298-QUEUE_EVIDENCE_ACCEPTANCE_ACTIONS_SEGMENT",
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
        "archived": archived,
        "approved": approved,
        "after": after,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1298_QUEUE_EVIDENCE_ACCEPTANCE_ACTIONS_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
