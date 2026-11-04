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
LIVE_LOG = LOGS / "SAAS_MVP_CYCLE3_ACCEPTANCE_WORKSPACE_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8103").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "cycle3-acceptance-workspace-check",
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
    sheet_name = "156_G4_MVP_CYCLE3_ACCEPTANCE_WORKSPACE"
    if sheet_name not in workbook.sheetnames:
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-3246-CYCLE3-ACCEPTANCE-WORKSPACE-SCHEMA",
        "SAAS-3316-CYCLE3-ACCEPTANCE-WORKSPACE-RESULT-CENTER",
        "SAAS-3386-CYCLE3-ACCEPTANCE-WORKSPACE-FRONTEND",
        "SAAS-3456-CYCLE3-ACCEPTANCE-WORKSPACE-LIVE",
        "SAAS-3525-CYCLE3-ACCEPTANCE-WORKSPACE-FIXATION",
        "MVP Cycle 3 Acceptance Workspace v0.1",
    ]
    workbook.close()
    return len(closed_rows) == 280 and all(marker in joined for marker in required_markers)


def create_cycle3() -> tuple[str, str, str, dict]:
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
            "goal": "Подготовить источник для третьего цикла.",
            "expected_artifact": "Cycle 1 source artifact",
            "source_context": "SAAS-3246..3525 live cycle3 acceptance workspace check",
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
            "source_label": "cycle3-acceptance-source",
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
    launcher_payload = cycle2_result["outcome_next_cycle_launcher"]["launch_payload"]
    request_json(
        f"/api/task-runs/{cycle2_id}/workspace/next-step-review",
        "POST",
        {**launcher_payload, "confirmed_at_label": "confirmed by cycle3 acceptance workspace check"},
    )
    cycle2_after_review = request_json(f"/api/task-runs/{cycle2_id}/result-center")
    create_payload = cycle2_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle3_create = request_json(
        f"/api/task-runs/{cycle2_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 3 from {create_payload['source_label']}",
            "followup_goal": create_payload["goal"],
            "followup_expected_artifact": create_payload["expected_artifact"],
            "followup_source_context": create_payload["source_context"],
            "followup_urgency": create_payload["urgency"],
        },
    )
    cycle3_id = after_cycle3_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    cycle3_result = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    return cycle1_id, cycle2_id, cycle3_id, cycle3_result


def live_api_check() -> dict:
    cycle1_id, cycle2_id, cycle3_id, cycle3_result = create_cycle3()
    initial_workspace = cycle3_result["cycle_acceptance_workspace"]
    request_json(f"/api/task-runs/{cycle3_id}/acceptance-decision", "POST", {"route": "continue", "comment": "continue from cycle 3"})
    cycle3_after_route = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    routed_workspace = cycle3_after_route["cycle_acceptance_workspace"]
    launcher_payload = cycle3_after_route["outcome_next_cycle_launcher"]["launch_payload"]
    request_json(
        f"/api/task-runs/{cycle3_id}/workspace/next-step-review",
        "POST",
        {**launcher_payload, "confirmed_at_label": "confirmed by cycle3 acceptance workspace check"},
    )
    cycle3_after_review = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    create_payload = cycle3_after_review["outcome_next_cycle_launcher"]["launch_payload"]
    after_cycle4_create = request_json(
        f"/api/task-runs/{cycle3_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create cycle 4 from {create_payload['source_label']}",
            "followup_goal": create_payload["goal"],
            "followup_expected_artifact": create_payload["expected_artifact"],
            "followup_source_context": create_payload["source_context"],
            "followup_urgency": create_payload["urgency"],
        },
    )
    cycle4_id = after_cycle4_create["outcome_next_cycle_launcher"]["linked_task_run_id"]
    cycle3_after_cycle4 = request_json(f"/api/task-runs/{cycle3_id}/result-center")
    final_workspace = cycle3_after_cycle4["cycle_acceptance_workspace"]
    item_ids = {item["id"] for item in final_workspace["acceptance_items"]}
    decision_ids = {item["id"] for item in final_workspace["decision_items"]}
    checks = {
        "cycle3_acceptance_workspace_active": initial_workspace["is_active"] is True,
        "cycle3_acceptance_workspace_number": initial_workspace["cycle_number"] == 3,
        "cycle3_acceptance_items_cover_user_acceptance": {
            "cycle-acceptance-result",
            "cycle-acceptance-criteria",
            "cycle-acceptance-signal",
            "cycle-acceptance-decision",
            "cycle-acceptance-asset",
            "cycle-acceptance-next",
            "cycle-acceptance-stop",
        }.issubset(item_ids),
        "cycle3_acceptance_routes_visible": {
            "cycle-acceptance-route-accept",
            "cycle-acceptance-route-revise",
            "cycle-acceptance-route-continue",
        }.issubset(decision_ids),
        "cycle3_route_continue_persisted": routed_workspace["selected_route"] == "continue",
        "cycle3_primary_action_reaches_next_cycle": final_workspace["primary_action"] == "open-next-cycle",
        "cycle4_created_from_cycle3": cycle4_id and cycle3_after_cycle4["outcome_next_cycle_launcher"]["linked_task_run_id"] == cycle4_id,
        "cycle3_existing_runtime_only_gate": any(
            gate["id"] == "cycle-acceptance-existing-runtime-only" and gate["status"] == "passed"
            for gate in final_workspace["gates"]
        ),
    }
    evidence = {
        "task": "SAAS_MVP_CYCLE3_ACCEPTANCE_WORKSPACE_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "cycle1_task_run_id": cycle1_id,
        "cycle2_task_run_id": cycle2_id,
        "cycle3_task_run_id": cycle3_id,
        "cycle4_task_run_id": cycle4_id,
        "initial_workspace": initial_workspace,
        "routed_workspace": routed_workspace,
        "final_workspace": final_workspace,
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
        "schema_exposes_cycle_acceptance_workspace": contains(schemas, "class CycleAcceptanceWorkspaceState")
        and contains(schemas, "cycle_acceptance_workspace: CycleAcceptanceWorkspaceState"),
        "result_center_builds_cycle_acceptance_workspace": contains(result_center, "_build_cycle_acceptance_workspace_state")
        and contains(result_center, "cycle-acceptance-existing-runtime-only"),
        "frontend_shows_cycle_acceptance_workspace": contains(page, "cycleAcceptanceWorkspace?.is_active")
        and contains(page, "Приемка результата текущего цикла")
        and contains(styles, ".cycle-acceptance-workspace"),
        "live_api_proves_cycle3_acceptance_to_cycle4": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table cycle_acceptance")
        and not contains(page, "cycle-acceptance-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_280_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_CYCLE3_ACCEPTANCE_WORKSPACE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP cycle 3 acceptance workspace; cycle 3 result acceptance explains criteria, route, asset and next transition to cycle 4 from existing Result Center runtime",
        "readiness": "2655 / 3525 = 75.3%",
    }
    out = LOGS / "SAAS_MVP_CYCLE3_ACCEPTANCE_WORKSPACE_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
