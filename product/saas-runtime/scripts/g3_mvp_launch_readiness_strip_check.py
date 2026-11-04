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
    if "125_G4_MVP_LAUNCH_READINESS" not in workbook.sheetnames:
        return False
    rows = list(workbook["125_G4_MVP_LAUNCH_READINESS"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1439-LAUNCH-READINESS-MODEL",
        "SAAS-1440-LAUNCH-READINESS-USER-BOARD",
        "SAAS-1448-LAUNCH-READINESS-FIXATION",
        "mission -> materials -> AI team -> result -> launch",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "launch_readiness_type_defined": contains(page, "type LaunchReadinessItem")
        and contains(page, 'status: "done" | "active" | "waiting"'),
        "launch_readiness_state_is_data_driven": contains(page, "const launchReadinessItems = useMemo<LaunchReadinessItem[]>")
        and contains(page, "selectedBusinessMission.title")
        and contains(page, "activeDocumentIds.length")
        and contains(page, "selectedWorkgroup.length")
        and contains(page, "productTask.expectedArtifact"),
        "readiness_rendered_inside_user_action_board": contains(page, 'className="launch-readiness-strip"')
        and contains(page, 'aria-label="Готовность миссии к запуску"')
        and contains(page, "launchReadinessItems.map"),
        "readiness_covers_main_user_path": contains(page, 'title: "Миссия"')
        and contains(page, 'title: "Материалы"')
        and contains(page, 'title: "AI-команда"')
        and contains(page, 'title: "Результат"')
        and contains(page, 'title: "Запуск"'),
        "styles_are_stable_and_responsive": contains(styles, ".launch-readiness-strip")
        and contains(styles, ".launch-readiness-item")
        and contains(styles, "grid-template-columns: repeat(5, minmax(0, 1fr))")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_frontend_user_mvp": not contains(page, "/api/launch-readiness")
        and not contains(page, "launch-readiness-admin")
        and not contains(styles, "launch-readiness-admin"),
        "ksg_records_launch_readiness_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_LAUNCH_READINESS_STRIP",
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP launch-readiness strip only; no new admin/evidence layers, no backend contract expansion, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_LAUNCH_READINESS_STRIP_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
