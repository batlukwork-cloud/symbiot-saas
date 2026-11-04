from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.services.identity_provider import identity_provider_mode, validate_oidc_jwt


DEMO_SESSION_TOKEN = os.getenv("SYMBIOT_DEMO_SESSION_TOKEN", "symbiot-demo-session-token")
DEMO_TENANT_ID = os.getenv("SYMBIOT_DEMO_TENANT_ID", "tenant:demo")

PUBLIC_API_PATHS = {"/api/security/status"}


@dataclass(frozen=True)
class RuntimeSession:
    actor: str
    role: str
    department: str
    access_level: str
    tenant_id: str
    session_id: str
    auth_source: str


def is_public_path(path: str) -> bool:
    return path == "/health" or path in PUBLIC_API_PATHS


def require_runtime_session(request: Request) -> RuntimeSession:
    mode = identity_provider_mode()
    if mode in {"oidc", "oidc_jwt"}:
        return _require_oidc_session(request)
    if mode != "demo_headers":
        raise HTTPException(status_code=503, detail=f"Unsupported identity provider mode: {mode}.")

    return _require_demo_session(request)


def _require_demo_session(request: Request) -> RuntimeSession:
    token = request.headers.get("x-symbiot-session")
    tenant_id = request.headers.get("x-tenant-id")

    if token != DEMO_SESSION_TOKEN:
        raise HTTPException(status_code=401, detail="Missing or invalid Symbiot session token.")
    if tenant_id != DEMO_TENANT_ID:
        raise HTTPException(status_code=403, detail="Tenant scope is missing or not allowed for this session.")

    return RuntimeSession(
        actor=request.headers.get("x-actor", "demo-user"),
        role=request.headers.get("x-role", "runtime-operator"),
        department=request.headers.get("x-department", "sales"),
        access_level=request.headers.get("x-access-level", "standard"),
        tenant_id=tenant_id,
        session_id="session-demo-001",
        auth_source="demo_headers",
    )


def _claim_list_value(value: object) -> str:
    if isinstance(value, list) and value:
        return str(value[0])
    if isinstance(value, str):
        return value
    raise HTTPException(status_code=401, detail="OIDC role claim is empty or unsupported.")


def _require_oidc_session(request: Request) -> RuntimeSession:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing OIDC bearer token.")

    token = authorization.split(" ", 1)[1].strip()
    claims = validate_oidc_jwt(token)
    tenant_id = str(claims["tenant_id"])
    requested_tenant = request.headers.get("x-tenant-id")
    if requested_tenant and requested_tenant != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant header does not match OIDC token tenant.")

    return RuntimeSession(
        actor=str(claims.get("email") or claims["sub"]),
        role=_claim_list_value(claims.get("roles")),
        department=str(claims.get("department") or "unassigned"),
        access_level=str(claims["access_level"]),
        tenant_id=tenant_id,
        session_id=str(claims.get("jti") or claims["sub"]),
        auth_source="oidc_jwt",
    )


def assert_scope_allowed(access_scope: str, session: RuntimeSession) -> None:
    if access_scope != session.tenant_id:
        raise HTTPException(
            status_code=403,
            detail=f"Access scope {access_scope} does not match session tenant {session.tenant_id}.",
        )


def security_status() -> dict[str, object]:
    mode = identity_provider_mode()
    return {
        "mode": "oidc-jwt-middleware" if mode in {"oidc", "oidc_jwt"} else "demo-session-middleware",
        "identity_provider_mode": mode,
        "auth_required_for_api": True,
        "public_paths": sorted(PUBLIC_API_PATHS | {"/health"}),
        "tenant_isolation_required": True,
        "demo_tenant": DEMO_TENANT_ID,
        "authorization_header": "Bearer <JWT>" if mode in {"oidc", "oidc_jwt"} else None,
        "session_header": "x-symbiot-session",
        "tenant_header": "x-tenant-id",
        "role_header": "x-role",
        "department_header": "x-department",
        "access_level_header": "x-access-level",
        "token_redacted": True,
        "asvs_controls": ["ASVS V2 Authentication", "ASVS V3 Session", "ASVS V4 Access Control", "ASVS V10 Logging"],
    }
