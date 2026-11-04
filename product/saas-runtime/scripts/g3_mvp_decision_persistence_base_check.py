from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
TASK_RUNS = ROOT / "backend" / "app" / "routers" / "task_runs.py"
STORE = ROOT / "backend" / "app" / "services" / "task_run_store.py"
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


def ordered(text: str, first: str, second: str) -> bool:
    first_index = text.find(first)
    second_index = text.find(second)
    return first_index >= 0 and second_index > first_index


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "145_G4_MVP_DECISION_PERSISTENCE_BASE" not in workbook.sheetnames:
        return False
    rows = list(workbook["145_G4_MVP_DECISION_PERSISTENCE_BASE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1839-DECISION-PERSISTENCE",
        "SAAS-1851-DECISION-API",
        "SAAS-1863-DECISION-RESULT-CENTER",
        "SAAS-1875-DECISION-FRONTEND-WIRE",
        "SAAS-1887-DECISION-REGRESSION",
        "SAAS-1898-DECISION-FIXATION",
        "MVP Decision Persistence Base v0.1",
        "acceptance decision route is persisted through Result Center",
    ]
    return len(closed_rows) == 60 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")
    task_runs = TASK_RUNS.read_text(encoding="utf-8")
    store = STORE.read_text(encoding="utf-8")

    checks = {
        "backend_schema_models_decision_state": contains(schemas, "class AcceptanceDecisionRequest")
        and contains(schemas, "class AcceptanceDecisionRouteOption")
        and contains(schemas, "class AcceptanceDecisionState")
        and contains(schemas, "acceptance_decision: AcceptanceDecisionState"),
        "backend_result_center_derives_latest_route": contains(result_center, "_ACCEPTANCE_ROUTE_ACTIONS")
        and contains(result_center, "acceptance-decision-accept")
        and contains(result_center, "acceptance-decision-revise")
        and contains(result_center, "acceptance-decision-continue")
        and contains(result_center, "reversed(action_history)")
        and contains(result_center, "acceptance_decision=acceptance_decision"),
        "backend_endpoint_records_route_action": contains(task_runs, '@router.post("/{task_run_id}/acceptance-decision"')
        and contains(task_runs, "payload: AcceptanceDecisionRequest")
        and contains(task_runs, 'action_id = f"acceptance-decision-{payload.route}"')
        and contains(task_runs, "record_result_action(task_run_id, action_id, session.actor, payload.comment)"),
        "uses_existing_runtime_action_store": contains(store, "task_run_result_actions")
        and contains(store, "record_result_action")
        and contains(result_center, "list_result_action_records(task_run.id)")
        and not contains(task_runs, "create_acceptance_decision_table"),
        "frontend_types_and_post_are_wired": contains(page, "type AcceptanceDecisionState")
        and contains(page, "acceptance_decision: AcceptanceDecisionState")
        and contains(page, "saveAcceptanceDecisionRoute")
        and contains(page, '`/api/task-runs/${resultCenter.task_run_id}/acceptance-decision`')
        and contains(page, "setResultCenter(updated)"),
        "frontend_restores_persisted_selection": contains(page, "resultCenter?.acceptance_decision.selected_route")
        and contains(page, "setAcceptanceDecisionRoute(persistedRoute)")
        and contains(page, "persistedAcceptanceDecisionRoutes")
        and contains(page, "routeAvailability"),
        "user_router_still_after_acceptance_board": ordered(
            page,
            'aria-label="Приемка повторного цикла"',
            'aria-label="Маршрут решения после приемки"',
        )
        and contains(page, "Фиксация решения без внешней отправки"),
        "styles_show_persistence_status": contains(styles, ".acceptance-decision-option:disabled")
        and contains(styles, ".acceptance-decision-persistence")
        and contains(styles, ".acceptance-decision-persistence.is-saving")
        and contains(styles, ".acceptance-decision-persistence.is-saved")
        and contains(styles, ".acceptance-decision-persistence.is-error"),
        "scope_stays_mvp_not_admin_or_eac": not contains(task_runs, "evidence-acceptance-center/acceptance-decision")
        and not contains(page, "acceptance-decision-admin")
        and not contains(result_center, "tenant_isolation_decision")
        and not contains(result_center, "production_deploy_decision"),
        "ksg_records_60_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_DECISION_PERSISTENCE_BASE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(TASK_RUNS), str(KSG)],
        "scope": "user MVP Result Center acceptance decision persistence; accept/revise/continue route stored in existing task_run_result_actions and restored in frontend; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1028 / 1898 = 54.2%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_DECISION_PERSISTENCE_BASE_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
