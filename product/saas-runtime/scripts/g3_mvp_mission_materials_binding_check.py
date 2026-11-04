from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
KSG = (
    ROOT.parents[1]
    / "docs"
    / "06_management"
    / "01_УПРАВЛЕНИЕ_РАЗРАБОТКОЙ"
    / "СИМБИОТ_SAAS_КСГ_ДОРОЖНАЯ_КАРТА.xlsx"
)


def contains(text: str, marker: str) -> bool:
    return marker in text


def hidden_user_source_panel_removed(styles: str) -> bool:
    hidden_block = styles.split(".user-page .status-group,", 1)[1].split("{", 1)[0]
    return ".user-page .source-attachment-panel" not in hidden_block


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "124_G4_MVP_MISSION_MATERIALS" not in workbook.sheetnames:
        return False
    rows = list(workbook["124_G4_MVP_MISSION_MATERIALS"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1429-BASELINE-GAP-KSG-TRACE",
        "SAAS-1430-G-LAYER-ROADMAP-GUARDS",
        "SAAS-1431-MISSION-MATERIALS-USER-VISIBILITY",
        "SAAS-1438-MISSION-MATERIALS-FIXATION",
        "Materials/RAG planned in Knowledge Hub",
        "Production, security, tenant, integrations and pricing remain G-later",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "source_panel_visible_in_user_mvp": hidden_user_source_panel_removed(styles)
        and contains(page, 'className="source-attachment-panel"'),
        "materials_bound_to_selected_business_mission": contains(page, "missionMaterialSummary")
        and contains(page, "<h3>{selectedBusinessMission.title}</h3>")
        and contains(page, "Материалы для миссии"),
        "materials_explain_ai_team_and_result_path": contains(page, "selectedRolePack.title")
        and contains(page, "На выходе нужен проверяемый результат")
        and contains(page, "Связь материалов с результатом"),
        "upload_and_link_update_mission_source_context": contains(page, "registerSourceLink")
        and contains(page, "uploadMissionFiles")
        and contains(page, "selectedBusinessMission.title")
        and contains(page, "пользовательские материалы"),
        "runtime_contracts_stay_existing": contains(page, '"/api/documents/source-intake"')
        and contains(page, '"/api/documents/source-intake/links"')
        and contains(page, '"/api/documents/upload"')
        and not contains(page, '"/api/mission-materials"'),
        "styles_are_responsive_and_stable": contains(styles, ".source-mission-summary")
        and contains(styles, "@media (max-width: 760px)")
        and contains(styles, "overflow-wrap: anywhere"),
        "ksg_records_planned_but_not_ready_g_layers": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_MISSION_MATERIALS_BINDING",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP mission-material binding plus KSG trace only; no new admin/evidence layers, no backend contract expansion, no production/security/tenant/pricing implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_MISSION_MATERIALS_BINDING_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
