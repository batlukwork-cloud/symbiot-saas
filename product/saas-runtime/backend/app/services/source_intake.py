from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse

from app.schemas import GateResult, SourceIntakeItem, SourceIntakeLinkRequest, SourceIntakeSummary
from app.services.rag_index import list_documents
from app.services.sqlite_store import (
    insert_source_link,
    list_source_links,
    list_uploaded_files,
    next_source_link_id,
)
from app.services.upload_service import upload_runtime_status


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _upload_status(upload: dict[str, str | int | None]) -> tuple[str, list[GateResult]]:
    checks: list[GateResult] = []
    policy_status = str(upload.get("policy_status") or "warning")
    scan_status = str(upload.get("scan_status") or "warning")
    rag_status = str(upload.get("rag_status") or "not_checked")
    document_id = upload.get("document_id")
    ocr_job_id = upload.get("ocr_job_id")

    checks.append(
        GateResult(
            id="source-upload-policy",
            title="Политика файла",
            status="passed" if policy_status == "passed" else "failed",
            reason=f"policy_status={policy_status}",
            action=None if policy_status == "passed" else "Проверить тип, размер и разрешение файла.",
        )
    )
    checks.append(
        GateResult(
            id="source-upload-scan",
            title="Проверка файла",
            status="passed" if scan_status == "passed" else "failed",
            reason=f"scan_status={scan_status}",
            action=None if scan_status == "passed" else "Не использовать файл до безопасной проверки.",
        )
    )

    if policy_status != "passed" or scan_status != "passed" or rag_status in {"blocked", "failed"}:
        return "blocked", checks
    if document_id:
        return "indexed", checks
    if rag_status == "needs_approval":
        checks.append(
            GateResult(
                id="source-rag-approval",
                title="Согласование RAG",
                status="warning",
                reason="В файле найдены чувствительные данные; нужна ручная приемка перед индексированием.",
                action="Провести human approval.",
            )
        )
        return "needs_approval", checks
    if ocr_job_id:
        checks.append(
            GateResult(
                id="source-ocr-required",
                title="OCR требуется",
                status="warning",
                reason=f"Файл поставлен в OCR-задачу {ocr_job_id}.",
                action="Выполнить OCR worker и затем индексировать результат.",
            )
        )
        return "needs_ocr", checks
    return "ready", checks


def list_source_intake(access_scope: str = "tenant:demo") -> SourceIntakeSummary:
    documents = [document for document in list_documents() if document.access_scope == access_scope]
    uploads = [upload for upload in list_uploaded_files() if upload.get("access_scope") == access_scope]
    links = [link for link in list_source_links() if link.get("access_scope") == access_scope]
    upload_status = upload_runtime_status()

    items: list[SourceIntakeItem] = [
        SourceIntakeItem(
            id=f"source:{document.id}",
            kind="document",
            title=document.name,
            status="indexed" if document.index_status == "indexed" else "warning",
            access_scope=document.access_scope,
            reference=document.id,
            document_id=document.id,
            checks=[
                GateResult(
                    id="source-document-indexed",
                    title="Индекс RAG",
                    status="passed" if document.index_status == "indexed" else "warning",
                    reason=f"index_status={document.index_status}",
                    action=None if document.index_status == "indexed" else "Дождаться индексации документа.",
                )
            ],
        )
        for document in documents
    ]

    for upload in uploads:
        status, checks = _upload_status(upload)
        items.append(
            SourceIntakeItem(
                id=f"source:{upload['id']}",
                kind="upload",
                title=str(upload["name"]),
                status=status,  # type: ignore[arg-type]
                access_scope=str(upload["access_scope"]),
                reference=str(upload["id"]),
                document_id=upload.get("document_id"),  # type: ignore[arg-type]
                upload_id=str(upload["id"]),
                rag_status=str(upload.get("rag_status") or "not_checked"),
                ocr_job_id=upload.get("ocr_job_id"),  # type: ignore[arg-type]
                checks=checks,
            )
        )

    for link in links:
        status = "indexed" if link.get("document_id") else "registered"
        items.append(
            SourceIntakeItem(
                id=f"source:{link['id']}",
                kind="link",
                title=str(link["title"]),
                status=status,  # type: ignore[arg-type]
                access_scope=str(link["access_scope"]),
                reference=str(link["id"]),
                document_id=link.get("document_id"),
                url=str(link["url"]),
                checks=[
                    GateResult(
                        id="source-link-registered",
                        title="Ссылка зарегистрирована",
                        status="warning" if status == "registered" else "passed",
                        reason="Ссылка сохранена как контекст миссии, но автоматическое извлечение еще не включено."
                        if status == "registered"
                        else "Ссылка связана с индексированным документом.",
                        action="Запустить импорт/извлечение ссылки в следующем слое."
                        if status == "registered"
                        else None,
                    )
                ],
            )
        )

    ready_document_ids = sorted(
        {
            item.document_id
            for item in items
            if item.document_id and item.status in {"indexed", "ready"}
        }
    )
    active_source_ids = [item.id for item in items if item.status not in {"blocked"}]

    return SourceIntakeSummary(
        active_source_ids=active_source_ids,
        ready_document_ids=ready_document_ids or ["doc-demo-001"],
        items=items,
        upload_runtime_ready=upload_status.ready,
        supported_inputs=["demo_document", "single_file", "file_group", "link"],
        next_action="Загрузите файл, зарегистрируйте ссылку или используйте готовый demo-источник.",
    )


def register_source_link(payload: SourceIntakeLinkRequest) -> SourceIntakeItem:
    parsed = urlparse(payload.url)
    if parsed.scheme not in {"http", "https", "file"}:
        raise ValueError("Source link must use http, https, or file scheme.")
    source_id = next_source_link_id()
    title = payload.title or parsed.netloc or parsed.path or payload.url
    insert_source_link(
        {
            "id": source_id,
            "title": title,
            "url": payload.url,
            "note": payload.note,
            "access_scope": payload.access_scope,
            "status": "registered",
            "document_id": None,
            "created_at": _now_iso(),
        }
    )
    return SourceIntakeItem(
        id=f"source:{source_id}",
        kind="link",
        title=title,
        status="registered",
        access_scope=payload.access_scope,
        reference=source_id,
        url=payload.url,
        checks=[
            GateResult(
                id="source-link-registered",
                title="Ссылка зарегистрирована",
                status="warning",
                reason="Ссылка сохранена как материал миссии; автоматическое извлечение будет отдельным controlled layer.",
                action="Добавить импорт ссылки в очередь Source Intake.",
            )
        ],
    )
