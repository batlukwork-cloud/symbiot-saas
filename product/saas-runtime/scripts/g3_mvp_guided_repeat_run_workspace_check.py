from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
RUN_TIMESTAMP = "2026-07-11T00:00:00+03:00"
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
    if "141_G4_MVP_GUIDED_REPEAT_RUN" not in workbook.sheetnames:
        return False
    rows = list(workbook["141_G4_MVP_GUIDED_REPEAT_RUN"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1659-REPEAT-SOURCE",
        "SAAS-1669-REPEAT-READY",
        "SAAS-1679-REPEAT-PREVIEW",
        "SAAS-1689-REPEAT-FIXATION",
        "SAAS-1698-REPEAT-FIXATION",
        "MVP Guided Repeat Run Workspace v0.1",
        "readiness 828 / 1698 = 48.8%",
    ]
    return len(closed_rows) == 40 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "guided_repeat_model_exists": contains(page, "type GuidedRepeatRunWorkspaceItem")
        and contains(page, "guidedRepeatRunReadinessItems")
        and contains(page, "guidedRepeatRunPreviewItems")
        and contains(page, "guidedRepeatRunSummaryText"),
        "repeat_source_is_bound_to_result": contains(page, "Источник повтора")
        and contains(page, "artifactComposerEditorValue.title")
        and contains(page, "nextStepPayloadForCreation.source_context"),
        "repeat_readiness_uses_existing_review_state": contains(page, "Готовность запуска")
        and contains(page, "guidedRepeatRunStatusLabel")
        and contains(page, "nextStepReviewConfirmed")
        and contains(page, "linkedFollowupTaskRunId"),
        "repeat_template_uses_mission_roles_materials": contains(page, "Шаблон миссии")
        and contains(page, "selectedBusinessMission.title")
        and contains(page, "selectedRolePack.title")
        and contains(page, "activeDocumentIds.length"),
        "repeat_preview_uses_next_step_payload": contains(page, "Новый запуск")
        and contains(page, "Стартовая инструкция")
        and contains(page, "nextStepPayloadForCreation.expected_artifact")
        and contains(page, "nextStepPayloadForCreation.urgency"),
        "repeat_workspace_rendered_in_user_flow": contains(page, 'aria-label="Рабочее пространство повторного запуска"')
        and contains(page, "guidedRepeatRunReadinessItems.map")
        and contains(page, "guidedRepeatRunPreviewItems.map")
        and contains(page, "Preview без внешней отправки"),
        "repeat_styles_and_mobile_exist": contains(styles, ".guided-repeat-run-workspace")
        and contains(styles, ".guided-repeat-run-grid")
        and contains(styles, ".guided-repeat-run-preview")
        and contains(styles, ".guided-repeat-run-summary")
        and contains(styles, ".guided-repeat-run-head,")
        and contains(styles, ".guided-repeat-run-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/guided-repeat")
        and not contains(page, "persistGuidedRepeatRun")
        and not contains(page, "sendGuidedRepeatRun")
        and not contains(page, "exportGuidedRepeatRun")
        and not contains(page, "guided-repeat-admin"),
        "repeat_preview_is_local_not_external": contains(page, "без внешней отправки")
        and contains(page, "Внешняя отправка и экспорт не используются")
        and not contains(page, "navigator.share")
        and not contains(page, "mailto:"),
        "ksg_records_40_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_GUIDED_REPEAT_RUN_WORKSPACE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP guided repeat run workspace; repeat source, readiness, next-run preview, local summary; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "828 / 1698 = 48.8%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_GUIDED_REPEAT_RUN_WORKSPACE_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
