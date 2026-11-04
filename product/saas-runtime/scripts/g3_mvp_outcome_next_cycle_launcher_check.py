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
LIVE_LOG = LOGS / "SAAS_MVP_OUTCOME_NEXT_CYCLE_LAUNCHER_LIVE_API_2026-07-11.json"
API_BASE = os.getenv("SYMBIOT_API_BASE", "http://127.0.0.1:8101").rstrip("/")
HEADERS = {
    "Content-Type": "application/json",
    "x-symbiot-session": os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token"),
    "x-tenant-id": os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo"),
    "x-actor": "outcome-next-cycle-launcher-check",
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
    sheet_name = "154_G4_MVP_OUTCOME_NEXT_CYCLE_LAUNCHER"
    if sheet_name not in workbook.sheetnames:
        return False
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2826-OUTCOME-NEXT-CYCLE-LAUNCHER-SCHEMA",
        "SAAS-2866-OUTCOME-NEXT-CYCLE-LAUNCHER-RESULT-CENTER",
        "SAAS-2906-OUTCOME-NEXT-CYCLE-LAUNCHER-FRONTEND",
        "SAAS-2946-OUTCOME-NEXT-CYCLE-LAUNCHER-ACTIONS",
        "SAAS-2986-OUTCOME-NEXT-CYCLE-LAUNCHER-LIVE",
        "SAAS-3025-OUTCOME-NEXT-CYCLE-LAUNCHER-FIXATION",
        "MVP Outcome-to-Next-Cycle Launcher v0.1",
    ]
    return len(closed_rows) == 200 and all(marker in joined for marker in required_markers)


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
            "goal": "Подготовить follow-up для запуска следующего цикла из outcome.",
            "expected_artifact": "Outcome launcher source artifact",
            "source_context": "SAAS-2826..3025 live outcome next-cycle launcher check",
            "urgency": "normal",
        },
        "document_ids": ["doc-demo-001"],
    }
    queue_response = request_json("/api/task-runs/queue", "POST", payload)
    source_task_run_id = queue_response["task_run"]["id"]
    request_json(
        f"/api/task-runs/{source_task_run_id}/acceptance-decision",
        "POST",
        {"route": "accept", "comment": "accept source before launcher check"},
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
            "goal": "Сформировать outcome второго цикла.",
            "expected_artifact": "Second cycle outcome artifact",
            "source_context": f"Source TaskRun {source_task_run_id}",
            "urgency": "open second cycle",
            "source_label": "outcome-launcher-source",
            "confirmed_at_label": "live-check",
        },
    )
    source_after_followup = request_json(
        f"/api/task-runs/{source_task_run_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": "create follow-up for outcome next-cycle launcher",
            "followup_goal": "Сформировать outcome второго цикла.",
            "followup_expected_artifact": "Second cycle outcome artifact",
            "followup_source_context": f"Source TaskRun {source_task_run_id}",
            "followup_urgency": "open second cycle",
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
    request_json(
        f"/api/task-runs/{linked_task_run_id}/acceptance-decision",
        "POST",
        {"route": "continue", "comment": "continue to launch next cycle from outcome"},
    )
    after_route = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")
    launcher_after_route = after_route["outcome_next_cycle_launcher"]
    request_json(
        f"/api/task-runs/{linked_task_run_id}/workspace/next-step-review",
        "POST",
        {
            **launcher_after_route["launch_payload"],
            "confirmed_at_label": "confirmed by live outcome launcher check",
        },
    )
    after_review = request_json(f"/api/task-runs/{linked_task_run_id}/result-center")
    launcher_after_review = after_review["outcome_next_cycle_launcher"]
    create_payload = launcher_after_review["launch_payload"]
    after_create = request_json(
        f"/api/task-runs/{linked_task_run_id}/result-actions/create-next-task",
        "POST",
        {
            "comment": f"create from {create_payload['source_label']}",
            "followup_goal": create_payload["goal"],
            "followup_expected_artifact": create_payload["expected_artifact"],
            "followup_source_context": create_payload["source_context"],
            "followup_urgency": create_payload["urgency"],
        },
    )
    launcher_after_create = after_create["outcome_next_cycle_launcher"]
    new_cycle_task_run_id = launcher_after_create["linked_task_run_id"]
    new_cycle_result = request_json(f"/api/task-runs/{new_cycle_task_run_id}/result-center")
    item_ids = {item["id"] for item in launcher_after_create["items"]}
    checks = {
        "after_route_launcher_active": launcher_after_route["is_active"] is True,
        "after_route_primary_action_confirm": launcher_after_route["primary_action"] == "confirm-next-cycle",
        "after_route_payload_targets_cycle_3": launcher_after_route["target_cycle_number"] == 3,
        "after_review_primary_action_create": launcher_after_review["primary_action"] == "create-next-cycle",
        "after_review_confirmed": launcher_after_review["review_confirmed"] is True,
        "after_create_primary_action_open": launcher_after_create["primary_action"] == "open-next-cycle",
        "after_create_linked_task_run_id_visible": bool(new_cycle_task_run_id),
        "after_create_items_cover_launcher": {
            "launcher-source-outcome",
            "launcher-route",
            "launcher-review",
            "launcher-target-cycle",
            "launcher-first-action",
        }.issubset(item_ids),
        "new_cycle_is_cycle_3_followup": new_cycle_result["followup_continuity"]["cycle_number"] == 3,
        "new_cycle_source_is_cycle_2": new_cycle_result["followup_continuity"]["source_task_run_id"] == linked_task_run_id,
        "source_link_preserved": after_create["followup_continuity"]["source_task_run_id"] == source_task_run_id,
    }
    evidence = {
        "task": "SAAS_MVP_OUTCOME_NEXT_CYCLE_LAUNCHER_LIVE_API",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "api_base": API_BASE,
        "passed": all(checks.values()),
        "checks": checks,
        "source_task_run_id": source_task_run_id,
        "linked_task_run_id": linked_task_run_id,
        "new_cycle_task_run_id": new_cycle_task_run_id,
        "launcher_after_route": launcher_after_route,
        "launcher_after_review": launcher_after_review,
        "launcher_after_create": launcher_after_create,
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
        "schema_exposes_outcome_next_cycle_launcher": contains(schemas, "class OutcomeNextCycleLauncherState")
        and contains(schemas, "outcome_next_cycle_launcher: OutcomeNextCycleLauncherState"),
        "result_center_builds_launcher_from_existing_runtime": contains(result_center, "_build_outcome_next_cycle_launcher_state")
        and contains(result_center, "outcome-next-cycle-launcher-existing-runtime-only"),
        "frontend_shows_launcher_and_uses_payload": contains(page, "outcomeNextCycleLauncher?.is_active")
        and contains(page, "applyOutcomeNextCycleLauncherPrimaryAction")
        and contains(page, "nextTaskPayloadForAction")
        and contains(styles, ".outcome-next-cycle-launcher"),
        "live_api_proves_launcher_contract": bool(live.get("passed")),
        "scope_stays_user_mvp_no_new_admin_evidence_layer": not contains(result_center, "create table outcome_next_cycle")
        and not contains(page, "outcome-next-cycle-admin")
        and not contains(result_center, "production_deploy"),
        "ksg_records_200_task_throw": ksg_trace_ready(),
    }
    evidence = {
        "task": "SAAS_MVP_OUTCOME_NEXT_CYCLE_LAUNCHER",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP outcome-to-next-cycle launcher; route continue becomes confirmable and creatable next cycle from existing Result Center runtime",
        "readiness": "2155 / 3025 = 71.2%",
    }
    out = LOGS / "SAAS_MVP_OUTCOME_NEXT_CYCLE_LAUNCHER_CHECK_2026-07-11.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
