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
    "x-actor": "queue-admin-evidence-package-check",
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
    source_ref = f"direct-evidence-package-{run_token}"

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Package proof evidence",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1268 proof: internal package must include open blockers and decision trail.",
            "evidence_ref": f"evidence-package-proof-{run_token}",
            "related_action_id": f"command-evidence-package-{run_token}",
        },
    )
    package_with_blocker = request_json("/api/task-runs/queue/evidence-review/package")
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-package-check",
            "reason": "Cleanup package proof case after blocker visibility is verified.",
            "review_note": "Evidence package proof accepted after internal package captured the blocker.",
        },
    )
    package_after_cleanup = request_json("/api/task-runs/queue/evidence-review/package")
    action_audit = request_json("/api/task-runs/queue/admin-action-audit")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "evidence-package-endpoint-ready",
            "passed": package_with_blocker["export_scope"] == "internal_evidence"
            and package_with_blocker["external_export_allowed"] is False
            and package_with_blocker["id"].startswith("queue-evidence-package-"),
            "evidence": {
                "id": package_with_blocker["id"],
                "scope": package_with_blocker["export_scope"],
                "external": package_with_blocker["external_export_allowed"],
            },
        },
        {
            "id": "evidence-package-hash-present",
            "passed": len(package_with_blocker["package_hash"]) == 64,
            "evidence": package_with_blocker["package_hash"],
        },
        {
            "id": "evidence-package-open-blocker-visible",
            "passed": any(item["id"] == review["id"] for item in package_with_blocker["open_items"])
            and package_with_blocker["acceptance_summary"]["ready_for_internal_acceptance"] is False,
            "evidence": {
                "open_items": package_with_blocker["open_items"],
                "summary": package_with_blocker["acceptance_summary"],
            },
        },
        {
            "id": "evidence-package-decision-trail-linked",
            "passed": any(event["evidence_ref"] == review["evidence_ref"] for event in package_with_blocker["decision_events"]),
            "evidence": package_with_blocker["decision_events"][:5],
        },
        {
            "id": "evidence-package-gates-visible",
            "passed": {
                "queue-evidence-package-internal-only",
                "queue-evidence-package-has-hash",
                "queue-evidence-package-decision-trail-linked",
                "queue-evidence-package-acceptance-state-explicit",
            }.issubset({gate["id"] for gate in package_with_blocker["gates"]}),
            "evidence": package_with_blocker["gates"],
        },
        {
            "id": "evidence-package-cleanup-approved",
            "passed": approved["status"] == "approved"
            and not any(item["id"] == review["id"] for item in package_after_cleanup["open_items"]),
            "evidence": {"approved": approved, "after_cleanup_open": package_after_cleanup["open_items"]},
        },
        {
            "id": "evidence-package-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Собрать пакет приемки",
                    "Пакет внутренней приемки",
                    "evidenceReviewPackage",
                    "loadEvidenceReviewPackage",
                )
            ),
            "evidence": "Evidence package UI markers are present in Product Workbench source.",
        },
        {
            "id": "evidence-package-ui-styles-exist",
            "passed": ".evidence-review-package" in style_source,
            "evidence": "Evidence package CSS class exists.",
        },
        {
            "id": "evidence-package-audit-chain-valid",
            "passed": action_audit["chain_valid"] is True and action_audit["head_hash"] != "GENESIS",
            "evidence": {"head_hash": action_audit["head_hash"], "events_total": action_audit["events_total"]},
        },
        {
            "id": "evidence-package-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (package_with_blocker, package_after_cleanup)
            ),
            "evidence": "Evidence package is internal, local runtime evidence only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1268-QUEUE_ADMIN_EVIDENCE_PACKAGE_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "review": review,
        "package_with_blocker": package_with_blocker,
        "approved": approved,
        "package_after_cleanup": package_after_cleanup,
        "action_audit_summary": {
            "chain_valid": action_audit["chain_valid"],
            "events_total": action_audit["events_total"],
            "head_hash": action_audit["head_hash"],
        },
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1268_QUEUE_ADMIN_EVIDENCE_PACKAGE_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
