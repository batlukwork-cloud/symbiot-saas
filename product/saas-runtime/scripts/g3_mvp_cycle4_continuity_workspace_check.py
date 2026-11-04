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
LIVE_LOG = LOGS / "SAAS_MVP_CYCLE4_CONTINUITY_WORKSPACE_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8104").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "cycle4-continuity-workspace-check",
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
    sheet_name = "157_G4_MVP_CYCLE4_CONTINUITY_WORKSPACE"
    if sheet_name not in workbook.sheetnames:
        workbook.close()
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-3526-CYCLE4-CONTINUITY-WORKSPACE-SCHEMA",
        "SAAS-3606-CYCLE4-CONTINUITY-WORKSPACE-RESULT-CENTER",
        "SAAS-3686-CYCLE4-CONTINUITY-WORKSPACE-FRONTEND",
        "SAAS-3766-CYCLE4-CONTINUITY-WORKSPACE-LIVE",
        "SAAS-3845-CYCLE4-CONTINUITY-WORKSPACE-FIXATION",
        "MVP Cycle 4 Continuity Workspace v0.1",
    ]
    workbook.close()
    return len(closed_rows) == 320 and all(marker in joined for marker in required_markers)


def create_cycle4() -> tuple[str, str, str, str, dict]:
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
            "goal": "Подготовить источник для четвертого цикла.",
            "expected_artifact": "Cycle 1 source artifact",
            "source_context": "SAAS-3526..3845 live cycle4 continuity workspace check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    cycle1_id = queue_response["task_run"]["id"]
    request_json(f"/api/task-runs/{cycle1_id}/acceptance-decision", "POST", {"route": "accept", "comment": "accept cycle 1"})
    request_json(f"/api/task-runs/{cycle1_id}/result-actions/accept-result", "POST", {"comment": "accept cycle 1 result"})
    request_json(
        f"/api/task-runs/{cycle1_id}/workspace/next-step-review",
        "POST",
        {
            "goal": "Сформировать outcome второго цикла.",
            "expected_artifact": "Cycle 2 outcome artifact",
            "source_context": f"Source TaskRun {cycle1_id}",
            "urgency": "open cycle 2",
            "source_label": "cycle4-continuity-source",
            "confirmed_at_label": "live-check",
        },
    )
    after_cycle2_create = request_json(
        f"/api/task-runs/{cycle1_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create cycle 2",
            "followup_goal": "Сформировать outcome второго цикла.",
            "followup_expected_artifact": "Cycle 2 outcome artifact",
            "followup_source_context": f"Source TaskRun {cycle1_id}",
            "followup_urgency": "open cycle 2",
        },
    )
    cycle2_id = next(record["related_task_run_id"] for record in after_cycle2_create["action_history"] if record.get("related_task_run_id"))
    request_json(f"/api/task-runs/{cycle2_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue from cycle 2"})
    cycle2_result = request_json(f"/api/task-runs/{cycle2_id}/result-center")
    cycle2_payload = cycle2_result["outcome_next_cycle_launcher"]["launch_payload"]
    request_json(
        f"/api/task-runs/{cycle2_id}/workspace/next-step-review",
        "POST",
        {**cycle2_payload, "confirmed_at_label": "confirmed by cycle4 continuity workspace check"},
    )
    cycle2_after_review = request_json(f"/api/task-runs/{cycle2_id}/result-center")
    cycle3_payload = cycle2_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle3_create = request_json(
        f"/api/task-runs/{cycle2_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 3 from {cycle3_payload['source_label']}",
            "followup_goal": cycle3_payload["goal"],
            "followup_expected_artifact": cycle3_payload["expected_artifact"],
            "followup_source_context": cycle3_payload["source_context"],
            "followup_urgency": cycle3_payload["urgency"],
        },
    )
    cycle3_id = after_cycle3_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    request_json(f"/api/task-runs/{cycle3_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue from cycle 3"})
    cycle3_result = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    cycle3_payload = cycle3_result["outcome_next_cycle_launcher"]["launch_payload"]
    request_json(
        f"/api/task-runs/{cycle3_id}/workspace/next-step-review",
        "POST",
        {**cycle3_payload, "confirmed_at_label": "confirmed by cycle4 continuity workspace check"},
    )
    cycle3_after_review = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    cycle4_payload = cycle3_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle4_create = request_json(
        f"/api/task-runs/{cycle3_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 4 from {cycle4_payload['source_label']}",
            "followup_goal": cycle4_payload["goal"],
            "followup_expected_artifact": cycle4_payload["expected_artifact"],
            "followup_source_context": cycle4_payload["source_context"],
            "followup_urgency": cycle4_payload["urgency"],
        },
    )
    cycle4_id = after_cycle4_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    cycle4_result = request_json(f"/api/task-runs/{cycle4_id}/result-center")
    return cycle1_id, cycle2_id, cycle3_id, cycle4_id, cycle4_result


