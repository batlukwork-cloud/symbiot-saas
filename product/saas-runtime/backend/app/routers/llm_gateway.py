from fastapi import APIRouter, Query

from app.schemas import LlmGatewayEvidence
from app.services.llm_gateway import get_llm_evidence as build_llm_evidence

router = APIRouter(prefix="/llm-gateway", tags=["llm-gateway"])


@router.get("/evidence/{task_run_id}", response_model=LlmGatewayEvidence)
def get_llm_evidence(task_run_id: str, provider_id: str = Query(default="mock-provider")) -> LlmGatewayEvidence:
    return build_llm_evidence(task_run_id, provider_id)
