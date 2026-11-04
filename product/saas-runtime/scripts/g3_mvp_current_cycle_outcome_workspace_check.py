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
LIVE_LOG = LOGS / "SAAS_MVP_CURRENT_CYCLE_OUTCOME_WORKSPACE_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8100").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "current-cycle-outcome-check",
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
    sheet_name = "153_G4_MVP_CURRENT_CYCLE_OUTCOME"
    if sheet_name not in workbook.sheetnames:
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2646-CURRENT-CYCLE-OUTCOME-SCHEMA",
        "SAAS-2666-CURRENT-CYCLE-OUTCOME-RESULT-CENTER",
        "SAAS-2686-CURRENT-CYCLE-OUTCOME-FRONTEND",
        "SAAS-2706-CURRENT-CYCLE-OUTCOME-ROUTES",
        "SAAS-2726-CURRENT-CYCLE-OUTCOME-ACTIONS",
        "SAAS-2746-CURRENT-CYCLE-OUTCOME-ARTIFACT",
        "SAAS-2766-CURRENT-CYCLE-OUTCOME-LIVE",
        "SAAS-2786-CURRENT-CYCLE-OUTCOME-REGRESSION",
        "SAAS-2825-CURRENT-CYCLE-OUTCOME-FIXATION",
        "MVP Current Cycle Outcome Workspace v0.1",
    ]
    return len(closed_rows) == 180 and all(marker in joined for marker in required_markers)


def create_followup() -> tuple[str, str]:
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
            "goal": "Подготовить follow-up для проверки решения текущего цикла.",
            "expected_artifact": "Current cycle outcome artifact",
            "source_context": "SAAS-2646..2825 live current cycle outcome check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    source_task_run_id = queue_response["task_run"]["id"]
    request_json(
        f"/api/task-runs/{source_task_run_id}/acceptance-decision",
        "POST",
        {"route": "accept", "comment": "accept source before current cycle outcome check"},
    )
    request_json(
        f"/api/task-runs/{source_task_run_id}/result-actions/accept-result",
        "POST",
        {"comment": "accept source result"},
    )
    request_json(
        f"/api/task-runs/{source_task_run_id}/workspace/next-step-review",
        "POST",
        {
            "goal": "Сформировать результат текущего follow-up цикла.",
            "expected_artifact": "Current cycle outcome artifact",
            "source_context": f"Source TaskRun {source_task_run_id}",
            "urgency": "decide current cycle outcome",
            "source_label": "current-cycle-outcome-live-check",
            "confirmed_at_label": "live-check",
        },
    )
    source_after_followup = request_json(
        f"/api/task-runs/{source_task_run_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create follow-up for current cycle outcome",
            "followup_goal": "Сформировать результат текущего follow-up цикла.",
            "followup_expected_artifact": "Current cycle outcome artifact",
            "followup_source_context": f"Source TaskRun {source_task_run_id}",
            "followup_urgency": "decide current cycle outcome",
        },
    )
    linked_task_run_id = next(
        record["related_task_run_id"]
        for record in source_after_followup["action_history"]
        if record.get("related_task_run_id")
    )
    return source_task_run_id, linked_task_run_id


def live_api_check() -> dict:
    source_task_run_id, linked_task_run_id = create_followup()
    before_route = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")
    request_json(
        f"/api/task-runs/{linked_task_run_id}/acceptance-decision",
        "POST",
        {"route": "continue", "comment": "continue current cycle after useful result"},
    )
    after_route = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")
    before_workspace = before_route["current_cycle_outcome_workspace"]
    after_workspace = after_route["current_cycle_outcome_workspace"]
    before_ids = {item["id"] for item in before_workspace["items"]}
    after_route_ids = {item["id"] for item in after_workspace["route_items"]}
    checks = {
        "before_workspace_active": before_workspace["is_active"] is True,
        "before_cycle_number_is_2": before_workspace["cycle_number"] == 2,
        "before_primary_action_choose_route": before_workspace["primary_action"] == "choose-route",
        "before_items_cover_outcome_surface": {
            "current-cycle-result",
            "current-cycle-status",
            "current-cycle-route",
            "current-cycle-next-asset",
        }.issubset(before_ids),
        "route_items_cover_three_routes": {"route-accept", "route-revise", "route-continue"}.issubset(after_route_ids),
        "after_selected_route_continue": after_workspace["selected_route"] == "continue",
        "after_primary_action_continue_next_cycle": after_workspace["primary_action"] == "continue-next-cycle",
        "after_acceptance_decision_persisted": after_route["acceptance_decision"]["selected_route"] == "continue",
        "source_link_preserved": after_route["followup_continuity"]["source_task_run_id"] == source_task_run_id,
    }
    evidence = {
        "task": "SAAS_MVP_CURRENT_CYCLE_OUTCOME_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "source_task_run_id": source_task_run_id,
        "linked_task_run_id": linked_task_run_id,
        "before_workspace": before_workspace,
        "after_workspace": after_workspace,
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
        "schema_exposes_current_cycle_outcome_workspace": contains(schemas, "class CurrentCycleOutcomeWorkspaceState")
        and contains(schemas, "current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState"),
        "result_center_builds_outcome_from_existing_runtime": contains(result_center, "_build_current_cycle_outcome_workspace_state")
        and contains(result_center, "current-cycle-outcome-existing-runtime-only"),
        "frontend_shows_current_cycle_outcome_workspace": contains(page, "currentCycleOutcomeWorkspace?.is_active")
        and contains(page, "Решение текущего цикла")
        and contains(page, "applyCurrentCycleOutcomePrimaryAction")
        and contains(styles, ".current-cycle-outcome-workspace"),
        "live_api_proves_outcome_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table current_cycle_outcome")
        and not contains(page, "current-cycle-outcome-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_180_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_CURRENT_CYCLE_OUTCOME_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP current cycle outcome workspace; follow-up result shows outcome, route and next asset from existing Result Center state",
        "readiness": "1955 / 2825 = 69.2%",
    }
    out = LOGS / "SAAS_MVP_CURRENT_CYCLE_OUTCOME_WORKSPACE_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
