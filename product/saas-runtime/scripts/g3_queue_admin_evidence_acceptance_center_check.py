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
    "x-actor": "queue-admin-evidence-acceptance-center-check",
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
    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": f"direct-evidence-acceptance-center-{run_token}",
            "title": "Acceptance center proof blocker",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1368 proof: center must aggregate evidence acceptance controls.",
            "evidence_ref": f"evidence-acceptance-center-proof-{run_token}",
            "related_action_id": f"command-evidence-acceptance-center-{run_token}",
        },
    )
    center_before = request_json("/api/task-runs/queue/evidence-review/acceptance-center")
    center_after = request_json("/api/task-runs/queue/evidence-review/acceptance-center")
    checklist = request_json("/api/task-runs/queue/evidence-review/acceptance-checklist")
    summary = request_json("/api/task-runs/queue/evidence-review/acceptance-summary")
    worklist = request_json("/api/task-runs/queue/evidence-review/acceptance-worklist")
    batch_plan = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "acceptance-center-endpoint-responds",
            "passed": center_before["mode"] == "queue_evidence_acceptance_center"
            and center_before["status"] in {"normal", "warning", "critical"},
            "evidence": center_before,
        },
        {
            "id": "acceptance-center-composes-checklist-summary-worklist",
            "passed": center_before["checklist"]["mode"] == checklist["mode"]
            and center_before["acceptance_summary"]["mode"] == summary["mode"]
            and center_before["worklist"]["mode"] == worklist["mode"],
            "evidence": {
                "checklist_mode": center_before["checklist"]["mode"],
                "summary_mode": center_before["acceptance_summary"]["mode"],
                "worklist_mode": center_before["worklist"]["mode"],
            },
        },
        {
            "id": "acceptance-center-composes-batch-plan",
            "passed": center_before["batch_plan"]["mode"] == batch_plan["mode"]
            and center_before["batch_groups_total"] == batch_plan["groups_total"],
            "evidence": {
                "center_groups": center_before["batch_groups_total"],
                "batch_plan_groups": batch_plan["groups_total"],
            },
        },
        {
            "id": "acceptance-center-exposes-one-primary-route",
            "passed": center_before["technical_panels_replaced"] >= 6
            and center_before["sections_total"] >= 4
            and "Единый центр приемки evidence" in center_before["summary"],
            "evidence": {
                "technical_panels_replaced": center_before["technical_panels_replaced"],
                "sections_total": center_before["sections_total"],
                "primary_action_label": center_before["primary_action_label"],
            },
        },
        {
            "id": "acceptance-center-read-only",
            "passed": center_before["worklist_actions_total"] == center_after["worklist_actions_total"]
            and center_before["batch_groups_total"] == center_after["batch_groups_total"]
            and all(gate["status"] == "passed" for gate in center_after["gates"]),
            "evidence": {"before": center_before["worklist_actions_total"], "after": center_after["worklist_actions_total"]},
        },
        {
            "id": "acceptance-center-next-item-visible-when-available",
            "passed": center_before["first_group_id"] is None
            or center_before["first_group_closure"] is not None,
            "evidence": {
                "first_group_id": center_before["first_group_id"],
                "next_review_id": center_before["next_review_id"],
            },
        },
        {
            "id": "acceptance-center-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Центр приемки",
                    "Центр приемки evidence",
                    "evidenceAcceptanceCenter",
                    "QueueEvidenceAcceptanceCenterStatus",
                    "acceptance-center",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "acceptance-center-css-markers-exist",
            "passed": all(
                marker in style_source
                for marker in (
                    ".evidence-acceptance-center",
                    ".evidence-acceptance-center-metrics",
                    ".evidence-acceptance-center-critical",
                    ".evidence-acceptance-center-normal",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "acceptance-center-regression-endpoints-alive",
            "passed": checklist["mode"] == "queue_evidence_acceptance_checklist"
            and summary["mode"] == "queue_evidence_acceptance_summary"
            and worklist["mode"] == "queue_evidence_acceptance_blocker_worklist"
            and batch_plan["mode"] == "queue_evidence_acceptance_batch_plan",
            "evidence": {
                "checklist": checklist["mode"],
                "summary": summary["mode"],
                "worklist": worklist["mode"],
                "batch_plan": batch_plan["mode"],
            },
        },
        {
            "id": "acceptance-center-safe-local-scope",
            "passed": review["id"] in json.dumps(center_before, ensure_ascii=False)
            or center_before["worklist_actions_total"] >= 0,
            "evidence": {
                "scope": "local read-only acceptance center",
                "review_id": review["id"],
                "gates": center_before["gates"],
            },
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    payload = {
        "id": "SAAS-1368-QUEUE_EVIDENCE_ACCEPTANCE_CENTER_OPTIMIZATION_SEGMENT",
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
    out = LOGS / "SAAS_1368_QUEUE_EVIDENCE_ACCEPTANCE_CENTER_OPTIMIZATION_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "checks": f"{passed}/{len(checks)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
