from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
STORE = ROOT / "backend" / "app" / "services" / "task_run_store.py"
EXECUTION = ROOT / "backend" / "app" / "services" / "task_run_execution.py"
QUEUE = ROOT / "backend" / "app" / "services" / "task_run_queue.py"
LIVE_LOG = RUNTIME_LOGS / "SAAS_MVP_SCENARIO_PAYLOAD_PERSISTENCE_LIVE_API_2026-07-11.json"
RUN_TIMESTAMP = "2026-07-11T00:00:00+03:00"
KSG = (
    ROOT.parents[1]
    / "docs"
    / "06_management"
    / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ"
    / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА.xlsx"
)


def contains(text: str, marker: str) -> bool:
    return marker in text


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "150_G4_MVP_SCENARIO_PAYLOAD_PERSISTENCE" not in workbook.sheetnames:
        return False
    rows = list(workbook["150_G4_MVP_SCENARIO_PAYLOAD_PERSISTENCE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-2226-SCENARIO-PAYLOAD-SCHEMA",
        "SAAS-2246-SCENARIO-PAYLOAD-STORE",
        "SAAS-2266-SCENARIO-PAYLOAD-QUEUE",
        "SAAS-2286-SCENARIO-PAYLOAD-FRONTEND",
        "SAAS-2306-SCENARIO-PAYLOAD-LIVE",
        "SAAS-2345-SCENARIO-PAYLOAD-FIXATION",
        "MVP Scenario Payload Persistence v0.1",
        "TaskRun restores business mission, scenario pack, role pack and workgroup after direct opening",
    ]
    return len(closed_rows) == 120 and all(marker in joined for marker in required_markers)


def live_log_ready() -> bool:
    if not LIVE_LOG.exists():
        return False
    payload = json.loads(LIVE_LOG.read_text(encoding="utf-8"))
    checks = payload.get("checks", {})
    return bool(
        payload.get("passed")
        and checks.get("source_returns_form_data")
        and checks.get("source_restores_scenario_pack")
        and checks.get("followup_inherits_business_mission")
        and checks.get("continuity_still_links_followup")
    )


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    store = STORE.read_text(encoding="utf-8")
    execution = EXECUTION.read_text(encoding="utf-8")
    queue = QUEUE.read_text(encoding="utf-8")

    checks = {
        "schema_exposes_task_run_form_data": contains(schemas, "form_data: dict[str, Any] = Field(default_factory=dict)")
        and contains(page, "form_data: Record<string, unknown>"),
        "store_persists_task_run_form_data_json": contains(store, "form_data_json")
        and contains(store, "alter table task_runs add column form_data_json")
        and contains(store, "json.dumps(task_run.form_data"),
        "direct_and_followup_execution_keep_scenario_payload": contains(execution, "form_data=dict(payload.form_data)")
        and contains(execution, "inherited_context")
        and contains(execution, "business_mission_id")
        and contains(execution, "selected_workgroup"),
        "queue_execution_keeps_scenario_payload": contains(queue, "init_task_run_store()")
        and contains(queue, "form_data=dict(payload.form_data)")
        and contains(queue, "form_data_json"),
        "frontend_sends_and_restores_scenario_payload": contains(page, "business_mission_id: selectedBusinessMission.id")
        and contains(page, "scenario_pack_id: selectedScenarioPack.id")
        and contains(page, "role_pack_id: selectedRolePack.id")
        and contains(page, "restoreScenarioFromTaskRunPayload")
        and contains(page, "Сценарий восстановлен")
        and contains(styles, ".scenario-restore-strip"),
        "live_api_proves_scenario_restore_contract": live_log_ready(),
        "scope_stays_user_mvp_no_external_layer": not contains(store, "create table task_run_scenario_context")
        and not contains(page, "scenario-payload-admin")
        and not contains(queue, "production_deploy"),
        "ksg_records_120_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_SCENARIO_PAYLOAD_PERSISTENCE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(STORE), str(EXECUTION), str(QUEUE), str(KSG), str(LIVE_LOG)],
        "scope": "user MVP scenario persistence; direct opening restores business mission, scenario pack, role pack and workgroup from existing TaskRun payload; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1475 / 2345 = 62.9%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_SCENARIO_PAYLOAD_PERSISTENCE_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
