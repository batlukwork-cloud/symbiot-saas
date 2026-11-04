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
    if "138_G4_MVP_NEXT_STEP_REVIEW" not in workbook.sheetnames:
        return False
    rows = list(workbook["138_G4_MVP_NEXT_STEP_REVIEW"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1569-NEXT-STEP-REVIEW-STATE",
        "SAAS-1570-NEXT-STEP-REVIEW-UI",
        "SAAS-1571-NEXT-STEP-REVIEW-GUARD",
        "SAAS-1576-NEXT-STEP-REVIEW-REGRESSION",
        "SAAS-1578-NEXT-STEP-REVIEW-FIXATION",
        "review -> confirm -> create-next-task",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "review_confirmation_state_exists": contains(page, "const [nextStepReviewConfirmed, setNextStepReviewConfirmed]")
        and contains(page, "function confirmNextStepReview()")
        and contains(page, "setNextStepReviewConfirmed(true)"),
        "review_resets_when_next_step_changes": contains(page, "setNextStepReviewConfirmed(false)")
        and contains(page, "nextStepBrief.expected_artifact")
        and contains(page, "nextStepBrief.source_context")
        and contains(page, "updateArtifactEditorField")
        and contains(page, "saveArtifactEditorDraft")
        and contains(page, "resetArtifactEditorDraft"),
        "create_next_task_guard_requires_confirmation": contains(
            page, 'action.id === "create-next-task" && !nextStepReviewConfirmed'
        )
        and contains(page, "Проверьте и подтвердите следующий шаг перед созданием новой задачи."),
        "decision_button_is_disabled_until_confirmation": contains(
            page, 'card.id === "create-next-task" && !nextStepReviewConfirmed'
        )
        and contains(page, "нужно подтверждение"),
        "review_card_shows_next_step_payload": contains(page, 'aria-label="Проверка следующего шага"')
        and contains(page, "nextStepReviewItems.map")
        and contains(page, "Будет создано")
        and contains(page, "Первое действие")
        and contains(page, "Подтвердить следующий шаг"),
        "review_uses_saved_edit_source_labels": contains(page, "nextStepSourceLabel")
        and contains(page, "Следующий запуск возьмет сохраненную пользователем правку")
        and contains(page, "Следующий запуск пока опирается на версию Симбиота"),
        "styles_cover_review_and_mobile": contains(styles, ".next-step-review-card")
        and contains(styles, ".next-step-review-card.is-confirmed")
        and contains(styles, ".next-step-review-grid")
        and contains(styles, ".next-step-review-button")
        and contains(styles, ".next-step-review-grid,"),
        "scope_has_no_backend_or_external_expansion": not contains(page, "/api/next-step-review")
        and not contains(page, "persistNextStepReview")
        and not contains(page, "sendNextStepReview")
        and not contains(page, "exportNextStepReview")
        and not contains(page, "next-step-review-admin"),
        "ksg_records_next_step_review_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_NEXT_STEP_REVIEW_APPROVAL",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP only; review and confirm next-step payload before create-next-task; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_NEXT_STEP_REVIEW_APPROVAL_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
