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
    if "143_G4_MVP_REPEAT_RUN_ACCEPTANCE" not in workbook.sheetnames:
        return False
    rows = list(workbook["143_G4_MVP_REPEAT_RUN_ACCEPTANCE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1739-ACCEPT-CRITERIA",
        "SAAS-1749-ACCEPT-OUTCOME",
        "SAAS-1759-ACCEPT-STOP",
        "SAAS-1769-ACCEPT-FIXATION",
        "SAAS-1778-ACCEPT-FIXATION",
        "MVP Repeat Run Acceptance Board v0.1",
        "readiness 908 / 1778 = 51.1%",
    ]
    return len(closed_rows) == 40 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "acceptance_board_model_exists": contains(page, "type RepeatRunAcceptanceBoardItem")
        and contains(page, "repeatRunAcceptanceCriteriaItems")
        and contains(page, "repeatRunAcceptanceOutcomeItems")
        and contains(page, "repeatRunAcceptanceSummaryText"),
        "acceptance_criteria_use_business_metric": contains(page, "Критерий приемки")
        and contains(page, "selectedBusinessMission.metric")
        and contains(page, "двигает бизнес-метрику миссии"),
        "acceptance_signal_uses_result_center_state": contains(page, "Сигнал готовности")
        and contains(page, "resultCenter?.product_status")
        and contains(page, "linkedFollowupTaskRunId"),
        "acceptance_decision_and_stop_are_visible": contains(page, "Решение пользователя")
        and contains(page, "Стоп-точка")
        and contains(page, "приемка результата следующего цикла"),
        "acceptance_outcomes_use_asset_and_next_step": contains(page, "Накопленный актив")
        and contains(page, "Следующее решение")
        and contains(page, "nextStepPayloadForCreation.expected_artifact"),
        "acceptance_board_rendered_after_execution": contains(page, 'aria-label="Приемка повторного цикла"')
        and contains(page, "repeatRunAcceptanceCriteriaItems.map")
        and contains(page, "repeatRunAcceptanceOutcomeItems.map")
        and contains(page, "Acceptance без внешней отправки"),
        "acceptance_styles_and_mobile_exist": contains(styles, ".repeat-run-acceptance-board")
        and contains(styles, ".repeat-run-acceptance-grid")
        and contains(styles, ".repeat-run-acceptance-outcomes")
        and contains(styles, ".repeat-run-acceptance-summary")
        and contains(styles, ".repeat-run-acceptance-head,")
        and contains(styles, ".repeat-run-acceptance-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/repeat-run-acceptance")
        and not contains(page, "persistRepeatRunAcceptance")
        and not contains(page, "sendRepeatRunAcceptance")
        and not contains(page, "exportRepeatRunAcceptance")
        and not contains(page, "repeat-acceptance-admin"),
        "acceptance_is_local_not_external": contains(page, "Acceptance без внешней отправки")
        and not contains(page, "navigator.share")
        and not contains(page, "mailto:")
        and not contains(page, "downloadRepeatAcceptance"),
        "ksg_records_40_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_REPEAT_RUN_ACCEPTANCE_BOARD",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP repeat run acceptance board; criteria, readiness signal, decision, stop point, outcomes and local acceptance plan; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "908 / 1778 = 51.1%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_REPEAT_RUN_ACCEPTANCE_BOARD_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
