from __future__ import annotations

import json
import os
import sys
import urllib.error
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
    "x-actor": "queue-admin-evidence-sla-check",
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
    before = request_json("/api/task-runs/queue/evidence-review")

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": f"direct-evidence-sla-{run_token}",
            "title": "SLA-контроль проверки evidence",
            "owner_role": "qa-evidence",
            "severity": "critical",
            "reason": "SAAS-1238 proof: администратор должен видеть просроченную проверку evidence.",
            "evidence_ref": f"evidence-sla-proof-{run_token}",
            "related_action_id": f"command-evidence-sla-{run_token}",
        },
    )
    aged_created_at = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    age_review_case(review["id"], aged_created_at)
    aged = request_json("/api/task-runs/queue/evidence-review")
    aged_item = next((item for item in aged["items"] if item["id"] == review["id"]), None)
    cleanup = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-sla-check",
            "reason": "Cleanup SLA proof case after overdue detection was verified.",
            "review_note": "SLA proof accepted after overdue state was visible to admin.",
        },
    )
    after_cleanup = request_json("/api/task-runs/queue/evidence-review")
    command_center = request_json("/api/task-runs/queue/admin-command-center")

    checks = [
        {
            "id": "evidence-review-sla-fields-exposed",
            "passed": all(key in review for key in ("age_seconds", "response_due_at", "sla_status")),
            "evidence": review,
        },
        {
            "id": "critical-review-has-deadline",
            "passed": review["status"] == "pending"
            and review["sla_status"] == "within_sla"
            and bool(review["response_due_at"]),
            "evidence": review,
        },
        {
            "id": "aged-review-becomes-overdue",
            "passed": aged_item is not None
            and aged_item["sla_status"] == "overdue"
            and aged_item["age_seconds"] >= 7100,
            "evidence": aged_item,
        },
        {
            "id": "status-counts-overdue",
            "passed": aged["overdue"] >= before["overdue"] + 1
            and aged["status"] == "critical"
            and aged["oldest_open_age_seconds"] >= 7100,
            "evidence": {
                "before_overdue": before["overdue"],
                "aged_overdue": aged["overdue"],
                "status": aged["status"],
                "oldest_open_age_seconds": aged["oldest_open_age_seconds"],
            },
        },
        {
            "id": "sla-gate-visible",
            "passed": any(gate["id"] == "queue-evidence-review-sla-visible" and gate["status"] == "passed" for gate in aged["gates"]),
            "evidence": aged["gates"],
        },
        {
            "id": "command-center-remains-linked",
            "passed": any(source["id"] == "evidence-review" for source in command_center["sources"]),
            "evidence": {
                "sources_total": command_center["sources_total"],
                "sources": command_center["sources"],
            },
        },
        {
            "id": "cleanup-restores-test-case",
            "passed": cleanup["status"] == "approved" and after_cleanup["overdue"] <= aged["overdue"],
            "evidence": {"cleanup": cleanup, "after_cleanup": after_cleanup},
        },
        {
            "id": "evidence-sla-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (review, aged, cleanup)
            ),
            "evidence": "SLA proof uses local runtime API and local MVP SQLite test row only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1238-QUEUE_ADMIN_EVIDENCE_SLA_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "aged": aged,
        "after_cleanup": after_cleanup,
        "command_center_summary": {
            "status": command_center["status"],
            "operator_mode": command_center["operator_mode"],
            "sources_total": command_center["sources_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1238_QUEUE_ADMIN_EVIDENCE_SLA_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
