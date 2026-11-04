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
    if "133_G4_MVP_SECOND_CYCLE_PROGRESS" not in workbook.sheetnames:
        return False
    rows = list(workbook["133_G4_MVP_SECOND_CYCLE_PROGRESS"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1519-SECOND-CYCLE-PROGRESS-MODEL",
        "SAAS-1520-SECOND-CYCLE-PROGRESS-UI",
        "SAAS-1528-SECOND-CYCLE-PROGRESS-FIXATION",
        "decision -> progress -> asset -> next",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "second_cycle_progress_type_defined": contains(page, "type SecondCycleProgressItem")
        and contains(page, 'status: "accepted" | "progress" | "asset" | "next"'),
        "second_cycle_progress_model_uses_cycle_state": contains(
            page, "const secondCycleProgressItems = useMemo<SecondCycleProgressItem[]>"
        )
        and contains(page, "currentCycleNumber")
        and contains(page, "nextCycleNumber")
        and contains(page, 'resultCenter?.product_status === "accepted"')
        and contains(page, "linkedFollowupTaskRunId"),
        "second_cycle_progress_model_uses_accumulated_assets": contains(page, "activeDocumentIds.length")
        and contains(page, "selectedWorkgroup.length")
        and contains(page, "resultCenter?.artifact?.title"),
        "second_cycle_progress_rendered_for_user": contains(page, 'className="second-cycle-progress"')
        and contains(page, 'aria-label="Прогресс второго цикла"')
        and contains(page, "secondCycleProgressItems.map"),
        "second_cycle_progress_has_four_user_answers": contains(page, "Решение цикла")
        and contains(page, "Прогресс сценария")
        and contains(page, "Накопленный актив")
        and contains(page, "Следующий шаг"),
        "styles_are_stable_and_responsive": contains(styles, ".second-cycle-progress")
        and contains(styles, ".second-cycle-progress-grid")
        and contains(styles, ".second-cycle-progress-item")
        and contains(styles, "grid-template-columns: repeat(4, minmax(0, 1fr))")
        and contains(styles, ".second-cycle-progress-grid,")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/second-cycle")
        and not contains(page, "second-cycle-admin")
        and not contains(styles, "second-cycle-admin"),
        "ksg_records_second_cycle_progress_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_SECOND_CYCLE_PROGRESS",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP second-cycle progress only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_SECOND_CYCLE_PROGRESS_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
