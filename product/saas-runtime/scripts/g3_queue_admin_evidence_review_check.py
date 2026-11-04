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
    "x-actor": "queue-admin-evidence-review-check",
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
    before = request_json("/api/task-runs/queue/evidence-review")

    triage = request_json(
        "/api/task-runs/queue/manual-triage",
        "POST",
        {
            "source_action_id": f"command-evidence-review-{run_token}",
            "title": "Проверить evidence результата",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1228 proof: resolved manual triage must create a QA evidence review case.",
            "evidence_ref": f"queue-evidence-review-proof-{run_token}",
            "related_runbook_step_id": "runbook-evidence-review",
        },
    )
    resolved_triage = request_json(
        f"/api/task-runs/queue/manual-triage/{triage['id']}/resolve",
        "POST",
        {
            "actor": "queue-admin-evidence-review-check",
            "reason": "Move resolved manual triage into QA evidence review.",
            "resolution": "Manual triage resolved; QA evidence review remains required before final closure.",
        },
    )
    after_triage = request_json("/api/task-runs/queue/evidence-review")
    generated_review = next(
        (
            item
            for item in after_triage["items"]
            if item.get("related_manual_triage_id") == triage["id"]
            or item.get("evidence_ref") == triage["evidence_ref"]
        ),
        None,
    )

    approved_review = None
    if generated_review:
        approved_review = request_json(
            f"/api/task-runs/queue/evidence-review/{generated_review['id']}/approve",
            "POST",
            {
                "actor": "queue-admin-evidence-review-check",
                "reason": "Approve generated evidence review after manual triage resolution.",
                "review_note": "Evidence chain is visible and suitable for MVP admin proof.",
            },
        )

    direct_review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": f"direct-evidence-review-{run_token}",
            "title": "Вернуть evidence на доработку",
            "owner_role": "qa-evidence",
            "severity": "critical",
            "reason": "SAAS-1228 proof: QA must be able to return weak evidence for rework.",
            "evidence_ref": f"weak-evidence-proof-{run_token}",
            "related_action_id": f"command-evidence-review-{run_token}",
        },
    )
    rework_review = request_json(
        f"/api/task-runs/queue/evidence-review/{direct_review['id']}/rework",
        "POST",
        {
            "actor": "queue-admin-evidence-review-check",
            "reason": "Return weak evidence for rework.",
            "review_note": "Evidence lacks a clear artifact reference and must be strengthened.",
        },
    )

    after_decisions = request_json("/api/task-runs/queue/evidence-review")
    cleanup_review = request_json(
        f"/api/task-runs/queue/evidence-review/{direct_review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-review-check",
            "reason": "Cleanup proof case after rework risk was verified.",
            "review_note": "Regression cleanup: test-created evidence review is accepted after proof, leaving Command Center stable.",
        },
    )
    after_cleanup = request_json("/api/task-runs/queue/evidence-review")
    action_audit = request_json("/api/task-runs/queue/admin-action-audit")
    command_center = request_json("/api/task-runs/queue/admin-command-center")

    source_ids = {source["id"] for source in command_center["sources"]}
    evidence_audit_events = [
        event for event in action_audit["events"] if event.get("action_kind") == "evidence_review"
    ]
    checks = [
        {
            "id": "evidence-review-endpoint-ready",
            "passed": before["mode"] == "sqlite_mvp_queue_evidence_review",
            "evidence": before["mode"],
        },
        {
            "id": "manual-triage-resolution-creates-review",
            "passed": generated_review is not None and resolved_triage["status"] == "resolved",
            "evidence": {"triage": resolved_triage, "generated_review": generated_review},
        },
        {
            "id": "generated-review-is-pending",
            "passed": generated_review is not None and generated_review["status"] == "pending",
            "evidence": generated_review,
        },
        {
            "id": "approve-decision-recorded",
            "passed": approved_review is not None
            and approved_review["status"] == "approved"
            and approved_review["reviewed_by"] == "queue-admin-evidence-review-check"
            and bool(approved_review["review_note"]),
            "evidence": approved_review,
        },
        {
            "id": "rework-decision-recorded",
            "passed": rework_review["status"] == "rework"
            and rework_review["reviewed_by"] == "queue-admin-evidence-review-check"
            and bool(rework_review["review_note"]),
            "evidence": rework_review,
        },
        {
            "id": "status-reflects-rework-risk",
            "passed": after_decisions["rework"] >= before["rework"] + 1 and after_decisions["status"] == "critical",
            "evidence": {
                "before_rework": before["rework"],
                "after_rework": after_decisions["rework"],
                "status": after_decisions["status"],
            },
        },
        {
            "id": "evidence-review-gates-visible",
            "passed": all(gate["status"] == "passed" for gate in after_decisions["gates"]),
            "evidence": after_decisions["gates"],
        },
        {
            "id": "command-center-links-evidence-review",
            "passed": "evidence-review" in source_ids and command_center["sources_total"] >= 10,
            "evidence": {"sources_total": command_center["sources_total"], "source_ids": sorted(source_ids)},
        },
        {
            "id": "action-audit-captures-evidence-review",
            "passed": action_audit["chain_valid"] is True and len(evidence_audit_events) >= 3,
            "evidence": {
                "chain_valid": action_audit["chain_valid"],
                "events": evidence_audit_events[:6],
            },
        },
        {
            "id": "proof-cleanup-keeps-command-center-stable",
            "passed": cleanup_review["status"] == "approved"
            and direct_review["id"] == cleanup_review["id"]
            and after_cleanup["rework"] <= after_decisions["rework"],
            "evidence": {"cleanup_review": cleanup_review, "after_cleanup": after_cleanup},
        },
        {
            "id": "evidence-review-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider")
                for payload in (triage, resolved_triage, approved_review or {}, direct_review, rework_review)
            ),
            "evidence": "Evidence review lifecycle uses local runtime API only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1228-QUEUE_ADMIN_EVIDENCE_REVIEW_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "before": before,
        "after_triage": after_triage,
        "after_decisions": after_decisions,
        "after_cleanup": after_cleanup,
        "command_center_summary": {
            "status": command_center["status"],
            "operator_mode": command_center["operator_mode"],
            "sources_total": command_center["sources_total"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1228_QUEUE_ADMIN_EVIDENCE_REVIEW_SEGMENT_EVIDENCE_2026-07-07.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
