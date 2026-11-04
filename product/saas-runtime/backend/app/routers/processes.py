from fastapi import APIRouter, Depends

from app.schemas import ProcessCard
from app.services.mock_store import PROCESSES
from app.services.access_policy import evaluate_access, require_process_access
from app.services.security_context import RuntimeSession, require_runtime_session

router = APIRouter(prefix="/processes", tags=["processes"])


@router.get("", response_model=list[ProcessCard])
def list_processes(session: RuntimeSession = Depends(require_runtime_session)) -> list[ProcessCard]:
    return [
        process
        for process in PROCESSES
        if evaluate_access(process.id, "view", session)["allowed"]
    ]


@router.get("/{process_id}", response_model=ProcessCard)
def get_process(process_id: str, session: RuntimeSession = Depends(require_runtime_session)) -> ProcessCard:
    require_process_access(process_id, "view", session)
    return next(process for process in PROCESSES if process.id == process_id)
