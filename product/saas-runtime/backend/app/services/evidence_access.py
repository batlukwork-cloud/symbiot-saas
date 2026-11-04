from __future__ import annotations

import json
from datetime import UTC, datetime
from hashlib import sha256

from fastapi import HTTPException

from app.schemas import (
    EvidenceAccessAuditEvent,
    EvidenceAccessAuditVerification,
    EvidenceAccessDecision,
    EvidenceAccessModelStatus,
    GateResult,
)
from app.services.audit_retention import GENESIS_HASH, audit_persistence_status
from app.services.role_directory import get_role, role_exists, roles_with_permission
from app.services.security_context import DEMO_TENANT_ID, RuntimeSession
from app.services.sqlite_store import get_connection, init_store

POLICY_VERSION = "evidence-access-policy-v0.2-role-directory-permissions"


def _view_roles() -> list[str]:
    return roles_with_permission("evidence.view")


def _package_roles() -> list[str]:
    return roles_with_permission("evidence.package")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _hash_payload(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()


def _init_store() -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists evidence_access_audit (
                id text primary key,
                actor text not null,
                role text not null,
                tenant_id text not null,
                resource text not null,
                action text not null,
                status text not null,
                reason text not null,
                created_at text not null,
                previous_hash text,
                event_hash text
            )
            """
        )
        _backfill_hash_chain(connection)


def _next_event_id(connection) -> str:
    count = connection.execute("select count(*) from evidence_access_audit").fetchone()[0]
    return f"evidence-access-{count + 1:04d}"


def _latest_hash(connection) -> str:
    row = connection.execute(
        "select event_hash from evidence_access_audit where event_hash is not null order by id desc limit 1"
    ).fetchone()
    return row["event_hash"] if row and row["event_hash"] else GENESIS_HASH


def _hash_event_payload(row: dict[str, object], previous_hash: str) -> dict[str, object]:
    return {
        "id": row["id"],
        "actor": row["actor"],
        "role": row["role"],
        "tenant_id": row["tenant_id"],
        "resource": row["resource"],
        "action": row["action"],
        "status": row["status"],
        "reason": row["reason"],
        "created_at": row["created_at"],
        "previous_hash": previous_hash,
    }


def _insert_access_audit(decision: EvidenceAccessDecision) -> None:
    _init_store()
    with get_connection() as connection:
        event_id = _next_event_id(connection)
        created_at = _now()
        previous_hash = _latest_hash(connection)
        row = {
            "id": event_id,
            "actor": decision.actor,
            "role": decision.role,
            "tenant_id": decision.tenant_id,
            "resource": decision.resource,
            "action": decision.action,
            "status": decision.status,
            "reason": decision.reason,
            "created_at": created_at,
        }
        event_hash = _hash_payload(_hash_event_payload(row, previous_hash))
        connection.execute(
            """
            insert into evidence_access_audit(
                id, actor, role, tenant_id, resource, action, status, reason, created_at, previous_hash, event_hash
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                decision.actor,
                decision.role,
                decision.tenant_id,
                decision.resource,
                decision.action,
                decision.status,
                decision.reason,
                created_at,
                previous_hash,
                event_hash,
            ),
        )


def _backfill_hash_chain(connection) -> None:
    previous_hash = GENESIS_HASH
    rows = connection.execute("select * from evidence_access_audit order by id").fetchall()
    for row in rows:
        payload = {
            "id": row["id"],
            "actor": row["actor"],
            "role": row["role"],
            "tenant_id": row["tenant_id"],
            "resource": row["resource"],
            "action": row["action"],
            "status": row["status"],
            "reason": row["reason"],
            "created_at": row["created_at"],
        }
        expected_hash = _hash_payload(_hash_event_payload(payload, previous_hash))
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected_hash:
            connection.execute(
                "update evidence_access_audit set previous_hash = ?, event_hash = ? where id = ?",
                (previous_hash, expected_hash, row["id"]),
            )
        previous_hash = expected_hash


def _decision_gates(allowed: bool, action: str) -> list[GateResult]:
    return [
        GateResult(
            id="gate-evidence-access-policy",
            title="Evidence Access Policy Gate",
            status="passed" if allowed else "failed",
            reason=(
                "Evidence access is allowed by role, tenant and action policy."
                if allowed
                else "Evidence access is blocked by role, tenant or action policy."
            ),
            action=None if allowed else "Use an approved evidence role or request Dmitry approval.",
        ),
        GateResult(
            id="gate-evidence-access-audit",
            title="Evidence Access Audit Gate",
            status="passed",
            reason=f"Evidence access decision for `{action}` is recorded in persistent audit.",
        ),
    ]


