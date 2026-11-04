from fastapi import APIRouter

from app.schemas import LlmProviderConfig
from app.services.llm_gateway import list_providers

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/llm-providers", response_model=list[LlmProviderConfig])
def list_llm_providers() -> list[LlmProviderConfig]:
    return list_providers()
