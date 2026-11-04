from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.schemas import (
    DocumentIngestRequest,
    GateResult,
    OcrExecutionEvidence,
    OcrJobRecord,
    OcrWorkerStatus,
    RagApprovalReleaseEvidence,
)
from app.services.data_protection import (
    approve_request,
    classify_text,
    create_rag_approval_if_required,
    record_rag_release,
)
from app.services.ocr_dispatcher import OCR_PIPELINE_PATH
from app.services.rag_index import ingest_document
from app.services.sqlite_store import (
    DATA_DIR,
    OCR_RESULTS_DIR,
    get_ocr_job,
    get_uploaded_file,
    list_ocr_jobs,
    update_ocr_job,
)


OCR_WORKER = "rea-ocr-execution-worker-v0.1"


def ocr_worker_status() -> OcrWorkerStatus:
    jobs = list_ocr_jobs()
    return OcrWorkerStatus(
        worker=OCR_WORKER,
        pipeline_path=str(OCR_PIPELINE_PATH),
        python_command=_ocr_python_command(),
        queued_jobs=sum(1 for job in jobs if job.get("status") == "queued"),
        completed_jobs=sum(1 for job in jobs if job.get("status") == "completed"),
        failed_jobs=sum(1 for job in jobs if job.get("status") == "failed"),
        ready=(OCR_PIPELINE_PATH / "tools" / "rea_doc_pipeline.py").exists(),
    )


def execute_next_ocr_job() -> OcrExecutionEvidence:
    for job in list_ocr_jobs():
        if job.get("status") == "queued":
            return execute_ocr_job(str(job["id"]))
    raise ValueError("No queued OCR jobs found")


def execute_ocr_job(job_id: str) -> OcrExecutionEvidence:
    job = get_ocr_job(job_id)
    if not job:
        raise ValueError(f"OCR job not found: {job_id}")

    upload = get_uploaded_file(str(job["file_id"]))
    if not upload:
        return _fail(job, f"Uploaded file not found for OCR job {job_id}")

    source_file = DATA_DIR / str(upload["storage_key"])
    if not source_file.exists():
        return _fail(job, f"Uploaded source file is missing: {source_file}")

    pipeline = OCR_PIPELINE_PATH / "tools" / "rea_doc_pipeline.py"
    if not pipeline.exists():
        return _fail(job, f"OCR pipeline script is missing: {pipeline}")

    OCR_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_dir = OCR_RESULTS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    update_ocr_job(job_id, {"status": "running", "result_path": str(output_dir), "error": None})

    command = [
        _ocr_python_command(),
        str(pipeline),
        "--input",
        str(source_file),
        "--output",
        str(output_dir),
        "--hash",
        "--ocr",
        "--ocr-engine",
        "auto",
        "--max-extract-mb",
        "80",
    ]
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return _fail(job, "OCR worker timed out after 180 seconds", output_dir)
    except OSError as exc:
        return _fail(job, f"OCR worker could not start: {exc}", output_dir)

    if completed.returncode != 0:
        error = (completed.stderr or completed.stdout or f"return code {completed.returncode}").strip()
        return _fail(job, error[:1500], output_dir)

    manifest_path = output_dir / "manifest.json"
    output_text_files = _collect_output_text_files(manifest_path)
    combined_text = _read_combined_text(output_text_files)
    if not combined_text.strip():
        return _fail(job, "OCR worker completed but produced no indexable text", output_dir)

    classification = classify_text(
        text=combined_text,
        artifact_id=str(job["id"]),
        access_scope=str(upload["access_scope"]),
        purpose="post_ocr_rag_ingest",
    )
    approval = create_rag_approval_if_required(artifact_id=str(job["id"]), classification=classification)
    if approval:
        completed_at = datetime.now(timezone.utc).isoformat()
        update_ocr_job(
            job_id,
            {
                "status": "completed",
                "result_path": str(output_dir),
                "document_id": None,
                "text_chars": len(combined_text),
                "completed_at": completed_at,
                "error": None,
                "classification_id": classification.id,
                "approval_id": approval.id,
                "rag_status": "needs_approval",
            },
        )
        updated = OcrJobRecord(**get_ocr_job(job_id))
        return OcrExecutionEvidence(
            job=updated,
            indexed_document=None,
            manifest_path=str(manifest_path),
            output_text_files=[str(path) for path in output_text_files],
            accepted_for_rag=False,
            pii_classification=classification,
            human_approval=approval,
        )

    document = ingest_document(
        DocumentIngestRequest(
            name=f"OCR {upload['name']}",
            type="ocr_text",
            content=combined_text,
            access_scope=str(upload["access_scope"]),
        )
    )
    completed_at = datetime.now(timezone.utc).isoformat()
    update_ocr_job(
        job_id,
        {
            "status": "completed",
            "result_path": str(output_dir),
            "document_id": document.id,
            "text_chars": len(combined_text),
            "completed_at": completed_at,
            "error": None,
            "classification_id": classification.id,
            "approval_id": None,
            "rag_status": "clean_allowed",
        },
    )
    record_rag_release(source_id=job_id, source_type="ocr_job", approval_id=approval.id, document_id=document.id)
    updated = OcrJobRecord(**get_ocr_job(job_id))
    return OcrExecutionEvidence(
        job=updated,
        indexed_document=document,
        manifest_path=str(manifest_path),
        output_text_files=[str(path) for path in output_text_files],
        accepted_for_rag=True,
        pii_classification=classification,
        human_approval=None,
    )


