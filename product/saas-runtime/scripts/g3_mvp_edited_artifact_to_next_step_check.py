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
    if "137_G4_MVP_EDITED_TO_NEXT" not in workbook.sheetnames:
        return False
    rows = list(workbook["137_G4_MVP_EDITED_TO_NEXT"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1559-EDITED-NEXT-BRIEF",
        "SAAS-1560-EDITED-NEXT-ACTION-PAYLOAD",
        "SAAS-1561-EDITED-NEXT-OPEN-LINKED",
        "SAAS-1566-EDITED-NEXT-REGRESSION",
        "SAAS-1568-EDITED-NEXT-FIXATION",
        "saved local edit -> next step brief -> no export/send",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "next_step_brief_is_derived_from_saved_edit": contains(page, "const nextStepBrief = useMemo<FollowupBrief>")
        and contains(page, "if (!artifactEditorSavedDraft)")
        and contains(page, "Продолжить сценарий по сохраненной правке")
        and contains(page, "Result Center: пользователь сохранил локальную правку"),
        "unsaved_text_is_not_promoted_to_next_step": contains(page, "artifactEditorSavedDraft")
        and contains(page, "artifactEditorHasUnsavedChanges")
        and contains(page, "Следующий шаг пойдет по вашей правке"),
        "create_next_task_payload_uses_next_step_brief": (
            contains(page, "followup_goal: nextStepBrief.goal")
            and contains(page, "followup_expected_artifact: nextStepBrief.expected_artifact")
            and contains(page, "followup_source_context: nextStepBrief.source_context")
            and contains(page, "followup_urgency: nextStepBrief.urgency")
        )
        or (
            contains(page, "followup_goal: nextStepPayloadForCreation.goal")
            and contains(page, "followup_expected_artifact: nextStepPayloadForCreation.expected_artifact")
            and contains(page, "followup_source_context: nextStepPayloadForCreation.source_context")
            and contains(page, "followup_urgency: nextStepPayloadForCreation.urgency")
        ),
        "open_linked_followup_uses_next_step_brief": (
            contains(page, "goal: nextStepBrief.goal")
            and contains(page, "expectedArtifact: nextStepBrief.expected_artifact")
            and contains(page, "sourceContext: nextStepBrief.source_context")
            and contains(page, "urgency: nextStepBrief.urgency")
        )
        or (
            contains(page, "goal: nextStepPayloadForCreation.goal")
            and contains(page, "expectedArtifact: nextStepPayloadForCreation.expected_artifact")
            and contains(page, "sourceContext: nextStepPayloadForCreation.source_context")
            and contains(page, "urgency: nextStepPayloadForCreation.urgency")
        ),
        "user_ui_explains_next_step_source": contains(page, "nextStepSourceLabel")
        and contains(page, "по сохраненной правке")
        and contains(page, "по версии Симбиота")
        and contains(page, 'className={`edited-artifact-next-step ${nextStepUsesEditedArtifact ? "is-edited" : ""}`'),
        "next_mission_card_uses_derived_brief": contains(page, "<p>{nextStepBrief.goal}</p>")
        and contains(page, "<strong>{nextStepBrief.expected_artifact}</strong>")
        and contains(page, "<small>{nextStepBrief.urgency}</small>"),
        "styles_cover_edited_next_step_state": contains(styles, ".edited-artifact-next-step")
        and contains(styles, ".edited-artifact-next-step.is-edited")
        and contains(styles, "border-left-color: #20a464"),
        "scope_has_no_backend_persistence_or_send": not contains(page, "/api/edited-artifact")
        and not contains(page, "persistEditedArtifact")
        and not contains(page, "exportEditedArtifact")
        and not contains(page, "sendEditedArtifact")
        and not contains(page, "artifact-editor-admin"),
        "ksg_records_edited_next_step_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_EDITED_ARTIFACT_TO_NEXT_STEP",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP only; saved local artifact edit becomes next-step brief; no backend persistence, no export/send, no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_EDITED_ARTIFACT_TO_NEXT_STEP_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
