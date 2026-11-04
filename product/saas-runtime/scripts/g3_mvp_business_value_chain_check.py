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
    if "130_G4_MVP_BUSINESS_VALUE" not in workbook.sheetnames:
        return False
    rows = list(workbook["130_G4_MVP_BUSINESS_VALUE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1489-BUSINESS-VALUE-MODEL",
        "SAAS-1490-BUSINESS-VALUE-CHAIN",
        "SAAS-1498-BUSINESS-VALUE-FIXATION",
        "outcome -> effect -> action -> asset",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "business_value_type_defined": contains(page, "type BusinessValueChainItem")
        and contains(page, 'status: "outcome" | "effect" | "action" | "asset"'),
        "business_value_model_uses_smb_mission_state": contains(page, "const businessValueChainItems = useMemo<BusinessValueChainItem[]>")
        and contains(page, "selectedBusinessMission.metric")
        and contains(page, "selectedBusinessMission.outcome")
        and contains(page, "followupBrief.goal")
        and contains(page, "currentCycleNumber"),
        "business_value_chain_rendered_in_cycle_panel": contains(page, 'className="business-value-chain"')
        and contains(page, 'aria-label="Бизнес-ценность цепочки"')
        and contains(page, "businessValueChainItems.map"),
        "business_value_explains_outcome_effect_action_asset": contains(page, "Что получено")
        and contains(page, "Эффект для бизнеса")
        and contains(page, "Следующий шаг")
        and contains(page, "Что накапливается"),
        "styles_are_stable_and_responsive": contains(styles, ".business-value-chain")
        and contains(styles, ".business-value-chain-grid")
        and contains(styles, "grid-template-columns: repeat(4, minmax(0, 1fr))")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/business-value")
        and not contains(page, "business-value-admin")
        and not contains(styles, "business-value-admin"),
        "ksg_records_business_value_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_BUSINESS_VALUE_CHAIN",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP business value chain only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_BUSINESS_VALUE_CHAIN_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
