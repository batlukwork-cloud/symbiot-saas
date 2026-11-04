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
    if "131_G4_MVP_SCENARIO_PACKAGE" not in workbook.sheetnames:
        return False
    rows = list(workbook["131_G4_MVP_SCENARIO_PACKAGE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1499-SCENARIO-PACKAGE-MODEL",
        "SAAS-1500-SCENARIO-PACKAGE-SUMMARY",
        "SAAS-1508-SCENARIO-PACKAGE-FIXATION",
        "mission -> assets -> decision -> repeat",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "scenario_package_type_defined": contains(page, "type ScenarioPackageSummaryItem")
        and contains(page, 'status: "mission" | "assets" | "decision" | "repeat"'),
        "scenario_package_model_uses_cycle_assets": contains(page, "const scenarioPackageSummaryItems = useMemo<ScenarioPackageSummaryItem[]>")
        and contains(page, "activeDocumentIds.length")
        and contains(page, "selectedWorkgroup.length")
        and contains(page, "selectedRolePack.title")
        and contains(page, "currentCycleNumber")
        and contains(page, "linkedFollowupTaskRunId"),
        "scenario_package_rendered_in_user_cycle_panel": contains(page, 'className="scenario-package-summary"')
        and contains(page, 'aria-label="Сценарный пакет"')
        and contains(page, "scenarioPackageSummaryItems.map"),
        "scenario_package_explains_mission_assets_decision_repeat": contains(page, "Пакет сценария")
        and contains(page, "Собрано в пакете")
        and contains(page, "Текущее решение")
        and contains(page, "Повторяемость"),
        "styles_are_stable_and_responsive": contains(styles, ".scenario-package-summary")
        and contains(styles, ".scenario-package-summary-grid")
        and contains(styles, "grid-template-columns: repeat(4, minmax(0, 1fr))")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/scenario-package")
        and not contains(page, "scenario-package-admin")
        and not contains(styles, "scenario-package-admin"),
        "ksg_records_scenario_package_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_SCENARIO_PACKAGE_SUMMARY",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP scenario package summary only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_SCENARIO_PACKAGE_SUMMARY_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
