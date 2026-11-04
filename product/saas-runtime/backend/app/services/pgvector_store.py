from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.schemas import RagChunk
from app.services.embedding_provider import embed_text as embed_with_provider
from app.services.embedding_provider import provider_name
from app.services.sqlite_store import (
    ROOT,
    VECTOR_DIMENSION,
    VECTOR_MODEL,
    list_chunk_vectors,
    list_chunks_from_store,
    list_documents_from_store,
    tokenize,
)


DEFAULT_DATABASE_URL = "postgresql://symbiot:symbiot@localhost:5432/symbiot_runtime"
MIGRATION_PATH = ROOT / "backend" / "migrations" / "001_pgvector_schema.sql"


def database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def _load_psycopg() -> Any:
    try:
        import psycopg  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on local runtime package install.
        raise RuntimeError(f"psycopg is not installed or unavailable: {exc}") from exc
    return psycopg


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


def _connect() -> Any:
    psycopg = _load_psycopg()
    return psycopg.connect(database_url(), connect_timeout=3)


def apply_pgvector_migration() -> dict[str, Any]:
    if not MIGRATION_PATH.exists():
        return {
            "status": "failed",
            "ready": False,
            "reason": f"Migration file is missing: {MIGRATION_PATH}",
        }
    try:
        with _connect() as connection:
            connection.execute(MIGRATION_PATH.read_text(encoding="utf-8"))
            connection.commit()
    except Exception as exc:
        return {
            "status": "blocked_by_infrastructure",
            "ready": False,
            "reason": str(exc),
            "database_url": _redact_url(database_url()),
            "migration_path": str(MIGRATION_PATH),
        }
    return {
        "status": "applied",
        "ready": True,
        "database_url": _redact_url(database_url()),
        "migration_path": str(MIGRATION_PATH),
    }


def pgvector_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "mode": "pgvector_live",
        "database_url": _redact_url(database_url()),
        "migration_path": str(MIGRATION_PATH),
        "migration_exists": MIGRATION_PATH.exists(),
        "model": VECTOR_MODEL,
        "dimension": VECTOR_DIMENSION,
        "connected": False,
        "extension_ready": False,
        "tables_ready": False,
        "documents_total": 0,
        "chunks_total": 0,
        "vectors_total": 0,
        "ready": False,
        "reason": "",
    }
    try:
        with _connect() as connection:
            status["connected"] = True
            extension = connection.execute(
                "select exists(select 1 from pg_extension where extname = 'vector')"
            ).fetchone()
            status["extension_ready"] = bool(extension[0]) if extension else False
            tables = connection.execute(
                """
                select count(*)
                from information_schema.tables
                where table_schema = 'public'
                  and table_name in ('runtime_documents', 'runtime_source_chunks', 'runtime_chunk_embeddings')
                """
            ).fetchone()
            status["tables_ready"] = bool(tables and tables[0] == 3)
            if status["tables_ready"]:
                status["documents_total"] = connection.execute("select count(*) from runtime_documents").fetchone()[0]
                status["chunks_total"] = connection.execute("select count(*) from runtime_source_chunks").fetchone()[0]
                status["vectors_total"] = connection.execute("select count(*) from runtime_chunk_embeddings").fetchone()[0]
            status["ready"] = bool(
                status["connected"]
                and status["extension_ready"]
                and status["tables_ready"]
                and status["chunks_total"] == status["vectors_total"]
                and status["vectors_total"] > 0
            )
    except Exception as exc:
        status["reason"] = str(exc)
    return status


