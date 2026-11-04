from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256

from fastapi import HTTPException

from app.services.role_directory import get_role, list_runtime_roles, role_exists, unknown_roles
from app.services.sqlite_store import get_connection
from app.services.security_context import DEMO_TENANT_ID, RuntimeSession


DEFAULT_PROCESS_POLICIES: dict[str, dict[str, object]] = {
    "commercial-proposal": {
        "process_id": "commercial-proposal",
        "tenant_id": DEMO_TENANT_ID,
        "view_roles": ["admin", "runtime-operator", "sales-manager", "observer"],
        "execute_roles": ["admin", "runtime-operator", "sales-manager"],
        "allowed_departments": ["sales", "management"],
        "min_access_level": "standard",
        "policy_version": "access-policy-v0.1",
        "status": "active",
    }
}

ACCESS_LEVEL_RANK = {"read": 1, "standard": 2, "manager": 3, "admin": 4}
GENESIS_HASH = "0" * 64


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_column(connection, table: str, column: str, ddl: str) -> None:
    columns = {row["name"] for row in connection.execute(f"pragma table_info({table})").fetchall()}
    if column not in columns:
        connection.execute(f"alter table {table} add column {column} {ddl}")


def _init_policy_store() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists access_policies (
                process_id text primary key,
                tenant_id text not null,
                view_roles_json text not null,
                execute_roles_json text not null,
                allowed_departments_json text not null,
                min_access_level text not null,
                policy_version text not null,
                status text not null,
                updated_at text not null,
                updated_by text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists access_policy_audit (
                id text primary key,
                process_id text not null,
                actor text not null,
                role text not null,
                action text not null,
                before_json text,
                after_json text not null,
                created_at text not null,
                previous_hash text,
                event_hash text
            )
            """
        )
        _ensure_column(connection, "access_policy_audit", "previous_hash", "text")
        _ensure_column(connection, "access_policy_audit", "event_hash", "text")
        count = connection.execute("select count(*) from access_policies").fetchone()[0]
        if count == 0:
            for policy in DEFAULT_PROCESS_POLICIES.values():
                _upsert_policy(connection, policy, actor="system")
                _insert_audit(connection, policy["process_id"], "system", "system", "seed", None, policy)
        _backfill_audit_hash_chain(connection)


def _policy_from_row(row) -> dict[str, object]:
    return {
        "process_id": row["process_id"],
        "tenant_id": row["tenant_id"],
        "view_roles": json.loads(row["view_roles_json"]),
        "execute_roles": json.loads(row["execute_roles_json"]),
        "allowed_departments": json.loads(row["allowed_departments_json"]),
        "min_access_level": row["min_access_level"],
        "policy_version": row["policy_version"],
        "status": row["status"],
        "updated_at": row["updated_at"],
        "updated_by": row["updated_by"],
    }


def _upsert_policy(connection, policy: dict[str, object], actor: str) -> None:
    connection.execute(
        """
        insert or replace into access_policies(
            process_id, tenant_id, view_roles_json, execute_roles_json,
            allowed_departments_json, min_access_level, policy_version,
            status, updated_at, updated_by
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            policy["process_id"],
            policy.get("tenant_id", DEMO_TENANT_ID),
            json.dumps(policy.get("view_roles", []), ensure_ascii=False),
            json.dumps(policy.get("execute_roles", []), ensure_ascii=False),
            json.dumps(policy.get("allowed_departments", []), ensure_ascii=False),
            policy.get("min_access_level", "read"),
            policy.get("policy_version", "access-policy-v0.1"),
            policy.get("status", "active"),
            _now(),
            actor,
        ),
    )


def _next_audit_id(connection) -> str:
    count = connection.execute("select count(*) from access_policy_audit").fetchone()[0]
    return f"policy-audit-{count + 1:04d}"


def _audit_event_hash(event: dict[str, object]) -> str:
    payload = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(payload.encode("utf-8")).hexdigest()


def _latest_audit_hash(connection) -> str:
    row = connection.execute(
        "select event_hash from access_policy_audit where event_hash is not null order by id desc limit 1"
    ).fetchone()
    return row["event_hash"] if row and row["event_hash"] else GENESIS_HASH


