from __future__ import annotations

import json
import sqlite3
from hashlib import sha256
from pathlib import Path
from math import sqrt

from app.schemas import DocumentRecord, RagChunk


ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "runtime_data"
DB_PATH = DATA_DIR / "symbiot_runtime.db"
UPLOAD_DIR = DATA_DIR / "uploads"
OCR_DISPATCH_DIR = DATA_DIR / "ocr_dispatch_queue"
OCR_RESULTS_DIR = DATA_DIR / "ocr_results"
VECTOR_DIMENSION = 16
VECTOR_MODEL = "symbiot-embedding-abstraction-v0.2"


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_store() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists documents (
                id text primary key,
                name text not null,
                type text not null,
                index_status text not null,
                access_scope text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists chunks (
                id text primary key,
                document_id text not null,
                title text not null,
                text text not null,
                access_scope text not null,
                terms_json text not null,
                base_score real not null,
                foreign key(document_id) references documents(id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists chunk_vectors (
                chunk_id text primary key,
                vector_json text not null,
                model text not null,
                dimension integer not null,
                foreign key(chunk_id) references chunks(id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists uploaded_files (
                id text primary key,
                name text not null,
                type text not null,
                size_bytes integer not null,
                sha256 text not null,
                access_scope text not null,
                storage_key text not null,
                policy_status text not null,
                scan_status text not null,
                ocr_job_id text,
                classification_id text,
                approval_id text,
                rag_status text default 'not_checked',
                document_id text,
                created_at text not null
            )
            """
        )
        _ensure_column(connection, "uploaded_files", "classification_id", "text")
        _ensure_column(connection, "uploaded_files", "approval_id", "text")
        _ensure_column(connection, "uploaded_files", "rag_status", "text default 'not_checked'")
        _ensure_column(connection, "uploaded_files", "document_id", "text")
        connection.execute(
            """
            create table if not exists ocr_jobs (
                id text primary key,
                file_id text not null,
                status text not null,
                engine text not null,
                dispatch_path text not null,
                command_hint text not null,
                created_at text not null,
                result_path text,
                document_id text,
                text_chars integer default 0,
                completed_at text,
                error text,
                classification_id text,
                approval_id text,
                rag_status text default 'not_checked',
                foreign key(file_id) references uploaded_files(id)
            )
            """
        )
        _ensure_column(connection, "ocr_jobs", "result_path", "text")
        _ensure_column(connection, "ocr_jobs", "document_id", "text")
        _ensure_column(connection, "ocr_jobs", "text_chars", "integer default 0")
        _ensure_column(connection, "ocr_jobs", "completed_at", "text")
        _ensure_column(connection, "ocr_jobs", "error", "text")
        _ensure_column(connection, "ocr_jobs", "classification_id", "text")
        _ensure_column(connection, "ocr_jobs", "approval_id", "text")
        _ensure_column(connection, "ocr_jobs", "rag_status", "text default 'not_checked'")
        connection.execute(
            """
            create table if not exists source_links (
                id text primary key,
                title text not null,
                url text not null,
                note text,
                access_scope text not null,
                status text not null,
                document_id text,
                created_at text not null
            )
            """
        )
        if connection.execute("select count(*) from documents").fetchone()[0] == 0:
            seed_document(
                "doc-demo-001",
                "Продуктовая база demo.md",
                "md",
                "tenant:demo",
                [
                    "Symbiot Runtime собирает процесс, источники, LLM-черновик, gate-проверки, artifact и audit trail.",
                    "MVP path должен доказываться evidence: API response, UI screenshot, build, hashes and audit events.",
                ],
            )
        _backfill_vectors(connection)


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    columns = {row["name"] for row in connection.execute(f"pragma table_info({table})").fetchall()}
    if column not in columns:
        connection.execute(f"alter table {table} add column {column} {ddl}")


def _backfill_vectors(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        select chunks.id, chunks.title, chunks.text
        from chunks
        left join chunk_vectors on chunk_vectors.chunk_id = chunks.id
        where chunk_vectors.chunk_id is null
        """
    ).fetchall()
    for row in rows:
        connection.execute(
            """
            insert or replace into chunk_vectors(chunk_id, vector_json, model, dimension)
            values (?, ?, ?, ?)
            """,
            (row["id"], json.dumps(embed_text(f"{row['title']} {row['text']}")), VECTOR_MODEL, VECTOR_DIMENSION),
        )


def seed_document(document_id: str, name: str, document_type: str, access_scope: str, chunks: list[str]) -> None:
    with get_connection() as connection:
        connection.execute(
            "insert or ignore into documents(id, name, type, index_status, access_scope) values (?, ?, ?, ?, ?)",
            (document_id, name, document_type, "indexed", access_scope),
        )
        for index, text in enumerate(chunks, start=1):
            chunk_id = f"chunk-{document_id}-{index:03d}" if not document_id.endswith("001") else f"chunk-demo-{index:03d}"
            connection.execute(
                """
                insert or ignore into chunks(id, document_id, title, text, access_scope, terms_json, base_score)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk_id, document_id, name, text, access_scope, json.dumps(sorted(tokenize(text))), 0.8 + index * 0.03),
            )
            connection.execute(
                """
                insert or replace into chunk_vectors(chunk_id, vector_json, model, dimension)
                values (?, ?, ?, ?)
                """,
                (chunk_id, json.dumps(embed_text(f"{name} {text}")), VECTOR_MODEL, VECTOR_DIMENSION),
            )


def insert_document(document_id: str, name: str, document_type: str, access_scope: str, chunks: list[str]) -> DocumentRecord:
    seed_document(document_id, name, document_type, access_scope, chunks)
    return DocumentRecord(id=document_id, name=name, type=document_type, index_status="indexed", access_scope=access_scope)


def list_documents_from_store() -> list[DocumentRecord]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute("select id, name, type, index_status, access_scope from documents order by id").fetchall()
    return [DocumentRecord(**dict(row)) for row in rows]


def list_chunks_from_store(access_scope: str = "tenant:demo") -> list[RagChunk]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute(
            "select id, document_id, title, text, access_scope, base_score from chunks where access_scope = ? order by id",
            (access_scope,),
        ).fetchall()
    return [
        RagChunk(
            id=row["id"],
            document_id=row["document_id"],
            title=row["title"],
            text=row["text"],
            score=float(row["base_score"]),
            access_scope=row["access_scope"],
        )
        for row in rows
    ]


def list_chunk_vectors(access_scope: str = "tenant:demo") -> dict[str, list[float]]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select chunks.id, chunk_vectors.vector_json
            from chunks
            join chunk_vectors on chunk_vectors.chunk_id = chunks.id
            where chunks.access_scope = ?
            """,
            (access_scope,),
        ).fetchall()
    return {row["id"]: json.loads(row["vector_json"]) for row in rows}


def next_document_id() -> str:
    init_store()
    with get_connection() as connection:
        count = connection.execute("select count(*) from documents").fetchone()[0]
    return f"doc-demo-{count + 1:03d}"


def next_uploaded_file_id() -> str:
    init_store()
    with get_connection() as connection:
        count = connection.execute("select count(*) from uploaded_files").fetchone()[0]
    return f"upload-demo-{count + 1:03d}"


def next_ocr_job_id() -> str:
    init_store()
    with get_connection() as connection:
        count = connection.execute("select count(*) from ocr_jobs").fetchone()[0]
    return f"ocr-demo-{count + 1:03d}"


def next_source_link_id() -> str:
    init_store()
    with get_connection() as connection:
        count = connection.execute("select count(*) from source_links").fetchone()[0]
    return f"source-link-demo-{count + 1:03d}"


def insert_uploaded_file(values: dict[str, str | int | None]) -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            insert or replace into uploaded_files(
                id, name, type, size_bytes, sha256, access_scope, storage_key,
                policy_status, scan_status, ocr_job_id, classification_id, approval_id,
                rag_status, document_id, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["id"],
                values["name"],
                values["type"],
                values["size_bytes"],
                values["sha256"],
                values["access_scope"],
                values["storage_key"],
                values["policy_status"],
                values["scan_status"],
                values.get("ocr_job_id"),
                values.get("classification_id"),
                values.get("approval_id"),
                values.get("rag_status", "not_checked"),
                values.get("document_id"),
                values["created_at"],
            ),
        )


def update_uploaded_file(file_id: str, values: dict[str, str | int | None]) -> None:
    init_store()
    allowed = {"classification_id", "approval_id", "rag_status", "document_id"}
    updates = [(key, value) for key, value in values.items() if key in allowed]
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key, _value in updates)
    parameters = [value for _key, value in updates]
    parameters.append(file_id)
    with get_connection() as connection:
        connection.execute(f"update uploaded_files set {assignments} where id = ?", parameters)


def insert_ocr_job(values: dict[str, str | int | None]) -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            insert or replace into ocr_jobs(
                id, file_id, status, engine, dispatch_path, command_hint, created_at,
                result_path, document_id, text_chars, completed_at, error,
                classification_id, approval_id, rag_status
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["id"],
                values["file_id"],
                values["status"],
                values["engine"],
                values["dispatch_path"],
                values["command_hint"],
                values["created_at"],
                values.get("result_path"),
                values.get("document_id"),
                values.get("text_chars", 0),
                values.get("completed_at"),
                values.get("error"),
                values.get("classification_id"),
                values.get("approval_id"),
                values.get("rag_status", "not_checked"),
            ),
        )


def update_ocr_job(job_id: str, values: dict[str, str | int | None]) -> None:
    init_store()
    allowed = {
        "status",
        "engine",
        "result_path",
        "document_id",
        "text_chars",
        "completed_at",
        "error",
        "classification_id",
        "approval_id",
        "rag_status",
    }
    updates = [(key, value) for key, value in values.items() if key in allowed]
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key, _value in updates)
    parameters = [value for _key, value in updates]
    parameters.append(job_id)
    with get_connection() as connection:
        connection.execute(f"update ocr_jobs set {assignments} where id = ?", parameters)


