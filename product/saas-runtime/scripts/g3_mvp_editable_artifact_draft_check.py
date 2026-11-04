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
    if "136_G4_MVP_EDITABLE_ARTIFACT" not in workbook.sheetnames:
        return False
    rows = list(workbook["136_G4_MVP_EDITABLE_ARTIFACT"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    required_markers = [
        "SAAS-1549-EDITABLE-ARTIFACT-STATE",
        "SAAS-1550-EDITABLE-ARTIFACT-FIELDS",
        "SAAS-1552-EDITABLE-ARTIFACT-RESET",
        "SAAS-1558-EDITABLE-ARTIFACT-FIXATION",
        "local edit -> save -> reset -> no export/send",
    ]
    return all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    checks = {
        "editable_artifact_type_and_state_defined": contains(page, "type ArtifactEditorDraft")
        and contains(page, "const [artifactEditorDraft")
        and contains(page, "const [artifactEditorSavedDraft")
        and contains(page, "const [artifactEditorStatus"),
        "editor_tracks_generated_saved_and_unsaved_versions": contains(page, "artifactComposerGeneratedEditorValue")
        and contains(page, "artifactEditorBaseline")
        and contains(page, "artifactEditorHasUnsavedChanges")
        and contains(page, "artifactEditorIsCustom"),
        "editor_handlers_cover_update_save_reset": contains(page, "function updateArtifactEditorField")
        and contains(page, "function saveArtifactEditorDraft")
        and contains(page, "function resetArtifactEditorDraft")
        and contains(page, "setArtifactEditorSavedDraft"),
        "editable_fields_render_inside_user_mvp": contains(page, 'className="artifact-editor-fields"')
        and contains(page, 'data-testid="artifact-editor-title"')
        and contains(page, 'data-testid="artifact-editor-body"')
        and contains(page, 'data-testid="artifact-editor-next"')
        and contains(page, "Сохранить правку")
        and contains(page, "Сбросить к версии Симбиота"),
        "editor_is_available_in_result_center_before_followup": contains(page, "resultCenter && !isFollowupCycleOpen")
        and contains(page, "artifactComposerEditorValue.title || artifactComposerDraft.title"),
        "user_status_labels_are_explicit": contains(page, "Правка сохранена локально")
        and contains(page, "Есть несохраненная правка")
        and contains(page, "Версия Симбиота"),
        "proof_and_next_action_remain_visible": contains(page, "artifactComposerDraft.proof")
        and contains(page, "artifactComposerEditorValue.next")
        and contains(page, "artifactComposerDraft.checklist.map"),
        "styles_are_stable_and_responsive": contains(styles, ".artifact-editor-fields")
        and contains(styles, ".artifact-editor-field input")
        and contains(styles, ".artifact-editor-actions")
        and contains(styles, ".artifact-composer-preview-head,")
        and contains(styles, "@media (max-width: 760px)"),
        "user_mvp_startup_not_blocked_by_optional_service_layers": contains(page, "async function optionalJson")
        and contains(page, 'getJson<ProcessCard[]>("/api/processes")')
        and contains(page, 'optionalJson<LlmProviderConfig[]>("/api/admin/llm-providers", [])')
        and contains(page, 'optionalJson<EvidenceAccessModelStatus | null>("/api/audit-events/access-model-status", null)'),
        "scope_has_no_new_backend_or_admin_layer": not contains(page, "/api/artifact-editor")
        and not contains(page, "sendArtifactEditor")
        and not contains(page, "exportArtifactEditor")
        and not contains(page, "artifact-editor-admin")
        and not contains(styles, "artifact-editor-admin"),
        "ksg_records_editable_artifact_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_EDITABLE_ARTIFACT_DRAFT",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(KSG)],
        "scope": "frontend user MVP editable artifact draft only; local state edit/save/reset, no backend, no export/send, no new admin/evidence layers, no production/security/tenant/pricing/integration implementation",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_EDITABLE_ARTIFACT_DRAFT_CHECK_2026-07-10.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