def _audit_hash_payload(
    event_id: str,
    process_id: str,
    actor: str,
    role: str,
    action: str,
    before_json: str | None,
    after_json: str,
    created_at: str,
    previous_hash: str,
) -> dict[str, object]:
    return {
        "id": event_id,
        "process_id": process_id,
        "actor": actor,
        "role": role,
        "action": action,
        "before_json": before_json,
        "after_json": after_json,
        "created_at": created_at,
        "previous_hash": previous_hash,
    }


def _insert_audit(connection, process_id: str, actor: str, role: str, action: str, before, after) -> None:
    event_id = _next_audit_id(connection)
    created_at = _now()
    before_json = json.dumps(before, ensure_ascii=False) if before is not None else None
    after_json = json.dumps(after, ensure_ascii=False)
    previous_hash = _latest_audit_hash(connection)
    event_hash = _audit_event_hash(
        _audit_hash_payload(event_id, process_id, actor, role, action, before_json, after_json, created_at, previous_hash)
    )
    connection.execute(
        """
        insert into access_policy_audit(
            id, process_id, actor, role, action, before_json, after_json, created_at, previous_hash, event_hash
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            process_id,
            actor,
            role,
            action,
            before_json,
            after_json,
            created_at,
            previous_hash,
            event_hash,
        ),
    )


def _backfill_audit_hash_chain(connection) -> None:
    previous_hash = GENESIS_HASH
    rows = connection.execute("select * from access_policy_audit order by id").fetchall()
    for row in rows:
        expected_hash = _audit_event_hash(
            _audit_hash_payload(
                row["id"],
                row["process_id"],
                row["actor"],
                row["role"],
                row["action"],
                row["before_json"],
                row["after_json"],
                row["created_at"],
                previous_hash,
            )
        )
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected_hash:
            connection.execute(
                "update access_policy_audit set previous_hash = ?, event_hash = ? where id = ?",
                (previous_hash, expected_hash, row["id"]),
            )
        previous_hash = expected_hash


def list_access_policies() -> list[dict[str, object]]:
    _init_policy_store()
    with get_connection() as connection:
        rows = connection.execute("select * from access_policies order by process_id").fetchall()
    return [_policy_from_row(row) for row in rows]


def get_policy(process_id: str) -> dict[str, object]:
    _init_policy_store()
    with get_connection() as connection:
        row = connection.execute("select * from access_policies where process_id = ?", (process_id,)).fetchone()
    if row is None:
        raise KeyError(process_id)
    return _policy_from_row(row)


def update_policy(process_id: str, payload: dict[str, object], session: RuntimeSession) -> dict[str, object]:
    if session.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can update access policies.")

    _init_policy_store()
    try:
        current = dict(get_policy(process_id))
    except KeyError:
        current = {"process_id": process_id, "tenant_id": session.tenant_id}
    allowed_keys = {"view_roles", "execute_roles", "allowed_departments", "min_access_level", "status"}
    for key, value in payload.items():
        if key in allowed_keys:
            current[key] = value
    policy_roles = list(current.get("view_roles", [])) + list(current.get("execute_roles", []))
    unknown_policy_roles = unknown_roles(policy_roles)
    if unknown_policy_roles:
        raise HTTPException(
            status_code=422,
            detail={
                "reason": "Access policy contains roles that are absent from the Symbiot role directory.",
                "unknown_roles": unknown_policy_roles,
            },
        )
    current["policy_version"] = f"access-policy-v0.1-{_now()}"
    with get_connection() as connection:
        before = None
        row = connection.execute("select * from access_policies where process_id = ?", (process_id,)).fetchone()
        if row is not None:
            before = _policy_from_row(row)
        _upsert_policy(connection, current, actor=session.actor)
        _insert_audit(connection, process_id, session.actor, session.role, "update", before, current)
    return current


def evaluate_access(process_id: str, action: str, session: RuntimeSession) -> dict[str, object]:
    try:
        policy = get_policy(process_id)
    except KeyError:
        return {
            "allowed": False,
            "reason": "No access policy exists for this process.",
            "policy_version": None,
            "checks": [{"id": "policy-exists", "status": "failed"}],
        }

    checks: list[dict[str, str]] = []

    role_known = role_exists(session.role)
    checks.append({"id": "role-directory", "status": "passed" if role_known else "failed"})

    tenant_ok = policy.get("tenant_id") == session.tenant_id
    checks.append({"id": "tenant", "status": "passed" if tenant_ok else "failed"})

    roles_key = "execute_roles" if action == "execute" else "view_roles"
    role_ok = session.role in list(policy.get(roles_key, []))
    checks.append({"id": "rbac-role", "status": "passed" if role_ok else "failed"})

    department_ok = session.department in list(policy.get("allowed_departments", []))
    checks.append({"id": "abac-department", "status": "passed" if department_ok else "failed"})

    min_level = str(policy.get("min_access_level", "read"))
    level_ok = ACCESS_LEVEL_RANK.get(session.access_level, 0) >= ACCESS_LEVEL_RANK.get(min_level, 1)
    checks.append({"id": "abac-access-level", "status": "passed" if level_ok else "failed"})

    allowed = role_known and tenant_ok and role_ok and department_ok and level_ok and policy.get("status") == "active"
    return {
        "allowed": allowed,
        "reason": "Access granted by RBAC/ABAC policy." if allowed else "Access denied by RBAC/ABAC policy.",
        "process_id": process_id,
        "action": action,
        "actor": session.actor,
        "role": session.role,
        "department": session.department,
        "access_level": session.access_level,
        "tenant_id": session.tenant_id,
        "policy_version": policy.get("policy_version"),
        "role_directory_ref": get_role(session.role),
        "checks": checks,
    }


def require_process_access(process_id: str, action: str, session: RuntimeSession) -> dict[str, object]:
    decision = evaluate_access(process_id, action, session)
    if not decision["allowed"]:
        raise HTTPException(status_code=403, detail=decision)
    return decision


def list_policy_audit(process_id: str | None = None) -> list[dict[str, object]]:
    _init_policy_store()
    with get_connection() as connection:
        if process_id:
            rows = connection.execute(
                "select * from access_policy_audit where process_id = ? order by created_at desc",
                (process_id,),
            ).fetchall()
        else:
            rows = connection.execute("select * from access_policy_audit order by created_at desc").fetchall()
    return [
        {
            "id": row["id"],
            "process_id": row["process_id"],
            "actor": row["actor"],
            "role": row["role"],
            "action": row["action"],
            "before": json.loads(row["before_json"]) if row["before_json"] else None,
            "after": json.loads(row["after_json"]),
            "created_at": row["created_at"],
            "previous_hash": row["previous_hash"],
            "event_hash": row["event_hash"],
        }
        for row in rows
    ]


def verify_policy_audit_chain() -> dict[str, object]:
    _init_policy_store()
    previous_hash = GENESIS_HASH
    failed_event_id = None
    with get_connection() as connection:
        rows = connection.execute("select * from access_policy_audit order by id").fetchall()
    for row in rows:
        expected_hash = _audit_event_hash(
            _audit_hash_payload(
                row["id"],
                row["process_id"],
                row["actor"],
                row["role"],
                row["action"],
                row["before_json"],
                row["after_json"],
                row["created_at"],
                previous_hash,
            )
        )
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected_hash:
            failed_event_id = row["id"]
            break
        previous_hash = expected_hash
    return {
        "mode": "sha256_hash_chain",
        "valid": failed_event_id is None,
        "events_total": len(rows),
        "genesis_hash": GENESIS_HASH,
        "head_hash": previous_hash,
        "failed_event_id": failed_event_id,
        "checked_at": _now(),
    }


def policy_store_status() -> dict[str, object]:
    _init_policy_store()
    with get_connection() as connection:
        policy_count = connection.execute("select count(*) from access_policies").fetchone()[0]
        audit_count = connection.execute("select count(*) from access_policy_audit").fetchone()[0]
    chain = verify_policy_audit_chain()
    return {
        "storage": "sqlite",
        "persistent": True,
        "policies_total": policy_count,
        "audit_events_total": audit_count,
        "audit_chain_mode": chain["mode"],
        "audit_chain_valid": chain["valid"],
        "audit_head_hash": chain["head_hash"],
        "policy_tables": ["access_policies", "access_policy_audit"],
    }


def validate_access_policy_directory() -> dict[str, object]:
    policies = list_access_policies()
    invalid_policies: list[dict[str, object]] = []
    for policy in policies:
        policy_roles = list(policy.get("view_roles", [])) + list(policy.get("execute_roles", []))
        missing_roles = unknown_roles(policy_roles)
        if missing_roles:
            invalid_policies.append({"process_id": policy["process_id"], "unknown_roles": missing_roles})
    return {
        "valid": len(invalid_policies) == 0,
        "policies_total": len(policies),
        "invalid_policies_total": len(invalid_policies),
        "invalid_policies": invalid_policies,
        "known_runtime_roles": list_runtime_roles(),
    }
