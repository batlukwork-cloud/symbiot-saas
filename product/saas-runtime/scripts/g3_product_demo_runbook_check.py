from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
API_BASE = os.environ.get("SYMBIOT_API_BASE", "http://127.0.0.1:8000").rstrip("/")

HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.environ.get("SYMBIOT_SESSION", "symbiot-demo-session-token"),
    "x-tenant-id": os.environ.get("SYMBIOT_TENANT_ID", "tenant:demo"),
    "x-actor": os.environ.get("SYMBIOT_ACTOR", "g3-product-demo-runbook"),
    "x-role": os.environ.get("SYMBIOT_ROLE", "runtime-operator"),
    "x-department": os.environ.get("SYMBIOT_DEPARTMENT", "sales"),
    "x-access-level": os.environ.get("SYMBIOT_ACCESS_LEVEL", "standard"),
}


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            data = response.read().decode("utf-8")
            return response.status, json.loads(data) if data else {}
    except HTTPError as exc:
        data = exc.read().decode("utf-8")
        return exc.code, json.loads(data) if data else {"detail": exc.reason}


def main() -> None:
    started_at = datetime.now(UTC).isoformat()

    preview_payload = {
        "process_id": "commercial-proposal",
        "goal": "Показать полный продуктовый цикл Симбиота: задача, рабочая группа, TaskRun, приемка и следующий TaskRun.",
        "expected_artifact": "Demo runbook evidence package",
        "source_context": "G3 Product Runtime demo runbook",
        "urgency": "G3 Product Demo",
        "document_ids": ["doc-demo-001"],
    }
    preview_status, preview = request_json("POST", "/api/task-runs/intake-preview", preview_payload)

    create_payload = {
        "process_id": preview_payload["process_id"],
        "profile_id": preview.get("recommended_profile_id", "demo-tenant-working"),
        "form_data": {
            "goal": preview_payload["goal"],
            "expected_artifact": preview_payload["expected_artifact"],
            "source_context": preview_payload["source_context"],
            "urgency": preview_payload["urgency"],
            "selected_workgroup": [role["runtime_role"] for role in preview.get("workgroup", [])],
        },
        "document_ids": preview_payload["document_ids"],
    }
    create_status, task_run = request_json("POST", "/api/task-runs", create_payload)
    task_run_id = task_run.get("id")

    center_status, center = request_json("GET", f"/api/task-runs/{task_run_id}/result-center")
    accept_status, accepted = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/accept-result",
        {"comment": "Product demo runbook accepted the result."},
    )
    next_status, next_result = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
        {"comment": "Product demo runbook created the next managed TaskRun."},
    )
    related_ids = [
        record.get("related_task_run_id")
        for record in next_result.get("action_history", [])
        if record.get("related_task_run_id")
    ]
    related_task_run_id = related_ids[-1] if related_ids else None
    followup_status, followup = request_json("GET", f"/api/task-runs/{related_task_run_id}") if related_task_run_id else (0, {})

    checks = {
        "preview_ready": preview_status == 200 and preview.get("status") == "ready",
        "task_run_created": create_status == 200 and bool(task_run_id),
        "result_center_ready": center_status == 200 and center.get("product_status") == "ready_for_acceptance",
        "accept_result_completed": accept_status == 200 and accepted.get("product_status") == "accepted",
        "next_task_action_completed": next_status == 200
        and "create-next-task" in [action.get("id") for action in next_result.get("actions", []) if action.get("status") == "completed"],
        "followup_task_run_created": followup_status == 200 and followup.get("id") == related_task_run_id,
    }
    passed = all(checks.values())

    evidence = {
        "task": "SAAS-0933",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks": checks,
        "passed": passed,
        "preview": {
            "status": preview_status,
            "readiness": preview.get("readiness_score"),
            "workgroup_total": len(preview.get("workgroup", [])),
        },
        "task_run_id": task_run_id,
        "artifact_id": task_run.get("artifact_id"),
        "result_center_status": center.get("product_status"),
        "accepted_status": accepted.get("product_status"),
        "related_task_run_id": related_task_run_id,
        "followup_status": followup.get("status"),
        "audit_event_ids": next_result.get("evidence", {}).get("audit_event_ids", []),
    }
    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_0933_PRODUCT_DEMO_RUNBOOK_LIVE_CHECK_2026-07-03.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
