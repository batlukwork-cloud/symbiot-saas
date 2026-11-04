from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"


def contains(text: str, marker: str) -> bool:
    return marker in text


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "business_mission_type_defined": contains(page, "type BusinessMissionTemplate")
        and contains(page, "metric: string")
        and contains(page, "scenarioPackId: string")
        and contains(page, "rolePackId: string"),
        "smb_mission_catalog_has_core_use_cases": contains(page, "const BUSINESS_MISSIONS")
        and contains(page, 'id: "proposal-smb"')
        and contains(page, 'id: "support-knowledge"')
        and contains(page, 'id: "lead-qualification"')
        and contains(page, 'id: "document-summary"')
        and contains(page, 'id: "hr-screening"')
        and contains(page, 'id: "ops-report"'),
        "mission_selection_is_stateful": contains(page, "selectedBusinessMissionId")
        and contains(page, "selectedBusinessMission = useMemo")
        and contains(page, "setSelectedBusinessMissionId(mission.id)"),
        "mission_selection_updates_taskrun_inputs": contains(page, "function applyBusinessMission")
        and contains(page, "setProductTask(mission.task)")
        and contains(page, "setSelectedScenarioPackId(mission.scenarioPackId)")
        and contains(page, "setSelectedRoleIds(rolePack.runtimeRoleIds)"),
        "catalog_rendered_in_user_flow": contains(page, 'className="business-mission-catalog"')
        and contains(page, 'aria-label="Каталог бизнес-миссий"')
        and contains(page, "BUSINESS_MISSIONS.map"),
        "business_outcome_visible": contains(page, "selectedBusinessMission.outcome")
        and contains(page, "selectedBusinessMission.goodFor")
        and contains(page, "selectedBusinessMission.metric")
        and contains(page, "AI-команда"),
        "mission_brief_uses_selected_mission": contains(page, "<h2>{selectedBusinessMission.title}</h2>")
        and contains(page, "Бизнес-миссия"),
        "catalog_styles_are_responsive": contains(styles, ".business-mission-catalog")
        and contains(styles, ".business-mission-grid")
        and contains(styles, ".business-mission-outcome")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_frontend_user_mvp": not contains(page, "mission-catalog-admin")
        and not contains(styles, "mission-catalog-admin")
        and not contains(page, "/api/business-missions"),
    }

    evidence = {
        "task": "SAAS_MVP_MISSION_CATALOG_BUSINESS_OUTCOME",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES)],
        "scope": "frontend user MVP mission catalog and business outcome layer only; no backend contract, production, security, tenant, audit-access or admin/evidence expansion",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_MISSION_CATALOG_BUSINESS_OUTCOME_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