def decide_evidence_access(
    session: RuntimeSession,
    resource: str = "audit_export_package",
    action: str = "view_status",
    record: bool = True,
) -> EvidenceAccessDecision:
    persistence = audit_persistence_status()
    role_known = role_exists(session.role)
    tenant_ok = session.tenant_id == DEMO_TENANT_ID
    view_roles = _view_roles()
    package_roles = _package_roles()
    view_allowed = session.role in view_roles
    package_allowed = session.role in package_roles
    external_blocked = action == "external_export"

    if action in {"view_status", "view_events"}:
        action_allowed = view_allowed
    elif action == "download_internal_package":
        action_allowed = package_allowed
    else:
        action_allowed = False

    allowed = role_known and tenant_ok and action_allowed and not external_blocked
    if not role_known:
        reason = "Runtime role is absent from Symbiot role directory."
    elif not tenant_ok:
        reason = "Tenant is outside the allowed evidence scope."
    elif external_blocked:
        reason = "External evidence export is blocked until explicit approval."
    elif not action_allowed:
        reason = "Role is not allowed to perform this evidence action."
    else:
        reason = "Evidence access granted by MVP evidence access policy."

    checks = [
        GateResult(
            id="evidence-role-directory",
            title="Evidence role directory check",
            status="passed" if role_known else "failed",
            reason=f"Runtime role `{session.role}` is {'known' if role_known else 'unknown'}.",
        ),
        GateResult(
            id="evidence-tenant-scope",
            title="Evidence tenant scope check",
            status="passed" if tenant_ok else "failed",
            reason=f"Evidence tenant scope is `{session.tenant_id}`.",
        ),
        GateResult(
            id="evidence-action-policy",
            title="Evidence action policy check",
            status="passed" if action_allowed and not external_blocked else "failed",
            reason=f"Action `{action}` is {'allowed' if action_allowed and not external_blocked else 'blocked'} for role `{session.role}`.",
        ),
    ]
    decision = EvidenceAccessDecision(
        id=f"evidence-access-{_hash_payload({'actor': session.actor, 'role': session.role, 'resource': resource, 'action': action})[:12]}",
        actor=session.actor,
        role=session.role,
        tenant_id=session.tenant_id,
        resource=resource,  # type: ignore[arg-type]
        action=action,  # type: ignore[arg-type]
        allowed=allowed,
        status="allowed" if allowed else "blocked",
        reason=reason,
        role_directory_ref=get_role(session.role),
        retention_schedule_status=persistence.retention_schedule_status,
        external_export_allowed=False,
        package_access_allowed=package_allowed,
        checks=checks + _decision_gates(allowed, action),
    )
    if record:
        _insert_access_audit(decision)
    return decision


def require_evidence_access(session: RuntimeSession, resource: str, action: str) -> EvidenceAccessDecision:
    decision = decide_evidence_access(session, resource=resource, action=action, record=True)
    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.model_dump())
    return decision


def evidence_access_model_status() -> EvidenceAccessModelStatus:
    _init_store()
    persistence = audit_persistence_status()
    with get_connection() as connection:
        events_total = connection.execute("select count(*) from evidence_access_audit").fetchone()[0]
    verification = verify_evidence_access_audit_chain()
    return EvidenceAccessModelStatus(
        mode="mvp_internal_evidence_access",
        policy_version=POLICY_VERSION,
        storage="sqlite:evidence_access_audit",
        view_roles=_view_roles(),
        package_roles=_package_roles(),
        external_export_allowed=False,
        retention_schedule_status=persistence.retention_schedule_status,
        audit_events_total=events_total,
        audit_chain_valid=verification.valid,
        audit_head_hash=verification.head_hash,
        gates=[
            GateResult(
                id="gate-evidence-access-policy",
                title="Evidence Access Policy Gate",
                status="passed",
                reason="Internal evidence access roles and package roles are explicit.",
            ),
            GateResult(
                id="gate-evidence-access-audit",
                title="Evidence Access Audit Gate",
                status="passed" if verification.valid else "failed",
                reason="Evidence access decisions are persisted and hash-chain verifiable.",
            ),
            GateResult(
                id="gate-external-evidence-export-block",
                title="External Evidence Export Block Gate",
                status="passed",
                reason="External evidence export remains blocked until explicit approval.",
            ),
        ],
    )


def list_evidence_access_audit() -> list[EvidenceAccessAuditEvent]:
    _init_store()
    with get_connection() as connection:
        rows = connection.execute("select * from evidence_access_audit order by created_at desc").fetchall()
    return [
        EvidenceAccessAuditEvent(
            id=row["id"],
            actor=row["actor"],
            role=row["role"],
            tenant_id=row["tenant_id"],
            resource=row["resource"],
            action=row["action"],
            status=row["status"],
            reason=row["reason"],
            created_at=row["created_at"],
            previous_hash=row["previous_hash"],
            event_hash=row["event_hash"],
        )
        for row in rows
    ]


def verify_evidence_access_audit_chain() -> EvidenceAccessAuditVerification:
    _init_store()
    previous_hash = GENESIS_HASH
    failed_event_id = None
    with get_connection() as connection:
        rows = connection.execute("select * from evidence_access_audit order by id").fetchall()
    for row in rows:
        payload = {
            "id": row["id"],
            "actor": row["actor"],
            "role": row["role"],
            "tenant_id": row["tenant_id"],
            "resource": row["resource"],
            "action": row["action"],
            "status": row["status"],
            "reason": row["reason"],
            "created_at": row["created_at"],
        }
        expected_hash = _hash_payload(_hash_event_payload(payload, previous_hash))
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected_hash:
            failed_event_id = row["id"]
            break
        previous_hash = row["event_hash"]
    return EvidenceAccessAuditVerification(
        mode="sha256_hash_chain",
        valid=failed_event_id is None,
        events_total=len(rows),
        genesis_hash=GENESIS_HASH,
        head_hash=previous_hash,
        failed_event_id=failed_event_id,
        checked_at=_now(),
    )
