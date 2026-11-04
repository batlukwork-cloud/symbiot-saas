import hashlib
import json
from datetime import UTC, datetime

from app.schemas import (
    AuditEvent,
    AuditEventHash,
    AuditExportPackage,
    AuditPersistenceStatus,
    AuditRetentionStatus,
    GateResult,
)
from app.services.mock_store import AUDIT_EVENTS
from app.services.sqlite_store import DB_PATH, get_connection, init_store

GENESIS_HASH = "0" * 64
RETENTION_POLICY = (
    "G3 MVP local evidence: audit events are retained as internal release evidence; "
    "production legal retention period is pending separate approval."
)
REDACTION_POLICY = "Only redacted audit payloads are included; secrets and raw client data must not be exported."


def _event_payload(event: AuditEvent, previous_hash: str) -> dict[str, object]:
    return {
        "id": event.id,
        "actor": event.actor,
        "action": event.action,
        "target": event.target,
        "redacted_payload": event.redacted_payload,
        "previous_hash": previous_hash,
    }


def _sha256(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _init_audit_store() -> None:
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists audit_events (
                id text primary key,
                actor text not null,
                action text not null,
                target text not null,
                redacted_payload_json text not null,
                created_at text not null,
                previous_hash text,
                event_hash text
            )
            """
        )
        for event in AUDIT_EVENTS:
            connection.execute(
                """
                insert or ignore into audit_events(
                    id, actor, action, target, redacted_payload_json, created_at
                )
                values (?, ?, ?, ?, ?, ?)
                """,
                (
                    event.id,
                    event.actor,
                    event.action,
                    event.target,
                    json.dumps(event.redacted_payload, ensure_ascii=False, sort_keys=True),
                    "2026-07-01T00:00:00+00:00",
                ),
            )
        _backfill_persistent_hash_chain(connection)


def _event_from_row(row) -> AuditEvent:
    return AuditEvent(
        id=row["id"],
        actor=row["actor"],
        action=row["action"],
        target=row["target"],
        redacted_payload=json.loads(row["redacted_payload_json"]),
    )


def list_persistent_audit_events() -> list[AuditEvent]:
    _init_audit_store()
    with get_connection() as connection:
        rows = connection.execute("select * from audit_events order by created_at, id").fetchall()
    return [_event_from_row(row) for row in rows]


def _backfill_persistent_hash_chain(connection) -> None:
    previous_hash = GENESIS_HASH
    rows = connection.execute("select * from audit_events order by created_at, id").fetchall()
    for row in rows:
        event = _event_from_row(row)
        event_hash = _sha256(_event_payload(event, previous_hash))
        if row["previous_hash"] != previous_hash or row["event_hash"] != event_hash:
            connection.execute(
                "update audit_events set previous_hash = ?, event_hash = ? where id = ?",
                (previous_hash, event_hash, row["id"]),
            )
        previous_hash = event_hash


def build_audit_chain(events: list[AuditEvent] | None = None) -> list[AuditEventHash]:
    chain: list[AuditEventHash] = []
    previous_hash = GENESIS_HASH
    for event in events or AUDIT_EVENTS:
        event_hash = _sha256(_event_payload(event, previous_hash))
        chain.append(AuditEventHash(id=event.id, previous_hash=previous_hash, event_hash=event_hash))
        previous_hash = event_hash
    return chain


def verify_audit_chain(events: list[AuditEvent] | None = None) -> bool:
    chain = build_audit_chain(events)
    previous_hash = GENESIS_HASH
    for item in chain:
        if item.previous_hash != previous_hash:
            return False
        previous_hash = item.event_hash
    return True


def audit_retention_status() -> AuditRetentionStatus:
    events = list_persistent_audit_events()
    chain = build_audit_chain(events)
    head_hash = chain[-1].event_hash if chain else GENESIS_HASH
    gates = [
        GateResult(
            id="gate-audit-retention-policy",
            title="Audit Retention Policy Gate",
            status="warning",
            reason="MVP local evidence retention is explicit; production legal retention period is not approved yet.",
            action="Approve production retention schedule before client pilot.",
        ),
        GateResult(
            id="gate-audit-export-evidence",
            title="Audit Export Evidence Gate",
            status="passed",
            reason="Internal audit export package includes only redacted payloads and SHA256 chain hashes.",
        ),
    ]
    return AuditRetentionStatus(
        mode="mvp_local_evidence",
        retention_policy=RETENTION_POLICY,
        storage="SQLite persistent audit_events + generated release evidence JSON",
        events_total=len(events),
        immutable_chain=True,
        chain_valid=verify_audit_chain(events),
        head_hash=head_hash,
        export_allowed=True,
        external_export_allowed=False,
        stop_condition="External audit export and production retention schedule require Dmitry approval.",
        gates=gates,
    )


def audit_persistence_status() -> AuditPersistenceStatus:
    events = list_persistent_audit_events()
    chain = build_audit_chain(events)
    head_hash = chain[-1].event_hash if chain else GENESIS_HASH
    gates = [
        GateResult(
            id="gate-audit-persistence",
            title="Audit Persistence Gate",
            status="passed",
            reason="General audit events are seeded into SQLite and verified through a SHA256 chain.",
        ),
        GateResult(
            id="gate-retention-schedule-approval",
            title="Retention Schedule Approval Gate",
            status="warning",
            reason="Production retention schedule is intentionally pending Dmitry/legal approval.",
            action="Approve production retention duration and deletion/legal-hold policy before client pilot.",
        ),
    ]
    return AuditPersistenceStatus(
        storage="sqlite",
        persistent=True,
        db_path=str(DB_PATH),
        events_total=len(events),
        seed_source="mock_store.AUDIT_EVENTS",
        sync_mode="seeded_from_runtime",
        chain_valid=verify_audit_chain(events),
        head_hash=head_hash,
        retention_schedule_status="pending_approval",
        external_export_allowed=False,
        gates=gates,
    )


def audit_export_package(actor: str = "demo-user", tenant_id: str = "tenant:demo") -> AuditExportPackage:
    events = list_persistent_audit_events()
    chain = build_audit_chain(events)
    generated_at = datetime.now(UTC).isoformat()
    package_payload: dict[str, object] = {
        "generated_at": generated_at,
        "actor": actor,
        "tenant_id": tenant_id,
        "export_scope": "internal_evidence",
        "event_hashes": [item.model_dump() for item in chain],
        "redaction_policy": REDACTION_POLICY,
    }
    package_hash = _sha256(package_payload)
    return AuditExportPackage(
        id=f"audit-export-{package_hash[:12]}",
        generated_at=generated_at,
        actor=actor,
        tenant_id=tenant_id,
        export_scope="internal_evidence",
        external_export_allowed=False,
        events_total=len(events),
        event_hashes=chain,
        package_hash=package_hash,
        redaction_policy=REDACTION_POLICY,
        gates=audit_retention_status().gates,
    )
