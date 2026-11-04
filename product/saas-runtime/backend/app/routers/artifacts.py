from fastapi import APIRouter, HTTPException, Query

from app.schemas import (
    Artifact,
    ArtifactCompareActionRecord,
    ArtifactCompareActionRequest,
    ArtifactDiffJobCreateRequest,
    ArtifactDiffJobRecord,
    ArtifactEvidencePackage,
    ArtifactExportDraft,
    ArtifactRollbackRequest,
    ArtifactRollbackResult,
    ArtifactVersionCompareResult,
    ArtifactVersionRecord,
)
from app.services.task_run_store import (
    compare_artifact_version_with_current,
    create_artifact_diff_job,
    get_artifact as get_persisted_artifact,
    get_artifact_diff_job,
    get_artifact_evidence_package,
    get_artifact_export_draft,
    list_artifact_versions,
    record_artifact_compare_action,
    rollback_artifact_version,
)

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("/diff-jobs/{job_id}", response_model=ArtifactDiffJobRecord)
def get_diff_job(job_id: str) -> ArtifactDiffJobRecord:
    job = get_artifact_diff_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Artifact diff job {job_id} not found.")
    return job


@router.post("/diff-jobs/{job_id}/actions/{action_id}", response_model=ArtifactCompareActionRecord)
def create_compare_action(job_id: str, action_id: str, payload: ArtifactCompareActionRequest) -> ArtifactCompareActionRecord:
    try:
        return record_artifact_compare_action(
            job_id=job_id,
            action_id=action_id,
            actor=payload.actor,
            comment=payload.comment,
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Artifact diff job {error.args[0]} not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/{artifact_id}", response_model=Artifact)
def get_artifact(artifact_id: str) -> Artifact:
    artifact = get_persisted_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    return artifact


@router.get("/{artifact_id}/versions", response_model=list[ArtifactVersionRecord])
def get_artifact_versions(artifact_id: str) -> list[ArtifactVersionRecord]:
    artifact = get_persisted_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    return list_artifact_versions(artifact_id)


@router.get("/{artifact_id}/export-draft", response_model=ArtifactExportDraft)
def export_artifact_draft(artifact_id: str) -> ArtifactExportDraft:
    try:
        return get_artifact_export_draft(artifact_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Artifact {error.args[0]} not found.") from error


@router.get("/{artifact_id}/evidence-package", response_model=ArtifactEvidencePackage)
def artifact_evidence_package(artifact_id: str) -> ArtifactEvidencePackage:
    try:
        return get_artifact_evidence_package(artifact_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Artifact {error.args[0]} not found.") from error


@router.post("/{artifact_id}/versions/{version_id}/diff-jobs", response_model=ArtifactDiffJobRecord)
def create_diff_job(artifact_id: str, version_id: str, payload: ArtifactDiffJobCreateRequest) -> ArtifactDiffJobRecord:
    artifact = get_persisted_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    job = create_artifact_diff_job(
        artifact_id=artifact_id,
        version_id=version_id,
        actor=payload.actor,
        max_diff_lines=payload.max_diff_lines,
        diff_offset=payload.diff_offset,
    )
    if job.status == "failed":
        raise HTTPException(status_code=409, detail=job.error or "Artifact diff job failed.")
    return job


@router.get("/{artifact_id}/versions/{version_id}/compare-current", response_model=ArtifactVersionCompareResult)
def compare_artifact_version(artifact_id: str, version_id: str, max_diff_lines: int = Query(120, ge=1, le=500), diff_offset: int = Query(0, ge=0)) -> ArtifactVersionCompareResult:
    artifact = get_persisted_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    try:
        return compare_artifact_version_with_current(artifact_id=artifact_id, version_id=version_id, max_diff_lines=max_diff_lines, diff_offset=diff_offset)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Artifact version {error.args[0]} not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{artifact_id}/versions/{version_id}/rollback", response_model=ArtifactRollbackResult)
def rollback_artifact(artifact_id: str, version_id: str, payload: ArtifactRollbackRequest) -> ArtifactRollbackResult:
    artifact = get_persisted_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    try:
        return rollback_artifact_version(
            artifact_id=artifact_id,
            version_id=version_id,
            actor=payload.actor,
            reason=payload.reason,
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Artifact version {error.args[0]} not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
