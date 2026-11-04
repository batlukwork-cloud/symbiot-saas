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
LIVE_LOG = LOGS / "SAAS_MVP_SCENARIO_RESUME_CONTROL_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8098").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "scenario-resume-check",
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
    sheet_name = "151_G4_MVP_SCENARIO_RESUME_CONTROL"
    if sheet_name not in workbook.sheetnames:
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2346-SCENARIO-RESUME-SCHEMA",
        "SAAS-2366-SCENARIO-RESUME-RESULT-CENTER",
        "SAAS-2386-SCENARIO-RESUME-FRONTEND",
        "SAAS-2406-SCENARIO-RESUME-ACTIONS",
        "SAAS-2426-SCENARIO-RESUME-LIVE",
        "SAAS-2446-SCENARIO-RESUME-REGRESSION",
        "SAAS-2485-SCENARIO-RESUME-FIXATION",
        "MVP Scenario Resume Control v0.1",
    ]
    return len(closed_rows) == 140 and all(marker in joined for marker in required_markers)


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
            "goal": "Продолжить MVP-сценарий с понятной точки остановки.",
            "expected_artifact": "Scenario resume control artifact",
            "source_context": "SAAS-2346..2485 live resume control check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    task_run_id = queue_response["task_run"]["id"]
    source_before = request_json(f"/api/task-runs/{task_run_id}/result-center")
    request_json(
        f"/api/task-runs/{task_run_id}/acceptance-decision",
        "POST",
        {"route": "accept", "comment": "accept source result for scenario resume check"},
    )
    request_json(
        f"/api/task-runs/{task_run_id}/result-actions/accept-result",
        "POST",
        {"comment": "accept result before scenario resume continuation"},
    )
    source_after_accept = request_json(f"/api/task-runs/{task_run_id}/result-center")
    request_json(
        f"/api/task-runs/{task_run_id}/workspace/next-step-review",
        "POST",
        {
            "goal": "Открыть следующий цикл из сохраненного сценария.",
            "expected_artifact": "Follow-up scenario resume artifact",
            "source_context": f"Source TaskRun {task_run_id}",
            "urgency": "continue MVP user scenario",
            "source_label": "scenario-resume-live-check",
            "confirmed_at_label": "live-check",
        },
    )
    source_after_review = request_json(f"/api/task-runs/{task_run_id}/result-center")
    source_after_followup = request_json(
        f"/api/task-runs/{task_run_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create follow-up for scenario resume control",
            "followup_goal": "Открыть следующий цикл из сохраненного сценария.",
            "followup_expected_artifact": "Follow-up scenario resume artifact",
            "followup_source_context": f"Source TaskRun {task_run_id}",
            "followup_urgency": "continue MVP user scenario",
        },
    )
    linked_task_run_id = next(
        record["related_task_run_id"]
        for record in source_after_followup["action_history"]
        if record.get("related_task_run_id")
    )
    linked_task_run = request_json(f"/api/task-runs/{linked_task_run_id}")
    linked_result_center = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")

    checks = {
        "source_initial_resume_review_result": source_before["scenario_resume"]["primary_action"] == "review-result",
        "source_after_accept_needs_next_step_confirm": source_after_accept["scenario_resume"]["primary_action"]
        == "confirm-next-step",
        "source_after_review_can_create_next_task": source_after_review["scenario_resume"]["primary_action"]
        == "create-next-task",
        "source_after_followup_opens_linked_task": source_after_followup["scenario_resume"]["primary_action"]
        == "open-followup",
        "source_resume_points_to_linked_task": source_after_followup["scenario_resume"]["primary_action_target_task_run_id"]
        == linked_task_run_id,
        "source_resume_steps_cover_full_loop": len(source_after_followup["scenario_resume"]["steps"]) == 4,
        "linked_followup_keeps_scenario_payload": linked_task_run["form_data"].get("business_mission_id")
        == "lead-qualification",
        "linked_followup_has_continuity_context": linked_result_center["followup_continuity"]["is_followup"] is True,
    }
    evidence = {
        "task": "SAAS_MVP_SCENARIO_RESUME_CONTROL_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "source_task_run_id": task_run_id,
        "linked_task_run_id": linked_task_run_id,
        "source_resume": source_after_followup["scenario_resume"],
        "linked_continuity": linked_result_center["followup_continuity"],
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
        "schema_exposes_scenario_resume_state": contains(schemas, "class ScenarioResumeState")
        and contains(schemas, "primary_action")
        and contains(schemas, "steps: list[ScenarioResumeStep]"),
        "result_center_builds_primary_resume_action": contains(result_center, "_build_scenario_resume_state")
        and contains(result_center, "primary_action = \"open-followup\"")
        and contains(result_center, "primary_action = \"create-next-task\"")
        and contains(result_center, "scenario-resume-existing-history-only"),
        "frontend_shows_resume_control": contains(page, "scenarioResume?.is_resumable")
        and contains(page, "С места остановки")
        and contains(page, "applyScenarioResumePrimaryAction")
        and contains(styles, ".scenario-resume-control"),
        "live_api_proves_resume_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table scenario_resume")
        and not contains(page, "scenario-resume-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_140_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_SCENARIO_RESUME_CONTROL",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP scenario resume control; direct opening shows next action and continuation steps from existing Result Center history",
        "readiness": "1615 / 2485 = 65.0%",
    }
    out = LOGS / "SAAS_MVP_SCENARIO_RESUME_CONTROL_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
