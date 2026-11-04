from __future__ import annotations

import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.schemas import GateResult
from app.services.idp_url_policy import classify_https_production_url, is_production_https_url
from app.services.keycloak_bootstrap import keycloak_bootstrap_status


def _configured(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _fetch_jwks_status(jwks_url: str) -> dict[str, object]:
    if not is_production_https_url(jwks_url):
        return {
            "reachable": False,
            "http_status": None,
            "keys_total": 0,
            "error": "jwks_url_is_not_production_https",
        }
    try:
        request = Request(jwks_url, headers={"Accept": "application/json", "User-Agent": "symbiot-runtime-readiness/0.1"})
        with urlopen(request, timeout=5) as response:  # noqa: S310 - URL is policy-checked first.
            body = response.read(512_000)
            payload = json.loads(body.decode("utf-8"))
            keys = payload.get("keys", [])
            return {
                "reachable": True,
                "http_status": response.status,
                "keys_total": len(keys) if isinstance(keys, list) else 0,
                "error": None,
            }
    except (OSError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {
            "reachable": False,
            "http_status": None,
            "keys_total": 0,
            "error": exc.__class__.__name__,
        }


def keycloak_production_readiness_status() -> dict[str, object]:
    issuer = os.getenv("SYMBIOT_OIDC_ISSUER", "").strip()
    jwks_url = os.getenv("SYMBIOT_OIDC_JWKS_URL", "").strip()
    client_id = os.getenv("SYMBIOT_OIDC_CLIENT_ID", "").strip()
    audience = os.getenv("SYMBIOT_OIDC_AUDIENCE", "").strip() or client_id
    mode = os.getenv("SYMBIOT_IDENTITY_PROVIDER_MODE", "demo_headers").strip() or "demo_headers"
    provider = os.getenv("SYMBIOT_OIDC_PROVIDER", "keycloak").strip() or "keycloak"

    issuer_policy = classify_https_production_url(issuer)
    jwks_policy = classify_https_production_url(jwks_url)
    bootstrap = keycloak_bootstrap_status()
    jwks_live = _fetch_jwks_status(jwks_url)

    required_env_ready = all(
        [
            mode == "oidc_jwt",
            provider == "keycloak",
            bool(client_id),
            bool(audience),
            bool(issuer_policy["production_like"]),
            bool(jwks_policy["production_like"]),
            not _configured("SYMBIOT_OIDC_JWKS_JSON"),
        ]
    )
    live_jwks_ready = bool(jwks_live["reachable"]) and int(jwks_live["keys_total"]) > 0
    production_endpoint_ready = bool(bootstrap["bootstrap_package_ready"]) and required_env_ready and live_jwks_ready

    return {
        "provider": provider,
        "mode": mode,
        "issuer": issuer,
        "jwks_url": jwks_url,
        "client_id_configured": bool(client_id),
        "audience_configured": bool(audience),
        "inline_jwks_disabled": not _configured("SYMBIOT_OIDC_JWKS_JSON"),
        "issuer_policy": issuer_policy,
        "jwks_policy": jwks_policy,
        "jwks_live": jwks_live,
        "bootstrap_package_ready": bool(bootstrap["bootstrap_package_ready"]),
        "required_env_ready": required_env_ready,
        "live_jwks_ready": live_jwks_ready,
        "production_endpoint_ready": production_endpoint_ready,
        "stop_condition": (
            "Production HTTPS Keycloak endpoint is reachable and can be used for OIDC/JWT validation."
            if production_endpoint_ready
            else "Production endpoint is not ready until mode=oidc_jwt, HTTPS issuer/JWKS, real remote JWKS keys and bootstrap package are all verified."
        ),
        "gates": [
            GateResult(
                id="gate-keycloak-production-endpoint",
                title="Keycloak Production HTTPS Endpoint Gate",
                status="passed" if production_endpoint_ready else "warning",
                reason=(
                    "Production HTTPS Keycloak issuer/JWKS are configured and live JWKS keys are reachable."
                    if production_endpoint_ready
                    else "Production HTTPS Keycloak issuer/JWKS are not fully configured or live JWKS is not reachable."
                ),
                action=None if production_endpoint_ready else "Deploy Keycloak behind HTTPS, configure issuer/JWKS env vars and verify live JWKS keys.",
            ),
            GateResult(
                id="gate-keycloak-realm-bootstrap",
                title="Keycloak Realm Bootstrap Gate",
                status="passed" if bootstrap["bootstrap_package_ready"] else "warning",
                reason=(
                    "Realm bootstrap package is ready."
                    if bootstrap["bootstrap_package_ready"]
                    else "Realm bootstrap package is not ready."
                ),
            ),
        ],
    }
