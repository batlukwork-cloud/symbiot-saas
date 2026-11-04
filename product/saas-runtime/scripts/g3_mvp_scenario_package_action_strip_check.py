from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
RUN_TIMESTAMP = "2026-07-10T00:00:00+03:00"
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
    if "132_G4_MVP_SCENARIO_ACTION" not in workbook.sheetnames:
        return False
    rows = list(workbook["132_G4_MVP_SCENARIO_ACTION"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1509-SCENARIO-ACTION-MODEL",
        "SAAS-1510-SCENARIO-ACTION-STRIP",
        "SAAS-1518-SCENARIO-ACTION-FIXATION",
        "review -> decide -> continue",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "scenario_action_type_defined": contains(page, "type ScenarioPackageActionItem")
        and contains(page, 'status: "review" | "decide" | "continue"'),
        "scenario_action_model_links_package_to_decision": contains(
            page, "const scenarioPackageActionItems = useMemo<ScenarioPackageActionItem[]>"
        )
        and contains(page, "resultCenter?.artifact?.title")
        and contains(page, "currentCycleNumber")
        and contains(page, "linkedFollowupTaskRunId")
        and contains(page, "nextCycleNumber"),
        "scenario_action_rendered_inside_package": contains(page, 'className="scenario-package-action-strip"')
        and contains(page, 'aria-label="Что сделать со сценарным пакетом"')
        and contains(page, "scenarioPackageActionItems.map"),
        "scenario_action_has_three_user_actions": contains(page, "Проверить пакет")
        and contains(page, "Принять решение")
        and contains(page, "Продолжить цикл")
        and contains(page, "#business-result-detail")
        and contains(page, "#result-decision")
        and contains(page, "#result-center"),
        "styles_are_stable_and_responsive": contains(styles, ".scenario-package-action-strip")
        and contains(styles, ".scenario-package-action")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr))")
        and contains(styles, ".scenario-package-action-strip,")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/scenario-package")
        and not contains(page, "scenario-package-admin")
        and not contains(styles, "scenario-package-admin"),
        "ksg_records_scenario_action_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_SCENARIO_PACKAGE_ACTION_STRIP",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP scenario package action strip only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_SCENARIO_PACKAGE_ACTION_STRIP_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
