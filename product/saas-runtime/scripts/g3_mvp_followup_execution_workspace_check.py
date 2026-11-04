from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
LIVE_LOG = LOGS / "SAAS_MVP_FOLLOWUP_EXECUTION_WORKSPACE_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8099").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "followup-execution-workspace-check",
    "x-role": "runtime-operator",
    "x-department": "sales",
    "x-access-level": "standard",
}
KSG = (
    ROOT.parents[1]
    / "docs"
    / "06_management"
    / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ"
    / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА.xlsx"
)


def contains(text: str, marker: str) -> bool:
    return marker in text


def request_json(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(f"{API_BASE}{path}", data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path}: {error.code} {detail}") from error


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False
    if not KSG.exists():
        return False
    workbook = load_workbook(KSG, read_only=True, data_only=True)
    sheet_name = "152_G4_MVP_FOLLOWUP_EXECUTION_WORKSPACE"
    if sheet_name not in workbook.sheetnames:
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2486-FOLLOWUP-EXECUTION-SCHEMA",
        "SAAS-2506-FOLLOWUP-EXECUTION-RESULT-CENTER",
        "SAAS-2526-FOLLOWUP-EXECUTION-FRONTEND",
        "SAAS-2546-FOLLOWUP-EXECUTION-ACTIONS",
        "SAAS-2566-FOLLOWUP-EXECUTION-TEAM",
        "SAAS-2586-FOLLOWUP-EXECUTION-LIVE",
        "SAAS-2606-FOLLOWUP-EXECUTION-REGRESSION",
        "SAAS-2645-FOLLOWUP-EXECUTION-FIXATION",
        "MVP Follow-up Execution Workspace v0.1",
    ]
    return len(closed_rows) == 160 and all(marker in joined for marker in required_markers)


def live_api_check() -> dict:
    payload = {
        "process_id": "commercial-proposal",
        "profile_id": "demo-tenant-working",
        "max_attempts": 2,
        "timeout_seconds": 30,
        "auto_process": True,
        "form_data": {
            "business_mission_id": "lead-qualification",
            "scenario_pack_id": "managed-result",
            "role_pack_id": "commercial",
            "selected_workgroup": ["sales-manager", "analyst", "methodologist"],
            "goal": "Подготовить рабочий follow-up цикл для SMB-пользователя.",
            "expected_artifact": "Follow-up execution workspace artifact",
            "source_context": "SAAS-2486..2645 live follow-up execution workspace check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    source_task_run_id = queue_response["task_run"]["id"]
    request_json(
        f"/api/task-runs/{source_task_run_id}/acceptance-decision",
        "POST",
        {"route": "accept", "comment": "accept source result for follow-up workspace check"},
    )
    request_json(
        f"/api/task-runs/{source_task_run_id}/result-actions/accept-result",
        "POST",
        {"comment": "accept result before follow-up workspace check"},
    )
    request_json(
        f"/api/task-runs/{source_task_run_id}/workspace/next-step-review",
        "POST",
        {
            "goal": "Сформировать рабочий результат второго цикла.",
            "expected_artifact": "Second cycle execution artifact",
            "source_context": f"Source TaskRun {source_task_run_id}",
            "urgency": "prepare SMB follow-up output",
            "source_label": "followup-execution-workspace-live-check",
            "confirmed_at_label": "live-check",
        },
    )
    source_after_followup = request_json(
        f"/api/task-runs/{source_task_run_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create follow-up for execution workspace",
            "followup_goal": "Сформировать рабочий результат второго цикла.",
            "followup_expected_artifact": "Second cycle execution artifact",
            "followup_source_context": f"Source TaskRun {source_task_run_id}",
            "followup_urgency": "prepare SMB follow-up output",
        },
    )
    linked_task_run_id = next(
        record["related_task_run_id"]
        for record in source_after_followup["action_history"]
        if record.get("related_task_run_id")
    )
    linked_task_run = request_json(f"/api/task-runs/{linked_task_run_id}")
    linked_result_center = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")
    workspace = linked_result_center["followup_execution_workspace"]
    item_ids = {item["id"] for item in workspace["items"]}

    checks = {
        "workspace_active_for_followup": workspace["is_active"] is True,
        "workspace_cycle_number_is_2": workspace["cycle_number"] == 2,
        "workspace_points_to_source": workspace["source_task_run_id"] == source_task_run_id,
        "workspace_current_is_linked_task": workspace["current_task_run_id"] == linked_task_run_id,
        "workspace_primary_action_accepts_current_result": workspace["primary_action"] == "accept-current-result",
        "workspace_restores_workgroup": len(workspace["inherited_workgroup"]) == 3,
        "workspace_items_cover_execution_surface": {"cycle-source", "cycle-goal", "cycle-artifact", "cycle-workgroup", "cycle-decision"}.issubset(item_ids),
        "linked_task_run_keeps_payload": linked_task_run["form_data"].get("business_mission_id") == "lead-qualification",
        "linked_result_keeps_continuity": linked_result_center["followup_continuity"]["is_followup"] is True,
    }
    evidence = {
        "task": "SAAS_MVP_FOLLOWUP_EXECUTION_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "source_task_run_id": source_task_run_id,
        "linked_task_run_id": linked_task_run_id,
        "workspace": workspace,
    }
    LOGS.mkdir(parents=True, exist_ok=True)
    LIVE_LOG.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    return evidence


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")
    live = live_api_check()
    checks = {
        "schema_exposes_followup_execution_workspace": contains(schemas, "class FollowupExecutionWorkspaceState")
        and contains(schemas, "followup_execution_workspace: FollowupExecutionWorkspaceState"),
        "result_center_builds_workspace_from_existing_runtime": contains(result_center, "_build_followup_execution_workspace_state")
        and contains(result_center, "followup-execution-existing-runtime-only")
        and contains(result_center, "_form_data_list"),
        "frontend_shows_followup_execution_workspace": contains(page, "followupExecutionWorkspace?.is_active")
        and contains(page, "Рабочая зона текущего follow-up")
        and contains(page, "applyFollowupExecutionPrimaryAction")
        and contains(styles, ".followup-execution-workspace"),
        "live_api_proves_workspace_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table followup_execution")
        and not contains(page, "followup-execution-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_160_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_FOLLOWUP_EXECUTION_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP follow-up execution workspace; opened follow-up shows current cycle source, goal, artifact, workgroup and next decision from existing runtime state",
        "readiness": "1775 / 2645 = 67.1%",
    }
    out = LOGS / "SAAS_MVP_FOLLOWUP_EXECUTION_WORKSPACE_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
