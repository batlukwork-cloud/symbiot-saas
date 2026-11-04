from fastapi import APIRouter, Response, Query

from app.schemas import EmbeddingProviderStatus, RagSearchResponse, VectorIndexStatus
from app.services.embedding_provider import embedding_status, pgvector_migration_sql
from app.services.pgvector_store import apply_pgvector_migration, pgvector_status, sync_sqlite_to_pgvector
from app.services.rag_eval import eval_history, evaluate_rag, load_eval_set, load_eval_thresholds, provider_governance_status
from app.services.rag_index import get_vector_status, search

router = APIRouter(prefix="/rag", tags=["rag"])


@router.get("/search", response_model=RagSearchResponse)
def search_rag(query: str = Query(default="Symbiot Runtime MVP path")) -> RagSearchResponse:
    return search(query=query, min_score=0.5)


@router.get("/evidence/{task_run_id}", response_model=RagSearchResponse)
def get_rag_evidence(task_run_id: str) -> RagSearchResponse:
    return search(query=f"Runtime evidence {task_run_id}", min_score=0.5)


@router.get("/vector-status", response_model=VectorIndexStatus)
def get_rag_vector_status() -> VectorIndexStatus:
    return VectorIndexStatus(**get_vector_status())


@router.get("/embedding-status", response_model=EmbeddingProviderStatus)
def get_embedding_status() -> EmbeddingProviderStatus:
    return embedding_status()


@router.get("/pgvector-status")
def get_pgvector_status() -> dict:
    return pgvector_status()


@router.post("/pgvector/apply-migration")
def apply_migration() -> dict:
    return apply_pgvector_migration()


@router.post("/pgvector/sync")
def sync_pgvector(access_scope: str = Query(default="tenant:demo")) -> dict:
    return sync_sqlite_to_pgvector(access_scope=access_scope)


@router.get("/eval-set")
def get_eval_set() -> list[dict]:
    return load_eval_set()


@router.get("/eval-thresholds")
def get_eval_thresholds() -> dict:
    return load_eval_thresholds()


@router.post("/evaluate")
def run_rag_eval() -> dict:
    return evaluate_rag()


@router.get("/eval-history")
def get_eval_history(limit: int = Query(default=20, ge=1, le=100)) -> list[dict]:
    return eval_history(limit=limit)


@router.get("/provider-governance")
def get_provider_governance() -> dict:
    return provider_governance_status()


@router.get("/pgvector-migration.sql")
def get_pgvector_migration() -> Response:
    return Response(content=pgvector_migration_sql(), media_type="text/plain")
