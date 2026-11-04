from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.schemas import (
    DocumentIngestRequest,
    DocumentRecord,
    FilePolicyCheckRequest,
    FilePolicyEvidence,
    FileUploadEvidence,
    HumanApprovalDecisionRequest,
    OcrExecutionEvidence,
    OcrWorkerStatus,
    RagApprovalReleaseEvidence,
    SourceIntakeItem,
    SourceIntakeLinkRequest,
    SourceIntakeSummary,
    UploadApprovalReleaseEvidence,
    UploadRuntimeStatus,
)
from app.services.data_protection import classify_text, create_rag_approval_if_required
from app.services.ocr_worker import approve_ocr_job_for_rag, execute_next_ocr_job, execute_ocr_job, ocr_worker_status
from app.services.rag_index import ingest_document, list_documents as list_indexed_documents
from app.services.source_intake import list_source_intake, register_source_link
from app.services.sqlite_store import list_ocr_jobs, list_uploaded_files, storage_status
from app.services.upload_policy import check_upload_policy
from app.services.upload_service import approve_upload_for_rag, save_upload, upload_runtime_status
from app.services.security_context import RuntimeSession, assert_scope_allowed, require_runtime_session

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentRecord])
def list_documents() -> list[DocumentRecord]:
    return list_indexed_documents()


@router.post("/ingest", response_model=DocumentRecord)
def ingest(payload: DocumentIngestRequest, session: RuntimeSession = Depends(require_runtime_session)) -> DocumentRecord:
    assert_scope_allowed(payload.access_scope, session)
    classification = classify_text(
        text=payload.content,
        artifact_id=f"direct-ingest:{payload.name}",
        access_scope=payload.access_scope,
        purpose="direct_rag_ingest",
    )
    approval = create_rag_approval_if_required(artifact_id=f"direct-ingest:{payload.name}", classification=classification)
    if approval:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "PII detected. RAG ingest is blocked until human approval.",
                "classification_id": classification.id,
                "approval_id": approval.id,
                "risk_level": classification.risk_level,
                "findings": [finding.model_dump() for finding in classification.findings],
            },
        )
    return ingest_document(payload)


@router.get("/storage-status")
def get_storage_status() -> dict[str, str | int | bool]:
    return storage_status()


@router.get("/source-intake", response_model=SourceIntakeSummary)
def get_source_intake(
    access_scope: str = "tenant:demo",
    session: RuntimeSession = Depends(require_runtime_session),
) -> SourceIntakeSummary:
    assert_scope_allowed(access_scope, session)
    return list_source_intake(access_scope)


@router.post("/source-intake/links", response_model=SourceIntakeItem)
def create_source_link(
    payload: SourceIntakeLinkRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> SourceIntakeItem:
    assert_scope_allowed(payload.access_scope, session)
    try:
        return register_source_link(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/upload-policy/check", response_model=FilePolicyEvidence)
def check_policy(payload: FilePolicyCheckRequest, session: RuntimeSession = Depends(require_runtime_session)) -> FilePolicyEvidence:
    assert_scope_allowed(payload.access_scope, session)
    return check_upload_policy(payload)


@router.post("/upload", response_model=FileUploadEvidence)
async def upload_document(
    file: UploadFile = File(...),
    access_scope: str = Form(default="tenant:demo"),
    session: RuntimeSession = Depends(require_runtime_session),
) -> FileUploadEvidence:
    assert_scope_allowed(access_scope, session)
    content = await file.read()
    return save_upload(file.filename or "uploaded.bin", file.content_type or "application/octet-stream", content, access_scope)


@router.get("/upload-runtime-status", response_model=UploadRuntimeStatus)
def get_upload_runtime_status() -> UploadRuntimeStatus:
    return upload_runtime_status()


@router.get("/uploads")
def get_uploads() -> list[dict[str, str | int | None]]:
    return list_uploaded_files()


@router.post("/uploads/{file_id}/approve-rag", response_model=UploadApprovalReleaseEvidence)
def approve_uploaded_file_rag_release(
    file_id: str,
    request: HumanApprovalDecisionRequest,
) -> UploadApprovalReleaseEvidence:
    try:
        return approve_upload_for_rag(
            file_id=file_id,
            reviewer=request.reviewer,
            decision_comment=request.decision_comment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/ocr-jobs")
def get_ocr_jobs() -> list[dict[str, str | int | None]]:
    return list_ocr_jobs()


@router.get("/ocr-worker-status", response_model=OcrWorkerStatus)
def get_ocr_worker_status() -> OcrWorkerStatus:
    return ocr_worker_status()


@router.post("/ocr-jobs/execute-next", response_model=OcrExecutionEvidence)
def run_next_ocr_job() -> OcrExecutionEvidence:
    try:
        return execute_next_ocr_job()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/ocr-jobs/{job_id}/execute", response_model=OcrExecutionEvidence)
def run_ocr_job(job_id: str) -> OcrExecutionEvidence:
    try:
        return execute_ocr_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/ocr-jobs/{job_id}/approve-rag", response_model=RagApprovalReleaseEvidence)
def approve_ocr_rag_release(job_id: str, request: HumanApprovalDecisionRequest) -> RagApprovalReleaseEvidence:
    try:
        return approve_ocr_job_for_rag(
            job_id=job_id,
            reviewer=request.reviewer,
            decision_comment=request.decision_comment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
