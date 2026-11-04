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
    if "134_G4_MVP_CLIENT_RESULT_PACKAGE" not in workbook.sheetnames:
        return False
    rows = list(workbook["134_G4_MVP_CLIENT_RESULT_PACKAGE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1529-CLIENT-RESULT-PACKAGE-MODEL",
        "SAAS-1530-CLIENT-RESULT-PACKAGE-UI",
        "SAAS-1538-CLIENT-RESULT-PACKAGE-FIXATION",
        "summary -> value -> proof -> handoff",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "client_result_package_type_defined": contains(page, "type ClientResultPackageItem")
        and contains(page, 'status: "summary" | "value" | "proof" | "handoff"'),
        "client_result_package_model_uses_accepted_result": contains(
            page, "const clientResultPackageItems = useMemo<ClientResultPackageItem[]>"
        )
        and contains(page, 'resultCenter?.product_status === "accepted"')
        and contains(page, "resultCenter?.artifact?.title")
        and contains(page, "productTask.expectedArtifact"),
        "client_result_package_model_uses_business_and_assets": contains(page, "selectedBusinessMission.metric")
        and contains(page, "selectedBusinessMission.outcome")
        and contains(page, "activeDocumentIds.length")
        and contains(page, "selectedWorkgroup.length"),
        "client_result_package_model_uses_handoff": contains(page, "linkedFollowupTaskRunId")
        and contains(page, "cycleSourceTaskRunId")
        and contains(page, "nextCycleNumber"),
        "client_result_package_rendered_for_user": contains(page, 'className="client-result-package"')
        and contains(page, 'aria-label="Клиентский пакет результата"')
        and contains(page, "clientResultPackageItems.map"),
        "client_result_package_has_four_user_answers": contains(page, "Краткий итог")
        and contains(page, "Польза для бизнеса")
        and contains(page, "Опора пакета")
        and contains(page, "Следующий контакт")
        and contains(page, "Пакет готов к передаче"),
        "styles_are_stable_and_responsive": contains(styles, ".client-result-package")
        and contains(styles, ".client-result-package-grid")
        and contains(styles, ".client-result-package-item")
        and contains(styles, "grid-template-columns: repeat(4, minmax(0, 1fr))")
        and contains(styles, ".client-result-package-grid,")
        and contains(styles, "@media (max-width: 760px)"),
        "scope_stays_user_mvp_frontend": not contains(page, "/api/client-result-package")
        and not contains(page, "client-package-admin")
        and not contains(styles, "client-package-admin"),
        "ksg_records_client_result_package_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_CLIENT_RESULT_PACKAGE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP client result package only; no backend contract expansion, no export/send workflow, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_CLIENT_RESULT_PACKAGE_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