def live_api_check() -> dict:
    cycle1_id, cycle2_id, cycle3_id, cycle4_id, cycle4_result = create_cycle4()
    workspace = cycle4_result["cycle_continuity_workspace"]
    item_ids = {item["id"] for item in workspace["items"]}
    gate_ids = {gate["id"]: gate["status"] for gate in workspace["gates"]}
    checks = {
        "cycle4_continuity_workspace_active": workspace["is_active"] is True,
        "cycle4_number_is_4": workspace["cycle_number"] == 4,
        "cycle4_source_is_cycle3": workspace["source_task_run_id"] == cycle3_id,
        "cycle4_lineage_restored": cycle4_result["followup_continuity"]["cycle_number"] == 4
        and len(cycle4_result["followup_continuity"]["lineage"]) >= 3,
        "cycle4_items_cover_user_scenario": {
            "cycle-continuity-basis",
            "cycle-continuity-task",
            "cycle-continuity-result",
            "cycle-continuity-acceptance",
            "cycle-continuity-next-transition",
            "cycle-continuity-stop",
        }.issubset(item_ids),
        "cycle4_primary_action_clear": workspace["primary_action"] in {"execute-cycle", "accept-cycle-result", "continue-chain"},
        "cycle4_acceptance_workspace_still_active": cycle4_result["cycle_acceptance_workspace"]["is_active"] is True,
        "cycle4_existing_runtime_only_gate": gate_ids.get("cycle-continuity-existing-runtime-only") == "passed",
    }
    evidence = {
        "task": "SAAS_MVP_CYCLE4_CONTINUITY_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "cycle1_task_run_id": cycle1_id,
        "cycle2_task_run_id": cycle2_id,
        "cycle3_task_run_id": cycle3_id,
        "cycle4_task_run_id": cycle4_id,
        "cycle4_workspace": workspace,
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
        "schema_exposes_cycle_continuity_workspace": contains(schemas, "class CycleContinuityWorkspaceState")
        and contains(schemas, "cycle_continuity_workspace: CycleContinuityWorkspaceState"),
        "result_center_builds_cycle_continuity_workspace": contains(result_center, "_build_cycle_continuity_workspace_state")
        and contains(result_center, "cycle-continuity-existing-runtime-only"),
        "frontend_shows_cycle_continuity_workspace": contains(page, "cycleContinuityWorkspace?.is_active")
        and contains(page, "Самостоятельная рабочая зона цикла")
        and contains(styles, ".cycle-continuity-workspace"),
        "live_api_proves_cycle4_continuity_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table cycle_continuity")
        and not contains(page, "cycle-continuity-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_320_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_CYCLE4_CONTINUITY_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP cycle 4 continuity workspace; direct-opened cycle 4 shows basis, current task, expected result, acceptance and next transition from existing Result Center runtime",
        "readiness": "2975 / 3845 = 77.4%",
    }
    out = LOGS / "SAAS_MVP_CYCLE4_CONTINUITY_WORKSPACE_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
