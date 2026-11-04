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
    "x-actor": "queue-admin-evidence-package-archive-check",
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
    source_ref = f"direct-evidence-package-archive-{run_token}"

    review = request_json(
        "/api/task-runs/queue/evidence-review",
        "POST",
        {
            "source_ref": source_ref,
            "title": "Package archive proof evidence",
            "owner_role": "qa-evidence",
            "severity": "warning",
            "reason": "SAAS-1278 proof: package archive must persist blocked snapshot in local history.",
            "evidence_ref": f"evidence-package-archive-proof-{run_token}",
            "related_action_id": f"command-evidence-package-archive-{run_token}",
        },
    )
    package_before_archive = request_json("/api/task-runs/queue/evidence-review/package")
    archived = request_json("/api/task-runs/queue/evidence-review/package/archive", "POST", {})
    archive_status = request_json("/api/task-runs/queue/evidence-review/package/archive?limit=20")
    archive_path = Path(archived["archive_path"])
    archive_text = archive_path.read_text(encoding="utf-8") if archive_path.exists() else ""
    approved = request_json(
        f"/api/task-runs/queue/evidence-review/{review['id']}/approve",
        "POST",
        {
            "actor": "queue-admin-evidence-package-archive-check",
            "reason": "Cleanup package archive proof case after archive visibility is verified.",
            "review_note": "Evidence package archive proof accepted after local history captured the blocked package.",
        },
    )
    archive_after_cleanup = request_json("/api/task-runs/queue/evidence-review/package/archive?limit=20")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "archive-entry-created",
            "passed": archived["id"].startswith("queue-evidence-package-archive-")
            and archived["package_id"].startswith("queue-evidence-package-")
            and len(archived["package_hash"]) == 64,
            "evidence": {"archived": archived, "package_hash": package_before_archive["package_hash"]},
        },
        {
            "id": "archive-captures-blocked-state",
            "passed": archived["status"] == "blocked"
            and archived["pending"] >= 1
            and archived["open_items_total"] >= 1,
            "evidence": archived,
        },
        {
            "id": "archive-status-lists-entry",
            "passed": any(entry["id"] == archived["id"] for entry in archive_status["entries"])
            and archive_status["latest_entry_id"] == archived["id"],
            "evidence": archive_status,
        },
        {
            "id": "archive-jsonl-written",
            "passed": archive_path.exists()
            and archived["id"] in archive_text
            and archived["package_hash"] in archive_text,
            "evidence": {"archive_path": str(archive_path), "length": len(archive_text)},
        },
        {
            "id": "archive-gates-visible",
            "passed": {
                "queue-evidence-package-archive-local-jsonl",
                "queue-evidence-package-archive-no-external-export",
                "queue-evidence-package-archive-readable",
            }.issubset({gate["id"] for gate in archive_status["gates"]}),
            "evidence": archive_status["gates"],
        },
        {
            "id": "archive-cleanup-approved",
            "passed": approved["status"] == "approved"
            and any(entry["id"] == archived["id"] for entry in archive_after_cleanup["entries"]),
            "evidence": {"approved": approved, "archive_after_cleanup": archive_after_cleanup},
        },
        {
            "id": "archive-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Сохранить в историю",
                    "История пакетов",
                    "История пакетов приемки",
                    "evidenceReviewPackageArchive",
                    "saveEvidenceReviewPackageArchive",
                )
            ),
            "evidence": "Evidence package archive UI markers are present in Product Workbench source.",
        },
        {
            "id": "archive-ui-styles-exist",
            "passed": ".evidence-review-package-history" in style_source,
            "evidence": "Evidence package archive CSS class exists.",
        },
        {
            "id": "archive-safe-local-scope",
            "passed": all(
                blocked not in json.dumps(payload, ensure_ascii=False).lower()
                for blocked in ("production deploy", "secret rotation", "external provider", "https domain")
                for payload in (archived, archive_status)
            ),
            "evidence": "Evidence package archive is local JSONL metadata only.",
        },
    ]

    failed = [check for check in checks if not check["passed"]]
    payload = {
        "id": "SAAS-1278-QUEUE_ADMIN_EVIDENCE_PACKAGE_ARCHIVE_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failed),
        "checks_failed": len(failed),
        "checks": checks,
        "review": review,
        "package_before_archive": package_before_archive,
        "archived": archived,
        "archive_status": archive_status,
        "approved": approved,
        "archive_after_cleanup": archive_after_cleanup,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1278_QUEUE_ADMIN_EVIDENCE_PACKAGE_ARCHIVE_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": not failed, "evidence": str(out), "checks": f"{payload['checks_passed']}/{payload['checks_total']}"}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
