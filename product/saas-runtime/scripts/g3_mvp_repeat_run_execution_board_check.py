from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
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
    if "142_G4_MVP_REPEAT_RUN_EXECUTION" not in workbook.sheetnames:
        return False
    rows = list(workbook["142_G4_MVP_REPEAT_RUN_EXECUTION"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1699-EXEC-PLAN",
        "SAAS-1709-EXEC-CONTROL",
        "SAAS-1719-EXEC-ACCEPTANCE",
        "SAAS-1729-EXEC-FIXATION",
        "SAAS-1738-EXEC-FIXATION",
        "MVP Repeat Run Execution Board v0.1",
        "readiness 868 / 1738 = 49.9%",
    ]
    return len(closed_rows) == 40 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "execution_board_model_exists": contains(page, "type RepeatRunExecutionBoardItem")
        and contains(page, "repeatRunExecutionPlanItems")
        and contains(page, "repeatRunExecutionControlItems")
        and contains(page, "repeatRunExecutionSummaryText"),
        "execution_plan_uses_next_run_payload": contains(page, "Вход запуска")
        and contains(page, "AI-команда")
        and contains(page, "Рабочий ход")
        and contains(page, "Приемка результата")
        and contains(page, "nextStepPayloadForCreation.expected_artifact"),
        "execution_controls_use_user_mvp_state": contains(page, "Готовность входа")
        and contains(page, "Что контролировать")
        and contains(page, "Когда остановиться")
        and contains(page, "Что получит пользователь")
        and contains(page, "selectedBusinessMission.metric"),
        "execution_board_rendered_after_repeat_workspace": contains(page, 'aria-label="План выполнения повторного запуска"')
        and contains(page, "repeatRunExecutionPlanItems.map")
        and contains(page, "repeatRunExecutionControlItems.map")
        and contains(page, "План без внешней отправки"),
        "execution_board_has_stop_and_acceptance": contains(page, "Стоп-точка остается пользовательской")
        and contains(page, "Result Center: проверить, принять, поправить и продолжить"),
        "execution_styles_and_mobile_exist": contains(styles, ".repeat-run-execution-board")
        and contains(styles, ".repeat-run-execution-grid")
        and contains(styles, ".repeat-run-execution-controls")
        and contains(styles, ".repeat-run-execution-summary")
        and contains(styles, ".repeat-run-execution-head,")
        and contains(styles, ".repeat-run-execution-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/repeat-run-execution")
        and not contains(page, "persistRepeatRunExecution")
        and not contains(page, "sendRepeatRunExecution")
        and not contains(page, "exportRepeatRunExecution")
        and not contains(page, "repeat-run-admin"),
        "execution_plan_is_local_not_external": contains(page, "План без внешней отправки")
        and not contains(page, "navigator.share")
        and not contains(page, "mailto:")
        and not contains(page, "downloadRepeatRun"),
        "previous_guided_repeat_remains_connected": contains(page, "guidedRepeatRunStatusLabel")
        and contains(page, "guidedRepeatRunSummaryText")
        and contains(page, "repeatRunExecutionSummaryText"),
        "ksg_records_40_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_REPEAT_RUN_EXECUTION_BOARD",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP repeat run execution board; input, team, execution, acceptance, controls and local execution plan; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "868 / 1738 = 49.9%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_REPEAT_RUN_EXECUTION_BOARD_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
