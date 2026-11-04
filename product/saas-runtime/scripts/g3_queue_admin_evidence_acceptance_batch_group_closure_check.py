from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
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
    "x-actor": "queue-admin-evidence-acceptance-batch-group-closure-check",
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
    source_prefix = f"direct-evidence-acceptance-batch-group-closure-{run_token}"
    reviews = []
    for index in range(2):
        reviews.append(
            request_json(
                "/api/task-runs/queue/evidence-review",
                "POST",
                {
                    "source_ref": f"{source_prefix}-{index + 1}",
                    "title": f"Acceptance batch group closure proof blocker {index + 1}",
                    "owner_role": "qa-evidence",
                    "severity": "warning",
                    "reason": "SAAS-1358 proof: batch group closure must expose remaining evidence items.",
                    "evidence_ref": f"evidence-acceptance-batch-group-closure-proof-{run_token}-{index + 1}",
                    "related_action_id": f"command-evidence-acceptance-batch-group-closure-{run_token}-{index + 1}",
                },
            )
        )

    plan = request_json("/api/task-runs/queue/evidence-review/acceptance-batch-plan")
    group = next((item for item in plan["groups"] if item["action_kind"] == "filter_pending"), plan["groups"][0])
    session = request_json(
        "/api/task-runs/queue/evidence-review/acceptance-batch-action",
        "POST",
        {
            "group_id": group["id"],
            "action_kind": group["action_kind"],
            "action_label": group["action_label"],
            "action_target": group["action_target"],
            "item_ids": group["item_ids"],
            "owner_roles": group["owner_roles"],
            "reason": "Proof opens batch group before closure status checks.",
            "actor": "queue-admin-evidence-acceptance-batch-group-closure-check",
        },
    )
    source_query = urllib.parse.quote(source_prefix)
    closure_before = request_json(
        f"/api/task-runs/queue/evidence-review/acceptance-batch-groups/{group['id']}/closure?source_query={source_query}"
    )
    first_decision = request_json(
        "/api/task-runs/queue/evidence-review/acceptance-batch-item-decision",
        "POST",
        {
            "batch_group_id": group["id"],
            "review_id": reviews[0]["id"],
            "decision": "approve",
            "actor": "queue-admin-evidence-acceptance-batch-group-closure-check",
            "reason": "Proof accepts first item and expects group to remain open.",
            "review_note": "Batch group closure proof accepted first evidence item.",
        },
    )
    closure_mid = request_json(
        f"/api/task-runs/queue/evidence-review/acceptance-batch-groups/{group['id']}/closure?source_query={source_query}"
    )
    second_decision = request_json(
        "/api/task-runs/queue/evidence-review/acceptance-batch-item-decision",
        "POST",
        {
            "batch_group_id": group["id"],
            "review_id": reviews[1]["id"],
            "decision": "approve",
            "actor": "queue-admin-evidence-acceptance-batch-group-closure-check",
            "reason": "Proof accepts second item and expects group to close for this source slice.",
            "review_note": "Batch group closure proof accepted second evidence item.",
        },
    )
    closure_after = request_json(
        f"/api/task-runs/queue/evidence-review/acceptance-batch-groups/{group['id']}/closure?source_query={source_query}"
    )
    audit = request_json("/api/task-runs/queue/admin-action-audit")
    page_source = (ROOT / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    style_source = (ROOT / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")

    checks = [
        {
            "id": "batch-group-closure-endpoint-responds",
            "passed": closure_before["mode"] == "queue_evidence_acceptance_batch_group_closure"
            and closure_before["batch_group_id"] == group["id"],
            "evidence": closure_before,
        },
        {
            "id": "batch-group-closure-initially-open",
            "passed": closure_before["status"] == "open"
            and closure_before["open_items"] == 2
            and closure_before["next_review_id"] in {review["id"] for review in reviews},
            "evidence": {
                "status": closure_before["status"],
                "open_items": closure_before["open_items"],
                "next_review_id": closure_before["next_review_id"],
            },
        },
        {
            "id": "batch-group-closure-remains-open-after-first-item",
            "passed": first_decision["status"] == "completed"
            and closure_mid["status"] == "open"
            and closure_mid["open_items"] == 1
            and closure_mid["next_review_id"] == reviews[1]["id"],
            "evidence": {"first_decision": first_decision, "closure_mid": closure_mid},
        },
        {
            "id": "batch-group-closure-closes-after-last-item",
            "passed": second_decision["status"] == "completed"
            and closure_after["status"] == "closed"
            and closure_after["open_items"] == 0
            and closure_after["next_review_id"] is None,
            "evidence": {"second_decision": second_decision, "closure_after": closure_after},
        },
        {
            "id": "batch-group-closure-gates-visible",
            "passed": {
                "queue-evidence-acceptance-batch-group-closure-scope",
                "queue-evidence-acceptance-batch-group-next-item",
                "queue-evidence-acceptance-batch-group-no-bulk-close",
            }.issubset({gate["id"] for gate in closure_after["gates"]}),
            "evidence": closure_after["gates"],
        },
        {
            "id": "batch-group-closure-no-bulk-auto-approval",
            "passed": all(
                event["action_kind"] != "evidence_acceptance_batch_group_closure"
                for event in audit["events"]
            )
            and first_decision["review_id"] == reviews[0]["id"]
            and second_decision["review_id"] == reviews[1]["id"],
            "evidence": {"audit_events_total": audit["events_total"], "checked": "read-only closure"},
        },
        {
            "id": "batch-group-closure-source-slice-isolated",
            "passed": closure_after["review_status"]["items"] == []
            and source_prefix in reviews[0]["source_ref"]
            and source_prefix in reviews[1]["source_ref"],
            "evidence": {"source_prefix": source_prefix, "closure_items": closure_after["review_status"]["items"]},
        },
        {
            "id": "batch-group-closure-ui-markers-exist",
            "passed": all(
                marker in page_source
                for marker in (
                    "Статус закрытия batch-группы",
                    "evidenceAcceptanceBatchGroupClosure",
                    "QueueEvidenceAcceptanceBatchGroupClosureStatus",
                    "acceptance-batch-groups",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-group-closure-css-markers-exist",
            "passed": all(
                marker in style_source
                for marker in (
                    ".evidence-acceptance-batch-closure",
                    ".evidence-acceptance-batch-closure-open",
                    ".evidence-acceptance-batch-closure-closed",
                    ".evidence-acceptance-batch-closure-blocked",
                )
            ),
            "evidence": {"markers": "present"},
        },
        {
            "id": "batch-group-closure-safe-local-scope",
            "passed": session["mode"] == "queue_evidence_acceptance_batch_action_session"
            and group["id"].startswith("acceptance-batch-")
            and closure_after["action_target"].startswith("/api/task-runs/queue/evidence-review")
            and all(gate["status"] == "passed" for gate in closure_after["gates"]),
            "evidence": {
                "scope": "local read-only batch group closure",
                "batch_group_id": group["id"],
                "action_target": closure_after["action_target"],
            },
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    payload = {
        "id": "SAAS-1358-QUEUE_EVIDENCE_ACCEPTANCE_BATCH_GROUP_CLOSURE_SEGMENT",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "review_ids": [review["id"] for review in reviews],
        "batch_group_id": group["id"],
        "checks_total": len(checks),
        "checks_passed": passed,
        "status": "passed" if passed == len(checks) else "failed",
        "checks": checks,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    out = LOGS / "SAAS_1358_QUEUE_EVIDENCE_ACCEPTANCE_BATCH_GROUP_CLOSURE_SEGMENT_EVIDENCE_2026-07-08.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "checks": f"{passed}/{len(checks)}", "evidence": str(out)}, ensure_ascii=False, indent=2))
    if payload["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
