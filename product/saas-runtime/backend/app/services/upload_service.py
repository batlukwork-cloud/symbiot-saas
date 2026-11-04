from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

from app.schemas import (
    DocumentIngestRequest,
    FilePolicyCheckRequest,
    FileUploadEvidence,
    FileUploadRecord,
    GateResult,
    UploadApprovalReleaseEvidence,
    UploadRuntimeStatus,
)
from app.services.data_protection import (
    approve_request,
    classify_text,
    create_rag_approval_if_required,
    record_rag_release,
)
from app.services.rag_index import ingest_document
from app.services.ocr_dispatcher import OCR_DISPATCHER, OCR_PIPELINE_PATH, dispatch_ocr_job
from app.services.scanner_adapter import SCANNER_ADAPTER, scan_file
from app.services.sqlite_store import (
    UPLOAD_DIR,
    insert_uploaded_file,
    get_uploaded_file,
    list_ocr_jobs,
    list_uploaded_files,
    next_uploaded_file_id,
    update_uploaded_file,
)
from app.services.upload_policy import check_upload_policy


def save_upload(filename: str, content_type: str, data: bytes, access_scope: str) -> FileUploadEvidence:
    file_id = next_uploaded_file_id()
    file_type = Path(filename).suffix.lower().strip(".") or "bin"
    safe_name = "".join(char if char.isalnum() or char in "._-" else "_" for char in filename) or f"{file_id}.{file_type}"
    tenant_key = access_scope.replace(":", "_").replace("/", "_")
    target_dir = UPLOAD_DIR / tenant_key
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{file_id}_{safe_name}"
    target_path.write_bytes(data)

    digest = sha256(data).hexdigest().upper()
    policy_payload = FilePolicyCheckRequest(
        name=filename,
        type=file_type,
        size_bytes=len(data),
        content_type=content_type,
        access_scope=access_scope,
    )
    policy = check_upload_policy(policy_payload)
    scan = scan_file(target_path, digest)
    created_at = datetime.now(timezone.utc).isoformat()
    ocr_job = dispatch_ocr_job(file_id, target_path, created_at, policy.ocr_required and policy.allowed)
    classification = None
    approval = None
    rag_status = "not_checked"
    text_preview = _decode_text_like_upload(file_type, content_type, data)
    if text_preview is not None and policy.allowed and scan.status != "failed":
        classification = classify_text(
            text=text_preview,
            artifact_id=file_id,
            access_scope=access_scope,
            purpose="upload_rag_ingest",
        )
        approval = create_rag_approval_if_required(artifact_id=file_id, classification=classification)
        rag_status = "needs_approval" if approval else "clean_allowed"
    upload = FileUploadRecord(
        id=file_id,
        name=filename,
        type=file_type,
        size_bytes=len(data),
        sha256=digest,
        access_scope=access_scope,
        storage_key=str(target_path.relative_to(UPLOAD_DIR.parent)),
        policy_status=policy.status,
        scan_status=scan.status,
        ocr_job_id=ocr_job.id if ocr_job else None,
        classification_id=classification.id if classification else None,
        approval_id=approval.id if approval else None,
        rag_status=rag_status,
        document_id=None,
        created_at=created_at,
    )
    insert_uploaded_file(upload.model_dump())
    return FileUploadEvidence(
        upload=upload,
        policy=policy,
        scan=scan,
        ocr_job=ocr_job,
        accepted_for_runtime=policy.allowed and scan.status != "failed" and rag_status != "needs_approval",
        pii_classification=classification,
        human_approval=approval,
        rag_status=rag_status,
    )


def _decode_text_like_upload(file_type: str, content_type: str, data: bytes) -> str | None:
    text_types = {"txt", "md", "csv", "json", "xml", "html", "htm", "yaml", "yml"}
    if file_type not in text_types and not content_type.startswith("text/"):
        return None
    return data.decode("utf-8", errors="replace")[:250_000]


def approve_upload_for_rag(file_id: str, reviewer: str, decision_comment: str) -> UploadApprovalReleaseEvidence:
    upload = get_uploaded_file(file_id)
    if not upload:
        raise ValueError(f"Uploaded file not found: {file_id}")
    if not upload.get("approval_id"):
        raise ValueError(f"Uploaded file does not require human approval: {file_id}")
    source_file = UPLOAD_DIR.parent / str(upload["storage_key"])
    if not source_file.exists():
        update_uploaded_file(file_id, {"rag_status": "failed"})
        raise ValueError(f"Uploaded source file is missing: {source_file}")
    text = _decode_text_like_upload(str(upload["type"]), "text/plain", source_file.read_bytes())
    if text is None or not text.strip():
        update_uploaded_file(file_id, {"rag_status": "failed"})
        raise ValueError("Uploaded file cannot be decoded for RAG release")

    approval = approve_request(
        approval_id=str(upload["approval_id"]),
        reviewer=reviewer,
        decision_comment=decision_comment,
    )
    document = ingest_document(
        DocumentIngestRequest(
            name=f"Approved upload {upload['name']}",
            type=str(upload["type"]),
            content=text,
            access_scope=str(upload["access_scope"]),
        )
    )
    update_uploaded_file(file_id, {"rag_status": "approved_indexed", "document_id": document.id})
    record_rag_release(source_id=file_id, source_type="upload", approval_id=approval.id, document_id=document.id)
    updated = FileUploadRecord(**get_uploaded_file(file_id))
    return UploadApprovalReleaseEvidence(
        upload=updated,
        approval=approval,
        indexed_document=document,
        accepted_for_rag=True,
        gates=[
            GateResult(
                id="gate-human-approval",
                title="Human Approval Gate",
                status="passed",
                reason=f"Reviewer {reviewer} approved uploaded client text for RAG ingest.",
            ),
            GateResult(
                id="gate-client-data-rag-release",
                title="Client Data RAG Release Gate",
                status="passed",
                reason="Uploaded client document was indexed only after named approval.",
            ),
        ],
    )


def upload_runtime_status() -> UploadRuntimeStatus:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UploadRuntimeStatus(
        storage_path=str(UPLOAD_DIR),
        uploads_total=len(list_uploaded_files()),
        ocr_jobs_total=len(list_ocr_jobs()),
        scanner_adapter=SCANNER_ADAPTER,
        ocr_dispatcher=OCR_DISPATCHER,
        ocr_pipeline_path=str(OCR_PIPELINE_PATH),
        ready=UPLOAD_DIR.exists() and OCR_PIPELINE_PATH.exists(),
    )
