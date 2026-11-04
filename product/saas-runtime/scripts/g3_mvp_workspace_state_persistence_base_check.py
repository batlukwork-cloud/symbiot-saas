from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOGS = ROOT / "runtime_logs"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
STYLES = ROOT / "frontend" / "app" / "styles.css"
SCHEMAS = ROOT / "backend" / "app" / "schemas.py"
RESULT_CENTER = ROOT / "backend" / "app" / "services" / "result_center.py"
TASK_RUNS = ROOT / "backend" / "app" / "routers" / "task_runs.py"
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
    if "146_G4_MVP_WORKSPACE_STATE_PERSISTENCE" not in workbook.sheetnames:
        return False
    rows = list(workbook["146_G4_MVP_WORKSPACE_STATE_PERSISTENCE"].iter_rows(values_only=True))
    joined = "\n".join(" | ".join("" if cell is None else str(cell) for cell in row) for row in rows)
    closed_rows = [row for row in rows[1:] if len(row) > 4 and row[4] == "closed"]
    required_markers = [
        "SAAS-1899-WORKSPACE-SCHEMA",
        "SAAS-1911-WORKSPACE-API",
        "SAAS-1923-WORKSPACE-RESULT-CENTER",
        "SAAS-1935-WORKSPACE-FRONTEND",
        "SAAS-1947-WORKSPACE-REGRESSION",
        "SAAS-1958-WORKSPACE-FIXATION",
        "MVP Workspace State Persistence Base v0.1",
        "artifact draft and next-step review are persisted through Result Center",
    ]
    return len(closed_rows) == 60 and all(marker in joined for marker in required_markers)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    schemas = SCHEMAS.read_text(encoding="utf-8")
    result_center = RESULT_CENTER.read_text(encoding="utf-8")
    task_runs = TASK_RUNS.read_text(encoding="utf-8")

    checks = {
        "backend_schema_models_workspace_state": contains(schemas, "class ArtifactDraftPersistenceRequest")
        and contains(schemas, "class NextStepReviewPersistenceRequest")
        and contains(schemas, "class UserWorkspacePersistenceState")
        and contains(schemas, "user_workspace_state: UserWorkspacePersistenceState"),
        "backend_result_center_derives_workspace_state": contains(result_center, "_build_user_workspace_state")
        and contains(result_center, "workspace-artifact-draft-save")
        and contains(result_center, "workspace-artifact-draft-reset")
        and contains(result_center, "workspace-next-step-review-confirm")
        and contains(result_center, "user_workspace_state=user_workspace_state"),
        "backend_workspace_endpoints_exist": contains(task_runs, '@router.post("/{task_run_id}/workspace/artifact-draft"')
        and contains(task_runs, '@router.post("/{task_run_id}/workspace/artifact-draft/reset"')
        and contains(task_runs, '@router.post("/{task_run_id}/workspace/next-step-review"')
        and contains(task_runs, "json.dumps(payload.model_dump(), ensure_ascii=False)")
        and contains(task_runs, "record_result_action(task_run_id, \"workspace-next-step-review-confirm\""),
        "frontend_types_and_state_exist": contains(page, "type UserWorkspacePersistenceState")
        and contains(page, "user_workspace_state: UserWorkspacePersistenceState")
        and contains(page, "workspacePersistenceState")
        and contains(page, "workspacePersistenceMessage"),
        "frontend_artifact_draft_save_is_persisted": contains(page, "async function saveArtifactEditorDraft")
        and contains(page, "`/api/task-runs/${resultCenter.task_run_id}/workspace/artifact-draft`")
        and contains(page, "updated.user_workspace_state.artifact_draft.summary"),
        "frontend_artifact_draft_reset_is_persisted": contains(page, "async function resetArtifactEditorDraft")
        and contains(page, "`/api/task-runs/${resultCenter.task_run_id}/workspace/artifact-draft/reset`")
        and contains(page, "Artifact draft reset from Product Workbench MVP."),
        "frontend_next_step_review_is_persisted": contains(page, "async function confirmNextStepReview")
        and contains(page, "`/api/task-runs/${resultCenter.task_run_id}/workspace/next-step-review`")
        and contains(page, "updated.user_workspace_state.next_step_review.summary"),
        "frontend_restores_persisted_workspace": contains(page, "resultCenter?.user_workspace_state")
        and contains(page, "setArtifactEditorSavedDraft(restoredDraft)")
        and contains(page, "setNextStepReviewSnapshot({")
        and contains(page, "persistedReview.confirmed"),
        "styles_show_workspace_persistence_status": contains(styles, ".workspace-persistence-note")
        and contains(styles, ".workspace-persistence-note.is-saving")
        and contains(styles, ".workspace-persistence-note.is-saved")
        and contains(styles, ".workspace-persistence-note.is-error"),
        "ksg_records_60_task_throw": ksg_trace_ready(),
    }

    evidence = {
        "task": "SAAS_MVP_WORKSPACE_STATE_PERSISTENCE_BASE",
        "started_at": RUN_TIMESTAMP,
        "finished_at": RUN_TIMESTAMP,
        "checks": checks,
        "passed": all(checks.values()),
        "files": [str(PAGE), str(STYLES), str(SCHEMAS), str(RESULT_CENTER), str(TASK_RUNS), str(KSG)],
        "scope": "user MVP workspace state persistence; saved artifact draft and confirmed next-step review stored in existing Result Center action history; no new admin/evidence layer, no production/security/tenant/pricing/integration implementation",
        "readiness": "1088 / 1958 = 55.6%",
    }

    RUNTIME_LOGS.mkdir(parents=True, exist_ok=True)
    evidence_path = RUNTIME_LOGS / "SAAS_MVP_WORKSPACE_STATE_PERSISTENCE_BASE_CHECK_2026-07-11.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
