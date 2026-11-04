from fastapi import APIRouter, Depends, Request

from app.services.access_policy import (
    evaluate_access,
    list_access_policies,
    list_policy_audit,
    policy_store_status,
    update_policy,
    validate_access_policy_directory,
    verify_policy_audit_chain,
)
from app.services.identity_provider import identity_provider_status
from app.services.keycloak_bootstrap import keycloak_bootstrap_status
from app.services.keycloak_production_readiness import keycloak_production_readiness_status
from app.services.role_directory import load_role_directory, role_directory_coverage, role_directory_status
from app.services.role_directory import (
    list_role_directory_audit,
    role_directory_admin_status,
    update_runtime_role,
    verify_role_directory_audit_chain,
)
from app.services.security_context import RuntimeSession, require_runtime_session, security_status

router = APIRouter(prefix="/security", tags=["security"])


@router.get("/status")
def get_security_status() -> dict[str, object]:
    return security_status()


@router.get("/identity-provider/status")
def get_identity_provider_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return identity_provider_status()


@router.get("/identity-provider/keycloak-bootstrap")
def get_keycloak_bootstrap_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return keycloak_bootstrap_status()


@router.get("/identity-provider/production-readiness")
def get_keycloak_production_readiness_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return keycloak_production_readiness_status()


@router.get("/session-check")
def check_session(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return {
        "authenticated": True,
        "actor": session.actor,
        "role": session.role,
        "department": session.department,
        "access_level": session.access_level,
        "tenant_id": session.tenant_id,
        "session_id": session.session_id,
        "auth_source": session.auth_source,
    }


@router.get("/headers-evidence")
def get_headers_evidence(request: Request, session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return {
        "authenticated": True,
        "tenant_id": session.tenant_id,
        "actor": session.actor,
        "secrets_redacted": True,
        "received_headers": {
            "authorization": "[redacted]" if request.headers.get("authorization") else None,
            "x-symbiot-session": "[redacted]" if request.headers.get("x-symbiot-session") else None,
            "x-tenant-id": request.headers.get("x-tenant-id"),
            "x-actor": request.headers.get("x-actor"),
            "x-role": request.headers.get("x-role"),
            "x-department": request.headers.get("x-department"),
            "x-access-level": request.headers.get("x-access-level"),
        },
    }


@router.get("/access-policies")
def get_access_policies(session: RuntimeSession = Depends(require_runtime_session)) -> list[dict[str, object]]:
    return list_access_policies()


@router.get("/access-policy-store-status")
def get_access_policy_store_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return policy_store_status()


@router.get("/role-directory/status")
def get_role_directory_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return role_directory_status()


@router.get("/role-directory/coverage")
def get_role_directory_coverage(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return role_directory_coverage()


@router.get("/role-directory/admin-status")
def get_role_directory_admin_status(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return role_directory_admin_status()


@router.get("/role-directory/audit")
def get_role_directory_audit(
    runtime_role: str | None = None,
    session: RuntimeSession = Depends(require_runtime_session),
) -> list[dict[str, object]]:
    return list_role_directory_audit(runtime_role=runtime_role)


@router.get("/role-directory/audit/verify")
def get_role_directory_audit_verification(
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return verify_role_directory_audit_chain()


@router.patch("/role-directory/roles/{runtime_role}")
def patch_runtime_role(
    runtime_role: str,
    payload: dict[str, object],
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return update_runtime_role(runtime_role, payload, session)


@router.get("/role-directory")
def get_role_directory(session: RuntimeSession = Depends(require_runtime_session)) -> dict[str, object]:
    return load_role_directory()


@router.get("/access-policy-directory-validation")
def get_access_policy_directory_validation(
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return validate_access_policy_directory()


@router.post("/access-policies/{process_id}")
def update_access_policy(
    process_id: str,
    payload: dict[str, object],
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return update_policy(process_id, payload, session)


@router.get("/access-policy-audit")
def get_access_policy_audit(
    process_id: str | None = None,
    session: RuntimeSession = Depends(require_runtime_session),
) -> list[dict[str, object]]:
    return list_policy_audit(process_id=process_id)


@router.get("/access-policy-audit/verify")
def get_access_policy_audit_verification(
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return verify_policy_audit_chain()


@router.get("/access-check")
def get_access_check(
    process_id: str,
    action: str = "view",
    session: RuntimeSession = Depends(require_runtime_session),
) -> dict[str, object]:
    return evaluate_access(process_id, action, session)