def sync_sqlite_to_pgvector(access_scope: str = "tenant:demo") -> dict[str, Any]:
    migration = apply_pgvector_migration()
    if not migration.get("ready"):
        return {
            "status": "blocked_by_infrastructure",
            "synced_documents": 0,
            "synced_chunks": 0,
            "synced_vectors": 0,
            "reason": migration.get("reason", "pgvector migration is not available"),
            "migration": migration,
        }

    documents = list_documents_from_store()
    chunks = list_chunks_from_store(access_scope)
    vectors = list_chunk_vectors(access_scope)
    synced_documents = 0
    synced_chunks = 0
    synced_vectors = 0
    try:
        with _connect() as connection:
            for document in documents:
                if document.access_scope != access_scope:
                    continue
                connection.execute(
                    """
                    insert into runtime_documents(id, tenant_scope, name, document_type, index_status)
                    values (%s, %s, %s, %s, %s)
                    on conflict (id) do update
                    set tenant_scope = excluded.tenant_scope,
                        name = excluded.name,
                        document_type = excluded.document_type,
                        index_status = excluded.index_status
                    """,
                    (document.id, document.access_scope, document.name, document.type, document.index_status),
                )
                synced_documents += 1
            for chunk_index, chunk in enumerate(chunks, start=1):
                connection.execute(
                    """
                    insert into runtime_source_chunks(id, document_id, tenant_scope, title, chunk_text, chunk_index)
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (id) do update
                    set document_id = excluded.document_id,
                        tenant_scope = excluded.tenant_scope,
                        title = excluded.title,
                        chunk_text = excluded.chunk_text,
                        chunk_index = excluded.chunk_index
                    """,
                    (chunk.id, chunk.document_id, chunk.access_scope, chunk.title, chunk.text, chunk_index),
                )
                synced_chunks += 1
                vector = embed_with_provider(f"{chunk.title} {chunk.text}")
                connection.execute(
                    """
                    insert into runtime_chunk_embeddings(chunk_id, embedding, embedding_provider, embedding_model)
                    values (%s, %s::vector, %s, %s)
                    on conflict (chunk_id) do update
                    set embedding = excluded.embedding,
                        embedding_provider = excluded.embedding_provider,
                        embedding_model = excluded.embedding_model
                    """,
                    (chunk.id, _vector_literal(vector), provider_name(), VECTOR_MODEL),
                )
                synced_vectors += 1
            connection.commit()
    except Exception as exc:
        return {
            "status": "failed",
            "synced_documents": synced_documents,
            "synced_chunks": synced_chunks,
            "synced_vectors": synced_vectors,
            "reason": str(exc),
        }
    return {
        "status": "passed",
        "synced_documents": synced_documents,
        "synced_chunks": synced_chunks,
        "synced_vectors": synced_vectors,
        "reason": "SQLite MVP knowledge store synchronized into live pgvector tables.",
        "pgvector": pgvector_status(),
    }


def search_pgvector(query: str, access_scope: str = "tenant:demo", min_score: float = 0.5) -> list[RagChunk]:
    query_vector = _vector_literal(embed_with_provider(query))
    query_terms = tokenize(query.replace("_", " "))
    with _connect() as connection:
        rows = connection.execute(
            """
            select
                c.id,
                c.document_id,
                c.title,
                c.chunk_text,
                c.tenant_scope,
                1 - (e.embedding <=> %s::vector) as vector_score
            from runtime_source_chunks c
            join runtime_chunk_embeddings e on e.chunk_id = c.id
            where c.tenant_scope = %s
            order by e.embedding <=> %s::vector
            limit 20
            """,
            (query_vector, access_scope, query_vector),
        ).fetchall()
    matched: list[RagChunk] = []
    for row in rows:
        text = f"{row[2]} {row[3]}".replace("_", " ")
        term_hits = len(query_terms.intersection(tokenize(text)))
        vector_score = float(row[5])
        keyword_score = min(0.99, 0.55 + term_hits * 0.12) if term_hits else 0.0
        score = max(vector_score, keyword_score)
        if score < min_score:
            continue
        matched.append(RagChunk(
            id=row[0],
            document_id=row[1],
            title=row[2],
            text=row[3],
            access_scope=row[4],
            score=round(score, 2),
        ))
    matched.sort(key=lambda item: item.score, reverse=True)
    return matched[:5]


def live_pgvector_available() -> bool:
    return bool(pgvector_status().get("ready"))


def _redact_url(url: str) -> str:
    if "@" not in url or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    host = rest.split("@", 1)[1]
    return f"{scheme}://***:***@{host}"
