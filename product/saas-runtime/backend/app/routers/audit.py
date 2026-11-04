from fastapi import APIRouter, Depends

from app.schemas import (
    AuditEvent,
    AuditExportPackage,
    AuditPersistenceStatus,
    AuditRetentionStatus,
    EvidenceAccessAuditEvent,
    EvidenceAccessAuditVerification,
    EvidenceAccessDecision,
    EvidenceAccessModelStatus,
)
from app.services.audit_retention import (
    audit_export_package,
    audit_persistence_status,
    audit_retention_status,
    list_persistent_audit_events,
)
from app.services.evidence_access import (
    decide_evidence_access,
    evidence_access_model_status,
    list_evidence_access_audit,
    require_evidence_access,
    verify_evidence_access_audit_chain,
)
from app.services.security_context import RuntimeSession, require_runtime_session

router = APIRouter(prefix="/audit-events", tags=["audit"])


@router.get("", response_model=list[AuditEvent])
def list_audit_events(session: RuntimeSession = Depends(require_runtime_session)) -> list[AuditEvent]:
    require_evidence_access(session, resource="audit_events", action="view_events")
    return list_persistent_audit_events()


@router.get("/retention-status", response_model=AuditRetentionStatus)
def get_audit_retention_status() -> AuditRetentionStatus:
    return audit_retention_status()


@router.get("/persistence-status", response_model=AuditPersistenceStatus)
def get_audit_persistence_status() -> AuditPersistenceStatus:
    return audit_persistence_status()


@router.get("/access-model-status", response_model=EvidenceAccessModelStatus)
def get_evidence_access_model_status() -> EvidenceAccessModelStatus:
    return evidence_access_model_status()


@router.get("/access-check", response_model=EvidenceAccessDecision)
def get_evidence_access_check(
    resource: str = "audit_export_package",
    action: str = "view_status",
    session: RuntimeSession = Depends(require_runtime_session),
) -> EvidenceAccessDecision:
    return decide_evidence_access(session, resource=resource, action=action)


@router.get("/access-audit", response_model=list[EvidenceAccessAuditEvent])
def get_evidence_access_audit(
    session: RuntimeSession = Depends(require_runtime_session),
) -> list[EvidenceAccessAuditEvent]:
    require_evidence_access(session, resource="release_evidence", action="view_events")
    return list_evidence_access_audit()


@router.get("/access-audit/verify", response_model=EvidenceAccessAuditVerification)
def get_evidence_access_audit_verification() -> EvidenceAccessAuditVerification:
    return verify_evidence_access_audit_chain()


@router.get("/export-package", response_model=AuditExportPackage)
def get_audit_export_package(session: RuntimeSession = Depends(require_runtime_session)) -> AuditExportPackage:
    require_evidence_access(session, resource="audit_export_package", action="download_internal_package")
    return audit_export_package(actor=session.actor, tenant_id=session.tenant_id)
