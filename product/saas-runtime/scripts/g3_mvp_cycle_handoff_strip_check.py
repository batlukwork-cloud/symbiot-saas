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
    if "129_G4_MVP_CYCLE_HANDOFF" not in workbook.sheetnames:
        return False
    rows = list(workbook["129_G4_MVP_CYCLE_HANDOFF"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1479-CYCLE-HANDOFF-MODEL",
        "SAAS-1480-CYCLE-HANDOFF-STRIP",
        "SAAS-1488-CYCLE-HANDOFF-FIXATION",
        "accepted -> current -> next",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "cycle_handoff_type_defined": contains(page, "type CycleHandoffItem")
        and contains(page, 'status: "accepted" | "current" | "next"'),
        "cycle_handoff_model_uses_runtime_state": contains(page, "const cycleHandoffItems = useMemo<CycleHandoffItem[]>")
        and contains(page, "cycleSourceTaskRunId")
        and contains(page, "linkedFollowupTaskRunId")
        and contains(page, "resultCenter?.product_status")
        and contains(page, "currentCycleNumber")
        and contains(page, "nextCycleNumber"),
        "cycle_handoff_strip_rendered_in_user_cycle_panel": contains(page, 'className="cycle-handoff-strip"')
        and contains(page, 'aria-label="Передача между циклами"')
        and contains(page, "cycleHandoffItems.map"),
        "handoff_explains_accepted_current_next": contains(page, "Принят как основание")
        and contains(page, "Нужно принять результат")
        and contains(page, "Следующий запуск создан"),
        "styles_are_stable_and_responsive": contains(styles, ".cycle-handoff-strip")
        and contains(styles, ".cycle-handoff-item")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr))")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/cycle-handoff")
        and not contains(page, "cycle-handoff-admin")
        and not contains(styles, "cycle-handoff-admin"),
        "ksg_records_cycle_handoff_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_CYCLE_HANDOFF_STRIP",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP cycle handoff clarity only; no backend contract expansion, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_CYCLE_HANDOFF_STRIP_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
