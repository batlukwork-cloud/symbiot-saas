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


def ksg_trace_ready() -> bool:
    try:
        from openpyxl import load_workbook
    except Exception:
        return False

    workbook = load_workbook(KSG, read_only=True, data_only=True)
    if "127_G4_MVP_NEXT_CYCLE_OPENING" not in workbook.sheetnames:
        return False
    rows = list(workbook["127_G4_MVP_NEXT_CYCLE_OPENING"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1459-NEXT-CYCLE-OPENING-MODEL",
        "SAAS-1460-NEXT-CYCLE-OPENING-CARD",
        "SAAS-1468-NEXT-CYCLE-OPENING-FIXATION",
        "source -> target -> action",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "next_cycle_opening_type_defined": contains(page, "type NextCycleOpeningItem")
        and contains(page, 'status: "source" | "target" | "action"'),
        "opening_model_uses_existing_cycle_state": contains(page, "const nextCycleOpeningItems = useMemo<NextCycleOpeningItem[]>")
        and contains(page, "cycleSourceTaskRunId")
        and contains(page, "linkedFollowupTaskRunId")
        and contains(page, "openedFollowupTaskRunId")
        and contains(page, "followupBrief.expected_artifact"),
        "opening_card_rendered_in_user_continuation_panel": contains(page, 'className="next-cycle-opening-card"')
        and contains(page, 'aria-label="Открытие следующего цикла"')
        and contains(page, "nextCycleOpeningItems.map"),
        "opening_card_explains_source_target_action": contains(page, 'title: "Основание"')
        and contains(page, 'title: "Новый цикл"')
        and contains(page, 'title: "Следующее действие"'),
        "styles_are_stable_and_responsive": contains(styles, ".next-cycle-opening-card")
        and contains(styles, ".next-cycle-opening-grid")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr))")
        and contains(styles, ".next-cycle-opening-grid")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/next-cycle-opening")
        and not contains(page, "next-cycle-opening-admin")
        and not contains(styles, "next-cycle-opening-admin"),
        "ksg_records_next_cycle_opening_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_NEXT_CYCLE_OPENING_CLARITY",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP next-cycle opening clarity only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_NEXT_CYCLE_OPENING_CLARITY_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
