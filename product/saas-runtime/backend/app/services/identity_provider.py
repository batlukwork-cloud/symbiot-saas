from __future__ import annotations

import json
import os
from fastapi import HTTPException

from app.schemas import GateResult
from app.services.idp_url_policy import is_production_https_url

try:
    import jwt
    from jwt import PyJWKClient
except ImportError:  # pragma: no cover - status endpoint exposes this as not ready
    jwt = None
    PyJWKClient = None


OIDC_MODES = {"oidc", "oidc_jwt"}


def _configured(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def identity_provider_mode() -> str:
    return os.getenv("SYMBIOT_IDENTITY_PROVIDER_MODE", "demo_headers").strip() or "demo_headers"


def _jwks_json_configured() -> bool:
    return _configured("SYMBIOT_OIDC_JWKS_JSON")


def _jwks_source() -> str:
    if _configured("SYMBIOT_OIDC_JWKS_URL"):
        return "remote_jwks_url"
    if _jwks_json_configured():
        return "inline_jwks_json"
    return "not_configured"


def _oidc_audience() -> str:
    return os.getenv("SYMBIOT_OIDC_AUDIENCE", "").strip() or os.getenv("SYMBIOT_OIDC_CLIENT_ID", "").strip()


def _is_production_jwks_url() -> bool:
    return is_production_https_url(os.getenv("SYMBIOT_OIDC_JWKS_URL", "").strip())


def _get_signing_key(token: str):
    if jwt is None:
        raise HTTPException(status_code=503, detail="JWT validation dependency is not installed.")

    if _jwks_json_configured():
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            jwks = json.loads(os.getenv("SYMBIOT_OIDC_JWKS_JSON", "{}"))
            for jwk in jwks.get("keys", []):
                if kid is None or jwk.get("kid") == kid:
                    return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
        except Exception as exc:  # noqa: BLE001 - security error is intentionally generic to callers
            raise HTTPException(status_code=401, detail="Invalid OIDC signing key.") from exc
        raise HTTPException(status_code=401, detail="OIDC signing key was not found in JWKS.")

    jwks_url = os.getenv("SYMBIOT_OIDC_JWKS_URL", "").strip()
    if not jwks_url:
        raise HTTPException(status_code=503, detail="OIDC JWKS source is not configured.")
    try:
        return PyJWKClient(jwks_url).get_signing_key_from_jwt(token).key
    except Exception as exc:  # noqa: BLE001 - security error is intentionally generic to callers
        raise HTTPException(status_code=401, detail="OIDC signing key could not be resolved.") from exc


def validate_oidc_jwt(token: str) -> dict[str, object]:
    issuer = os.getenv("SYMBIOT_OIDC_ISSUER", "").strip()
    audience = _oidc_audience()
    if not issuer or not audience:
        raise HTTPException(status_code=503, detail="OIDC issuer and audience/client id must be configured.")

    try:
        claims = jwt.decode(
            token,
            key=_get_signing_key(token),
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iat", "sub", "tenant_id", "roles", "access_level"]},
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - do not leak token validation internals
        raise HTTPException(status_code=401, detail="Invalid OIDC bearer token.") from exc

    missing = [claim for claim in ("sub", "tenant_id", "roles", "access_level") if not claims.get(claim)]
    if missing:
        raise HTTPException(status_code=401, detail=f"OIDC token is missing required claims: {', '.join(missing)}")
    return claims


def identity_provider_status() -> dict[str, object]:
    mode = identity_provider_mode()
    provider = os.getenv("SYMBIOT_OIDC_PROVIDER", "keycloak").strip() or "keycloak"
    oidc_configured = mode in OIDC_MODES and all(
        _configured(name)
        for name in ("SYMBIOT_OIDC_ISSUER", "SYMBIOT_OIDC_CLIENT_ID")
    )
    jwks_configured = _configured("SYMBIOT_OIDC_JWKS_URL") or _jwks_json_configured()
    verified_jwt_validation_ready = bool(jwt) and oidc_configured and jwks_configured
    remote_jwks_validation_ready = bool(jwt) and oidc_configured and _configured("SYMBIOT_OIDC_JWKS_URL")
    production_sso_ready = remote_jwks_validation_ready and _is_production_jwks_url()
    stop_condition = (
        "Production SSO is configured through remote JWKS and can replace demo headers."
        if production_sso_ready
        else "Client pilot is blocked until OIDC issuer, client id, JWKS URL and JWT validation evidence are configured and verified."
    )

    return {
        "mode": mode,
        "provider": provider,
        "target_protocol": "OIDC/OAuth2 JWT",
        "demo_headers_enabled": mode == "demo_headers",
        "jwt_dependency_available": bool(jwt),
        "jwks_source": _jwks_source(),
        "verified_jwt_validation_ready": verified_jwt_validation_ready,
        "remote_jwks_validation_ready": remote_jwks_validation_ready,
        "production_sso_ready": production_sso_ready,
        "configured_fields": {
            "SYMBIOT_IDENTITY_PROVIDER_MODE": bool(mode),
            "SYMBIOT_OIDC_PROVIDER": bool(provider),
            "SYMBIOT_OIDC_ISSUER": _configured("SYMBIOT_OIDC_ISSUER"),
            "SYMBIOT_OIDC_CLIENT_ID": _configured("SYMBIOT_OIDC_CLIENT_ID"),
            "SYMBIOT_OIDC_JWKS_URL": _configured("SYMBIOT_OIDC_JWKS_URL"),
            "SYMBIOT_OIDC_JWKS_JSON": _jwks_json_configured(),
            "SYMBIOT_OIDC_AUDIENCE": _configured("SYMBIOT_OIDC_AUDIENCE"),
        },
        "required_claims": ["sub", "email", "tenant_id", "roles", "access_level"],
        "mapped_runtime_headers": {
            "sub": "x-actor",
            "tenant_id": "x-tenant-id",
            "roles": "x-role",
            "department": "x-department",
            "access_level": "x-access-level",
        },
        "asvs_controls": [
            "ASVS V2 Authentication",
            "ASVS V3 Session Management",
            "ASVS V4 Access Control",
            "ASVS V10 Logging",
        ],
        "nist_controls": ["NIST AI RMF Govern", "NIST AI RMF Map", "NIST AI RMF Manage"],
        "stop_condition": stop_condition,
        "gates": [
            GateResult(
                id="gate-production-idp-remote-jwks",
                title="Production IdP Remote JWKS Gate",
                status="passed" if remote_jwks_validation_ready else "warning",
                reason=(
                    f"Provider {provider} is configured with remote JWKS URL and verified JWT validation inputs."
                    if remote_jwks_validation_ready
                    else f"Provider {provider} is selected, but remote JWKS URL validation is not fully configured."
                ),
                action=None if remote_jwks_validation_ready else "Configure remote Keycloak issuer/client/JWKS URL and validate token evidence.",
            ),
            GateResult(
                id="gate-verified-oidc-jwt-validation",
                title="Verified OIDC/JWT Validation Gate",
                status="passed" if verified_jwt_validation_ready else "warning",
                reason=(
                    "JWT validation dependency, issuer, audience/client id and JWKS source are configured."
                    if verified_jwt_validation_ready
                    else "JWT validation cannot run until OIDC issuer, client id and JWKS source are configured."
                ),
                action=None if verified_jwt_validation_ready else "Configure OIDC/JWT validation inputs before SSO mode.",
            ),
            GateResult(
                id="gate-production-iam-sso-design",
                title="Production IAM/SSO Design Gate",
                status="passed" if production_sso_ready else "warning",
                reason=(
                    "Remote OIDC/JWT identity provider fields are configured."
                    if production_sso_ready
                    else "Current runtime is not connected to a production remote OIDC/JWT provider."
                ),
                action=None if production_sso_ready else "Configure remote OIDC/JWT provider before any client-data pilot.",
            )
        ],
    }
