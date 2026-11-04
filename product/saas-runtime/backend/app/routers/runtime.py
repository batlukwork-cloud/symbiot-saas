from fastapi import APIRouter

from app.schemas import RuntimeEvidence
from app.services.llm_gateway import get_llm_evidence
from app.services.quality_gates import evaluate_task_run
from app.services.rag_index import search
from app.services.task_run_store import list_audit_events_for_target

router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.get("/evidence/{task_run_id}", response_model=RuntimeEvidence)
def get_runtime_evidence(task_run_id: str) -> RuntimeEvidence:
    audit_events = list_audit_events_for_target(task_run_id)
    return RuntimeEvidence(
        task_run_id=task_run_id,
        rag=search(query=f"Runtime evidence {task_run_id}", min_score=0.5),
        llm=get_llm_evidence(task_run_id),
        quality=evaluate_task_run(task_run_id),
        audit_event_ids=[event.id for event in audit_events],
    )
