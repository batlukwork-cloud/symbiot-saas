from fastapi import APIRouter

from app.schemas import QualityEvidence, QualityGateDefinition
from app.services.quality_gates import evaluate_task_run, list_gate_catalog

router = APIRouter(prefix="/quality", tags=["quality"])


@router.get("/gates", response_model=list[QualityGateDefinition])
def list_gates() -> list[QualityGateDefinition]:
    return list_gate_catalog()


@router.get("/evidence/{task_run_id}", response_model=QualityEvidence)
def get_quality_evidence(task_run_id: str) -> QualityEvidence:
    return evaluate_task_run(task_run_id)