def approve_ocr_job_for_rag(job_id: str, reviewer: str, decision_comment: str) -> RagApprovalReleaseEvidence:
    job = get_ocr_job(job_id)
    if not job:
        raise ValueError(f"OCR job not found: {job_id}")
    if not job.get("approval_id"):
        raise ValueError(f"OCR job does not require human approval: {job_id}")
    approval = approve_request(
        approval_id=str(job["approval_id"]),
        reviewer=reviewer,
        decision_comment=decision_comment,
    )
    upload = get_uploaded_file(str(job["file_id"]))
    if not upload:
        raise ValueError(f"Uploaded file not found for OCR job {job_id}")
    result_path = job.get("result_path")
    if not result_path:
        raise ValueError(f"OCR job has no result path: {job_id}")
    manifest_path = Path(str(result_path)) / "manifest.json"
    output_text_files = _collect_output_text_files(manifest_path)
    combined_text = _read_combined_text(output_text_files)
    if not combined_text.strip():
        update_ocr_job(job_id, {"rag_status": "failed", "error": "Approved OCR job has no indexable text"})
        raise ValueError("Approved OCR job has no indexable text")

    document = ingest_document(
        DocumentIngestRequest(
            name=f"OCR approved {upload['name']}",
            type="ocr_text",
            content=combined_text,
            access_scope=str(upload["access_scope"]),
        )
    )
    update_ocr_job(
        job_id,
        {
            "document_id": document.id,
            "rag_status": "approved_indexed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        },
    )
    updated = OcrJobRecord(**get_ocr_job(job_id))
    return RagApprovalReleaseEvidence(
        job=updated,
        approval=approval,
        indexed_document=document,
        accepted_for_rag=True,
        gates=[
            GateResult(
                id="gate-human-approval",
                title="Human Approval Gate",
                status="passed",
                reason=f"Reviewer {reviewer} approved OCR text for RAG ingest.",
            ),
            GateResult(
                id="gate-client-data-rag-release",
                title="Client Data RAG Release Gate",
                status="passed",
                reason="Document was indexed only after named approval.",
            ),
        ],
    )


def _ocr_python_command() -> str:
    return os.environ.get("SYMBIOT_OCR_PYTHON", "python")


def _collect_output_text_files(manifest_path: Path) -> list[Path]:
    if not manifest_path.exists():
        return []
    try:
        items = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    files = []
    for item in items:
        path = item.get("output_text")
        if path and Path(path).exists():
            files.append(Path(path))
    return files


def _read_combined_text(paths: list[Path]) -> str:
    chunks = []
    for path in paths:
        chunks.append(f"\n\n# OCR SOURCE: {path.name}\n")
        chunks.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(chunks).strip()


def _fail(job: dict, error: str, output_dir: Path | None = None) -> OcrExecutionEvidence:
    update_ocr_job(
        str(job["id"]),
        {
            "status": "failed",
            "result_path": str(output_dir) if output_dir else job.get("result_path"),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error": error,
            "rag_status": "failed",
        },
    )
    updated = OcrJobRecord(**get_ocr_job(str(job["id"])))
    return OcrExecutionEvidence(
        job=updated,
        indexed_document=None,
        manifest_path=str(output_dir / "manifest.json") if output_dir else None,
        output_text_files=[],
        accepted_for_rag=False,
    )
