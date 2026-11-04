from __future__ import annotations

import json
import os
from pathlib import Path

from app.schemas import GateResult
from app.services.idp_url_policy import is_production_https_url


ROOT = Path(__file__).resolve().parents[3]
REALM_IMPORT_PATH = ROOT / "config" / "keycloak" / "symbiot-realm.json"
EXPECTED_REALM = os.getenv("SYMBIOT_KEYCLOAK_REALM", "symbiot").strip() or "symbiot"
EXPECTED_CLIENT_ID = os.getenv("SYMBIOT_OIDC_CLIENT_ID", "symbiot-runtime").strip() or "symbiot-runtime"
REQUIRED_RUNTIME_ROLES = {"admin", "runtime-operator", "qa-lead", "role-admin", "observer"}
REQUIRED_CLAIMS = {"tenant_id", "roles", "access_level"}


def _load_realm_import() -> dict[str, object]:
    if not REALM_IMPORT_PATH.exists():
        return {}
    return json.loads(REALM_IMPORT_PATH.read_text(encoding="utf-8"))


def _realm_roles(realm_import: dict[str, object]) -> set[str]:
    roles = realm_import.get("roles", {})
    if not isinstance(roles, dict):
        return set()
    realm_roles = roles.get("realm", [])
    if not isinstance(realm_roles, list):
        return set()
    return {str(role.get("name")) for role in realm_roles if isinstance(role, dict) and role.get("name")}


def _runtime_client(realm_import: dict[str, object]) -> dict[str, object]:
    clients = realm_import.get("clients", [])
    if not isinstance(clients, list):
        return {}
    for client in clients:
        if isinstance(client, dict) and client.get("clientId") == EXPECTED_CLIENT_ID:
            return client
    return {}


def _mapper_claims(client: dict[str, object]) -> set[str]:
    mappers = client.get("protocolMappers", [])
    if not isinstance(mappers, list):
        return set()
    claims: set[str] = set()
    for mapper in mappers:
        if not isinstance(mapper, dict):
            continue
        config = mapper.get("config", {})
        if isinstance(config, dict) and config.get("claim.name"):
            claims.add(str(config["claim.name"]))
    return claims


def _bootstrap_users(realm_import: dict[str, object]) -> list[str]:
    users = realm_import.get("users", [])
    if not isinstance(users, list):
        return []
    return [str(user.get("username")) for user in users if isinstance(user, dict) and user.get("username")]


def keycloak_bootstrap_status() -> dict[str, object]:
    realm_import = _load_realm_import()
    client = _runtime_client(realm_import)
    roles = _realm_roles(realm_import)
    claims = _mapper_claims(client)
    users = _bootstrap_users(realm_import)
    issuer = os.getenv("SYMBIOT_OIDC_ISSUER", "").strip()
    jwks_url = os.getenv("SYMBIOT_OIDC_JWKS_URL", "").strip()

    realm_ready = realm_import.get("realm") == EXPECTED_REALM and bool(realm_import.get("enabled", False))
    client_ready = bool(client) and client.get("protocol") == "openid-connect" and bool(client.get("enabled", False))
    roles_ready = REQUIRED_RUNTIME_ROLES.issubset(roles)
    claims_ready = REQUIRED_CLAIMS.issubset(claims)
    users_ready = {"symbiot-admin", "symbiot-operator", "symbiot-qa"}.issubset(set(users))
    bootstrap_package_ready = realm_ready and client_ready and roles_ready and claims_ready and users_ready
    production_endpoint_ready = is_production_https_url(issuer) and is_production_https_url(jwks_url)

    return {
        "provider": "keycloak",
        "realm": EXPECTED_REALM,
        "client_id": EXPECTED_CLIENT_ID,
        "realm_import_path": str(REALM_IMPORT_PATH),
        "realm_import_exists": REALM_IMPORT_PATH.exists(),
        "realm_ready": realm_ready,
        "client_ready": client_ready,
        "roles_ready": roles_ready,
        "claims_ready": claims_ready,
        "bootstrap_users_ready": users_ready,
        "bootstrap_package_ready": bootstrap_package_ready,
        "production_endpoint_ready": production_endpoint_ready,
        "roles_expected": sorted(REQUIRED_RUNTIME_ROLES),
        "roles_found": sorted(roles),
        "claims_expected": sorted(REQUIRED_CLAIMS),
        "claims_found": sorted(claims),
        "bootstrap_users": users,
        "import_command": (
            "docker compose --profile idp up keycloak, then import "
            "config/keycloak/symbiot-realm.json into the Keycloak admin console "
            "or use kcadm.sh in the production runbook."
        ),
        "stop_condition": (
            "Keycloak realm bootstrap package is ready; production SSO still needs HTTPS issuer/JWKS and real client secret."
            if bootstrap_package_ready and not production_endpoint_ready
            else "Keycloak realm bootstrap package or production HTTPS endpoint is not ready."
        ),
        "gates": [
            GateResult(
                id="gate-keycloak-realm-bootstrap",
                title="Keycloak Realm Bootstrap Gate",
                status="passed" if bootstrap_package_ready else "warning",
                reason=(
                    "Realm import package includes enabled realm, runtime client, required roles, claims and disabled bootstrap users."
                    if bootstrap_package_ready
                    else "Realm import package is missing required realm/client/role/claim/user bootstrap elements."
                ),
                action=None if bootstrap_package_ready else "Complete Keycloak realm import package before production IdP setup.",
            ),
            GateResult(
                id="gate-production-idp-remote-jwks",
                title="Production IdP Remote JWKS Gate",
                status="passed" if production_endpoint_ready else "warning",
                reason=(
                    "OIDC issuer and JWKS URL are HTTPS production endpoints."
                    if production_endpoint_ready
                    else "OIDC issuer/JWKS are not production HTTPS endpoints yet."
                ),
                action=None if production_endpoint_ready else "Configure real HTTPS Keycloak issuer and JWKS URL.",
            ),
        ],
    }
