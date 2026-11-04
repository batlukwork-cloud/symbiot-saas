# ADR-003 Production IdP: Keycloak + Remote JWKS

Status: accepted as baseline provider
Date: 2026-07-02
Gate: G3 Core Integration

## Context

`ENG-SaaS-0028` added executable JWT validation. The next decision is which production identity provider becomes the baseline for Runtime authentication.

The Runtime must support:

- OIDC/OAuth2 JWT;
- remote JWKS URL;
- tenant and role claims;
- admin and critical API protection;
- self-hosted deployment option;
- auditable configuration.

## Decision

Use Keycloak as the baseline production identity provider for Symbiot Runtime MVP.

Reasons:

- Keycloak is open source and self-hostable;
- it supports OpenID Connect/OAuth2 and SAML;
- it exposes realm public keys as JWKS through the standard realm certificate endpoint;
- it can be deployed in containers and later moved to a hardened production topology;
- it avoids making the MVP dependent on a foreign SaaS identity vendor.

Official reference points:

- OIDC certs/JWKS endpoint: `https://www.keycloak.org/securing-apps/oidc-layers`
- Container guidance: `https://www.keycloak.org/server/containers`
- Hostname production guidance: `https://www.keycloak.org/server/hostname`

## Runtime Configuration

Baseline variables:

```text
SYMBIOT_IDENTITY_PROVIDER_MODE=oidc_jwt
SYMBIOT_OIDC_PROVIDER=keycloak
SYMBIOT_OIDC_ISSUER=https://idp.example.ru/realms/symbiot
SYMBIOT_OIDC_CLIENT_ID=symbiot-runtime
SYMBIOT_OIDC_AUDIENCE=symbiot-runtime
SYMBIOT_OIDC_JWKS_URL=https://idp.example.ru/realms/symbiot/protocol/openid-connect/certs
```

Local evidence can use a temporary remote JWKS URL served from localhost. Production/client pilot must use a real remote JWKS URL over HTTPS.

## Required Keycloak Realm

Realm: `symbiot`

Client: `symbiot-runtime`

Required token claims:

- `sub`;
- `email`;
- `tenant_id`;
- `roles`;
- `department`;
- `access_level`.

## Stop Conditions

Client pilot is blocked until:

- Keycloak production hostname is configured;
- TLS is configured;
- remote JWKS URL is reachable from Runtime;
- issuer and audience match Runtime config;
- valid token, invalid token, wrong audience and tenant mismatch checks pass;
- admin users and role mappers are configured;
- backup and admin recovery procedure exists.

## Consequences

Positive:

- Runtime has a concrete IdP target;
- JWT validation is tied to a real OIDC provider shape;
- deployment can remain self-controlled.

Risks:

- production Keycloak needs DevOps ownership;
- `start-dev` is not production mode;
- claims mapping must be configured carefully or authorization will fail.

## Evidence

`ENG-SaaS-0029` captures remote JWKS validation evidence. The local evidence server imitates the Keycloak JWKS endpoint shape; production remains open until a real Keycloak instance is deployed.
