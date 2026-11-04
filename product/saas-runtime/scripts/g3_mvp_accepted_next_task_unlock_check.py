from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
API_BASE = os.environ.get("SYMBIOT_API_BASE", "http://127.0.0.1:8000").rstrip("/")
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"

HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.environ.get("SYMBIOT_SESSION", "symbiot-demo-session-token"),
    "x-tenant-id": os.environ.get("SYMBIOT_TENANT_ID", "tenant:demo"),
    "x-actor": os.environ.get("SYMBIOT_ACTOR", "demo-user"),
    "x-role": os.environ.get("SYMBIOT_ROLE", "runtime-operator"),
    "x-department": os.environ.get("SYMBIOT_DEPARTMENT", "sales"),
    "x-access-level": os.environ.get("SYMBIOT_ACCESS_LEVEL", "standard"),
}


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8")
            return json.loads(data) if data else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path}: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} {path}: {exc.reason}") from exc


def action_status(center: dict[str, Any], action_id: str) -> str:
    for action in center.get("actions", []):
        if action.get("id") == action_id:
            return str(action.get("status"))
    raise AssertionError(f"Action {action_id} not found")


def related_task_run_id(center: dict[str, Any]) -> str | None:
    for record in reversed(center.get("action_history", [])):
        if record.get("action_id") == "create-next-task" and record.get("related_task_run_id"):
            return str(record["related_task_run_id"])
    return None


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    source = RESULT_CENTER.read_text(encoding="utf-8")

    request_json("GET", "/health")
    queued = request_json(
        "POST",
        "/api/task-runs/queue",
        {
            "process_id": "commercial-proposal",
            "profile_id": "demo-tenant-working",
            "max_attempts": 2,
            "timeout_seconds": 30,
            "auto_process": True,
            "form_data": {
                "client_name": "REA demo",
                "need": "Проверить разблокировку следующей задачи после принятия результата.",
                "product": "Symbiot Runtime",
                "deadline": "G4 user MVP",
                "expected_artifact": "Accepted result with unlocked next task action.",
                "source_context": "Accepted next-task unlock regression check.",
                "selected_workgroup": ["biz_owner", "methodologist", "qa_controller"],
            },
            "document_ids": ["doc-demo-001"],
        },
    )
    task_run_id = queued["task_run"]["id"]
    ready_center = request_json("GET", f"/api/task-runs/{task_run_id}/result-center")
    accepted_center = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/accept-result",
        {"comment": "Accepted next-task unlock check: accept result first."},
    )
    next_status_after_accept = action_status(accepted_center, "create-next-task")
    next_center = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
        {
            "comment": "Accepted next-task unlock check: create linked follow-up.",
            "followup_goal": "Continue accepted result into the next user MVP cycle.",
            "followup_expected_artifact": "Follow-up artifact with evidence and acceptance.",
            "followup_source_context": f"Created from accepted TaskRun {task_run_id}.",
            "followup_urgency": "G4 user MVP",
        },
    )
    followup_id = related_task_run_id(next_center)
    followup = request_json("GET", f"/api/task-runs/{followup_id}") if followup_id else {}

    checks = {
        "source_uses_next_task_available_after_accepted": "next_task_available = ready_for_acceptance or product_status == \"accepted\"" in source,
        "initial_result_ready_for_acceptance": ready_center.get("product_status") == "ready_for_acceptance",
        "result_acceptance_completed": accepted_center.get("product_status") == "accepted",
        "next_task_available_after_acceptance": next_status_after_accept == "available",
        "create_next_task_completed": action_status(next_center, "create-next-task") == "completed",
        "followup_task_run_created": bool(followup_id) and followup.get("id") == followup_id,
        "scope_stays_existing_result_action": "create-next-task" in source
        and "/api/accepted-next-task-unlock" not in source
        and "accepted-next-task-admin" not in source,
    }

    evidence = {
        "task": "SAAS_MVP_ACCEPTED_NEXT_TASK_UNLOCK",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks": checks,
        "passed": all(checks.values()),
        "task_run_id": task_run_id,
        "next_status_after_accept": next_status_after_accept,
        "followup_task_run_id": followup_id,
        "files": [str(RESULT_CENTER)],
        "scope": "existing Result Center action availability fix only; no new endpoint, schema, admin/evidence layer, production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    path = RUNTIME_LOGS / "SAAS_MVP_ACCEPTED_NEXT_TASK_UNLOCK_CHECK_2026-07-10.json"
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
