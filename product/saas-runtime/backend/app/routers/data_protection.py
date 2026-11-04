from fastapi import APIRouter, Depends

from app.schemas import (
    DataProtectionStatus,
    ExportDecision,
    ExportRequest,
    HumanApprovalDecisionRequest,
    HumanApprovalRecord,
    ApprovalCreateRequest,
    PiiClassificationEvidence,
    PiiClassificationRequest,
)
from app.services.data_protection import (
    approve_request,
    classify_text,
    create_approval,
    data_protection_status,
    decide_export,
)
from app.services.security_context import RuntimeSession, assert_scope_allowed, require_runtime_session

router = APIRouter(prefix="/data-protection", tags=["data-protection"])


@router.get("/status", response_model=DataProtectionStatus)
def get_data_protection_status() -> DataProtectionStatus:
    return DataProtectionStatus(**data_protection_status())


@router.post("/pii/classify", response_model=PiiClassificationEvidence)
def classify_pii(
    request: PiiClassificationRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> PiiClassificationEvidence:
    assert_scope_allowed(request.access_scope, session)
    return classify_text(
        text=request.text,
        artifact_id=request.artifact_id,
        access_scope=request.access_scope,
        purpose=request.purpose,
    )


@router.post("/approvals", response_model=HumanApprovalRecord)
def create_human_approval(request: ApprovalCreateRequest) -> HumanApprovalRecord:
    return create_approval(
        artifact_id=request.artifact_id,
        classification_id=request.classification_id,
        requester=request.requester,
        reviewer=request.reviewer,
        purpose=request.purpose,
    )


@router.post("/approvals/{approval_id}/approve", response_model=HumanApprovalRecord)
def approve_human_request(approval_id: str, request: HumanApprovalDecisionRequest) -> HumanApprovalRecord:
    return approve_request(
        approval_id=approval_id,
        reviewer=request.reviewer,
        decision_comment=request.decision_comment,
    )


@router.post("/exports/check", response_model=ExportDecision)
def check_export(request: ExportRequest) -> ExportDecision:
    return decide_export(
        artifact_id=request.artifact_id,
        classification_id=request.classification_id,
        approval_id=request.approval_id,
        channel=request.channel,
    )
