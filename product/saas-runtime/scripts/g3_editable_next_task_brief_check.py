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
    "x-actor": os.environ.get("SYMBIOT_ACTOR", "g3-editable-next-task-brief"),
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
    followup_brief = {
        "followup_goal": "Проверить, что Result Center запускает следующий TaskRun из редактируемого брифа.",
        "followup_expected_artifact": "Evidence of editable next-task brief propagation",
        "followup_source_context": "SAAS-0934 editable next-task brief live check",
        "followup_urgency": "G3 Product Runtime / SAAS-0934",
    }

    create_payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "form_data": {
            "goal": "Создать исходный TaskRun для проверки редактируемого следующего шага.",
            "expected_artifact": "Initial artifact for SAAS-0934",
            "source_context": "Editable next-task brief test source",
            "urgency": "G3 Product Runtime / SAAS-0934",
        },
        "document_ids": ["doc-demo-001"],
    }
    create_status, task_run = request_json("POST", "/api/task-runs", create_payload)
    task_run_id = task_run.get("id")

    next_status, next_result = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
        {
            "comment": "SAAS-0934 creates the next managed TaskRun from editable brief.",
            **followup_brief,
        },
    )
    related_ids = [
        record.get("related_task_run_id")
        for record in next_result.get("action_history", [])
        if record.get("related_task_run_id")
    ]
    related_task_run_id = related_ids[-1] if related_ids else None
    followup_status, followup = (
        request_json("GET", f"/api/task-runs/{related_task_run_id}") if related_task_run_id else (0, {})
    )
    artifact_id = followup.get("artifact_id")
    artifact_status, artifact = request_json("GET", f"/api/artifacts/{artifact_id}") if artifact_id else (0, {})

    checks = {
        "source_task_run_created": create_status == 200 and bool(task_run_id),
        "create_next_task_completed": next_status == 200 and bool(related_task_run_id),
        "followup_task_run_created": followup_status == 200 and followup.get("id") == related_task_run_id,
        "followup_artifact_created": artifact_status == 200 and artifact.get("id") == artifact_id,
        "followup_goal_propagated": followup_brief["followup_goal"] in artifact.get("content", ""),
        "followup_context_propagated": followup_brief["followup_source_context"] in artifact.get("content", ""),
    }
    passed = all(checks.values())

    evidence = {
        "task": "SAAS-0934",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks": checks,
        "passed": passed,
        "task_run_id": task_run_id,
        "related_task_run_id": related_task_run_id,
        "followup_artifact_id": artifact_id,
        "followup_brief": followup_brief,
        "artifact_title": artifact.get("title"),
        "audit_event_ids": next_result.get("evidence", {}).get("audit_event_ids", []),
    }
    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_0934_EDITABLE_NEXT_TASK_BRIEF_LIVE_CHECK_2026-07-03.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
