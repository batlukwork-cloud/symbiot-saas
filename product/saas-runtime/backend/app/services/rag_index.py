from app.schemas import DocumentIngestRequest, DocumentRecord, RagChunk, RagSearchResponse
from app.services.sqlite_store import (
    cosine_similarity,
    embed_text,
    insert_document,
    list_chunk_vectors,
    list_chunks_from_store,
    list_documents_from_store,
    next_document_id,
    tokenize,
    vector_index_status,
)
from app.services.pgvector_store import pgvector_status, search_pgvector
from app.services.embedding_provider import embedding_status


def list_documents() -> list[DocumentRecord]:
    return list_documents_from_store()


def ingest_document(payload: DocumentIngestRequest) -> DocumentRecord:
    return insert_document(next_document_id(), payload.name, payload.type, payload.access_scope, _split_text(payload.content))


def search(query: str, access_scope: str = "tenant:demo", min_score: float = 0.5) -> RagSearchResponse:
    pgvector = pgvector_status()
    if pgvector.get("ready"):
        matched = search_pgvector(query=query, access_scope=access_scope, min_score=min_score)
        return RagSearchResponse(
            query=query,
            chunks=matched,
            min_score=min_score,
            source_coverage="passed" if matched else "failed",
            index_mode="pgvector_live",
        )

    query_terms = tokenize(query)
    query_vector = embed_text(query)
    vectors = list_chunk_vectors(access_scope)
    matched: list[RagChunk] = []
    for chunk in list_chunks_from_store(access_scope):
        chunk_terms = tokenize(f"{chunk.title} {chunk.text}")
        term_hits = len(query_terms.intersection(chunk_terms))
        vector_score = (cosine_similarity(query_vector, vectors.get(chunk.id, [])) + 1) / 2
        keyword_score = max(chunk.score, min(0.99, 0.55 + term_hits * 0.12)) if term_hits else chunk.score
        score = max(keyword_score, vector_score)
        if score >= min_score:
            matched.append(chunk.model_copy(update={"score": round(score, 2)}))
    matched.sort(key=lambda item: item.score, reverse=True)
    status = "passed" if matched else "failed"
    return RagSearchResponse(query=query, chunks=matched[:5], min_score=min_score, source_coverage=status, index_mode="pgvector_fallback")


def get_vector_status() -> dict[str, str | int | bool]:
    sqlite_status = vector_index_status()
    pgvector = pgvector_status()
    provider = embedding_status()
    return {
        **sqlite_status,
        "mode": "pgvector_live" if pgvector.get("ready") else "pgvector_fallback",
        "ready": bool(pgvector.get("ready")) or bool(sqlite_status.get("ready")),
        "storage": str(pgvector.get("database_url")) if pgvector.get("connected") else str(sqlite_status.get("storage")),
        "embedding_provider": provider.provider,
        "pgvector_ready": bool(pgvector.get("ready")),
        "pgvector_connected": bool(pgvector.get("connected")),
        "pgvector_tables_ready": bool(pgvector.get("tables_ready")),
        "pgvector_vectors_total": int(pgvector.get("vectors_total", 0)),
        "fallback_reason": None if pgvector.get("ready") else str(pgvector.get("reason") or "Live pgvector is not connected; SQLite vector fallback is active."),
    }


def _split_text(content: str) -> list[str]:
    normalized = " ".join(content.split())
    if not normalized:
        return ["Empty document indexed as a placeholder."]
    max_len = 220
    return [normalized[i : i + max_len] for i in range(0, len(normalized), max_len)]
