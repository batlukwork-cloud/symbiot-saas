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
    if "126_G4_MVP_RESULT_ACCEPTANCE" not in workbook.sheetnames:
        return False
    rows = list(workbook["126_G4_MVP_RESULT_ACCEPTANCE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1449-RESULT-ACCEPTANCE-MODEL",
        "SAAS-1450-RESULT-ACCEPTANCE-BRIDGE",
        "SAAS-1458-RESULT-ACCEPTANCE-FIXATION",
        "what happened -> why accept -> next cycle",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "result_acceptance_type_defined": contains(page, "type ResultAcceptanceBridgeItem")
        and contains(page, 'status: "ready" | "attention" | "next"'),
        "bridge_is_data_driven_from_result_center": contains(page, "const resultAcceptanceBridge = useMemo<ResultAcceptanceBridgeItem[]>")
        and contains(page, "resultCenter.evidence.quality.overall_status")
        and contains(page, "resultCenter.evidence.rag.source_coverage")
        and contains(page, "linkedFollowupTaskRunId")
        and contains(page, "followupBrief.goal"),
        "bridge_rendered_in_user_result": contains(page, 'className="result-acceptance-bridge"')
        and contains(page, 'aria-label="Мост приемки результата"')
        and contains(page, "resultAcceptanceBridge.map"),
        "bridge_covers_acceptance_questions": contains(page, 'title: "Что получилось"')
        and contains(page, 'title: "Почему можно принять"')
        and contains(page, 'title: "Что дальше"'),
        "styles_are_stable_and_responsive": contains(styles, ".result-acceptance-bridge")
        and contains(styles, ".result-acceptance-item")
        and contains(styles, "grid-template-columns: repeat(3, minmax(0, 1fr))")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_frontend_user_mvp": not contains(page, "/api/result-acceptance-bridge")
        and not contains(page, "result-acceptance-admin")
        and not contains(styles, "result-acceptance-admin"),
        "ksg_records_result_acceptance_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_RESULT_ACCEPTANCE_BRIDGE",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP result acceptance bridge only; no new admin/evidence layers, no backend contract expansion, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_RESULT_ACCEPTANCE_BRIDGE_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