def list_uploaded_files() -> list[dict[str, str | int | None]]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute("select * from uploaded_files order by created_at desc, id desc").fetchall()
    return [dict(row) for row in rows]


def get_uploaded_file(file_id: str) -> dict[str, str | int | None] | None:
    init_store()
    with get_connection() as connection:
        row = connection.execute("select * from uploaded_files where id = ?", (file_id,)).fetchone()
    return dict(row) if row else None


def list_ocr_jobs() -> list[dict[str, str | int | None]]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute("select * from ocr_jobs order by created_at desc, id desc").fetchall()
    return [dict(row) for row in rows]


def get_ocr_job(job_id: str) -> dict[str, str | int | None] | None:
    init_store()
    with get_connection() as connection:
        row = connection.execute("select * from ocr_jobs where id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def insert_source_link(values: dict[str, str | None]) -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            insert or replace into source_links(
                id, title, url, note, access_scope, status, document_id, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["id"],
                values["title"],
                values["url"],
                values.get("note"),
                values["access_scope"],
                values["status"],
                values.get("document_id"),
                values["created_at"],
            ),
        )


def list_source_links() -> list[dict[str, str | None]]:
    init_store()
    with get_connection() as connection:
        rows = connection.execute("select * from source_links order by created_at desc, id desc").fetchall()
    return [dict(row) for row in rows]


