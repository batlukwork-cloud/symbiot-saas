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
API_BASE = os.environ.get("SYMBIOT_API_BASE", "http://127.0.0.1:8020").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.environ.get("NEXT_PUBLIC_SYMBIOT_SESSION", "symbiot-demo-session-token"),
    "x-tenant-id": os.environ.get("NEXT_PUBLIC_TENANT_ID", "tenant:demo"),
    "x-actor": "demo-user",
    "x-role": os.environ.get("NEXT_PUBLIC_SYMBIOT_ROLE", "runtime-operator"),
    "x-department": os.environ.get("NEXT_PUBLIC_SYMBIOT_DEPARTMENT", "sales"),
    "x-access-level": os.environ.get("NEXT_PUBLIC_SYMBIOT_ACCESS_LEVEL", "standard"),
}


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(f"{API_BASE}{path}", data=data, headers=HEADERS, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path}: {error.code} {detail}") from error
    except URLError as error:
        raise RuntimeError(f"{method} {path}: {error.reason}") from error


def action_by_id(result_center: dict[str, Any], action_id: str) -> dict[str, Any]:
    for action in result_center.get("actions", []):
        if action.get("id") == action_id:
            return action
    raise AssertionError(f"Action {action_id} not found for {result_center.get('task_run_id')}")


def related_followup_id(result_center: dict[str, Any]) -> str:
    for record in reversed(result_center.get("action_history", [])):
        if record.get("action_id") == "create-next-task" and record.get("related_task_run_id"):
            return str(record["related_task_run_id"])
    raise AssertionError(f"Follow-up relation not found for {result_center.get('task_run_id')}")


def create_initial_task_run() -> tuple[str, dict[str, Any]]:
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": True,
        "form_data": {
            "client_name": "REA demo",
            "need": "Технически проверить повторяемую петлю пользовательского MVP.",
            "product": "Symbiot Runtime",
            "deadline": "G3 Product Runtime",
            "expected_artifact": "Проверяемый результат цикла с evidence и следующим follow-up.",
            "source_context": "Runtime loop technical acceptance without production/deploy changes.",
            "selected_workgroup": ["biz_owner", "methodologist", "qa_controller"],
        },
        "document_ids": ["doc-demo-001"],
    }
    response = request_json("POST", "/api/task-runs/queue", payload)
    task_run = response["task_run"]
    return str(task_run["id"]), response


def create_followup_and_accept(task_run_id: str, cycle_number: int) -> dict[str, Any]:
    center = request_json("GET", f"/api/task-runs/{task_run_id}/result-center")
    accept_action = action_by_id(center, "accept-result")
    if accept_action.get("status") != "available":
        raise AssertionError(f"accept-result is {accept_action.get('status')} for {task_run_id}")

    next_action = action_by_id(center, "create-next-task")
    if next_action.get("status") not in {"available", "completed"}:
        raise AssertionError(f"create-next-task is {next_action.get('status')} for {task_run_id}")

    if next_action.get("status") == "available":
        followed = request_json(
            "POST",
            f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
            {
                "comment": f"Runtime loop check: create cycle {cycle_number + 1}.",
                "followup_goal": f"Цикл {cycle_number + 1}: продолжить принятый результат {task_run_id}.",
                "followup_expected_artifact": f"Артефакт цикла {cycle_number + 1} с evidence и приемкой.",
                "followup_source_context": f"Created from ready cycle {cycle_number}: {task_run_id}.",
                "followup_urgency": "G3 Product Runtime",
            },
        )
    else:
        followed = center

    followup_id = related_followup_id(followed)
    accepted = request_json(
        "POST",
        f"/api/task-runs/{task_run_id}/result-actions/accept-result",
        {"comment": f"Runtime loop check: cycle {cycle_number} accepted."},
    )
    if accepted.get("product_status") != "accepted":
        raise AssertionError(f"{task_run_id} was not accepted: {accepted.get('product_status')}")

    followup_run = request_json("GET", f"/api/task-runs/{followup_id}")
    followup_center = request_json("GET", f"/api/task-runs/{followup_id}/result-center")
    return {
        "cycle": cycle_number,
        "task_run_id": task_run_id,
        "accepted_status": accepted.get("product_status"),
        "followup_task_run_id": followup_id,
        "followup_status": followup_run.get("status"),
        "followup_result_status": followup_center.get("product_status"),
        "followup_artifact_id": followup_run.get("artifact_id"),
    }


def main() -> None:
    started_at = datetime.now(UTC).isoformat()
    health = request_json("GET", "/health")
    first_run_id, queue_response = create_initial_task_run()
    first_loop = create_followup_and_accept(first_run_id, 1)
    second_loop = create_followup_and_accept(first_loop["followup_task_run_id"], 2)
    third_center = request_json("GET", f"/api/task-runs/{second_loop['followup_task_run_id']}/result-center")

    checks = {
        "api_health_ok": health.get("status") == "ok",
        "initial_task_run_completed": queue_response["task_run"].get("status") == "completed",
        "cycle_1_accepted": first_loop["accepted_status"] == "accepted",
        "cycle_2_created_completed": first_loop["followup_status"] == "completed"
        and first_loop["followup_result_status"] == "ready_for_acceptance",
        "cycle_2_accepted": second_loop["accepted_status"] == "accepted",
        "cycle_3_created_completed": second_loop["followup_status"] == "completed"
        and second_loop["followup_result_status"] == "ready_for_acceptance",
        "cycle_links_are_distinct": len(
            {
                first_loop["task_run_id"],
                first_loop["followup_task_run_id"],
                second_loop["followup_task_run_id"],
            }
        )
        == 3,
        "third_cycle_can_be_accepted_next": action_by_id(third_center, "accept-result").get("status") == "available",
        "no_external_or_production_call": API_BASE.startswith("http://127.0.0.1:"),
    }

    evidence = {
        "task": "SAAS_MVP_USER_REPEATABLE_LOOP_RUNTIME_CHECK",
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "checks": checks,
        "passed": all(checks.values()),
        "loop": {
            "initial_queue_id": queue_response["queue_item"]["id"],
            "cycle_1": first_loop,
            "cycle_2": second_loop,
            "cycle_3_task_run_id": second_loop["followup_task_run_id"],
        },
        "scope": "local runtime API technical verification of repeatable MVP loop; no production/deploy/security/tenant/audit-access/admin/evidence expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_USER_REPEATABLE_LOOP_RUNTIME_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
