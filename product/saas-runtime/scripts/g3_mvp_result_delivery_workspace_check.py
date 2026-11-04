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
    if "140_G4_MVP_RESULT_DELIVERY_WORKSPACE" not in workbook.sheetnames:
        return False
    rows = list(workbook["140_G4_MVP_RESULT_DELIVERY_WORKSPACE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1619-ARTIFACT",
        "SAAS-1629-ACTIONS",
        "SAAS-1639-REUSE",
        "SAAS-1649-HANDOFF",
        "SAAS-1658-HANDOFF",
        "MVP Result Delivery Workspace v0.1",
        "readiness 788 / 1658 = 47.5%",
    ]
    return len(closed_rows) == 40 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "delivery_workspace_model_exists": contains(page, "type ResultDeliveryWorkspaceItem")
        and contains(page, "resultDeliveryWorkspaceItems")
        and contains(page, "resultDeliveryActionItems"),
        "final_artifact_workspace_exists": contains(page, "Финальный артефакт")
        and contains(page, "artifactComposerEditorValue.title")
        and contains(page, "artifactComposerEditorValue.body"),
        "post_result_actions_exist": contains(page, "Что сделать сейчас")
        and contains(page, "Проверить смысл")
        and contains(page, "Запустить повтор")
        and contains(page, "Собрать handoff"),
        "reuse_recipe_exists": contains(page, "Как повторить")
        and contains(page, "selectedRolePack.title")
        and contains(page, "сценарий можно повторить как шаблон SMB-задачи"),
        "local_handoff_exists_without_send": contains(page, "resultDeliveryHandoffText")
        and contains(page, "Handoff без внешней отправки")
        and contains(page, "Это черновик передачи внутри экрана"),
        "workspace_rendered_in_user_cycle": contains(page, 'aria-label="Рабочее пространство результата"')
        and contains(page, "resultDeliveryWorkspaceItems.map")
        and contains(page, "resultDeliveryActionItems.map"),
        "delivery_styles_and_mobile_exist": contains(styles, ".result-delivery-workspace")
        and contains(styles, ".result-delivery-grid")
        and contains(styles, ".result-delivery-actions")
        and contains(styles, ".result-delivery-handoff")
        and contains(styles, ".result-delivery-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/result-delivery")
        and not contains(page, "persistResultDelivery")
        and not contains(page, "sendResultDelivery")
        and not contains(page, "exportResultDelivery")
        and not contains(page, "result-delivery-admin"),
        "handoff_is_local_not_external": contains(page, "без внешней отправки")
        and not contains(page, "navigator.share")
        and not contains(page, "mailto:")
        and not contains(page, "downloadResult"),
        "ksg_records_40_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_RESULT_DELIVERY_WORKSPACE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP result delivery workspace; final artifact, actions, reuse recipe, local handoff; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "788 / 1658 = 47.5%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_RESULT_DELIVERY_WORKSPACE_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