def tokenize(text: str) -> set[str]:
    normalized = text.lower().replace("/", " ").replace("-", " ")
    return {token.strip(".,:;!?()[]{}\"'`") for token in normalized.split() if len(token.strip(".,:;!?()[]{}\"'`")) >= 3}


def embed_text(text: str) -> list[float]:
    vector = [0.0] * VECTOR_DIMENSION
    for token in tokenize(text):
        digest = sha256(token.encode("utf-8")).digest()
        index = digest[0] % VECTOR_DIMENSION
        direction = 1.0 if digest[1] % 2 == 0 else -1.0
        weight = 1.0 + (digest[2] % 7) / 10
        vector[index] += direction * weight
    norm = sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 6) for value in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def vector_index_status() -> dict[str, str | int | bool]:
    init_store()
    with get_connection() as connection:
        chunks_total = connection.execute("select count(*) from chunks").fetchone()[0]
        vectors_total = connection.execute("select count(*) from chunk_vectors").fetchone()[0]
    migration = ROOT / "backend" / "migrations" / "001_pgvector_schema.sql"
    return {
        "mode": "pgvector_ready",
        "model": VECTOR_MODEL,
        "dimension": VECTOR_DIMENSION,
        "chunks_total": chunks_total,
        "vectors_total": vectors_total,
        "ready": chunks_total > 0 and chunks_total == vectors_total,
        "storage": str(DB_PATH),
        "embedding_provider": "deterministic_local_fallback",
        "pgvector_migration": str(migration),
        "pgvector_ready": migration.exists(),
    }


def storage_status() -> dict[str, str | int | bool]:
    init_store()
    with get_connection() as connection:
        documents = connection.execute("select count(*) from documents").fetchone()[0]
        chunks = connection.execute("select count(*) from chunks").fetchone()[0]
        vectors = connection.execute("select count(*) from chunk_vectors").fetchone()[0]
        uploads = connection.execute("select count(*) from uploaded_files").fetchone()[0]
        ocr_jobs = connection.execute("select count(*) from ocr_jobs").fetchone()[0]
    return {
        "type": "sqlite",
        "path": str(DB_PATH),
        "exists": DB_PATH.exists(),
        "documents": documents,
        "chunks": chunks,
        "vectors": vectors,
        "uploads": uploads,
        "ocr_jobs": ocr_jobs,
        "vector_index_ready": chunks > 0 and chunks == vectors,
        "vector_model": VECTOR_MODEL,
        "persistent": True,
    }
