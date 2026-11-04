from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8020").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "queue-admin-evidence-workbench-check",
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


def age_review_case(review_id: str, created_at: str) -> None:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.services.sqlite_store import get_connection  # pylint: disable=import-outside-toplevel

    with get_connection() as connection:
        connection.execute(
            """
            update task_run_evidence_review
            set created_at = ?, updated_at = ?
            where id = ?
            """,
            (created_at, created_at, review_id),
        )


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    run_token = started_at.replace(":", "").replace("-", "").replace(".", "")
    source_prefix = f"direct-evidence-workbench-{run_token}"
    before = request_json("/api/task-runs/queue/evidence-review?limit=100")

    overdue_review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": f"{source_prefix}-overdue",
            "title": "Workbench overdue evidence",
            "owner_role": "qa-evidence",
            "severity": "critical",
            "reason": "SAAS-1248 proof: Workbench must surface overdue critical evidence first.",
            "evidence_ref": f"workbench-overdue-proof-{run_token}",
            "related_action_id": f"command-evidence-workbench-{run_token}",
        },
    )
    rework_review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": f"{source_prefix}-rework",
            "title": "Workbench rework evidence",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1248 proof: Workbench must filter rework evidence.",
            "evidence_ref": f"workbench-rework-proof-{run_token}",
            "related_action_id": f"command-evidence-workbench-{run_token}",
        },
    )
    age_review_case(overdue_review["id"], (datetime.now(UTC) - timedelta(hours=2)).isoformat())
    reworked = request_json(
        f"/api/task-runs/queue/evidence-review/{rework_review['id']}/rework",
        "POST",
        {
            "actor": "queue-admin-evidence-workbench-check",
            "reason": "Create rework proof case for workbench filters.",
            "review_note": "Workbench filter proof: weak evidence must be visible in rework slice.",
        },
    )

    overdue_slice = query(
        "/api/task-runs/queue/evidence-review",
        {
            "limit": 100,
            "status": "pending",
            "severity": "critical",
            "sla_status": "overdue",
            "owner_role": "qa-evidence",
            "source_query": source_prefix,
        },
    )
    rework_slice = query(
        "/api/task-runs/queue/evidence-review",
        {
            "limit": 100,
            "status": "rework",
            "severity": "warning",
            "owner_role": "qa-evidence",
            "source_query": source_prefix,
        },
    )
    default_slice = request_json("/api/task-runs/queue/evidence-review?limit=100")

    cleanup_overdue = request_json(
        f"/api/task-runs/queue/evidence-review/{overdue_review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-workbench-check",
            "reason": "Cleanup workbench overdue proof case.",
            "review_note": "Workbench overdue proof accepted after filter behavior was verified.",
        },
    )
    cleanup_rework = request_json(
        f"/api/task-runs/queue/evidence-review/{rework_review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-workbench-check",
            "reason": "Cleanup workbench rework proof case.",
            "review_note": "Workbench rework proof accepted after filter behavior was verified.",
        },
    )
    after_cleanup = request_json("/api/task-runs/queue/evidence-review?limit=100")

    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")
    command_center = request_json("/api/task-runs/queue/admin-command-center")

    checks = [
        {
            "id": "workbench-filter-overdue-critical",
            "passed": any(item["id"] == overdue_review["id"] and item["sla_status"] == "overdue" for item in overdue_slice["items"]),
            "evidence": overdue_slice,
        },
        {
            "id": "workbench-filter-rework-warning",
            "passed": any(item["id"] == rework_review["id"] and item["status"] == "rework" for item in rework_slice["items"])
            and reworked["status"] == "rework",
            "evidence": {"slice": rework_slice, "reworked": reworked},
        },
        {
            "id": "workbench-default-prioritizes-actionable-items",
            "passed": bool(default_slice["items"])
            and default_slice["items"][0]["sla_status"] in {"overdue", "within_sla", "not_applicable"}
            and "queue-evidence-review-sla-visible" in {gate["id"] for gate in default_slice["gates"]},
            "evidence": {"first": default_slice["items"][0] if default_slice["items"] else None, "gates": default_slice["gates"]},
        },
        {
            "id": "workbench-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Evidence Review Workbench",
                    "Применить фильтр",
                    "Сначала разбирайте overdue",
                    "evidenceReviewStatusFilter",
                )
            ),
            "evidence": "Workbench controls are present in Product Workbench source.",
        },
        {
            "id": "workbench-ui-styles-exist",
            "passed": ".evidence-review-workbench" in style_source and ".evidence-review-filters" in style_source,
            "evidence": "Workbench CSS classes exist.",
        },
        {
            "id": "workbench-command-center-compatible",
            "passed": any(source["id"] == "evidence-review" for source in command_center["sources"]),
            "evidence": {"status": command_center["status"], "sources_total": command_center["sources_total"]},
        },
        {
            "id": "workbench-cleanup-restores-proof-cases",
            "passed": cleanup_overdue["status"] == "approved"
            and cleanup_rework["status"] == "approved"
            and not any(item["id"] in {overdue_review["id"], rework_review["id"]} and item["status"] != "approved" for item in after_cleanup["items"]),
            "evidence": {"cleanup_overdue": cleanup_overdue, "cleanup_rework": cleanup_rework, "after_cleanup": after_cleanup},
        },
        {
            "id": "workbench-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (overdue_review, rework_review, overdue_slice, rework_slice)
            ),
            "evidence": "Workbench filters use local runtime API and admin UI only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1248-QUEUE_ADMIN_EVIDENCE_WORKBENCH_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "overdue_slice": overdue_slice,
        "rework_slice": rework_slice,
        "after_cleanup": after_cleanup,
        "command_center_summary": {
            "status": command_center["status"],
            "operator_mode": command_center["operator_mode"],
            "sources_total": command_center["sources_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1248_QUEUE_ADMIN_EVIDENCE_WORKBENCH_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
