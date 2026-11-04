from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from hashlib import sha256
from pathlib import Path

from fastapi import HTTPException

from app.services.sqlite_store import get_connection, init_store
from app.services.security_context import RuntimeSession


ROOT = Path(__file__).resolve().parents[3]
ROLE_DIRECTORY_PATH = ROOT / "backend" / "config" / "role_directory.json"
GENESIS_HASH = "0" * 64
ACCESS_LEVELS = {"read", "standard", "manager", "admin"}
ROLE_STATUSES = {"active", "disabled"}
ROLE_OVERRIDE_KEYS = {"department", "access_level", "permissions", "status"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_payload(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()


def _init_role_directory_store() -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists role_directory_overrides (
                runtime_role text primary key,
                department text not null,
                access_level text not null,
                permissions_json text not null,
                status text not null,
                updated_at text not null,
                updated_by text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists role_directory_audit (
                id text primary key,
                runtime_role text not null,
                actor text not null,
                actor_role text not null,
                action text not null,
                before_json text,
                after_json text not null,
                created_at text not null,
                previous_hash text,
                event_hash text
            )
            """
        )
        _backfill_role_audit_hash_chain(connection)


def _load_overrides() -> dict[str, dict[str, object]]:
    _init_role_directory_store()
    with get_connection() as connection:
        rows = connection.execute("select * from role_directory_overrides").fetchall()
    return {
        row["runtime_role"]: {
            "department": row["department"],
            "access_level": row["access_level"],
            "permissions": json.loads(row["permissions_json"]),
            "status": row["status"],
            "updated_at": row["updated_at"],
            "updated_by": row["updated_by"],
            "override_source": "sqlite:role_directory_overrides",
        }
        for row in rows
    }


def _apply_overrides(roles: list[dict[str, object]]) -> list[dict[str, object]]:
    overrides = _load_overrides()
    merged: list[dict[str, object]] = []
    for role in roles:
        runtime_role = str(role["runtime_role"])
        item = dict(role)
        if runtime_role in overrides:
            item.update(overrides[runtime_role])
        merged.append(item)
    return merged


@lru_cache(maxsize=1)
def load_role_directory() -> dict[str, object]:
    data = json.loads(ROLE_DIRECTORY_PATH.read_text(encoding="utf-8"))
    roles = _apply_overrides([dict(role) for role in data.get("roles", [])])
    active_roles = [role for role in roles if role.get("status") == "active"]
    runtime_roles = sorted({str(role["runtime_role"]) for role in active_roles})
    symbiot_refs = sorted({str(role["symbiot_role_ref"]) for role in active_roles})
    departments = sorted({str(role["department"]) for role in active_roles})
    permission_groups = data.get("permission_model", {}).get("permission_groups", {})
    permission_summary = {
        permission: sorted(
            str(role["runtime_role"])
            for role in active_roles
            if permission in list(role.get("permissions", []))
        )
        for permission in sorted(permission_groups)
    }
    return {
        **data,
        "roles": roles,
        "runtime_roles": runtime_roles,
        "symbiot_refs": symbiot_refs,
        "departments": departments,
        "permission_summary": permission_summary,
        "roles_total": len(roles),
        "active_roles_total": len(active_roles),
        "path": str(ROLE_DIRECTORY_PATH),
    }


def _find_any_role(runtime_role: str) -> dict[str, object] | None:
    for role in load_role_directory()["roles"]:
        if role.get("runtime_role") == runtime_role:
            return dict(role)
    return None


def list_runtime_roles() -> list[str]:
    return list(load_role_directory()["runtime_roles"])


def get_role(runtime_role: str) -> dict[str, object] | None:
    for role in load_role_directory()["roles"]:
        if role.get("runtime_role") == runtime_role and role.get("status") == "active":
            return dict(role)
    return None


def role_exists(runtime_role: str) -> bool:
    return get_role(runtime_role) is not None


def role_permissions(runtime_role: str) -> list[str]:
    role = get_role(runtime_role)
    if role is None:
        return []
    return sorted(str(permission) for permission in role.get("permissions", []))


def role_has_permission(runtime_role: str, permission: str) -> bool:
    return permission in role_permissions(runtime_role)


def roles_with_permission(permission: str) -> list[str]:
    directory = load_role_directory()
    return list(directory.get("permission_summary", {}).get(permission, []))


def _permission_groups() -> set[str]:
    directory = load_role_directory()
    return set(directory.get("permission_model", {}).get("permission_groups", {}).keys())


def _require_role_admin(session: RuntimeSession) -> None:
    if session.access_level != "admin" or not role_has_permission(session.role, "role.admin"):
        raise HTTPException(status_code=403, detail="Only role administrators can update runtime role directory.")


def _validate_role_update(runtime_role: str, current: dict[str, object], updated: dict[str, object]) -> None:
    status = str(updated.get("status", "active"))
    access_level = str(updated.get("access_level", "read"))
    permissions = set(str(permission) for permission in updated.get("permissions", []))
    valid_permissions = _permission_groups()

    if status not in ROLE_STATUSES:
        raise HTTPException(status_code=422, detail={"reason": "Invalid role status.", "allowed": sorted(ROLE_STATUSES)})
    if access_level not in ACCESS_LEVELS:
        raise HTTPException(status_code=422, detail={"reason": "Invalid access level.", "allowed": sorted(ACCESS_LEVELS)})
    unknown_permissions = sorted(permissions - valid_permissions)
    if unknown_permissions:
        raise HTTPException(
            status_code=422,
            detail={"reason": "Unknown permission groups.", "unknown_permissions": unknown_permissions},
        )
    if not permissions:
        raise HTTPException(status_code=422, detail="Active runtime role must keep at least one permission.")

    if runtime_role == "admin":
        required = {"process.view", "evidence.view", "evidence.package", "policy.manage", "role.admin"}
        if status != "active" or access_level != "admin" or not required.issubset(permissions):
            raise HTTPException(
                status_code=409,
                detail="Admin role cannot be disabled or stripped of critical administration permissions.",
            )
    if runtime_role == "appsec" and not {"security.review", "evidence.view"}.issubset(permissions):
        raise HTTPException(status_code=409, detail="AppSec role must keep security.review and evidence.view.")
    if runtime_role == "qa-lead" and not {"quality.accept", "evidence.view"}.issubset(permissions):
        raise HTTPException(status_code=409, detail="QA Lead role must keep quality.accept and evidence.view.")
    if runtime_role == "runtime-operator" and not {"task.dispatch", "process.execute"}.issubset(permissions):
        raise HTTPException(status_code=409, detail="Runtime operator must keep task.dispatch and process.execute.")


def _next_role_audit_id(connection) -> str:
    count = connection.execute("select count(*) from role_directory_audit").fetchone()[0]
    return f"role-audit-{count + 1:04d}"


def _latest_role_audit_hash(connection) -> str:
    row = connection.execute(
        "select event_hash from role_directory_audit where event_hash is not null order by id desc limit 1"
    ).fetchone()
    return row["event_hash"] if row and row["event_hash"] else GENESIS_HASH


def _role_audit_payload(
    event_id: str,
    runtime_role: str,
    actor: str,
    actor_role: str,
    action: str,
    before_json: str | None,
    after_json: str,
    created_at: str,
    previous_hash: str,
) -> dict[str, object]:
    return {
        "id": event_id,
        "runtime_role": runtime_role,
        "actor": actor,
        "actor_role": actor_role,
        "action": action,
        "before_json": before_json,
        "after_json": after_json,
        "created_at": created_at,
        "previous_hash": previous_hash,
    }


def _insert_role_audit(connection, runtime_role: str, session: RuntimeSession, action: str, before, after) -> None:
    event_id = _next_role_audit_id(connection)
    created_at = _now()
    before_json = json.dumps(before, ensure_ascii=False) if before is not None else None
    after_json = json.dumps(after, ensure_ascii=False)
    previous_hash = _latest_role_audit_hash(connection)
    event_hash = _hash_payload(
        _role_audit_payload(
            event_id,
            runtime_role,
            session.actor,
            session.role,
            action,
            before_json,
            after_json,
            created_at,
            previous_hash,
        )
    )
    connection.execute(
        """
        insert into role_directory_audit(
            id, runtime_role, actor, actor_role, action, before_json, after_json,
            created_at, previous_hash, event_hash
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            runtime_role,
            session.actor,
            session.role,
            action,
            before_json,
            after_json,
            created_at,
            previous_hash,
            event_hash,
        ),
    )


def _backfill_role_audit_hash_chain(connection) -> None:
    previous_hash = GENESIS_HASH
    rows = connection.execute("select * from role_directory_audit order by id").fetchall()
    for row in rows:
        expected_hash = _hash_payload(
            _role_audit_payload(
                row["id"],
                row["runtime_role"],
                row["actor"],
                row["actor_role"],
                row["action"],
                row["before_json"],
                row["after_json"],
                row["created_at"],
                previous_hash,
            )
        )
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected_hash:
            connection.execute(
                "update role_directory_audit set previous_hash = ?, event_hash = ? where id = ?",
                (previous_hash, expected_hash, row["id"]),
            )
        previous_hash = expected_hash


def update_runtime_role(runtime_role: str, payload: dict[str, object], session: RuntimeSession) -> dict[str, object]:
    _require_role_admin(session)
    current = _find_any_role(runtime_role)
    if current is None:
        raise HTTPException(status_code=404, detail=f"Runtime role `{runtime_role}` is absent from role directory.")

    updated = dict(current)
    for key, value in payload.items():
        if key in ROLE_OVERRIDE_KEYS:
            updated[key] = value
    if "permissions" in updated:
        updated["permissions"] = sorted(str(permission) for permission in updated.get("permissions", []))
    _validate_role_update(runtime_role, current, updated)

    _init_role_directory_store()
    with get_connection() as connection:
        connection.execute(
            """
            insert or replace into role_directory_overrides(
                runtime_role, department, access_level, permissions_json, status, updated_at, updated_by
            )
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                runtime_role,
                str(updated["department"]),
                str(updated["access_level"]),
                json.dumps(updated["permissions"], ensure_ascii=False),
                str(updated["status"]),
                _now(),
                session.actor,
            ),
        )
        _insert_role_audit(connection, runtime_role, session, "update", current, updated)
    load_role_directory.cache_clear()
    return dict(_find_any_role(runtime_role) or updated)


def list_role_directory_audit(runtime_role: str | None = None) -> list[dict[str, object]]:
    _init_role_directory_store()
    with get_connection() as connection:
        if runtime_role:
            rows = connection.execute(
                "select * from role_directory_audit where runtime_role = ? order by created_at desc",
                (runtime_role,),
            ).fetchall()
        else:
            rows = connection.execute("select * from role_directory_audit order by created_at desc").fetchall()
    return [
        {
            "id": row["id"],
            "runtime_role": row["runtime_role"],
            "actor": row["actor"],
            "actor_role": row["actor_role"],
            "action": row["action"],
            "before": json.loads(row["before_json"]) if row["before_json"] else None,
            "after": json.loads(row["after_json"]),
            "created_at": row["created_at"],
            "previous_hash": row["previous_hash"],
            "event_hash": row["event_hash"],
        }
        for row in rows
    ]


def verify_role_directory_audit_chain() -> dict[str, object]:
    _init_role_directory_store()
    previous_hash = GENESIS_HASH
    failed_event_id = None
    with get_connection() as connection:
        rows = connection.execute("select * from role_directory_audit order by id").fetchall()
    for row in rows:
        expected_hash = _hash_payload(
            _role_audit_payload(
                row["id"],
                row["runtime_role"],
                row["actor"],
                row["actor_role"],
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
        previous_hash = row["event_hash"]
    return {
        "mode": "sha256_hash_chain",
        "valid": failed_event_id is None,
        "events_total": len(rows),
        "genesis_hash": GENESIS_HASH,
        "head_hash": previous_hash,
        "failed_event_id": failed_event_id,
        "checked_at": _now(),
    }


def role_directory_admin_status() -> dict[str, object]:
    _init_role_directory_store()
    with get_connection() as connection:
        overrides_total = connection.execute("select count(*) from role_directory_overrides").fetchone()[0]
        audit_events_total = connection.execute("select count(*) from role_directory_audit").fetchone()[0]
    chain = verify_role_directory_audit_chain()
    coverage = role_directory_coverage()
    return {
        "mode": "json_base_plus_sqlite_admin_overrides",
        "persistent": True,
        "overrides_total": overrides_total,
        "audit_events_total": audit_events_total,
        "audit_chain_mode": chain["mode"],
        "audit_chain_valid": chain["valid"],
        "audit_head_hash": chain["head_hash"],
        "coverage_ready": coverage["coverage_ready"],
        "admin_workflow_ready": chain["valid"] and coverage["coverage_ready"],
        "blocked_operations": [
            "create_new_role_without_obsidian_passport",
            "disable_admin",
            "strip_admin_critical_permissions",
            "external_evidence_export",
        ],
    }


def unknown_roles(roles: list[str]) -> list[str]:
    known = set(list_runtime_roles())
    return sorted({role for role in roles if role not in known})


def role_directory_coverage() -> dict[str, object]:
    directory = load_role_directory()
    permission_summary = dict(directory.get("permission_summary", {}))
    required_permissions = [
        "process.view",
        "process.execute",
        "evidence.view",
        "evidence.package",
        "policy.manage",
        "role.admin",
        "quality.accept",
        "risk.review",
        "security.review",
        "ai.governance",
        "rag.admin",
        "llm.admin",
        "deployment.manage",
    ]
    missing_permissions = [
        permission
        for permission in required_permissions
        if len(permission_summary.get(permission, [])) == 0
    ]
    roles_without_permissions = sorted(
        str(role["runtime_role"])
        for role in directory["roles"]
        if role.get("status") == "active" and not role.get("permissions")
    )
    return {
        "version": directory["version"],
        "roles_total": directory["roles_total"],
        "active_roles_total": directory["active_roles_total"],
        "departments": directory["departments"],
        "permission_groups_total": len(directory.get("permission_model", {}).get("permission_groups", {})),
        "required_permissions": required_permissions,
        "missing_required_permissions": missing_permissions,
        "roles_without_permissions": roles_without_permissions,
        "coverage_ready": len(missing_permissions) == 0 and len(roles_without_permissions) == 0,
        "permission_summary": permission_summary,
    }


def role_directory_status() -> dict[str, object]:
    directory = load_role_directory()
    coverage = role_directory_coverage()
    return {
        "source": directory["source"],
        "version": directory["version"],
        "path": directory["path"],
        "obsidian_registry": directory["obsidian_registry"],
        "roles_total": directory["roles_total"],
        "active_roles_total": directory["active_roles_total"],
        "runtime_roles": directory["runtime_roles"],
        "symbiot_refs_total": len(directory["symbiot_refs"]),
        "departments": directory["departments"],
        "permission_groups_total": coverage["permission_groups_total"],
        "coverage_ready": coverage["coverage_ready"],
        "missing_required_permissions": coverage["missing_required_permissions"],
        "mvp_ready": directory["active_roles_total"] > 0,
    }
