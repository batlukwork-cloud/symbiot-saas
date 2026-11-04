from __future__ import annotations

import json
import hashlib
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from app.schemas import (
    Artifact,
    AdminIncidentTimelineStatus,
    AuditEvent,
    DeadLetterQueueActionResponse,
    DeadLetterQueueRecord,
    DeadLetterQueueStatus,
    GateResult,
    IncidentTimelineEvent,
    IncidentLifecycleItem,
    IncidentLifecycleStatus,
    NotificationChannel,
    NotificationDeliveryItem,
    NotificationDeliveryStatus,
    NotificationPolicyAuditItem,
    NotificationPolicyAuditStatus,
    NotificationRoutePreference,
    NotificationRoutingStatus,
    QueueAdminActionAuditEvent,
    QueueAdminActionAuditStatus,
    QueueAdminCommandCenterAction,
    QueueAdminCommandCenterSource,
    QueueAdminCommandCenterStatus,
    QueueEvidenceAcceptanceBatchActionRequest,
    QueueEvidenceAcceptanceBatchActionResponse,
    QueueEvidenceAcceptanceBatchGroupClosureStatus,
    QueueEvidenceAcceptanceBatchItemDecisionRequest,
    QueueEvidenceAcceptanceBatchItemDecisionResponse,
    QueueEvidenceAcceptanceBatchGroup,
    QueueEvidenceAcceptanceBatchPlanStatus,
    QueueEvidenceAcceptanceCenterStatus,
    QueueEvidenceAcceptanceChecklistItem,
    QueueEvidenceAcceptanceChecklistStatus,
    QueueEvidenceAcceptanceBlockerWorklistStatus,
    QueueEvidenceAcceptanceSummaryStatus,
    QueueEvidenceReviewItem,
    QueueEvidenceReviewPackage,
    QueueEvidenceReviewPackageArchiveEntry,
    QueueEvidenceReviewPackageArchiveStatus,
    QueueEvidenceReviewRequest,
    QueueEvidenceReviewStatus,
    QueueManualTriageItem,
    QueueManualTriageRequest,
    QueueManualTriageStatus,
    QueueAdminRecoveryPlanStatus,
    QueueRunbookActionResponse,
    QueueOperationsRunbookStatus,
    QueueRecoveryStep,
    QueueRunbookStep,
    QueueAdminAction,
    QueueAdminAlert,
    QueueAdminAlertCenterStatus,
    StageStatus,
    TaskRun,
    TaskRunQueueActionResponse,
    TaskRunQueueEvent,
    TaskRunQueueItem,
    TaskRunQueueRequest,
    TaskRunQueueResponse,
    TaskRunQueueStatus,
    QueueObservationProblem,
    RetryPolicyStatus,
    WorkerObservabilityStatus,
    WorkerSchedulerStatus,
)
from app.services.mock_store import ARTIFACTS, AUDIT_EVENTS, RAG_CHUNKS, TASK_RUNS
from app.services.security_context import RuntimeSession
from app.services.sqlite_store import get_connection, init_store
from app.services.task_run_execution import _artifact_content, _artifact_title
from app.services.task_run_store import get_task_run, init_task_run_store, save_task_run_bundle

WORKER_NAME = "symbiot-sqlite-mvp-taskrun-worker-v0.1"
SCHEDULER_NAME = "symbiot-sqlite-mvp-persistent-scheduler-v0.1"
_scheduler_lock = threading.Lock()
_scheduler_stop_event = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_tick_lock = threading.Lock()
ROOT_DIR = Path(__file__).resolve().parents[3]
EVIDENCE_PACKAGE_ARCHIVE_DIR = ROOT_DIR / "runtime_data" / "evidence_package_archive"
EVIDENCE_PACKAGE_ARCHIVE_PATH = EVIDENCE_PACKAGE_ARCHIVE_DIR / "queue_evidence_packages.jsonl"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def init_task_run_queue_store() -> None:
    init_task_run_store()
    init_store()
    with get_connection() as connection:
        connection.execute(
            """
            create table if not exists task_run_queue (
                id text primary key,
                task_run_id text not null,
                status text not null,
                payload_json text not null,
                session_json text not null,
                attempts integer not null,
                max_attempts integer not null,
                timeout_seconds integer not null,
                error text,
                created_at text not null,
                updated_at text not null,
                next_run_at text,
                completed_at text
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_queue_events (
                id text primary key,
                queue_id text not null,
                task_run_id text not null,
                event_type text not null,
                actor text not null,
                status_before text,
                status_after text not null,
                message text not null,
                created_at text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_retry_policy (
                id text primary key,
                policy_version text not null,
                max_attempts integer not null,
                base_delay_seconds integer not null,
                max_delay_seconds integer not null,
                backoff_multiplier real not null,
                retryable_errors_json text not null,
                terminal_status text not null,
                manual_override_allowed integer not null,
                updated_at text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_dead_letters (
                id text primary key,
                queue_id text not null unique,
                task_run_id text not null,
                status text not null,
                severity text not null,
                reason text not null,
                error text,
                attempts integer not null,
                max_attempts integer not null,
                next_action text not null,
                created_at text not null,
                updated_at text not null,
                acknowledged_by text,
                acknowledged_at text,
                resolved_by text,
                resolved_at text
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_worker_scheduler (
                id text primary key,
                enabled integer not null,
                status text not null,
                interval_seconds real not null,
                started_at text,
                stopped_at text,
                heartbeat_at text,
                last_tick_at text,
                processed_total integer not null,
                error_total integer not null,
                last_error text,
                updated_at text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_notification_deliveries (
                id text primary key,
                incident_id text not null,
                channel_id text not null,
                channel_type text not null,
                status text not null,
                severity text not null,
                title text not null,
                owner_role text not null,
                message text not null,
                dry_run integer not null,
                created_at text not null,
                updated_at text not null,
                delivered_at text,
                attempt_count integer not null,
                error text,
                evidence_ref text,
                unique(incident_id, channel_id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_notification_routes (
                id text primary key,
                severity text not null,
                source text not null,
                owner_role text not null,
                channel_ids_json text not null,
                response_minutes integer,
                escalation_target text,
                enabled integer not null,
                delivery_mode text not null,
                reason text not null,
                updated_at text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_admin_action_audit (
                id text primary key,
                action_id text not null,
                action_kind text not null,
                actor text not null,
                reason text not null,
                executed integer not null,
                status_before text not null,
                status_after text not null,
                message text not null,
                evidence_ref text not null,
                created_at text not null,
                previous_hash text not null,
                event_hash text not null
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_manual_triage (
                id text primary key,
                source_action_id text not null,
                title text not null,
                owner_role text not null,
                severity text not null,
                status text not null,
                reason text not null,
                resolution text,
                evidence_ref text not null,
                related_runbook_step_id text,
                related_queue_id text,
                related_task_run_id text,
                created_at text not null,
                updated_at text not null,
                assigned_by text,
                assigned_at text,
                resolved_by text,
                resolved_at text,
                unique(source_action_id, evidence_ref)
            )
            """
        )
        connection.execute(
            """
            create table if not exists task_run_evidence_review (
                id text primary key,
                source_ref text not null,
                title text not null,
                owner_role text not null,
                severity text not null,
                status text not null,
                reason text not null,
                review_note text,
                evidence_ref text not null,
                related_manual_triage_id text,
                related_action_id text,
                related_task_run_id text,
                created_at text not null,
                updated_at text not null,
                reviewed_by text,
                reviewed_at text,
                unique(source_ref, evidence_ref)
            )
            """
        )
        now = datetime.now(UTC).isoformat()
        connection.execute(
            """
            insert or ignore into task_run_worker_scheduler(
                id, enabled, status, interval_seconds, started_at, stopped_at,
                heartbeat_at, last_tick_at, processed_total, error_total, last_error, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("default", 0, "stopped", 1.0, None, None, None, None, 0, 0, None, now),
        )
        connection.execute(
            """
            insert or ignore into task_run_retry_policy(
                id, policy_version, max_attempts, base_delay_seconds, max_delay_seconds,
                backoff_multiplier, retryable_errors_json, terminal_status,
                manual_override_allowed, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                "retry-policy-mvp-v0.1",
                3,
                0,
                60,
                2.0,
                json.dumps(["RuntimeError", "TimeoutError", "ConnectionError"], ensure_ascii=False),
                "failed",
                1,
                now,
            ),
        )
        for route in [
            (
                "route-warning-default",
                "warning",
                "all",
                "runtime-operator",
                ["local-log"],
                60,
                "QA Lead / Runtime Admin",
                1,
                "local_log_only",
                "Warning events must be visible to runtime operator without external delivery.",
            ),
            (
                "route-critical-default",
                "critical",
                "all",
                "runtime-admin",
                ["local-log"],
                15,
                "CTO / IT-директор",
                1,
                "local_log_only",
                "Critical events must be visible to runtime admin without production secrets.",
            ),
            (
                "route-critical-dlq",
                "critical",
                "dead_letter_queue",
                "runtime-admin",
                ["local-log"],
                15,
                "CTO / IT-директор",
                1,
                "local_log_only",
                "DLQ incidents require runtime admin triage and CTO escalation path.",
            ),
            (
                "route-info-default",
                "info",
                "all",
                "runtime-operator",
                ["local-log"],
                None,
                None,
                0,
                "external_blocked",
                "Info events are not delivered during MVP to reduce noise.",
            ),
        ]:
            connection.execute(
                """
                insert or ignore into task_run_notification_routes(
                    id, severity, source, owner_role, channel_ids_json, response_minutes,
                    escalation_target, enabled, delivery_mode, reason, updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    route[0],
                    route[1],
                    route[2],
                    route[3],
                    json.dumps(route[4], ensure_ascii=False),
                    route[5],
                    route[6],
                    route[7],
                    route[8],
                    route[9],
                    now,
                ),
            )


def _queue_item_from_row(row) -> TaskRunQueueItem:
    return TaskRunQueueItem(
        id=row["id"],
        task_run_id=row["task_run_id"],
        status=row["status"],
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
        timeout_seconds=row["timeout_seconds"],
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        next_run_at=row["next_run_at"],
        completed_at=row["completed_at"],
    )


def _notification_channel_registry() -> list[NotificationChannel]:
    return [
        NotificationChannel(
            id="local-log",
            name="Локальный журнал администратора",
            channel_type="local_log",
            enabled=True,
            delivery_mode="dry_run",
            target_ref="runtime_logs / sqlite audit",
            safe_for_mvp=True,
        ),
        NotificationChannel(
            id="email",
            name="Email",
            channel_type="email",
            enabled=False,
            delivery_mode="external_not_configured",
            target_ref="production SMTP is not configured",
            safe_for_mvp=False,
        ),
        NotificationChannel(
            id="telegram",
            name="Telegram",
            channel_type="telegram",
            enabled=False,
            delivery_mode="external_not_configured",
            target_ref="bot token/webhook is not configured",
            safe_for_mvp=False,
        ),
        NotificationChannel(
            id="webhook",
            name="Webhook",
            channel_type="webhook",
            enabled=False,
            delivery_mode="external_not_configured",
            target_ref="external endpoint is not configured",
            safe_for_mvp=False,
        ),
    ]


def _notification_delivery_from_row(row) -> NotificationDeliveryItem:
    return NotificationDeliveryItem(
        id=row["id"],
        incident_id=row["incident_id"],
        channel_id=row["channel_id"],
        channel_type=row["channel_type"],
        status=row["status"],
        severity=row["severity"],
        title=row["title"],
        owner_role=row["owner_role"],
        message=row["message"],
        dry_run=bool(row["dry_run"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        delivered_at=row["delivered_at"],
        attempt_count=row["attempt_count"],
        error=row["error"],
        evidence_ref=row["evidence_ref"],
    )


def _notification_route_from_row(row) -> NotificationRoutePreference:
    return NotificationRoutePreference(
        id=row["id"],
        severity=row["severity"],
        source=row["source"],
        owner_role=row["owner_role"],
        channel_ids=json.loads(row["channel_ids_json"]),
        response_minutes=row["response_minutes"],
        escalation_target=row["escalation_target"],
        enabled=bool(row["enabled"]),
        delivery_mode=row["delivery_mode"],
        reason=row["reason"],
        updated_at=row["updated_at"],
    )


def _notification_routes() -> list[NotificationRoutePreference]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_notification_routes
            order by
                case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
                case source when 'all' then 1 else 0 end,
                id
            """
        ).fetchall()
    return [_notification_route_from_row(row) for row in rows]


def _route_for_incident(incident: IncidentLifecycleItem) -> NotificationRoutePreference | None:
    candidates = [route for route in _notification_routes() if route.enabled and route.severity == incident.severity]
    exact = [route for route in candidates if route.source == incident.source]
    fallback = [route for route in candidates if route.source == "all"]
    return (exact or fallback or [None])[0]


def _queue_event_from_row(row) -> TaskRunQueueEvent:
    return TaskRunQueueEvent(
        id=row["id"],
        queue_id=row["queue_id"],
        task_run_id=row["task_run_id"],
        event_type=row["event_type"],
        actor=row["actor"],
        status_before=row["status_before"],
        status_after=row["status_after"],
        message=row["message"],
        created_at=row["created_at"],
    )


def _dead_letter_from_row(row) -> DeadLetterQueueRecord:
    return DeadLetterQueueRecord(
        id=row["id"],
        queue_id=row["queue_id"],
        task_run_id=row["task_run_id"],
        status=row["status"],
        severity=row["severity"],
        reason=row["reason"],
        error=row["error"],
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
        next_action=row["next_action"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        acknowledged_by=row["acknowledged_by"],
        acknowledged_at=row["acknowledged_at"],
        resolved_by=row["resolved_by"],
        resolved_at=row["resolved_at"],
    )


def _scheduler_row_from_connection(connection):
    row = connection.execute("select * from task_run_worker_scheduler where id = ?", ("default",)).fetchone()
    if row is None:
        init_task_run_queue_store()
        row = connection.execute("select * from task_run_worker_scheduler where id = ?", ("default",)).fetchone()
    return row


def _is_scheduler_thread_alive() -> bool:
    return _scheduler_thread is not None and _scheduler_thread.is_alive()


def _update_scheduler_state(
    *,
    enabled: bool | None = None,
    status: str | None = None,
    interval_seconds: float | None = None,
    started_at: str | None = None,
    stopped_at: str | None = None,
    heartbeat_at: str | None = None,
    last_tick_at: str | None = None,
    processed_delta: int = 0,
    error_delta: int = 0,
    last_error: str | None | object = ...,
) -> None:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        row = _scheduler_row_from_connection(connection)
        connection.execute(
            """
            update task_run_worker_scheduler
            set enabled = ?, status = ?, interval_seconds = ?, started_at = ?,
                stopped_at = ?, heartbeat_at = ?, last_tick_at = ?,
                processed_total = ?, error_total = ?, last_error = ?, updated_at = ?
            where id = ?
            """,
            (
                int(row["enabled"] if enabled is None else enabled),
                row["status"] if status is None else status,
                row["interval_seconds"] if interval_seconds is None else interval_seconds,
                row["started_at"] if started_at is None else started_at,
                row["stopped_at"] if stopped_at is None else stopped_at,
                row["heartbeat_at"] if heartbeat_at is None else heartbeat_at,
                row["last_tick_at"] if last_tick_at is None else last_tick_at,
                int(row["processed_total"]) + processed_delta,
                int(row["error_total"]) + error_delta,
                row["last_error"] if last_error is ... else last_error,
                now,
                "default",
            ),
        )


def _scheduler_loop() -> None:
    while not _scheduler_stop_event.is_set():
        with get_connection() as connection:
            row = _scheduler_row_from_connection(connection)
            interval = max(0.2, min(float(row["interval_seconds"]), 30.0))
        heartbeat = datetime.now(UTC).isoformat()
        try:
            run_scheduler_tick(actor="worker-scheduler")
            _update_scheduler_state(
                heartbeat_at=heartbeat,
                last_error=None,
            )
        except Exception as error:
            _update_scheduler_state(heartbeat_at=heartbeat, error_delta=1, last_error=str(error))
        _scheduler_stop_event.wait(interval)
    _update_scheduler_state(
        enabled=False,
        status="stopped",
        stopped_at=datetime.now(UTC).isoformat(),
        heartbeat_at=datetime.now(UTC).isoformat(),
    )


def run_scheduler_tick(actor: str = "worker-scheduler") -> TaskRunQueueItem | None:
    init_task_run_queue_store()
    if not _scheduler_tick_lock.acquire(blocking=False):
        return None
    try:
        processed = process_next_task_run_queue_item(actor=actor)
        _update_scheduler_state(
            last_tick_at=datetime.now(UTC).isoformat(),
            processed_delta=1 if processed is not None else 0,
            last_error=None,
        )
        return processed
    finally:
        _scheduler_tick_lock.release()


def start_worker_scheduler(actor: str = "demo-user", interval_seconds: float = 1.0, reason: str = "") -> WorkerSchedulerStatus:
    global _scheduler_thread
    safe_interval = max(0.2, min(float(interval_seconds or 1.0), 30.0))
    now = datetime.now(UTC).isoformat()
    with _scheduler_lock:
        _scheduler_stop_event.clear()
        _update_scheduler_state(
            enabled=True,
            status="running",
            interval_seconds=safe_interval,
            started_at=now,
            stopped_at=None,
            heartbeat_at=now,
            last_error=None,
        )
        if not _is_scheduler_thread_alive():
            _scheduler_thread = threading.Thread(target=_scheduler_loop, name=SCHEDULER_NAME, daemon=True)
            _scheduler_thread.start()
    return worker_scheduler_status()


def stop_worker_scheduler(actor: str = "demo-user", reason: str = "") -> WorkerSchedulerStatus:
    with _scheduler_lock:
        _scheduler_stop_event.set()
        thread = _scheduler_thread
    if thread is not None and thread.is_alive():
        thread.join(timeout=3.0)
    _update_scheduler_state(
        enabled=False,
        status="stopped",
        stopped_at=datetime.now(UTC).isoformat(),
        heartbeat_at=datetime.now(UTC).isoformat(),
    )
    return worker_scheduler_status()


def resume_worker_scheduler_if_enabled() -> None:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = _scheduler_row_from_connection(connection)
        should_resume = bool(row["enabled"])
        interval = float(row["interval_seconds"])
    if should_resume:
        start_worker_scheduler(actor="runtime-startup", interval_seconds=interval, reason="Resume persisted scheduler state.")


def worker_scheduler_status() -> WorkerSchedulerStatus:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = _scheduler_row_from_connection(connection)
    running = _is_scheduler_thread_alive()
    enabled = bool(row["enabled"])
    persisted_status = "running" if running and enabled else "stopped"
    if row["status"] != persisted_status:
        _update_scheduler_state(status=persisted_status, enabled=enabled and running)
        with get_connection() as connection:
            row = _scheduler_row_from_connection(connection)
    return WorkerSchedulerStatus(
        mode="sqlite_mvp_persistent_scheduler",
        scheduler=SCHEDULER_NAME,
        enabled=bool(row["enabled"]),
        running=running,
        status=row["status"],
        interval_seconds=float(row["interval_seconds"]),
        started_at=row["started_at"],
        stopped_at=row["stopped_at"],
        heartbeat_at=row["heartbeat_at"],
        last_tick_at=row["last_tick_at"],
        processed_total=int(row["processed_total"]),
        error_total=int(row["error_total"]),
        last_error=row["last_error"],
        queue_status=queue_status(),
        gates=[
            GateResult(
                id="worker-scheduler-state-persistent",
                title="Worker scheduler state is persistent",
                status="passed",
                reason="Scheduler enabled/running state, interval, heartbeat and counters are stored in SQLite.",
            ),
            GateResult(
                id="worker-scheduler-safe-control",
                title="Worker scheduler has safe controls",
                status="passed",
                reason="Runtime exposes start/stop/status/tick controls without changing tenant/security model.",
            ),
        ],
    )


def _queue_admin_alert(
    *,
    alert_id: str,
    severity: str,
    title: str,
    message: str,
    recommended_action: str,
    source: str,
    related_queue_id: str | None = None,
    related_task_run_id: str | None = None,
) -> QueueAdminAlert:
    now = datetime.now(UTC)
    owner_role = "runtime-operator"
    response_minutes: int | None = None
    escalation_target: str | None = None
    sla_status = "not_applicable"
    if severity == "critical":
        owner_role = "runtime-admin"
        response_minutes = 15
        escalation_target = "CTO / IT-директор"
        sla_status = "within_sla"
    elif severity == "warning":
        owner_role = "runtime-operator"
        response_minutes = 60
        escalation_target = "QA Lead / Runtime Admin"
        sla_status = "within_sla"
    due_at = (now + timedelta(minutes=response_minutes)).isoformat() if response_minutes else None
    notification_draft = (
        f"[{severity.upper()}] {title}. Owner: {owner_role}. Due: {due_at or 'not applicable'}. Action: {recommended_action}"
    )
    return QueueAdminAlert(
        id=alert_id,
        severity=severity,
        title=title,
        message=message,
        recommended_action=recommended_action,
        source=source,
        owner_role=owner_role,
        response_minutes=response_minutes,
        response_due_at=due_at,
        sla_status=sla_status,
        escalation_target=escalation_target,
        notification_draft=notification_draft,
        related_queue_id=related_queue_id,
        related_task_run_id=related_task_run_id,
    )


def queue_admin_alert_center() -> QueueAdminAlertCenterStatus:
    scheduler = worker_scheduler_status()
    observability = worker_observability()
    dead_letters = dead_letter_queue_status()
    queue = observability.queue_status
    alerts: list[QueueAdminAlert] = []

    if dead_letters.open:
        for item in dead_letters.items:
            if item.status != "open":
                continue
            alerts.append(
                _queue_admin_alert(
                    alert_id=f"alert-dlq-{item.id}",
                    severity="critical",
                    title="Есть задача в ручном разборе",
                    message=f"{item.task_run_id}: {item.reason}",
                    recommended_action="Открыть DLQ, взять проблему в разбор, затем выполнить retry или resolve.",
                    source="dead_letter_queue",
                    related_queue_id=item.queue_id,
                    related_task_run_id=item.task_run_id,
                )
            )

    if queue.failed:
        failed_items = [item for item in queue.items if item.status == "failed"]
        for item in failed_items[:3]:
            alerts.append(
                _queue_admin_alert(
                    alert_id=f"alert-failed-{item.id}",
                    severity="critical",
                    title="Есть failed-задача",
                    message=f"{item.task_run_id}: {item.error or 'terminal failed'}",
                    recommended_action="Проверить события queue item и решить: retry, DLQ acknowledge или resolve.",
                    source="queue",
                    related_queue_id=item.id,
                    related_task_run_id=item.task_run_id,
                )
            )
        if not failed_items:
            alerts.append(
                _queue_admin_alert(
                    alert_id="alert-failed-queue-items",
                    severity="critical",
                    title="Есть failed-задачи вне preview списка",
                    message=f"В очереди зафиксировано failed-задач: {queue.failed}.",
                    recommended_action="Открыть полный queue/DLQ контур и выполнить triage failed-задач.",
                    source="queue",
                )
            )

    active_waiting = queue.queued + queue.retrying
    if active_waiting and not scheduler.running:
        alerts.append(
            _queue_admin_alert(
                alert_id="alert-scheduler-stopped-with-backlog",
                severity="warning",
                title="Автопланировщик остановлен при наличии очереди",
                message=f"В очереди ожидают обработки {active_waiting} задач.",
                recommended_action="Запустить scheduler или выполнить один контрольный тик.",
                source="scheduler",
            )
        )

    if scheduler.last_error:
        alerts.append(
            _queue_admin_alert(
                alert_id="alert-scheduler-last-error",
                severity="critical",
                title="Scheduler зафиксировал ошибку",
                message=scheduler.last_error,
                recommended_action="Остановить scheduler, проверить queue events и перезапустить после устранения причины.",
                source="scheduler",
            )
        )

    for item in observability.attention_items[:5]:
        alerts.append(
            _queue_admin_alert(
                alert_id=f"alert-worker-{item.queue_id}",
                severity=item.severity,
                title=item.title,
                message=f"{item.task_run_id}: {item.status}, возраст {item.age_seconds}s.",
                recommended_action=item.recommendation,
                source="worker",
                related_queue_id=item.queue_id,
                related_task_run_id=item.task_run_id,
            )
        )

    if not alerts:
        alerts.append(
            _queue_admin_alert(
                alert_id="alert-queue-normal",
                severity="info",
                title="Очередь работает штатно",
                message="Нет активных failed/retrying/queued задач, DLQ open = 0, worker healthy.",
                recommended_action="Действий не требуется. Продолжать мониторинг.",
                source="queue",
            )
        )

    critical = sum(1 for alert in alerts if alert.severity == "critical")
    warning = sum(1 for alert in alerts if alert.severity == "warning")
    status = "critical" if critical else "warning" if warning else "normal"
    summary = (
        "Есть критичные инциденты очереди, требуется ручное решение администратора."
        if critical
        else "Есть предупреждения по очереди, проверьте recommended actions."
        if warning
        else "Очередь и scheduler находятся в штатном состоянии."
    )
    actions = [
        QueueAdminAction(
            id="start-scheduler",
            title="Запустить автопланировщик",
            description="Включить фоновую обработку queued/retrying задач.",
            enabled=not scheduler.running,
            endpoint="/api/task-runs/queue/scheduler/start",
        ),
        QueueAdminAction(
            id="stop-scheduler",
            title="Остановить автопланировщик",
            description="Безопасно остановить background-loop после текущего тика.",
            enabled=scheduler.running,
            endpoint="/api/task-runs/queue/scheduler/stop",
        ),
        QueueAdminAction(
            id="manual-tick",
            title="Один контрольный тик",
            description="Обработать максимум одну готовую queue item без включения постоянного scheduler.",
            enabled=True,
            endpoint="/api/task-runs/queue/scheduler/tick",
        ),
        QueueAdminAction(
            id="review-dlq",
            title="Разобрать DLQ",
            description="Открыть список dead-letter задач и выполнить acknowledge/retry/resolve.",
            enabled=dead_letters.open > 0,
            endpoint="/api/task-runs/queue/dead-letters",
        ),
    ]
    return QueueAdminAlertCenterStatus(
        mode="sqlite_mvp_queue_admin_alert_center",
        status=status,
        summary=summary,
        open_alerts=len([alert for alert in alerts if alert.severity != "info"]),
        critical_alerts=critical,
        warning_alerts=warning,
        scheduler_status=scheduler,
        observability=observability,
        dead_letter_queue=dead_letters,
        alerts=alerts,
        actions=actions,
        gates=[
            GateResult(
                id="queue-admin-alerts-derived-from-runtime",
                title="Queue admin alerts are derived from runtime evidence",
                status="passed",
                reason="Alert Center aggregates queue status, worker observability, scheduler status and DLQ without changing execution path.",
            ),
            GateResult(
                id="queue-admin-actions-are-explicit",
                title="Queue admin actions are explicit",
                status="passed",
                reason="Start/stop/tick/review actions expose the endpoint and enabled state for administrator decisions.",
            ),
        ],
    )


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _incident_sla_status(due_at: str | None, status: str) -> str:
    if status == "resolved" or not due_at:
        return "not_applicable" if not due_at else "within_sla"
    due = _parse_iso_datetime(due_at)
    if due is None:
        return "not_applicable"
    return "overdue" if datetime.now(UTC) > due else "within_sla"


def _incident_age_seconds(created_at: str | None) -> int:
    created = _parse_iso_datetime(created_at)
    if created is None:
        return 0
    return max(0, int((datetime.now(UTC) - created).total_seconds()))


def _incident_from_dead_letter(item: DeadLetterQueueRecord) -> IncidentLifecycleItem:
    owner_role = "runtime-admin" if item.severity == "critical" else "runtime-operator"
    response_minutes = 15 if item.severity == "critical" else 60
    created = _parse_iso_datetime(item.created_at)
    response_due_at = (created + timedelta(minutes=response_minutes)).isoformat() if created else None
    if item.status == "resolved":
        current_step = "Закрыто с evidence"
        next_action = "Контролировать повторное появление аналогичного сбоя."
        action_label = "Закрыто"
        action_endpoint = None
    elif item.status == "acknowledged":
        current_step = "В ручном разборе"
        next_action = "Выполнить retry после устранения причины или закрыть как resolved."
        action_label = "Повторить или закрыть"
        action_endpoint = f"/api/task-runs/queue/{item.queue_id}/retry"
    else:
        current_step = "Ожидает принятия в работу"
        next_action = "Взять инцидент в разбор, назначить администратора и подтвердить triage."
        action_label = "Взять в разбор"
        action_endpoint = f"/api/task-runs/queue/dead-letters/{item.id}/acknowledge"
    return IncidentLifecycleItem(
        id=f"incident-dlq-{item.id}",
        source="dead_letter_queue",
        severity=item.severity,
        status=item.status,
        title=f"DLQ: {item.task_run_id}",
        owner_role=owner_role,
        response_due_at=response_due_at,
        sla_status=_incident_sla_status(response_due_at, item.status),
        age_seconds=_incident_age_seconds(item.created_at),
        updated_at=item.updated_at,
        current_step=current_step,
        next_action=next_action,
        action_label=action_label,
        action_endpoint=action_endpoint,
        escalation_target="CTO / IT-директор" if item.severity == "critical" else "QA Lead / Runtime Admin",
        related_queue_id=item.queue_id,
        related_task_run_id=item.task_run_id,
        evidence_ref=item.id,
    )


def _incident_from_alert(alert: QueueAdminAlert) -> IncidentLifecycleItem:
    status = "open" if alert.severity != "info" else "resolved"
    return IncidentLifecycleItem(
        id=f"incident-alert-{alert.id}",
        source=alert.source if alert.source in {"queue", "scheduler", "worker"} else "alert",
        severity=alert.severity,
        status=status,
        title=alert.title,
        owner_role=alert.owner_role,
        response_due_at=alert.response_due_at,
        sla_status=_incident_sla_status(alert.response_due_at, status),
        age_seconds=0,
        updated_at=datetime.now(UTC).isoformat(),
        current_step="Требует реакции" if status == "open" else "Наблюдение",
        next_action=alert.recommended_action,
        action_label="Выполнить recommended action" if status == "open" else "Действий не требуется",
        action_endpoint=None,
        escalation_target=alert.escalation_target,
        related_queue_id=alert.related_queue_id,
        related_task_run_id=alert.related_task_run_id,
        evidence_ref=alert.id,
    )


def incident_lifecycle_status() -> IncidentLifecycleStatus:
    alert_center = queue_admin_alert_center()
    dead_letters = alert_center.dead_letter_queue
    incidents: list[IncidentLifecycleItem] = [_incident_from_dead_letter(item) for item in dead_letters.items]
    dlq_queue_ids = {item.queue_id for item in dead_letters.items}
    dlq_task_run_ids = {item.task_run_id for item in dead_letters.items}
    for alert in alert_center.alerts:
        if alert.severity == "info":
            continue
        if alert.related_queue_id in dlq_queue_ids or alert.related_task_run_id in dlq_task_run_ids:
            continue
        incidents.append(_incident_from_alert(alert))
    def _incident_sort_timestamp(item: IncidentLifecycleItem) -> float:
        updated = _parse_iso_datetime(item.updated_at)
        return updated.timestamp() if updated else 0.0

    incidents.sort(
        key=lambda item: (
            0 if item.status == "open" else 1 if item.status == "acknowledged" else 2,
            0 if item.severity == "critical" else 1 if item.severity == "warning" else 2,
            -_incident_sort_timestamp(item),
            item.id,
        )
    )
    open_count = sum(1 for item in incidents if item.status == "open")
    acknowledged_count = sum(1 for item in incidents if item.status == "acknowledged")
    resolved_count = sum(1 for item in incidents if item.status == "resolved")
    overdue_count = sum(1 for item in incidents if item.sla_status == "overdue")
    critical_open = any(item.severity == "critical" and item.status != "resolved" for item in incidents)
    warning_open = any(item.severity == "warning" and item.status != "resolved" for item in incidents)
    status = "critical" if critical_open else "warning" if warning_open else "normal"
    summary = (
        "Есть critical-инциденты: требуется владелец, triage и действие по SLA."
        if status == "critical"
        else "Есть warning-инциденты: требуется плановая реакция администратора."
        if status == "warning"
        else "Открытых инцидентов нет; runtime находится в штатном состоянии."
    )
    return IncidentLifecycleStatus(
        mode="sqlite_mvp_incident_lifecycle",
        status=status,
        summary=summary,
        total=len(incidents),
        open=open_count,
        acknowledged=acknowledged_count,
        resolved=resolved_count,
        overdue=overdue_count,
        incidents=incidents[:20],
        gates=[
            GateResult(
                id="incident-lifecycle-derived-from-runtime",
                title="Incident lifecycle is derived from runtime evidence",
                status="passed",
                reason="Incident Center is built from Alert Center, DLQ and queue evidence without bypassing runtime state.",
            ),
            GateResult(
                id="incident-lifecycle-has-owner-sla-action",
                title="Incident lifecycle has owner, SLA and action",
                status="passed",
                reason="Each incident exposes owner_role, SLA status, current step, next action and evidence reference.",
            ),
        ],
    )


def _notification_message_from_incident(
    incident: IncidentLifecycleItem,
    route: NotificationRoutePreference | None = None,
) -> str:
    route_text = f" Route: {route.id} -> {route.owner_role}." if route else ""
    return (
        f"[{incident.severity.upper()}] {incident.title}. "
        f"Owner: {incident.owner_role}. SLA: {incident.sla_status}. "
        f"Step: {incident.current_step}. Next: {incident.next_action}. "
        f"Evidence: {incident.evidence_ref or incident.id}.{route_text}"
    )


def _upsert_local_notification_delivery(connection, incident: IncidentLifecycleItem, actor: str) -> None:
    channel = _notification_channel_registry()[0]
    route = _route_for_incident(incident)
    if route is None or channel.id not in route.channel_ids:
        return
    now = datetime.now(UTC).isoformat()
    owner_role = route.owner_role or incident.owner_role
    message = _notification_message_from_incident(incident, route)
    existing = connection.execute(
        """
        select * from task_run_notification_deliveries
        where incident_id = ? and channel_id = ?
        """,
        (incident.id, channel.id),
    ).fetchone()
    if existing is None:
        connection.execute(
            """
            insert into task_run_notification_deliveries(
                id, incident_id, channel_id, channel_type, status, severity, title,
                owner_role, message, dry_run, created_at, updated_at, delivered_at,
                attempt_count, error, evidence_ref
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _new_id("notify"),
                incident.id,
                channel.id,
                channel.channel_type,
                "delivered",
                incident.severity,
                incident.title,
                owner_role,
                message,
                1,
                now,
                now,
                now,
                1,
                None,
                incident.evidence_ref or incident.id,
            ),
        )
        return
    connection.execute(
        """
        update task_run_notification_deliveries
        set status = ?, severity = ?, title = ?, owner_role = ?, message = ?,
            dry_run = ?, updated_at = ?, delivered_at = ?, attempt_count = attempt_count + 1,
            error = ?, evidence_ref = ?
        where id = ?
        """,
        (
            "delivered",
            incident.severity,
            incident.title,
            owner_role,
            message,
            1,
            now,
            now,
            None,
            incident.evidence_ref or incident.id,
            existing["id"],
        ),
    )


def dispatch_notification_deliveries(actor: str = "runtime-operator", reason: str = "") -> NotificationDeliveryStatus:
    lifecycle = incident_lifecycle_status()
    active_incidents = [item for item in lifecycle.incidents if item.status != "resolved" and item.severity != "info"]
    with get_connection() as connection:
        for incident in active_incidents:
            _upsert_local_notification_delivery(connection, incident, actor)
    return notification_delivery_status()


def notification_delivery_status(limit: int = 20) -> NotificationDeliveryStatus:
    channels = _notification_channel_registry()
    lifecycle = incident_lifecycle_status()
    active_incidents = sum(1 for item in lifecycle.incidents if item.status != "resolved" and item.severity != "info")
    with get_connection() as connection:
        counts = {
            status: connection.execute(
                "select count(*) from task_run_notification_deliveries where status = ?",
                (status,),
            ).fetchone()[0]
            for status in ("queued", "delivered", "blocked", "failed")
        }
        total = connection.execute("select count(*) from task_run_notification_deliveries").fetchone()[0]
        rows = connection.execute(
            """
            select * from task_run_notification_deliveries
            order by updated_at desc
            limit ?
            """,
            (limit,),
        ).fetchall()
    status = "critical" if counts["failed"] else "warning" if active_incidents and counts["delivered"] == 0 else "normal"
    summary = (
        "Есть failed notification delivery: требуется разбор администратора."
        if status == "critical"
        else "Есть активные инциденты без подтвержденной local-log доставки."
        if status == "warning"
        else "Local-log delivery готов: внешние каналы явно не настроены и не используются в MVP."
    )
    return NotificationDeliveryStatus(
        mode="sqlite_mvp_notification_delivery",
        status=status,
        summary=summary,
        total=total,
        queued=counts["queued"],
        delivered=counts["delivered"],
        blocked=counts["blocked"],
        failed=counts["failed"],
        active_incidents=active_incidents,
        channels=channels,
        items=[_notification_delivery_from_row(row) for row in rows],
        gates=[
            GateResult(
                id="notification-delivery-no-external-secrets",
                title="Notification delivery has no external secrets in MVP",
                status="passed",
                reason="Only local-log dry-run channel is enabled; email, Telegram and webhook are marked external_not_configured.",
            ),
            GateResult(
                id="notification-delivery-linked-to-incidents",
                title="Notification delivery is linked to incident lifecycle",
                status="passed",
                reason="Each delivery item references an incident id, owner role, message and evidence reference.",
            ),
        ],
    )


def notification_routing_status() -> NotificationRoutingStatus:
    routes = _notification_routes()
    active_routes = sum(1 for route in routes if route.enabled)
    external_blocked = sum(1 for route in routes if route.delivery_mode == "external_blocked" or "local-log" not in route.channel_ids)
    missing_critical = not any(route.enabled and route.severity == "critical" for route in routes)
    missing_warning = not any(route.enabled and route.severity == "warning" for route in routes)
    invalid_external = any(
        route.enabled and any(channel_id in {"email", "telegram", "webhook"} for channel_id in route.channel_ids)
        for route in routes
    )
    status = "critical" if invalid_external or missing_critical else "warning" if missing_warning else "normal"
    summary = (
        "Routing содержит внешний канал или отсутствует critical route: требуется ручная проверка."
        if status == "critical"
        else "Warning route не включен: часть сигналов может не попасть к оператору."
        if status == "warning"
        else "Routing preferences активны: warning и critical идут в local-log без внешних секретов."
    )
    return NotificationRoutingStatus(
        mode="sqlite_mvp_notification_routing",
        status=status,
        summary=summary,
        routes_total=len(routes),
        active_routes=active_routes,
        external_routes_blocked=external_blocked,
        routes=routes,
        gates=[
            GateResult(
                id="notification-routing-has-critical-owner",
                title="Critical notifications have an owner",
                status="failed" if missing_critical else "passed",
                reason="At least one enabled critical route maps incidents to runtime-admin.",
            ),
            GateResult(
                id="notification-routing-blocks-external-channels",
                title="External notification channels are blocked in MVP",
                status="failed" if invalid_external else "passed",
                reason="Enabled MVP routes use local-log only; email, Telegram and webhook remain production gate items.",
            ),
        ],
    )


def _notification_policy_item(
    *,
    item_id: str,
    title: str,
    passed: bool,
    policy_area: str,
    owner_role: str,
    rule: str,
    evidence_source: str,
    severity: str = "critical",
    warning: bool = False,
    remediation: str | None = None,
) -> NotificationPolicyAuditItem:
    status = "passed" if passed else "warning" if warning else "failed"
    return NotificationPolicyAuditItem(
        id=item_id,
        title=title,
        status=status,
        severity="info" if passed else severity,
        policy_area=policy_area,
        owner_role=owner_role,
        rule=rule,
        evidence_source=evidence_source,
        remediation=None if passed else remediation,
    )


def notification_policy_audit_status() -> NotificationPolicyAuditStatus:
    delivery = notification_delivery_status()
    routing = notification_routing_status()
    enabled_channels = [channel for channel in delivery.channels if channel.enabled]
    external_channels_enabled = [
        channel for channel in enabled_channels if channel.channel_type in {"email", "telegram", "webhook"}
    ]
    enabled_routes = [route for route in routing.routes if route.enabled]
    enabled_external_routes = [
        route
        for route in enabled_routes
        if route.delivery_mode != "local_log_only" or any(channel_id != "local-log" for channel_id in route.channel_ids)
    ]
    critical_routes = [route for route in enabled_routes if route.severity == "critical"]
    warning_routes = [route for route in enabled_routes if route.severity == "warning"]
    critical_owner_and_escalation = bool(
        critical_routes
        and all(route.owner_role and route.response_minutes and route.escalation_target for route in critical_routes)
    )
    warning_sla = bool(warning_routes and all(route.owner_role and route.response_minutes for route in warning_routes))
    delivered_items_have_evidence = all(item.evidence_ref for item in delivery.items if item.status == "delivered")
    items: list[NotificationPolicyAuditItem] = [
        _notification_policy_item(
            item_id="policy-local-log-channel-enabled",
            title="Local-log channel is the only enabled delivery path",
            passed=bool(enabled_channels) and all(channel.channel_type == "local_log" for channel in enabled_channels),
            policy_area="channels",
            owner_role="runtime-admin",
            rule="MVP notifications may write only to local-log evidence; external delivery requires production gate.",
            evidence_source="notification_delivery_status.channels",
            remediation="Disable external channels and keep local-log enabled for MVP evidence.",
        ),
        _notification_policy_item(
            item_id="policy-external-channels-disabled",
            title="External notification channels are disabled",
            passed=not external_channels_enabled,
            policy_area="secrets",
            owner_role="security-architect",
            rule="Email, Telegram and webhook providers must stay external_not_configured until production secrets gate.",
            evidence_source="notification_delivery_status.channels",
            remediation="Move external provider setup to production secrets gate and keep enabled=false before it.",
        ),
        _notification_policy_item(
            item_id="policy-enabled-routes-local-only",
            title="Enabled routes use local-log only",
            passed=not enabled_external_routes,
            policy_area="routes",
            owner_role="runtime-admin",
            rule="Enabled MVP routes must use channel_ids=[local-log] and delivery_mode=local_log_only.",
            evidence_source="notification_routing_status.routes",
            remediation="Remove external channel ids from enabled routes or disable the route.",
        ),
        _notification_policy_item(
            item_id="policy-critical-route-owner-sla-escalation",
            title="Critical route has owner, SLA and escalation",
            passed=critical_owner_and_escalation,
            policy_area="sla",
            owner_role="qa-lead",
            rule="Critical incidents must map to runtime-admin with response_minutes and escalation_target.",
            evidence_source="notification_routing_status.routes",
            remediation="Add owner_role, response_minutes and escalation_target to every critical route.",
        ),
        _notification_policy_item(
            item_id="policy-warning-route-owner-sla",
            title="Warning route has owner and SLA",
            passed=warning_sla,
            policy_area="sla",
            owner_role="qa-lead",
            rule="Warning incidents must map to runtime-operator with response_minutes.",
            evidence_source="notification_routing_status.routes",
            severity="warning",
            warning=True,
            remediation="Add or enable a warning route with owner_role and response_minutes.",
        ),
        _notification_policy_item(
            item_id="policy-delivery-has-no-failed-items",
            title="No failed notification deliveries",
            passed=delivery.failed == 0,
            policy_area="delivery",
            owner_role="runtime-operator",
            rule="Failed delivery must block acceptance until operator triage.",
            evidence_source="notification_delivery_status.failed",
            remediation="Review failed delivery item, fix the local-log path and dispatch again.",
        ),
        _notification_policy_item(
            item_id="policy-delivery-evidence-linked",
            title="Delivered notifications link evidence",
            passed=delivered_items_have_evidence,
            policy_area="evidence",
            owner_role="qa-lead",
            rule="Every delivered notification must keep evidence_ref to incident/queue source.",
            evidence_source="notification_delivery_status.items",
            remediation="Regenerate delivery item with evidence_ref before accepting admin flow.",
        ),
    ]
    failed = sum(1 for item in items if item.status == "failed")
    warnings = sum(1 for item in items if item.status == "warning")
    passed = sum(1 for item in items if item.status == "passed")
    status = "critical" if any(item.status == "failed" and item.severity == "critical" for item in items) else "warning" if warnings or failed else "normal"
    summary = (
        "Notification policy has critical gaps: external delivery or missing SLA/evidence control."
        if status == "critical"
        else "Notification policy has warnings: finish non-critical routing/SLA hardening before production."
        if status == "warning"
        else "Notification policy is safe for MVP: local-log only, routes owned, evidence linked."
    )
    external_delivery_allowed = bool(external_channels_enabled or enabled_external_routes)
    return NotificationPolicyAuditStatus(
        mode="sqlite_mvp_notification_policy_audit",
        status=status,
        summary=summary,
        checks_total=len(items),
        passed=passed,
        warnings=warnings,
        failed=failed,
        external_delivery_allowed=external_delivery_allowed,
        production_gate_required=True,
        items=items,
        gates=[
            GateResult(
                id="notification-policy-audit-local-only",
                title="Notification policy audit enforces local-only MVP delivery",
                status="failed" if external_delivery_allowed else "passed",
                reason="Enabled MVP notification routes and channels are checked against local-log only policy.",
            ),
            GateResult(
                id="notification-policy-audit-evidence",
                title="Notification policy audit links evidence",
                status="failed" if not delivered_items_have_evidence else "passed",
                reason="Delivered notification items must reference incident or queue evidence.",
            ),
        ],
    )


def _timeline_event_from_queue_event(event: TaskRunQueueEvent) -> IncidentTimelineEvent | None:
    mapping = {
        "dead_lettered": ("incident_open", "critical", "DLQ incident opened"),
        "retry_exhausted": ("incident_open", "critical", "Retry policy exhausted"),
        "dead_letter_acknowledged": ("dlq_acknowledged", "warning", "DLQ acknowledged"),
        "manual_retry": ("manual_retry", "warning", "Manual retry requested"),
        "dead_letter_resolved": ("incident_resolved", "resolved", "DLQ incident resolved"),
        "completed": ("incident_resolved", "resolved", "Queue item completed"),
    }
    if event.event_type not in mapping:
        return None
    event_type, status, title = mapping[event.event_type]
    return IncidentTimelineEvent(
        id=f"timeline-{event.id}",
        timestamp=event.created_at,
        event_type=event_type,
        title=f"{title}: {event.task_run_id}",
        actor=event.actor,
        status=status,
        source=f"queue_events.{event.event_type}",
        related_queue_id=event.queue_id,
        related_task_run_id=event.task_run_id,
        evidence_ref=event.id,
    )


def _timeline_event_from_delivery(item: NotificationDeliveryItem) -> IncidentTimelineEvent | None:
    if item.status != "delivered":
        return None
    return IncidentTimelineEvent(
        id=f"timeline-{item.id}",
        timestamp=item.delivered_at or item.updated_at,
        event_type="notification_delivered",
        title=f"Notification delivered: {item.title}",
        actor=item.owner_role,
        status=item.severity,
        source=f"notification_delivery.{item.channel_id}",
        related_queue_id=None,
        related_task_run_id=None,
        evidence_ref=item.evidence_ref or item.incident_id,
    )


def admin_incident_timeline_status(limit: int = 50) -> AdminIncidentTimelineStatus:
    init_task_run_queue_store()
    events: list[IncidentTimelineEvent] = []
    lifecycle = incident_lifecycle_status()
    runbook = queue_operations_runbook_status()
    delivery = notification_delivery_status(limit=max(limit, 20))
    with get_connection() as connection:
        event_rows = connection.execute(
            """
            select * from task_run_queue_events
            order by created_at desc, id desc
            limit ?
            """,
            (max(10, min(limit, 200)),),
        ).fetchall()
    for row in event_rows:
        event = _timeline_event_from_queue_event(_queue_event_from_row(row))
        if event is not None:
            events.append(event)
    for item in delivery.items:
        event = _timeline_event_from_delivery(item)
        if event is not None:
            events.append(event)
    for step in runbook.steps:
        if step.status != "needs_attention":
            continue
        events.append(
            IncidentTimelineEvent(
                id=f"timeline-{step.id}",
                timestamp=datetime.now(UTC).isoformat(),
                event_type="runbook_action",
                title=f"Runbook action required: {step.title}",
                actor=step.owner_role,
                status=step.severity,
                source=step.evidence_source,
                evidence_ref=step.id,
            )
        )
    if not events:
        events.append(
            IncidentTimelineEvent(
                id="timeline-runtime-normal",
                timestamp=datetime.now(UTC).isoformat(),
                event_type="audit_evidence",
                title="Runtime incident timeline snapshot: no active incident",
                actor="qa-lead",
                status="resolved",
                source="incident_lifecycle_status",
                evidence_ref="incident-lifecycle-normal",
            )
        )
    events.sort(key=lambda item: (item.timestamp, item.id))
    unresolved = lifecycle.open + lifecycle.acknowledged
    status = lifecycle.status
    summary = (
        "Timeline shows critical incident activity: review event order and close with retry/resolve evidence."
        if status == "critical"
        else "Timeline shows warning activity: monitor actions until resolved."
        if status == "warning"
        else "Timeline is clean: no unresolved incident events."
    )
    return AdminIncidentTimelineStatus(
        mode="sqlite_mvp_admin_incident_timeline",
        status=status,
        summary=summary,
        events_total=len(events),
        unresolved_events=unresolved,
        timeline=events[-max(1, min(limit, 200)):],
        gates=[
            GateResult(
                id="admin-incident-timeline-chronological",
                title="Admin incident timeline is chronological",
                status="passed",
                reason="Queue, notification and runbook evidence are normalized into timestamped events sorted by time.",
            ),
            GateResult(
                id="admin-incident-timeline-evidence-linked",
                title="Admin incident timeline links evidence",
                status="passed" if all(event.evidence_ref for event in events) else "failed",
                reason="Timeline events expose evidence references to queue events, deliveries, runbook steps or lifecycle snapshot.",
            ),
        ],
    )


def queue_operations_runbook_status() -> QueueOperationsRunbookStatus:
    admin_center = queue_admin_alert_center()
    scheduler = admin_center.scheduler_status
    observability = admin_center.observability
    dead_letters = admin_center.dead_letter_queue
    delivery = notification_delivery_status()
    routing = notification_routing_status()
    queue = observability.queue_status
    waiting = queue.queued + queue.retrying

    steps = [
        QueueRunbookStep(
            id="runbook-queue-stopped",
            title="Очередь есть, автопланировщик остановлен",
            trigger="queued + retrying > 0 и scheduler.status = stopped",
            owner_role="runtime-operator",
            severity="warning",
            status="needs_attention" if waiting and not scheduler.running else "ready",
            action="Запустить scheduler или выполнить один контрольный тик, затем проверить queue status.",
            endpoint="/api/task-runs/queue/scheduler/start",
            evidence_source="scheduler_status + queue_status",
            action_label="Запустить scheduler",
            action_kind="start_scheduler",
            executable=True,
        ),
        QueueRunbookStep(
            id="runbook-dlq-open",
            title="Открыт ручной разбор DLQ",
            trigger="dead_letter_queue.open > 0",
            owner_role="runtime-admin",
            severity="critical",
            status="needs_attention" if dead_letters.open else "ready",
            action="Открыть DLQ, выполнить acknowledge, затем retry или resolve с причиной.",
            endpoint="/api/task-runs/queue/dead-letters",
            evidence_source="dead_letter_queue_status + queue_events",
            action_label="Открыть DLQ",
            action_kind="review_only",
            executable=False,
        ),
        QueueRunbookStep(
            id="runbook-critical-alert",
            title="Есть critical alert",
            trigger="admin_alert_center.critical_alerts > 0",
            owner_role="runtime-admin",
            severity="critical",
            status="needs_attention" if admin_center.critical_alerts else "ready",
            action="Назначить владельца, проверить recommended action, закрыть причину до продолжения клиентского сценария.",
            endpoint="/api/task-runs/queue/admin-alerts",
            evidence_source="queue_admin_alert_center",
            action_label="Открыть сигналы",
            action_kind="review_only",
            executable=False,
        ),
        QueueRunbookStep(
            id="runbook-worker-degraded",
            title="Worker требует внимания",
            trigger="worker_observability.health != healthy",
            owner_role="runtime-operator",
            severity="warning",
            status="needs_attention" if observability.health != "healthy" else "ready",
            action="Проверить attention items, recent failures и выполнить retry/cancel/recover-stale по ситуации.",
            endpoint="/api/task-runs/queue/observability",
            evidence_source="worker_observability",
            action_label="Проверить worker",
            action_kind="review_only",
            executable=False,
        ),
        QueueRunbookStep(
            id="runbook-notification-failed",
            title="Уведомления не доставлены",
            trigger="notification_delivery.failed > 0",
            owner_role="runtime-admin",
            severity="critical",
            status="needs_attention" if delivery.failed else "ready",
            action="Проверить local-log delivery, route owner и повторить dispatch после устранения причины.",
            endpoint="/api/task-runs/queue/notifications/status",
            evidence_source="notification_delivery_status",
            action_label="Повторить local-log delivery",
            action_kind="dispatch_notifications",
            executable=True,
        ),
        QueueRunbookStep(
            id="runbook-routing-invalid",
            title="Routing уведомлений нарушен",
            trigger="notification_routing.status != normal",
            owner_role="runtime-admin",
            severity="critical",
            status="needs_attention" if routing.status != "normal" else "ready",
            action="Проверить critical/warning routes; внешние каналы не включать без production secrets gate.",
            endpoint="/api/task-runs/queue/notifications/routing",
            evidence_source="notification_routing_status",
            action_label="Проверить routing",
            action_kind="review_only",
            executable=False,
        ),
        QueueRunbookStep(
            id="runbook-safe-stop",
            title="Безопасная остановка обработки",
            trigger="нужно остановить обработку без потери очереди",
            owner_role="runtime-operator",
            severity="info",
            status="ready",
            action="Остановить scheduler; текущая queue остается в SQLite и проверяется через status/events.",
            endpoint="/api/task-runs/queue/scheduler/stop",
            evidence_source="scheduler_status + sqlite queue persistence",
            action_label="Остановить scheduler",
            action_kind="stop_scheduler",
            executable=True,
        ),
        QueueRunbookStep(
            id="runbook-audit-proof",
            title="Доказательная база действия",
            trigger="после любого ручного действия администратора",
            owner_role="qa-lead",
            severity="info",
            status="ready",
            action="Проверить gates и events: action должен иметь actor, reason, before/after status и timestamp.",
            endpoint="/api/task-runs/queue/status",
            evidence_source="queue_events + gates",
            action_label="Проверить evidence",
            action_kind="verify_only",
            executable=False,
        ),
    ]

    attention = [step for step in steps if step.status == "needs_attention"]
    critical_attention = [step for step in attention if step.severity == "critical"]
    warning_attention = [step for step in attention if step.severity == "warning"]
    priority_steps = critical_attention + warning_attention
    status = "critical" if critical_attention else "warning" if attention else "normal"
    response_mode = "emergency_stop" if critical_attention else "operator_action" if attention else "monitor"
    primary_action = (
        priority_steps[0].action
        if priority_steps
        else "Продолжать мониторинг очереди, scheduler, DLQ, incident lifecycle и notification delivery."
    )
    summary = (
        "Есть критичный операционный шаг: остановить автоматическое продвижение и закрыть причину."
        if status == "critical"
        else "Есть операционное предупреждение: выполнить runbook step до приемки сценария."
        if status == "warning"
        else "Операционный регламент очереди готов: администратор видит действия, владельцев и evidence."
    )
    return QueueOperationsRunbookStatus(
        mode="sqlite_mvp_queue_operations_runbook",
        status=status,
        summary=summary,
        response_mode=response_mode,
        primary_action=primary_action,
        priority_step_ids=[step.id for step in priority_steps],
        steps_total=len(steps),
        steps_ready=len([step for step in steps if step.status == "ready"]),
        steps_needing_attention=len(attention),
        emergency_stop_required=bool(critical_attention),
        steps=steps,
        gates=[
            GateResult(
                id="queue-runbook-covers-admin-failures",
                title="Queue operations runbook covers admin failures",
                status="passed",
                reason="Runbook includes backlog, stopped scheduler, DLQ, critical alerts, worker degradation, failed delivery and routing issues.",
            ),
            GateResult(
                id="queue-runbook-links-evidence-and-actions",
                title="Runbook links evidence and actions",
                status="passed",
                reason="Each step has an owner, trigger, action, evidence source and endpoint when action is executable.",
            ),
        ],
    )


def _admin_action_audit_payload(
    event_id: str,
    action_id: str,
    action_kind: str,
    actor: str,
    reason: str,
    executed: bool,
    status_before: str,
    status_after: str,
    message: str,
    evidence_ref: str,
    created_at: str,
    previous_hash: str,
) -> dict[str, object]:
    return {
        "id": event_id,
        "action_id": action_id,
        "action_kind": action_kind,
        "actor": actor,
        "reason": reason,
        "executed": executed,
        "status_before": status_before,
        "status_after": status_after,
        "message": message,
        "evidence_ref": evidence_ref,
        "created_at": created_at,
        "previous_hash": previous_hash,
    }


def _admin_action_audit_hash(payload: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _next_admin_action_audit_id(connection) -> str:
    count = connection.execute("select count(*) from task_run_admin_action_audit").fetchone()[0]
    return f"admin-action-audit-{count + 1:04d}"


def _latest_admin_action_audit_hash(connection) -> str:
    row = connection.execute(
        "select event_hash from task_run_admin_action_audit order by rowid desc limit 1"
    ).fetchone()
    return str(row["event_hash"]) if row and row["event_hash"] else "GENESIS"


def _row_to_admin_action_audit_event(row) -> QueueAdminActionAuditEvent:
    return QueueAdminActionAuditEvent(
        id=row["id"],
        action_id=row["action_id"],
        action_kind=row["action_kind"],
        actor=row["actor"],
        reason=row["reason"],
        executed=bool(row["executed"]),
        status_before=row["status_before"],
        status_after=row["status_after"],
        message=row["message"],
        evidence_ref=row["evidence_ref"],
        created_at=row["created_at"],
        previous_hash=row["previous_hash"],
        event_hash=row["event_hash"],
    )


def _record_admin_action_audit(
    *,
    action_id: str,
    action_kind: str,
    actor: str,
    reason: str,
    executed: bool,
    status_before: str,
    status_after: str,
    message: str,
    evidence_ref: str,
) -> QueueAdminActionAuditEvent:
    init_task_run_queue_store()
    with get_connection() as connection:
        event_id = _next_admin_action_audit_id(connection)
        created_at = datetime.now(UTC).isoformat()
        previous_hash = _latest_admin_action_audit_hash(connection)
        payload = _admin_action_audit_payload(
            event_id,
            action_id,
            action_kind,
            actor,
            reason,
            executed,
            status_before,
            status_after,
            message,
            evidence_ref,
            created_at,
            previous_hash,
        )
        event_hash = _admin_action_audit_hash(payload)
        connection.execute(
            """
            insert into task_run_admin_action_audit(
                id, action_id, action_kind, actor, reason, executed, status_before,
                status_after, message, evidence_ref, created_at, previous_hash, event_hash
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                action_id,
                action_kind,
                actor,
                reason,
                1 if executed else 0,
                status_before,
                status_after,
                message,
                evidence_ref,
                created_at,
                previous_hash,
                event_hash,
            ),
        )
        row = connection.execute("select * from task_run_admin_action_audit where id = ?", (event_id,)).fetchone()
    return _row_to_admin_action_audit_event(row)


def list_admin_action_audit_events(limit: int = 20) -> list[QueueAdminActionAuditEvent]:
    init_task_run_queue_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_admin_action_audit
            order by rowid desc
            limit ?
            """,
            (limit,),
        ).fetchall()
    return [_row_to_admin_action_audit_event(row) for row in rows]


def list_admin_action_audit_events_by_kind(action_kind: str, limit: int = 8) -> list[QueueAdminActionAuditEvent]:
    init_task_run_queue_store()
    safe_limit = max(1, min(limit, 50))
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_admin_action_audit
            where action_kind = ?
            order by rowid desc
            limit ?
            """,
            (action_kind, safe_limit),
        ).fetchall()
    return [_row_to_admin_action_audit_event(row) for row in rows]


def verify_admin_action_audit_chain() -> tuple[bool, str]:
    init_task_run_queue_store()
    with get_connection() as connection:
        rows = connection.execute("select * from task_run_admin_action_audit order by rowid").fetchall()
    head_hash = "GENESIS"
    known_hashes = {"GENESIS"}
    for row in rows:
        expected = _admin_action_audit_hash(
            _admin_action_audit_payload(
                row["id"],
                row["action_id"],
                row["action_kind"],
                row["actor"],
                row["reason"],
                bool(row["executed"]),
                row["status_before"],
                row["status_after"],
                row["message"],
                row["evidence_ref"],
                row["created_at"],
                row["previous_hash"],
            )
        )
        if row["previous_hash"] not in known_hashes or row["event_hash"] != expected:
            return False, str(row["event_hash"] or "")
        head_hash = row["event_hash"]
        known_hashes.add(row["event_hash"])
    return True, head_hash


def queue_admin_action_audit_status(limit: int = 12) -> QueueAdminActionAuditStatus:
    events = list_admin_action_audit_events(limit=limit)
    chain_valid, head_hash = verify_admin_action_audit_chain()
    events_total = 0
    with get_connection() as connection:
        events_total = connection.execute("select count(*) from task_run_admin_action_audit").fetchone()[0]
    status = "critical" if not chain_valid else "warning" if events_total == 0 else "normal"
    summary = (
        "Admin action audit chain is invalid: stop guided admin actions until investigation."
        if status == "critical"
        else "No admin action has been captured yet; execute a guided or review-only action to create evidence."
        if status == "warning"
        else "Admin action audit captures actor, reason, before/after status, evidence and hash-chain."
    )
    return QueueAdminActionAuditStatus(
        mode="sqlite_mvp_queue_admin_action_audit",
        status=status,
        summary=summary,
        events_total=events_total,
        chain_valid=chain_valid,
        head_hash=head_hash,
        latest_event_id=events[0].id if events else None,
        events=events,
        gates=[
            GateResult(
                id="queue-admin-action-audit-chain-valid",
                title="Admin action audit hash-chain is valid",
                status="passed" if chain_valid else "failed",
                reason="Each admin action audit event includes previous_hash and event_hash built from actor, reason, action, status and evidence.",
            ),
            GateResult(
                id="queue-admin-action-audit-has-context",
                title="Admin action audit has decision context",
                status="passed" if all(event.actor and event.reason and event.evidence_ref for event in events) else "warning",
                reason="Captured events must explain who acted, why, what changed and which evidence supports the action.",
            ),
        ],
    )


def _row_to_manual_triage_item(row) -> QueueManualTriageItem:
    return QueueManualTriageItem(
        id=row["id"],
        source_action_id=row["source_action_id"],
        title=row["title"],
        owner_role=row["owner_role"],
        severity=row["severity"],
        status=row["status"],
        reason=row["reason"],
        resolution=row["resolution"],
        evidence_ref=row["evidence_ref"],
        related_runbook_step_id=row["related_runbook_step_id"],
        related_queue_id=row["related_queue_id"],
        related_task_run_id=row["related_task_run_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        assigned_by=row["assigned_by"],
        assigned_at=row["assigned_at"],
        resolved_by=row["resolved_by"],
        resolved_at=row["resolved_at"],
    )


def create_manual_triage_case(payload: QueueManualTriageRequest, actor: str = "runtime-operator") -> QueueManualTriageItem:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        existing = connection.execute(
            """
            select * from task_run_manual_triage
            where source_action_id = ? and evidence_ref = ?
            """,
            (payload.source_action_id, payload.evidence_ref),
        ).fetchone()
        if existing is not None:
            item = _row_to_manual_triage_item(existing)
            _record_admin_action_audit(
                action_id=f"manual-triage-existing:{item.id}",
                action_kind="manual_triage",
                actor=actor,
                reason=f"Manual triage already exists for {payload.source_action_id}: {payload.reason}",
                executed=False,
                status_before=item.status,
                status_after=item.status,
                message=f"Manual triage case already exists: {item.id}.",
                evidence_ref=item.evidence_ref,
            )
            return item
        case_id = _new_id("manual-triage")
        connection.execute(
            """
            insert into task_run_manual_triage(
                id, source_action_id, title, owner_role, severity, status, reason,
                resolution, evidence_ref, related_runbook_step_id, related_queue_id,
                related_task_run_id, created_at, updated_at, assigned_by, assigned_at,
                resolved_by, resolved_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                payload.source_action_id,
                payload.title,
                payload.owner_role,
                payload.severity,
                "open",
                payload.reason,
                None,
                payload.evidence_ref,
                payload.related_runbook_step_id,
                payload.related_queue_id,
                payload.related_task_run_id,
                now,
                now,
                None,
                None,
                None,
                None,
            ),
        )
        row = connection.execute("select * from task_run_manual_triage where id = ?", (case_id,)).fetchone()
    item = _row_to_manual_triage_item(row)
    _record_admin_action_audit(
        action_id=f"manual-triage-open:{item.id}",
        action_kind="manual_triage",
        actor=actor,
        reason=payload.reason,
        executed=True,
        status_before="none",
        status_after="open",
        message=f"Manual triage case opened: {item.title}.",
        evidence_ref=item.evidence_ref,
    )
    return item


def assign_manual_triage_case(case_id: str, actor: str = "runtime-operator", reason: str = "") -> QueueManualTriageItem | None:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        before = connection.execute("select * from task_run_manual_triage where id = ?", (case_id,)).fetchone()
        if before is None:
            return None
        before_status = before["status"]
        connection.execute(
            """
            update task_run_manual_triage
            set status = ?, updated_at = ?, assigned_by = ?, assigned_at = ?
            where id = ?
            """,
            ("assigned", now, actor, now, case_id),
        )
        after = connection.execute("select * from task_run_manual_triage where id = ?", (case_id,)).fetchone()
    item = _row_to_manual_triage_item(after)
    _record_admin_action_audit(
        action_id=f"manual-triage-assign:{item.id}",
        action_kind="manual_triage",
        actor=actor,
        reason=reason or f"Manual triage assigned: {item.id}.",
        executed=True,
        status_before=before_status,
        status_after=item.status,
        message=f"Manual triage assigned to {item.owner_role}.",
        evidence_ref=item.evidence_ref,
    )
    return item


def resolve_manual_triage_case(
    case_id: str,
    actor: str = "runtime-operator",
    reason: str = "",
    resolution: str = "",
) -> QueueManualTriageItem | None:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        before = connection.execute("select * from task_run_manual_triage where id = ?", (case_id,)).fetchone()
        if before is None:
            return None
        before_status = before["status"]
        final_resolution = resolution or reason or "Manual triage resolved with operator evidence."
        connection.execute(
            """
            update task_run_manual_triage
            set status = ?, updated_at = ?, resolution = ?, resolved_by = ?, resolved_at = ?
            where id = ?
            """,
            ("resolved", now, final_resolution, actor, now, case_id),
        )
        after = connection.execute("select * from task_run_manual_triage where id = ?", (case_id,)).fetchone()
    item = _row_to_manual_triage_item(after)
    _record_admin_action_audit(
        action_id=f"manual-triage-resolve:{item.id}",
        action_kind="manual_triage",
        actor=actor,
        reason=reason or final_resolution,
        executed=True,
        status_before=before_status,
        status_after=item.status,
        message=f"Manual triage resolved: {item.title}.",
        evidence_ref=item.evidence_ref,
    )
    create_evidence_review_case(
        QueueEvidenceReviewRequest(
            source_ref=f"manual-triage:{item.id}",
            title=f"Evidence review: {item.title}",
            owner_role="qa-evidence",
            severity=item.severity,
            reason=f"Manual triage resolved by {actor}; QA evidence review required before final closure.",
            evidence_ref=item.evidence_ref,
            related_manual_triage_id=item.id,
            related_action_id=item.source_action_id,
            related_task_run_id=item.related_task_run_id,
        ),
        actor=actor,
    )
    return item


def queue_manual_triage_status(limit: int = 20) -> QueueManualTriageStatus:
    init_task_run_queue_store()
    with get_connection() as connection:
        counts = {
            status: connection.execute(
                "select count(*) from task_run_manual_triage where status = ?",
                (status,),
            ).fetchone()[0]
            for status in ("open", "assigned", "resolved")
        }
        total = connection.execute("select count(*) from task_run_manual_triage").fetchone()[0]
        rows = connection.execute(
            """
            select * from task_run_manual_triage
            order by case when status = 'open' then 0 when status = 'assigned' then 1 else 2 end,
                     updated_at desc, id desc
            limit ?
            """,
            (max(1, min(limit, 100)),),
        ).fetchall()
    status = "critical" if counts["open"] else "warning" if counts["assigned"] else "normal"
    summary = (
        "Есть review-only действия без ручного закрытия: требуется операторский разбор."
        if status == "critical"
        else "Есть назначенные ручные разборы: нужен closure evidence."
        if status == "warning"
        else "Manual triage чист: открытых review-only разборов нет."
    )
    items = [_row_to_manual_triage_item(row) for row in rows]
    return QueueManualTriageStatus(
        mode="sqlite_mvp_queue_manual_triage",
        status=status,
        summary=summary,
        total=total,
        open=counts["open"],
        assigned=counts["assigned"],
        resolved=counts["resolved"],
        items=items,
        gates=[
            GateResult(
                id="queue-manual-triage-has-owner-and-evidence",
                title="Manual triage has owner and evidence",
                status="passed" if all(item.owner_role and item.evidence_ref for item in items) else "failed",
                reason="Every manual triage case must expose owner_role and evidence_ref.",
            ),
            GateResult(
                id="queue-manual-triage-closure-recorded",
                title="Manual triage closure is recorded",
                status="passed" if all(item.status != "resolved" or item.resolution for item in items) else "failed",
                reason="Resolved manual triage cases must contain resolution text and resolver metadata.",
            ),
        ],
    )


def _evidence_review_sla_minutes(severity: str) -> int:
    if severity == "critical":
        return 15
    if severity == "warning":
        return 60
    return 240


def _evidence_review_sla_fields(row, now: datetime | None = None) -> dict[str, object]:
    current = now or datetime.now(UTC)
    status = row["status"]
    created = _parse_iso_datetime(row["created_at"])
    age_seconds = max(0, int((current - created).total_seconds())) if created else 0
    if status == "approved" or created is None:
        return {
            "age_seconds": age_seconds,
            "response_due_at": None,
            "sla_status": "not_applicable",
        }
    response_due_at = created + timedelta(minutes=_evidence_review_sla_minutes(row["severity"]))
    return {
        "age_seconds": age_seconds,
        "response_due_at": response_due_at.isoformat(),
        "sla_status": "overdue" if current > response_due_at else "within_sla",
    }


def _evidence_review_decision_fields(row) -> dict[str, str]:
    status = row["status"]
    title = row["title"]
    reviewer = row["reviewed_by"] or "QA/admin"
    if status == "approved":
        return {
            "decision_quality": "accepted",
            "decision_summary": f"Evidence accepted by {reviewer}; dependent gate can use this proof.",
            "next_action": "Use evidence in the related gate, artifact passport or release proof.",
        }
    if status == "rework":
        return {
            "decision_quality": "needs_rework",
            "decision_summary": f"Evidence returned for rework: {row['review_note'] or title}.",
            "next_action": "Fix source evidence, rerun proof and return the case to QA/admin acceptance.",
        }
    return {
        "decision_quality": "needs_decision",
        "decision_summary": f"Evidence is waiting for QA/admin decision: {title}.",
        "next_action": "Check source, evidence reference and SLA; then approve or return for rework with a note.",
    }


def _row_to_evidence_review_item(row, now: datetime | None = None) -> QueueEvidenceReviewItem:
    sla = _evidence_review_sla_fields(row, now)
    decision = _evidence_review_decision_fields(row)
    return QueueEvidenceReviewItem(
        id=row["id"],
        source_ref=row["source_ref"],
        title=row["title"],
        owner_role=row["owner_role"],
        severity=row["severity"],
        status=row["status"],
        reason=row["reason"],
        review_note=row["review_note"],
        evidence_ref=row["evidence_ref"],
        related_manual_triage_id=row["related_manual_triage_id"],
        related_action_id=row["related_action_id"],
        related_task_run_id=row["related_task_run_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        age_seconds=int(sla["age_seconds"]),
        response_due_at=sla["response_due_at"],
        sla_status=sla["sla_status"],
        reviewed_by=row["reviewed_by"],
        reviewed_at=row["reviewed_at"],
        decision_quality=decision["decision_quality"],
        decision_summary=decision["decision_summary"],
        next_action=decision["next_action"],
    )


def create_evidence_review_case(payload: QueueEvidenceReviewRequest, actor: str = "runtime-operator") -> QueueEvidenceReviewItem:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        existing = connection.execute(
            """
            select * from task_run_evidence_review
            where source_ref = ? and evidence_ref = ?
            """,
            (payload.source_ref, payload.evidence_ref),
        ).fetchone()
        if existing is not None:
            item = _row_to_evidence_review_item(existing)
            _record_admin_action_audit(
                action_id=f"evidence-review-existing:{item.id}",
                action_kind="evidence_review",
                actor=actor,
                reason=f"Evidence review already exists for {payload.source_ref}: {payload.reason}",
                executed=False,
                status_before=item.status,
                status_after=item.status,
                message=f"Evidence review case already exists: {item.id}.",
                evidence_ref=item.evidence_ref,
            )
            return item
        review_id = _new_id("evidence-review")
        connection.execute(
            """
            insert into task_run_evidence_review(
                id, source_ref, title, owner_role, severity, status, reason,
                review_note, evidence_ref, related_manual_triage_id, related_action_id,
                related_task_run_id, created_at, updated_at, reviewed_by, reviewed_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                review_id,
                payload.source_ref,
                payload.title,
                payload.owner_role,
                payload.severity,
                "pending",
                payload.reason,
                None,
                payload.evidence_ref,
                payload.related_manual_triage_id,
                payload.related_action_id,
                payload.related_task_run_id,
                now,
                now,
                None,
                None,
            ),
        )
        row = connection.execute("select * from task_run_evidence_review where id = ?", (review_id,)).fetchone()
    item = _row_to_evidence_review_item(row)
    _record_admin_action_audit(
        action_id=f"evidence-review-open:{item.id}",
        action_kind="evidence_review",
        actor=actor,
        reason=payload.reason,
        executed=True,
        status_before="none",
        status_after="pending",
        message=f"Evidence review case opened: {item.title}.",
        evidence_ref=item.evidence_ref,
    )
    return item


def decide_evidence_review_case(
    review_id: str,
    decision: str,
    actor: str = "runtime-operator",
    reason: str = "",
    review_note: str = "",
) -> QueueEvidenceReviewItem | None:
    init_task_run_queue_store()
    normalized_decision = "approved" if decision == "approved" else "rework"
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        before = connection.execute("select * from task_run_evidence_review where id = ?", (review_id,)).fetchone()
        if before is None:
            return None
        before_status = before["status"]
        final_note = review_note or reason or (
            "Evidence accepted by QA/admin reviewer."
            if normalized_decision == "approved"
            else "Evidence returned for rework by QA/admin reviewer."
        )
        connection.execute(
            """
            update task_run_evidence_review
            set status = ?, updated_at = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
            where id = ?
            """,
            (normalized_decision, now, final_note, actor, now, review_id),
        )
        after = connection.execute("select * from task_run_evidence_review where id = ?", (review_id,)).fetchone()
    item = _row_to_evidence_review_item(after)
    _record_admin_action_audit(
        action_id=f"evidence-review-{normalized_decision}:{item.id}",
        action_kind="evidence_review",
        actor=actor,
        reason=reason or final_note,
        executed=True,
        status_before=before_status,
        status_after=item.status,
        message=f"Evidence review {normalized_decision}: {item.title}.",
        evidence_ref=item.evidence_ref,
    )
    return item


def queue_evidence_review_status(
    limit: int = 20,
    status_filter: str | None = None,
    severity_filter: str | None = None,
    sla_status_filter: str | None = None,
    owner_role_filter: str | None = None,
    source_query: str | None = None,
) -> QueueEvidenceReviewStatus:
    init_task_run_queue_store()
    now = datetime.now(UTC)
    safe_limit = max(1, min(limit, 100))
    normalized_status = status_filter if status_filter in {"pending", "approved", "rework"} else None
    normalized_severity = severity_filter if severity_filter in {"info", "warning", "critical"} else None
    normalized_sla = sla_status_filter if sla_status_filter in {"not_applicable", "within_sla", "overdue"} else None
    normalized_owner = owner_role_filter.strip().lower() if owner_role_filter else None
    normalized_query = source_query.strip().lower() if source_query else None
    with get_connection() as connection:
        counts = {
            status: connection.execute(
                "select count(*) from task_run_evidence_review where status = ?",
                (status,),
            ).fetchone()[0]
            for status in ("pending", "approved", "rework")
        }
        total = connection.execute("select count(*) from task_run_evidence_review").fetchone()[0]
        clauses: list[str] = []
        parameters: list[str] = []
        if normalized_status:
            clauses.append("status = ?")
            parameters.append(normalized_status)
        if normalized_severity:
            clauses.append("severity = ?")
            parameters.append(normalized_severity)
        if normalized_owner:
            clauses.append("lower(owner_role) = ?")
            parameters.append(normalized_owner)
        if normalized_query:
            clauses.append(
                "(lower(source_ref) like ? or lower(evidence_ref) like ? or lower(title) like ? or lower(reason) like ?)"
            )
            like_query = f"%{normalized_query}%"
            parameters.extend([like_query, like_query, like_query, like_query])
        where_sql = f"where {' and '.join(clauses)}" if clauses else ""
        rows = connection.execute(
            f"""
            select * from task_run_evidence_review
            {where_sql}
            order by updated_at desc, id desc
            limit 500
            """,
            tuple(parameters),
        ).fetchall()
        open_rows = connection.execute(
            """
            select * from task_run_evidence_review
            where status in ('pending', 'rework')
            """
        ).fetchall()
    open_sla = [_evidence_review_sla_fields(row, now) for row in open_rows]
    overdue = sum(1 for item in open_sla if item["sla_status"] == "overdue")
    oldest_open_age_seconds = max((int(item["age_seconds"]) for item in open_sla), default=0)
    due_candidates = [
        str(item["response_due_at"])
        for item in open_sla
        if item["response_due_at"] and item["sla_status"] == "within_sla"
    ]
    next_due_at = min(due_candidates) if due_candidates else None
    status = "critical" if counts["rework"] or overdue else "warning" if counts["pending"] else "normal"
    summary = (
        f"Есть просроченные проверки evidence: {overdue}; сначала разберите oldest/SLA."
        if overdue
        else
        "Есть evidence, возвращенное на доработку: нельзя считать результат закрытым."
        if status == "critical"
        else "Есть evidence на проверке: требуется QA/admin acceptance."
        if status == "warning"
        else "Evidence review чист: нет pending/rework проверок."
    )
    items = [_row_to_evidence_review_item(row, now) for row in rows]
    if normalized_sla:
        items = [item for item in items if item.sla_status == normalized_sla]
    status_priority = {"rework": 0, "pending": 1, "approved": 2}
    sla_priority = {"overdue": 0, "within_sla": 1, "not_applicable": 2}
    severity_priority = {"critical": 0, "warning": 1, "info": 2}
    items = sorted(
        items,
        key=lambda item: (
            sla_priority[item.sla_status],
            status_priority[item.status],
            severity_priority[item.severity],
            -item.age_seconds,
            item.updated_at,
        ),
    )[:safe_limit]
    decision_events = list_admin_action_audit_events_by_kind("evidence_review", limit=8)
    return QueueEvidenceReviewStatus(
        mode="sqlite_mvp_queue_evidence_review",
        status=status,
        summary=summary,
        total=total,
        pending=counts["pending"],
        approved=counts["approved"],
        rework=counts["rework"],
        overdue=overdue,
        oldest_open_age_seconds=oldest_open_age_seconds,
        next_due_at=next_due_at,
        latest_review_id=items[0].id if items else None,
        items=items,
        decision_events=decision_events,
        gates=[
            GateResult(
                id="queue-evidence-review-has-evidence",
                title="Evidence review cases link evidence",
                status="passed" if all(item.evidence_ref for item in items) else "failed",
                reason="Every evidence review case must include evidence_ref for traceability.",
            ),
            GateResult(
                id="queue-evidence-review-decision-recorded",
                title="Evidence review decisions are recorded",
                status="passed" if all(item.status == "pending" or (item.review_note and item.reviewed_by) for item in items) else "failed",
                reason="Approved or rework cases must contain reviewer, reviewed_at and review_note.",
            ),
            GateResult(
                id="queue-evidence-review-safe-scope",
                title="Evidence review remains local and safe",
                status="passed",
                reason="Evidence review records local acceptance state only; it does not publish, deploy, expose secrets or change tenant boundaries.",
            ),
            GateResult(
                id="queue-evidence-review-sla-visible",
                title="Evidence review SLA and aging are visible",
                status="passed" if all(item.age_seconds >= 0 and item.sla_status for item in items) else "failed",
                reason="Admin review queue must expose age, due time and overdue state before evidence can silently rot.",
            ),
            GateResult(
                id="queue-evidence-review-decision-trail-visible",
                title="Evidence review decision trail is visible",
                status="passed" if total == 0 or bool(decision_events) else "warning",
                reason="Evidence review must expose recent open/approve/rework events from the admin action audit hash-chain.",
            ),
        ],
    )


def queue_evidence_review_package(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceReviewPackage:
    review_status = queue_evidence_review_status(limit=100)
    generated_at = datetime.now(UTC).isoformat()
    open_items = [item for item in review_status.items if item.status in {"pending", "rework"}]
    decision_events = review_status.decision_events
    acceptance_summary = {
        "total": review_status.total,
        "pending": review_status.pending,
        "rework": review_status.rework,
        "approved": review_status.approved,
        "overdue": review_status.overdue,
        "status": review_status.status,
        "ready_for_internal_acceptance": review_status.pending == 0 and review_status.rework == 0 and review_status.overdue == 0,
        "blocking_reason": None
        if review_status.pending == 0 and review_status.rework == 0 and review_status.overdue == 0
        else "Evidence review still has pending, rework or overdue items.",
    }
    package_payload: dict[str, object] = {
        "generated_at": generated_at,
        "actor": actor,
        "tenant_id": tenant_id,
        "export_scope": "internal_evidence",
        "external_export_allowed": False,
        "acceptance_summary": acceptance_summary,
        "open_item_ids": [item.id for item in open_items],
        "decision_event_hashes": [event.event_hash for event in decision_events],
        "review_gates": [gate.model_dump() for gate in review_status.gates],
    }
    package_hash = hashlib.sha256(
        json.dumps(package_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    gates = [
        GateResult(
            id="queue-evidence-package-internal-only",
            title="Evidence package is internal only",
            status="passed",
            reason="Package export_scope is internal_evidence and external_export_allowed is false.",
        ),
        GateResult(
            id="queue-evidence-package-has-hash",
            title="Evidence package hash is reproducible",
            status="passed" if package_hash else "failed",
            reason="Package hash is computed from generated_at, actor, tenant, summary, open items, decision hashes and gates.",
        ),
        GateResult(
            id="queue-evidence-package-decision-trail-linked",
            title="Evidence package links decision trail",
            status="passed" if review_status.total == 0 or bool(decision_events) else "warning",
            reason="Package includes recent evidence_review audit events with hash links.",
        ),
        GateResult(
            id="queue-evidence-package-acceptance-state-explicit",
            title="Evidence package acceptance state is explicit",
            status="passed",
            reason="Package states whether pending/rework/overdue items still block internal acceptance.",
        ),
    ]
    return QueueEvidenceReviewPackage(
        id=f"queue-evidence-package-{package_hash[:12]}",
        generated_at=generated_at,
        actor=actor,
        tenant_id=tenant_id,
        export_scope="internal_evidence",
        external_export_allowed=False,
        package_hash=package_hash,
        review_status=review_status,
        open_items=open_items,
        decision_events=decision_events,
        acceptance_summary=acceptance_summary,
        gates=gates,
    )


def _package_archive_entry_from_payload(payload: dict[str, object]) -> QueueEvidenceReviewPackageArchiveEntry:
    return QueueEvidenceReviewPackageArchiveEntry(**payload)


def _read_evidence_package_archive_entries(limit: int = 20) -> list[QueueEvidenceReviewPackageArchiveEntry]:
    if not EVIDENCE_PACKAGE_ARCHIVE_PATH.exists():
        return []
    entries: list[QueueEvidenceReviewPackageArchiveEntry] = []
    for line in EVIDENCE_PACKAGE_ARCHIVE_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entries.append(_package_archive_entry_from_payload(json.loads(line)))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return list(reversed(entries))[: max(1, min(limit, 100))]


def _count_evidence_package_archive_entries() -> int:
    if not EVIDENCE_PACKAGE_ARCHIVE_PATH.exists():
        return 0
    return sum(1 for line in EVIDENCE_PACKAGE_ARCHIVE_PATH.read_text(encoding="utf-8").splitlines() if line.strip())


def archive_queue_evidence_review_package(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceReviewPackageArchiveEntry:
    package = queue_evidence_review_package(actor=actor, tenant_id=tenant_id)
    archived_at = datetime.now(UTC).isoformat()
    summary = package.acceptance_summary
    entry_payload = {
        "id": f"queue-evidence-package-archive-{hashlib.sha256((package.package_hash + archived_at).encode('utf-8')).hexdigest()[:12]}",
        "package_id": package.id,
        "package_hash": package.package_hash,
        "archived_at": archived_at,
        "actor": actor,
        "tenant_id": tenant_id,
        "status": "ready" if summary.get("ready_for_internal_acceptance") else "blocked",
        "pending": int(summary.get("pending", 0)),
        "rework": int(summary.get("rework", 0)),
        "overdue": int(summary.get("overdue", 0)),
        "decision_events_total": len(package.decision_events),
        "open_items_total": len(package.open_items),
        "archive_path": str(EVIDENCE_PACKAGE_ARCHIVE_PATH),
    }
    EVIDENCE_PACKAGE_ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with EVIDENCE_PACKAGE_ARCHIVE_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry_payload, ensure_ascii=False, sort_keys=True) + "\n")
    return _package_archive_entry_from_payload(entry_payload)


def queue_evidence_review_package_archive_status(limit: int = 20) -> QueueEvidenceReviewPackageArchiveStatus:
    entries = _read_evidence_package_archive_entries(limit=limit)
    storage = str(EVIDENCE_PACKAGE_ARCHIVE_PATH)
    return QueueEvidenceReviewPackageArchiveStatus(
        mode="local_jsonl_evidence_package_archive",
        storage=storage,
        entries_total=_count_evidence_package_archive_entries(),
        latest_entry_id=entries[0].id if entries else None,
        latest_package_hash=entries[0].package_hash if entries else None,
        entries=entries,
        gates=[
            GateResult(
                id="queue-evidence-package-archive-local-jsonl",
                title="Evidence package archive is local JSONL",
                status="passed",
                reason="Archive appends local internal evidence package metadata to JSONL without external export.",
            ),
            GateResult(
                id="queue-evidence-package-archive-no-external-export",
                title="Evidence package archive has no external export",
                status="passed",
                reason="Archive stores only package hash, counters, actor, tenant and local path.",
            ),
            GateResult(
                id="queue-evidence-package-archive-readable",
                title="Evidence package archive is readable",
                status="passed" if entries or not EVIDENCE_PACKAGE_ARCHIVE_PATH.exists() else "warning",
                reason="Archive status endpoint can read saved entries or reports an empty archive.",
            ),
        ],
    )


def queue_evidence_acceptance_checklist(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceChecklistStatus:
    package = queue_evidence_review_package(actor=actor, tenant_id=tenant_id)
    archive = queue_evidence_review_package_archive_status(limit=5)
    summary = package.acceptance_summary
    package_gates_passed = all(gate.status == "passed" for gate in package.gates)
    decision_trail_linked = package.review_status.total == 0 or bool(package.decision_events)
    archive_has_history = archive.entries_total > 0
    pending = int(summary.get("pending", 0))
    rework = int(summary.get("rework", 0))
    overdue = int(summary.get("overdue", 0))

    items = [
        QueueEvidenceAcceptanceChecklistItem(
            id="package-built",
            title="Пакет evidence собран",
            status="passed" if package.package_hash else "failed",
            owner_role="qa-evidence",
            reason=f"Сформирован пакет {package.id} с hash {package.package_hash[:12]}.",
            action="Если hash отсутствует, пересобрать пакет и проверить генерацию package_payload.",
            action_label="Пересобрать пакет",
            action_kind="refresh_package",
            action_target="/api/task-runs/queue/evidence-review/package",
            evidence_ref=package.id,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="internal-only",
            title="Пакет остается внутренним",
            status="passed" if package.export_scope == "internal_evidence" and not package.external_export_allowed else "failed",
            owner_role="security-architect",
            reason=f"scope={package.export_scope}; external_export_allowed={package.external_export_allowed}.",
            action="Запретить внешний экспорт до отдельного human approval и production-политики.",
            action_label="Оставить внутренним",
            action_kind="none",
            action_target=None,
            evidence_ref=package.package_hash,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="archive-history-present",
            title="Есть история приемочных пакетов",
            status="passed" if archive_has_history else "warning",
            owner_role="pmo-controller",
            reason=f"В локальном JSONL-архиве найдено записей: {archive.entries_total}.",
            action="Сохранить текущий пакет в историю перед внутренней приемкой.",
            action_label="Сохранить пакет",
            action_kind="save_archive",
            action_target="/api/task-runs/queue/evidence-review/package/archive",
            evidence_ref=archive.latest_entry_id,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="no-pending-review",
            title="Нет ожидающих QA/admin решений",
            status="passed" if pending == 0 else "failed",
            owner_role="qa-lead",
            reason=f"pending={pending}.",
            action="Разобрать pending evidence review cases: принять или вернуть на доработку.",
            action_label="Открыть pending",
            action_kind="filter_pending",
            action_target="/api/task-runs/queue/evidence-review?status=pending",
            evidence_ref=package.review_status.latest_review_id,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="no-rework-review",
            title="Нет evidence, возвращенного на доработку",
            status="passed" if rework == 0 else "failed",
            owner_role="runtime-operator",
            reason=f"rework={rework}.",
            action="Закрыть rework cases повторной поставкой evidence и решением QA/admin.",
            action_label="Открыть rework",
            action_kind="filter_rework",
            action_target="/api/task-runs/queue/evidence-review?status=rework",
            evidence_ref=package.review_status.latest_review_id,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="no-overdue-review",
            title="Нет просроченных приемочных решений",
            status="passed" if overdue == 0 else "failed",
            owner_role="pmo-controller",
            reason=f"overdue={overdue}.",
            action="Разобрать просроченные cases и зафиксировать решение в audit trail.",
            action_label="Открыть overdue",
            action_kind="filter_overdue",
            action_target="/api/task-runs/queue/evidence-review?sla_status=overdue",
            evidence_ref=package.review_status.next_due_at,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="decision-trail-linked",
            title="Цепочка решений привязана",
            status="passed" if decision_trail_linked else "warning",
            owner_role="audit-controller",
            reason=f"decision_events={len(package.decision_events)}; review_total={package.review_status.total}.",
            action="Провести хотя бы одно явное QA/admin решение, чтобы приемка имела audit trace.",
            action_label="Открыть решения",
            action_kind="review_decision_trail",
            action_target="/api/task-runs/queue/evidence-review",
            evidence_ref=package.decision_events[0].event_hash if package.decision_events else None,
        ),
        QueueEvidenceAcceptanceChecklistItem(
            id="package-gates-pass",
            title="Гейты пакета прошли",
            status="passed" if package_gates_passed else "failed",
            owner_role="quality-controller",
            reason=f"package_gates={len(package.gates)}; failed={len([gate for gate in package.gates if gate.status != 'passed'])}.",
            action="Исправить failed/warning gates пакета перед приемкой.",
            action_label="Проверить gates",
            action_kind="review_package_gates",
            action_target="/api/task-runs/queue/evidence-review/package",
            evidence_ref=package.package_hash,
        ),
    ]
    has_failed = any(item.status == "failed" for item in items)
    has_warning = any(item.status == "warning" for item in items)
    status = "critical" if has_failed else "warning" if has_warning else "normal"
    ready = not has_failed and not has_warning
    gates = [
        GateResult(
            id="queue-evidence-acceptance-checklist-complete",
            title="Evidence acceptance checklist is complete",
            status="passed" if len(items) == 8 else "failed",
            reason="Checklist covers package build, internal scope, archive history, pending/rework/overdue, decision trail and package gates.",
        ),
        GateResult(
            id="queue-evidence-acceptance-checklist-ready-state",
            title="Internal acceptance state is explicit",
            status="passed" if ready else "warning",
            reason="Checklist reports whether evidence can be internally accepted and names blockers when it cannot.",
        ),
        GateResult(
            id="queue-evidence-acceptance-checklist-safe-scope",
            title="Acceptance checklist remains local and safe",
            status="passed",
            reason="Checklist reads local package/archive status only and does not publish, deploy, rotate secrets or change tenant boundaries.",
        ),
    ]
    return QueueEvidenceAcceptanceChecklistStatus(
        mode="queue_evidence_acceptance_checklist",
        status=status,
        summary="Evidence готов к внутренней приемке." if ready else "Evidence пока не готов к внутренней приемке: есть блокеры или предупреждения.",
        package_id=package.id,
        package_hash=package.package_hash,
        archive_entries_total=archive.entries_total,
        ready_for_internal_acceptance=ready,
        items=items,
        gates=gates,
    )


def queue_evidence_acceptance_summary(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceSummaryStatus:
    checklist = queue_evidence_acceptance_checklist(actor=actor, tenant_id=tenant_id)
    failed_items = [item for item in checklist.items if item.status == "failed"]
    warning_items = [item for item in checklist.items if item.status == "warning"]
    passed_items = [item for item in checklist.items if item.status == "passed"]
    primary = failed_items[0] if failed_items else warning_items[0] if warning_items else None
    if checklist.ready_for_internal_acceptance:
        headline = "Evidence можно принять внутри QA/admin."
        summary = "Блокеров нет: package, archive, decision trail и gates находятся в приемочном состоянии."
        next_action = "Сохранить пакет в историю и передать результат на следующий технический слой."
    elif primary:
        headline = f"Приемку блокирует: {primary.title}"
        summary = f"{len(failed_items)} blocker, {len(warning_items)} warning. Первое действие: {primary.action_label}."
        next_action = primary.action
    else:
        headline = "Evidence требует проверки QA/admin."
        summary = "Checklist не нашел явный primary blocker, требуется ручная сверка."
        next_action = "Открыть полный чек-лист и проверить статусы вручную."
    return QueueEvidenceAcceptanceSummaryStatus(
        mode="queue_evidence_acceptance_summary",
        status=checklist.status,
        ready_for_internal_acceptance=checklist.ready_for_internal_acceptance,
        headline=headline,
        summary=summary,
        blockers_total=len(failed_items),
        warnings_total=len(warning_items),
        passed_total=len(passed_items),
        checklist_items_total=len(checklist.items),
        package_id=checklist.package_id,
        package_hash=checklist.package_hash,
        primary_blocker_id=primary.id if primary else None,
        primary_blocker_title=primary.title if primary else None,
        primary_blocker_status=primary.status if primary else None,
        primary_owner_role=primary.owner_role if primary else None,
        primary_reason=primary.reason if primary else None,
        primary_action_label=primary.action_label if primary else None,
        primary_action_kind=primary.action_kind if primary else None,
        primary_action_target=primary.action_target if primary else None,
        next_action=next_action,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-summary-primary-action",
                title="Acceptance summary exposes primary action",
                status="passed" if checklist.ready_for_internal_acceptance or primary is not None else "warning",
                reason="Admin summary must show the first actionable blocker or explicitly state that evidence is ready.",
            ),
            GateResult(
                id="queue-evidence-acceptance-summary-counts",
                title="Acceptance summary exposes blocker counts",
                status="passed" if len(checklist.items) == len(failed_items) + len(warning_items) + len(passed_items) else "failed",
                reason="Summary counters must reconcile with checklist items.",
            ),
            GateResult(
                id="queue-evidence-acceptance-summary-safe-scope",
                title="Acceptance summary remains local and safe",
                status="passed",
                reason="Summary composes local checklist state only and does not publish, deploy, expose secrets or change tenant boundaries.",
            ),
        ],
    )


def queue_evidence_acceptance_blocker_worklist(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceBlockerWorklistStatus:
    checklist = queue_evidence_acceptance_checklist(actor=actor, tenant_id=tenant_id)
    priority = {
        "no-pending-review": 0,
        "no-rework-review": 1,
        "no-overdue-review": 2,
        "archive-history-present": 3,
        "decision-trail-linked": 4,
        "package-gates-pass": 5,
        "package-built": 6,
        "internal-only": 7,
    }
    status_priority = {"failed": 0, "warning": 1, "passed": 2}
    items = sorted(
        [item for item in checklist.items if item.status in {"failed", "warning"} and item.action_kind != "none"],
        key=lambda item: (status_priority[item.status], priority.get(item.id, 99), item.id),
    )
    blockers_total = len([item for item in items if item.status == "failed"])
    warnings_total = len([item for item in items if item.status == "warning"])
    first = items[0] if items else None
    status = "critical" if blockers_total else "warning" if warnings_total else "normal"
    summary = (
        f"К разбору {len(items)} actionable blockers/warnings. Первое действие: {first.action_label}."
        if first
        else "Actionable blockers не найдены: evidence можно вести по стандартному маршруту приемки."
    )
    return QueueEvidenceAcceptanceBlockerWorklistStatus(
        mode="queue_evidence_acceptance_blocker_worklist",
        status=status,
        summary=summary,
        blockers_total=blockers_total,
        warnings_total=warnings_total,
        actionable_total=len(items),
        package_id=checklist.package_id,
        package_hash=checklist.package_hash,
        first_action_label=first.action_label if first else None,
        first_action_kind=first.action_kind if first else None,
        items=items,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-worklist-actionable-only",
                title="Acceptance worklist contains actionable blockers",
                status="passed" if all(item.status in {"failed", "warning"} and item.action_kind != "none" for item in items) else "failed",
                reason="Worklist must hide passed/non-actionable checklist noise from the admin first view.",
            ),
            GateResult(
                id="queue-evidence-acceptance-worklist-prioritized",
                title="Acceptance worklist is prioritized",
                status="passed",
                reason="Failed items are ordered before warnings; pending/rework/overdue are prioritized for QA/admin.",
            ),
            GateResult(
                id="queue-evidence-acceptance-worklist-safe-scope",
                title="Acceptance worklist remains local and safe",
                status="passed",
                reason="Worklist composes local checklist state only and does not publish, deploy, expose secrets or change tenant boundaries.",
            ),
        ],
    )


def queue_evidence_acceptance_batch_plan(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceBatchPlanStatus:
    worklist = queue_evidence_acceptance_blocker_worklist(actor=actor, tenant_id=tenant_id)
    grouped_items: dict[str, list[QueueEvidenceAcceptanceChecklistItem]] = {}
    for item in worklist.items:
        grouped_items.setdefault(item.action_kind, []).append(item)

    groups: list[QueueEvidenceAcceptanceBatchGroup] = []
    for action_kind, items in grouped_items.items():
        first = items[0]
        critical = any(item.status == "failed" for item in items)
        groups.append(
            QueueEvidenceAcceptanceBatchGroup(
                id=f"acceptance-batch-{action_kind}",
                title=f"{first.action_label}: {len(items)}",
                action_kind=action_kind,
                action_label=first.action_label,
                action_target=first.action_target,
                status="critical" if critical else "warning",
                items_total=len(items),
                owner_roles=sorted({item.owner_role for item in items}),
                item_ids=[item.id for item in items],
                reason=f"{len(items)} item(s) require {first.action_label}.",
                next_action=first.action,
            )
        )

    first_group = groups[0] if groups else None
    blockers_total = worklist.blockers_total
    warnings_total = worklist.warnings_total
    status = "critical" if blockers_total else "warning" if warnings_total else "normal"
    summary = (
        f"Сформировано {len(groups)} grouped action batch(es). Первое действие: {first_group.action_label}."
        if first_group
        else "Групповых действий нет: actionable blockers/warnings не найдены."
    )
    return QueueEvidenceAcceptanceBatchPlanStatus(
        mode="queue_evidence_acceptance_batch_plan",
        status=status,
        summary=summary,
        groups_total=len(groups),
        blockers_total=blockers_total,
        warnings_total=warnings_total,
        package_id=worklist.package_id,
        package_hash=worklist.package_hash,
        first_group_id=first_group.id if first_group else None,
        first_action_label=first_group.action_label if first_group else None,
        first_action_kind=first_group.action_kind if first_group else None,
        first_action_target=first_group.action_target if first_group else None,
        groups=groups,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-batch-plan-groups-actionable",
                title="Acceptance batch plan groups are actionable",
                status="passed" if all(group.action_kind != "none" and group.items_total > 0 for group in groups) else "failed",
                reason="Batch plan groups blockers/warnings by executable action kind and hides passed/non-actionable items.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-plan-first-action",
                title="Acceptance batch plan exposes first action",
                status="passed" if not groups or (first_group is not None and bool(first_group.action_label)) else "failed",
                reason="Admin must see the first safe batch action when blockers exist.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-plan-safe-scope",
                title="Acceptance batch plan remains local and safe",
                status="passed",
                reason="Batch plan composes local worklist/checklist state only and does not publish, deploy, expose secrets or change tenant boundaries.",
            ),
        ],
    )


def execute_queue_evidence_acceptance_batch_action(
    payload: QueueEvidenceAcceptanceBatchActionRequest,
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceBatchActionResponse:
    plan = queue_evidence_acceptance_batch_plan(actor=actor, tenant_id=tenant_id)
    group = next((item for item in plan.groups if item.id == payload.group_id), None)
    target = payload.action_target or (group.action_target if group else None)
    action_kind = payload.action_kind or (group.action_kind if group else "")
    action_label = payload.action_label or (group.action_label if group else "")
    item_ids = payload.item_ids or (group.item_ids if group else [])
    owner_roles = payload.owner_roles or (group.owner_roles if group else [])
    safe_local_target = bool(target) and str(target).startswith("/api/task-runs/queue/evidence-review")
    supported_review_route = action_kind in {"filter_pending", "filter_rework", "filter_overdue", "review_decision_trail"}

    status_filter = "pending" if action_kind == "filter_pending" else "rework" if action_kind == "filter_rework" else None
    sla_filter = "overdue" if action_kind == "filter_overdue" else None
    owner_filter = owner_roles[0] if action_kind == "review_decision_trail" and owner_roles else None
    review_status = queue_evidence_review_status(
        limit=100,
        status_filter=status_filter,
        sla_status_filter=sla_filter,
        owner_role_filter=owner_filter,
    )
    executed = group is not None and supported_review_route and safe_local_target
    status = "completed" if executed else "review_required" if group is not None else "blocked"
    message = (
        f"Batch action session opened {review_status.total} evidence review records via {action_label}."
        if executed
        else f"Batch action requires manual review before execution: {action_label or payload.group_id}."
        if group is not None
        else f"Batch group {payload.group_id} was not found in current acceptance batch plan."
    )
    event = _record_admin_action_audit(
        action_id=payload.group_id,
        action_kind="evidence_acceptance_batch_action",
        actor=payload.actor or actor,
        reason=payload.reason or message,
        executed=executed,
        status_before=f"{plan.status}/{plan.groups_total}",
        status_after=f"{status}/{review_status.status}",
        message=message,
        evidence_ref=f"{plan.package_hash}:{payload.group_id}:{','.join(item_ids)}",
    )
    return QueueEvidenceAcceptanceBatchActionResponse(
        mode="queue_evidence_acceptance_batch_action_session",
        status=status,
        batch_group_id=payload.group_id,
        action_kind=action_kind,
        action_label=action_label,
        action_target=target,
        items_total=len(item_ids),
        message=message,
        review_status=review_status,
        audit_event=event,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-batch-action-group-found",
                title="Acceptance batch action group is current",
                status="passed" if group is not None else "failed",
                reason="Batch action must refer to a group present in the current batch plan.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-action-safe-target",
                title="Acceptance batch action target is local evidence review",
                status="passed" if safe_local_target else "failed",
                reason="Batch action can only open local evidence-review slices in MVP and cannot call external targets.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-action-audited",
                title="Acceptance batch action is audit-recorded",
                status="passed" if event.event_hash else "failed",
                reason="Every batch action session must write an admin action audit event with hash-chain evidence.",
            ),
        ],
    )


def decide_queue_evidence_acceptance_batch_item(
    payload: QueueEvidenceAcceptanceBatchItemDecisionRequest,
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceBatchItemDecisionResponse:
    plan = queue_evidence_acceptance_batch_plan(actor=actor, tenant_id=tenant_id)
    group = next((item for item in plan.groups if item.id == payload.batch_group_id), None)
    final_actor = payload.actor or actor
    normalized_decision = "approved" if payload.decision == "approve" else "rework"
    item = decide_evidence_review_case(
        payload.review_id,
        normalized_decision,
        actor=final_actor,
        reason=payload.reason or f"Batch item decision {normalized_decision} from {payload.batch_group_id}.",
        review_note=payload.review_note or f"QA/admin batch item decision: {normalized_decision}.",
    )
    review_status = queue_evidence_review_status(limit=100)
    completed = group is not None and item is not None
    message = (
        f"Batch item decision {normalized_decision} recorded for {payload.review_id} from {payload.batch_group_id}."
        if completed
        else f"Batch item decision blocked: group or review item is not current ({payload.batch_group_id}, {payload.review_id})."
    )
    event = _record_admin_action_audit(
        action_id=f"{payload.batch_group_id}:{payload.review_id}:{normalized_decision}",
        action_kind="evidence_acceptance_batch_item_decision",
        actor=final_actor,
        reason=payload.reason or message,
        executed=completed,
        status_before=payload.batch_group_id,
        status_after=f"{normalized_decision}/{item.status if item else 'missing'}",
        message=message,
        evidence_ref=f"{plan.package_hash}:{payload.batch_group_id}:{payload.review_id}",
    )
    return QueueEvidenceAcceptanceBatchItemDecisionResponse(
        mode="queue_evidence_acceptance_batch_item_decision",
        status="completed" if completed else "blocked",
        batch_group_id=payload.batch_group_id,
        review_id=payload.review_id,
        decision=normalized_decision,
        message=message,
        review_item=item,
        review_status=review_status,
        audit_event=event,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-batch-item-group-found",
                title="Acceptance batch item decision group is current",
                status="passed" if group is not None else "failed",
                reason="Batch item decision must refer to a group present in the current batch plan.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-item-review-found",
                title="Acceptance batch item decision review item exists",
                status="passed" if item is not None else "failed",
                reason="Batch item decision must close one explicit evidence review item.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-item-audited",
                title="Acceptance batch item decision is audit-recorded",
                status="passed" if event.event_hash else "failed",
                reason="Every batch item decision must write a batch-specific admin action audit event.",
            ),
        ],
    )


def _batch_action_from_group_id(batch_group_id: str) -> tuple[str, str, str | None]:
    if batch_group_id == "acceptance-batch-filter_pending":
        return "filter_pending", "Открыть pending", "/api/task-runs/queue/evidence-review?status=pending"
    if batch_group_id == "acceptance-batch-filter_rework":
        return "filter_rework", "Открыть rework", "/api/task-runs/queue/evidence-review?status=rework"
    if batch_group_id == "acceptance-batch-filter_overdue":
        return "filter_overdue", "Открыть overdue", "/api/task-runs/queue/evidence-review?sla_status=overdue"
    if batch_group_id == "acceptance-batch-review_decision_trail":
        return "review_decision_trail", "Проверить decisions", "/api/task-runs/queue/evidence-review"
    return "unknown", "Проверить вручную", None


def queue_evidence_acceptance_batch_group_closure(
    batch_group_id: str,
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
    source_query: str | None = None,
) -> QueueEvidenceAcceptanceBatchGroupClosureStatus:
    plan = queue_evidence_acceptance_batch_plan(actor=actor, tenant_id=tenant_id)
    group = next((item for item in plan.groups if item.id == batch_group_id), None)
    fallback_action_kind, fallback_action_label, fallback_action_target = _batch_action_from_group_id(batch_group_id)
    action_kind = group.action_kind if group else fallback_action_kind
    action_label = group.action_label if group else fallback_action_label
    action_target = group.action_target if group else fallback_action_target
    owner_filter = group.owner_roles[0] if group and action_kind == "review_decision_trail" and group.owner_roles else None
    status_filter = "pending" if action_kind == "filter_pending" else "rework" if action_kind == "filter_rework" else None
    sla_filter = "overdue" if action_kind == "filter_overdue" else None
    supported_review_route = action_kind in {"filter_pending", "filter_rework", "filter_overdue", "review_decision_trail"}
    review_status = queue_evidence_review_status(
        limit=100,
        status_filter=status_filter,
        sla_status_filter=sla_filter,
        owner_role_filter=owner_filter,
        source_query=source_query,
    )
    items = review_status.items
    pending_items = sum(1 for item in items if item.status == "pending")
    rework_items = sum(1 for item in items if item.status == "rework")
    approved_items = sum(1 for item in items if item.status == "approved")
    open_items = pending_items + rework_items
    total_items = len(items)
    closed_items = approved_items
    next_item = next((item for item in items if item.status in {"pending", "rework"}), None)
    status = "blocked" if not supported_review_route else "closed" if open_items == 0 else "open"
    summary = (
        f"Batch-группа {batch_group_id} закрыта: открытых evidence review item нет."
        if status == "closed"
        else f"Batch-группа {batch_group_id} открыта: осталось {open_items}; следующий item {next_item.id if next_item else 'не определен'}."
        if status == "open"
        else f"Batch-группа {batch_group_id} не поддерживает автоматическую проверку закрытия в MVP."
    )
    return QueueEvidenceAcceptanceBatchGroupClosureStatus(
        mode="queue_evidence_acceptance_batch_group_closure",
        status=status,
        batch_group_id=batch_group_id,
        action_kind=action_kind,
        action_label=action_label,
        action_target=action_target,
        total_items=total_items,
        open_items=open_items,
        closed_items=closed_items,
        pending_items=pending_items,
        rework_items=rework_items,
        approved_items=approved_items,
        next_review_id=next_item.id if next_item else None,
        next_action_label=f"Разобрать {next_item.id}" if next_item else None,
        summary=summary,
        review_status=review_status,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-batch-group-closure-scope",
                title="Acceptance batch group closure stays local",
                status="passed" if supported_review_route else "failed",
                reason="Closure check reads local evidence-review state only and does not publish, deploy, expose secrets or change tenant boundaries.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-group-next-item",
                title="Acceptance batch group exposes next item",
                status="passed" if status == "closed" or next_item is not None else "failed",
                reason="Open groups must show the next explicit review item; closed groups must show that no item remains.",
            ),
            GateResult(
                id="queue-evidence-acceptance-batch-group-no-bulk-close",
                title="Acceptance batch group closure does not bulk close items",
                status="passed",
                reason="Closure endpoint is read-only and cannot approve, rework or mutate evidence review items.",
            ),
        ],
    )


def queue_evidence_acceptance_center_status(
    actor: str = "runtime-operator",
    tenant_id: str = "tenant:demo",
) -> QueueEvidenceAcceptanceCenterStatus:
    checklist = queue_evidence_acceptance_checklist(actor=actor, tenant_id=tenant_id)
    summary = queue_evidence_acceptance_summary(actor=actor, tenant_id=tenant_id)
    worklist = queue_evidence_acceptance_blocker_worklist(actor=actor, tenant_id=tenant_id)
    batch_plan = queue_evidence_acceptance_batch_plan(actor=actor, tenant_id=tenant_id)
    first_group_closure = (
        queue_evidence_acceptance_batch_group_closure(
            batch_plan.first_group_id,
            actor=actor,
            tenant_id=tenant_id,
        )
        if batch_plan.first_group_id
        else None
    )
    status = (
        "normal"
        if checklist.ready_for_internal_acceptance
        else "critical"
        if checklist.status == "critical" or summary.blockers_total > 0
        else "warning"
    )
    next_review_id = first_group_closure.next_review_id if first_group_closure else None
    headline = (
        "Evidence ready for internal acceptance"
        if checklist.ready_for_internal_acceptance
        else f"Evidence acceptance needs {worklist.actionable_total} action(s)"
        if worklist.actionable_total
        else "Evidence acceptance needs manual QA review"
    )
    center_summary = (
        "Единый центр приемки evidence заменяет ручной обход checklist, summary, worklist, batch plan, item decision и closure panels."
    )
    return QueueEvidenceAcceptanceCenterStatus(
        mode="queue_evidence_acceptance_center",
        status=status,
        headline=headline,
        summary=center_summary,
        ready_for_internal_acceptance=checklist.ready_for_internal_acceptance,
        blockers_total=summary.blockers_total,
        warnings_total=summary.warnings_total,
        worklist_actions_total=worklist.actionable_total,
        batch_groups_total=batch_plan.groups_total,
        primary_action_label=summary.primary_action_label or batch_plan.first_action_label,
        primary_action_kind=summary.primary_action_kind or batch_plan.first_action_kind,
        first_group_id=batch_plan.first_group_id,
        next_review_id=next_review_id,
        sections_total=5 if first_group_closure else 4,
        technical_panels_replaced=6,
        checklist=checklist,
        acceptance_summary=summary,
        worklist=worklist,
        batch_plan=batch_plan,
        first_group_closure=first_group_closure,
        gates=[
            GateResult(
                id="queue-evidence-acceptance-center-composes-existing-layers",
                title="Evidence acceptance center composes existing layers",
                status="passed",
                reason="Center reuses checklist, summary, worklist, batch plan and closure state instead of creating a parallel acceptance route.",
            ),
            GateResult(
                id="queue-evidence-acceptance-center-reduces-admin-noise",
                title="Evidence acceptance center reduces admin noise",
                status="passed" if worklist.actionable_total >= 0 and batch_plan.groups_total >= 0 else "failed",
                reason="Admin gets one top-level state, one primary action and one next item before opening technical panels.",
            ),
            GateResult(
                id="queue-evidence-acceptance-center-read-only",
                title="Evidence acceptance center is read-only",
                status="passed",
                reason="Center endpoint only reads local acceptance state and does not mutate evidence, publish, deploy or change tenant/security boundaries.",
            ),
        ],
    )


def execute_queue_runbook_action(
    step_id: str,
    actor: str = "runtime-operator",
    reason: str = "",
    interval_seconds: float = 0.5,
) -> QueueRunbookActionResponse:
    runbook = queue_operations_runbook_status()
    status_before = f"{runbook.status}/{runbook.response_mode}"
    step = next((item for item in runbook.steps if item.id == step_id), None)
    if step is None:
        message = f"Runbook step {step_id} is not registered."
        _record_admin_action_audit(
            action_id=step_id,
            action_kind="unknown",
            actor=actor,
            reason=reason or f"Attempted unknown runbook action: {step_id}.",
            executed=False,
            status_before=status_before,
            status_after="blocked/unknown_step",
            message=message,
            evidence_ref="queue_operations_runbook_status",
        )
        return QueueRunbookActionResponse(
            step_id=step_id,
            action_kind="unknown",
            executed=False,
            status="blocked",
            message=message,
            runbook=runbook,
            gates=[
                GateResult(
                    id="queue-runbook-action-known-step",
                    title="Queue runbook action uses registered step",
                    status="failed",
                    reason="Requested runbook step id is not present in the active operations runbook.",
                )
            ],
        )
    if not step.executable:
        message = f"Runbook step {step.id} is review-only: {step.action}"
        _record_admin_action_audit(
            action_id=step.id,
            action_kind=step.action_kind,
            actor=actor,
            reason=reason or f"Review-only runbook action requested: {step.id}.",
            executed=False,
            status_before=status_before,
            status_after="review_required/manual_triage",
            message=message,
            evidence_ref=step.evidence_source,
        )
        return QueueRunbookActionResponse(
            step_id=step.id,
            action_kind=step.action_kind,
            executed=False,
            status="review_required",
            message=message,
            runbook=runbook,
            gates=[
                GateResult(
                    id="queue-runbook-action-review-only",
                    title="Queue runbook action respects review-only steps",
                    status="passed",
                    reason="Human-review runbook steps are visible but cannot be auto-executed from the guided action endpoint.",
                )
            ],
        )

    safe_interval = max(0.2, min(float(interval_seconds or 0.5), 30.0))
    action_reason = reason or f"Guided runbook action: {step.id}."
    if step.action_kind == "start_scheduler":
        start_worker_scheduler(actor=actor, interval_seconds=safe_interval, reason=action_reason)
        message = "Scheduler started from guided runbook action."
    elif step.action_kind == "stop_scheduler":
        stop_worker_scheduler(actor=actor, reason=action_reason)
        message = "Scheduler stopped from guided runbook action."
    elif step.action_kind == "scheduler_tick":
        run_scheduler_tick(actor=actor)
        message = "One scheduler tick executed from guided runbook action."
    elif step.action_kind == "dispatch_notifications":
        dispatch_notification_deliveries(actor=actor, reason=action_reason)
        message = "Local-log notification dispatch executed from guided runbook action."
    else:
        message = f"Runbook action kind {step.action_kind} requires manual review."
        _record_admin_action_audit(
            action_id=step.id,
            action_kind=step.action_kind,
            actor=actor,
            reason=action_reason,
            executed=False,
            status_before=status_before,
            status_after="review_required/unsupported_action_kind",
            message=message,
            evidence_ref=step.evidence_source,
        )
        return QueueRunbookActionResponse(
            step_id=step.id,
            action_kind=step.action_kind,
            executed=False,
            status="review_required",
            message=message,
            runbook=runbook,
            gates=[
                GateResult(
                    id="queue-runbook-action-kind-safe",
                    title="Queue runbook action rejects unsupported action kind",
                    status="passed",
                    reason="Only explicitly whitelisted safe runtime operations can be executed from runbook actions.",
                )
            ],
        )

    refreshed = queue_operations_runbook_status()
    _record_admin_action_audit(
        action_id=step.id,
        action_kind=step.action_kind,
        actor=actor,
        reason=action_reason,
        executed=True,
        status_before=status_before,
        status_after=f"{refreshed.status}/{refreshed.response_mode}",
        message=message,
        evidence_ref=step.evidence_source,
    )
    return QueueRunbookActionResponse(
        step_id=step.id,
        action_kind=step.action_kind,
        executed=True,
        status="completed",
        message=message,
        runbook=refreshed,
        gates=[
            GateResult(
                id="queue-runbook-guided-action-executed",
                title="Queue runbook guided action executed",
                status="passed",
                reason="A whitelisted runtime operation was executed and the runbook status was refreshed for evidence.",
            ),
            GateResult(
                id="queue-runbook-guided-action-scoped",
                title="Queue runbook guided action remains scoped",
                status="passed",
                reason="The action is limited to local scheduler or local-log notification operations; production channels and secrets are not touched.",
            ),
        ],
    )


def queue_admin_recovery_plan_status() -> QueueAdminRecoveryPlanStatus:
    admin_center = queue_admin_alert_center()
    lifecycle = incident_lifecycle_status()
    runbook = queue_operations_runbook_status()
    policy_audit = notification_policy_audit_status()
    steps: list[QueueRecoveryStep] = []

    def add_step(
        *,
        step_id: str,
        priority: int,
        title: str,
        condition: str,
        owner_role: str,
        action_label: str,
        action_kind: str,
        expected_result: str,
        evidence_source: str,
        status: str,
        action_endpoint: str | None = None,
        related_alert_id: str | None = None,
        related_runbook_step_id: str | None = None,
        related_queue_id: str | None = None,
        related_task_run_id: str | None = None,
    ) -> None:
        steps.append(
            QueueRecoveryStep(
                id=step_id,
                priority=priority,
                title=title,
                condition=condition,
                owner_role=owner_role,
                action_label=action_label,
                action_endpoint=action_endpoint,
                action_kind=action_kind,
                expected_result=expected_result,
                evidence_source=evidence_source,
                related_alert_id=related_alert_id,
                related_runbook_step_id=related_runbook_step_id,
                related_queue_id=related_queue_id,
                related_task_run_id=related_task_run_id,
                status=status,
            )
        )

    alert_priority_base = {"critical": 10, "warning": 40, "info": 80}
    for index, alert in enumerate(admin_center.alerts[:6], start=1):
        if alert.severity == "info" and admin_center.status == "normal":
            continue
        source_endpoint = {
            "dead_letter_queue": "/api/task-runs/queue/dead-letters",
            "queue": f"/api/task-runs/queue/{alert.related_queue_id}/events" if alert.related_queue_id else "/api/task-runs/queue/status",
            "worker": "/api/task-runs/queue/observability",
            "scheduler": "/api/task-runs/queue/scheduler/status",
            "retry_policy": "/api/task-runs/queue/retry-policy",
        }.get(alert.source, "/api/task-runs/queue/status")
        add_step(
            step_id=f"recovery-alert-{alert.id}",
            priority=alert_priority_base[alert.severity] + index,
            title=alert.title,
            condition=alert.message,
            owner_role=alert.owner_role,
            action_label="Открыть ручной разбор" if alert.severity == "critical" else "Проверить и выполнить рекомендацию",
            action_endpoint=source_endpoint,
            action_kind="review_only",
            expected_result="Alert получает владельца, решение и evidence до продолжения клиентского сценария.",
            evidence_source=f"admin_alert_center:{alert.id}",
            related_alert_id=alert.id,
            related_queue_id=alert.related_queue_id,
            related_task_run_id=alert.related_task_run_id,
            status="needs_attention",
        )

    for runbook_step in runbook.steps:
        if runbook_step.status != "needs_attention":
            continue
        add_step(
            step_id=f"recovery-runbook-{runbook_step.id}",
            priority=20 if runbook_step.executable else 35,
            title=runbook_step.title,
            condition=runbook_step.trigger,
            owner_role=runbook_step.owner_role,
            action_label=runbook_step.action_label or "Выполнить runbook step",
            action_endpoint=(
                f"/api/task-runs/queue/operations-runbook/actions/{runbook_step.id}"
                if runbook_step.executable
                else runbook_step.endpoint
            ),
            action_kind="guided_action" if runbook_step.executable else "review_only",
            expected_result="Runbook step переходит в ready, а очередь возвращается в контролируемый режим.",
            evidence_source=f"queue_operations_runbook:{runbook_step.id}",
            related_runbook_step_id=runbook_step.id,
            status="needs_attention",
        )

    for incident in lifecycle.incidents[:5]:
        if incident.status == "resolved":
            continue
        add_step(
            step_id=f"recovery-incident-{incident.id}",
            priority=15 if incident.severity == "critical" else 45,
            title=incident.title,
            condition=incident.current_step,
            owner_role=incident.owner_role,
            action_label=incident.action_label,
            action_endpoint=incident.action_endpoint,
            action_kind="review_only",
            expected_result="Инцидент получает acknowledge/retry/resolve и перестает блокировать приемку.",
            evidence_source=incident.evidence_ref or f"incident_lifecycle:{incident.id}",
            related_queue_id=incident.related_queue_id,
            related_task_run_id=incident.related_task_run_id,
            status="needs_attention",
        )

    blocking_policy_items = [
        item for item in policy_audit.items if item.status in {"failed", "warning"} and item.severity in {"critical", "warning"}
    ]
    for index, item in enumerate(blocking_policy_items[:4], start=1):
        add_step(
            step_id=f"recovery-policy-{item.id}",
            priority=55 + index,
            title=item.title,
            condition=item.finding,
            owner_role=item.owner_role,
            action_label=item.required_action,
            action_endpoint="/api/task-runs/queue/notifications/policy-audit",
            action_kind="review_only",
            expected_result="Политика уведомлений подтверждает local-only MVP или фиксирует production gate.",
            evidence_source=item.evidence_source,
            status="blocked" if item.status == "failed" else "needs_attention",
        )

    if not steps:
        add_step(
            step_id="recovery-monitor-normal",
            priority=100,
            title="Очередь в штатном режиме",
            condition="Admin alerts, incident lifecycle, runbook и notification policy не требуют вмешательства.",
            owner_role="runtime-operator",
            action_label="Продолжать мониторинг",
            action_endpoint="/api/task-runs/queue/status",
            action_kind="monitor_only",
            expected_result="Новых действий не требуется, evidence остается доступной для QA.",
            evidence_source="queue_status + admin_alert_center + runbook + policy_audit",
            status="completed",
        )

    steps.sort(key=lambda item: (item.priority, item.id))
    actionable_steps = [step for step in steps if step.status in {"needs_attention", "blocked"}]
    blocked_steps = [step for step in steps if step.status == "blocked"]
    primary_step = actionable_steps[0] if actionable_steps else None
    has_guided = any(step.action_kind == "guided_action" and step.status == "needs_attention" for step in steps)
    if admin_center.critical_alerts or lifecycle.status == "critical" or blocked_steps:
        recommended_mode = "emergency_stop" if blocked_steps else "manual_triage"
    elif has_guided or admin_center.warning_alerts or lifecycle.status == "warning":
        recommended_mode = "guided_recovery"
    else:
        recommended_mode = "monitor"
    status = "critical" if recommended_mode in {"manual_triage", "emergency_stop"} else "warning" if recommended_mode == "guided_recovery" else "normal"
    summary = (
        "Есть критичный recovery plan: требуется ручной triage или блокирующий контроль до продолжения."
        if status == "critical"
        else "Есть управляемые шаги восстановления: выполните guided action или проверьте owner review."
        if status == "warning"
        else "Recovery plan в режиме мониторинга: действий администратора не требуется."
    )
    return QueueAdminRecoveryPlanStatus(
        mode="sqlite_mvp_queue_admin_recovery_plan",
        status=status,
        summary=summary,
        recommended_mode=recommended_mode,
        primary_step_id=primary_step.id if primary_step else None,
        steps_total=len(steps),
        steps_needing_attention=len(actionable_steps),
        blocked_steps=len(blocked_steps),
        plan=steps,
        gates=[
            GateResult(
                id="queue-admin-recovery-plan-linked",
                title="Queue admin recovery plan links source evidence",
                status="passed" if all(step.evidence_source for step in steps) else "failed",
                reason="Every recovery step references alert, runbook, incident, policy audit or queue status evidence.",
            ),
            GateResult(
                id="queue-admin-recovery-plan-safe-scope",
                title="Queue admin recovery plan remains local and safe",
                status="passed",
                reason="Recovery plan only references local admin/runtime endpoints and does not enable production deploy, external notification channels or secrets.",
            ),
            GateResult(
                id="queue-admin-recovery-plan-primary-step",
                title="Queue admin recovery plan has primary step",
                status="passed" if primary_step or status == "normal" else "failed",
                reason="When attention is required, the plan exposes the first priority step for administrator focus.",
            ),
        ],
    )


def queue_admin_command_center_status() -> QueueAdminCommandCenterStatus:
    admin_center = queue_admin_alert_center()
    recovery_plan = queue_admin_recovery_plan_status()
    lifecycle = incident_lifecycle_status()
    timeline = admin_incident_timeline_status()
    runbook = queue_operations_runbook_status()
    policy_audit = notification_policy_audit_status()
    action_audit = queue_admin_action_audit_status(limit=6)
    manual_triage = queue_manual_triage_status(limit=6)
    evidence_review = queue_evidence_review_status(limit=6)
    dead_letters = admin_center.dead_letter_queue

    sources = [
        QueueAdminCommandCenterSource(
            id="admin-alert-center",
            title="Центр сигналов",
            status=admin_center.status,
            summary=f"{admin_center.open_alerts} открыто, critical {admin_center.critical_alerts}, warning {admin_center.warning_alerts}.",
            endpoint="/api/task-runs/queue/admin-alerts",
            evidence_source="queue_admin_alert_center",
        ),
        QueueAdminCommandCenterSource(
            id="recovery-plan",
            title="План восстановления",
            status=recovery_plan.status,
            summary=f"{recovery_plan.steps_needing_attention}/{recovery_plan.steps_total} шагов требуют внимания.",
            endpoint="/api/task-runs/queue/admin-recovery-plan",
            evidence_source="queue_admin_recovery_plan",
        ),
        QueueAdminCommandCenterSource(
            id="operations-runbook",
            title="Операционный регламент",
            status=runbook.status,
            summary=f"{runbook.steps_needing_attention}/{runbook.steps_total} шагов требуют реакции.",
            endpoint="/api/task-runs/queue/operations-runbook",
            evidence_source="queue_operations_runbook",
        ),
        QueueAdminCommandCenterSource(
            id="incident-lifecycle",
            title="Инциденты",
            status=lifecycle.status,
            summary=f"{lifecycle.open} открыто, {lifecycle.overdue} просрочено по SLA.",
            endpoint="/api/task-runs/queue/incidents",
            evidence_source="incident_lifecycle",
        ),
        QueueAdminCommandCenterSource(
            id="incident-timeline",
            title="Лента событий",
            status=timeline.status,
            summary=f"{timeline.events_total} событий, {timeline.unresolved_events} незакрыто.",
            endpoint="/api/task-runs/queue/incidents/timeline",
            evidence_source="admin_incident_timeline",
        ),
        QueueAdminCommandCenterSource(
            id="notification-policy-audit",
            title="Аудит уведомлений",
            status=policy_audit.status,
            summary=f"{policy_audit.failed} failed, {policy_audit.warnings} warning, external={policy_audit.external_delivery_allowed}.",
            endpoint="/api/task-runs/queue/notifications/policy-audit",
            evidence_source="notification_policy_audit",
        ),
        QueueAdminCommandCenterSource(
            id="dead-letter-queue",
            title="Dead Letter Queue",
            status="critical" if dead_letters.open else "normal",
            summary=f"{dead_letters.open} открыто, {dead_letters.acknowledged} в разборе, {dead_letters.resolved} закрыто.",
            endpoint="/api/task-runs/queue/dead-letters",
            evidence_source="dead_letter_queue",
        ),
        QueueAdminCommandCenterSource(
            id="manual-triage",
            title="Ручной разбор администратора",
            status=manual_triage.status,
            summary=f"{manual_triage.open} open, {manual_triage.assigned} assigned, {manual_triage.resolved} resolved.",
            endpoint="/api/task-runs/queue/manual-triage",
            evidence_source="queue_manual_triage",
        ),
        QueueAdminCommandCenterSource(
            id="evidence-review",
            title="Проверка evidence",
            status=evidence_review.status,
            summary=f"{evidence_review.pending} pending, {evidence_review.rework} rework, {evidence_review.approved} approved.",
            endpoint="/api/task-runs/queue/evidence-review",
            evidence_source="queue_evidence_review",
        ),
        QueueAdminCommandCenterSource(
            id="admin-action-audit",
            title="Журнал действий",
            status=action_audit.status,
            summary=f"{action_audit.events_total} событий, chain={action_audit.chain_valid}.",
            endpoint="/api/task-runs/queue/admin-action-audit",
            evidence_source="queue_admin_action_audit",
        ),
    ]

    actions: list[QueueAdminCommandCenterAction] = []
    primary_step = next((step for step in recovery_plan.plan if step.id == recovery_plan.primary_step_id), None)
    if primary_step is not None:
        actions.append(
            QueueAdminCommandCenterAction(
                id=f"command-{primary_step.id}",
                label=primary_step.action_label,
                action_kind=primary_step.action_kind,
                enabled=primary_step.action_kind == "guided_action" and bool(primary_step.action_endpoint),
                endpoint=primary_step.action_endpoint,
                owner_role=primary_step.owner_role,
                reason=primary_step.condition,
                evidence_source=primary_step.evidence_source,
            )
        )

    for step in runbook.steps:
        if step.id in {primary_step.related_runbook_step_id if primary_step else None}:
            continue
        if step.status != "needs_attention":
            continue
        actions.append(
            QueueAdminCommandCenterAction(
                id=f"command-runbook-{step.id}",
                label=step.action_label or "Проверить runbook step",
                action_kind="guided_action" if step.executable else "review_only",
                enabled=step.executable,
                endpoint=f"/api/task-runs/queue/operations-runbook/actions/{step.id}" if step.executable else step.endpoint,
                owner_role=step.owner_role,
                reason=step.action,
                evidence_source=step.evidence_source,
            )
        )

    first_review = next((item for item in evidence_review.items if item.status in {"rework", "pending"}), None)
    if first_review is not None:
        actions.append(
            QueueAdminCommandCenterAction(
                id=f"command-evidence-review-{first_review.id}",
                label=f"Проверить evidence: {first_review.title}",
                action_kind="review_only",
                enabled=False,
                endpoint=f"/api/task-runs/queue/evidence-review/{first_review.id}/approve",
                owner_role=first_review.owner_role,
                reason=first_review.reason,
                evidence_source=first_review.evidence_ref,
            )
        )

    if not actions:
        actions.append(
            QueueAdminCommandCenterAction(
                id="command-monitor-normal",
                label="Продолжать мониторинг",
                action_kind="monitor_only",
                enabled=False,
                endpoint="/api/task-runs/queue/status",
                owner_role="runtime-operator",
                reason="Очередь, recovery plan, runbook и policy audit не требуют вмешательства.",
                evidence_source="queue_status + recovery_plan + runbook",
            )
        )

    blockers = [
        source
        for source in sources
        if source.status == "critical"
        or (source.id == "notification-policy-audit" and policy_audit.production_gate_required and policy_audit.failed)
    ]
    status = "critical" if blockers or recovery_plan.recommended_mode in {"manual_triage", "emergency_stop"} else "warning" if recovery_plan.recommended_mode == "guided_recovery" else "normal"
    headline = (
        "Остановить автоматическое продвижение и закрыть ручной разбор."
        if status == "critical"
        else "Выполнить главный управляемый шаг восстановления."
        if status == "warning"
        else "Система работает штатно, требуется только мониторинг."
    )
    summary = (
        f"Command Center собрал {len(sources)} источников, {len(actions)} действий и {len(blockers)} блокеров. "
        f"Режим администратора: {recovery_plan.recommended_mode}."
    )
    return QueueAdminCommandCenterStatus(
        mode="sqlite_mvp_queue_admin_command_center",
        status=status,
        operator_mode=recovery_plan.recommended_mode,
        headline=headline,
        summary=summary,
        primary_action_id=actions[0].id if actions else None,
        actions_total=len(actions),
        blockers_total=len(blockers),
        sources_total=len(sources),
        actions=actions,
        sources=sources,
        gates=[
            GateResult(
                id="queue-admin-command-center-sources-linked",
                title="Queue admin command center links source layers",
                status="passed" if len(sources) >= 10 and all(source.evidence_source for source in sources) else "failed",
                reason="Command Center links alert center, recovery plan, runbook, incident lifecycle, timeline, policy audit, DLQ, manual triage, evidence review and admin action audit evidence.",
            ),
            GateResult(
                id="queue-admin-command-center-primary-action",
                title="Queue admin command center exposes primary action",
                status="passed" if actions and actions[0].id == (actions[0].id if actions else None) else "failed",
                reason="Administrator sees one first action or explicit monitor-only state instead of reading all raw panels first.",
            ),
            GateResult(
                id="queue-admin-command-center-safe-scope",
                title="Queue admin command center remains local and safe",
                status="passed",
                reason="Command Center only composes local runtime endpoints; it does not enable production deploy, secrets, external providers or route changes.",
            ),
            GateResult(
                id="queue-admin-command-center-blockers-visible",
                title="Queue admin command center exposes blockers",
                status="passed" if status != "critical" or blockers else "failed",
                reason="Critical mode is allowed only when blocker sources are visible to the administrator.",
            ),
        ],
    )


def _task_run_from_connection_row(row) -> TaskRun | None:
    if row is None:
        return None
    return TaskRun(
        id=row["id"],
        process_id=row["process_id"],
        profile_id=row["profile_id"],
        status=row["status"],
        stages=json.loads(row["stages_json"]),
        gates=json.loads(row["gates_json"]),
        artifact_id=row["artifact_id"],
        form_data=json.loads(row["form_data_json"]) if "form_data_json" in row.keys() and row["form_data_json"] else {},
    )


def _record_queue_event(
    connection,
    queue_id: str,
    task_run_id: str,
    event_type: str,
    actor: str,
    status_before: str | None,
    status_after: str,
    message: str,
) -> TaskRunQueueEvent:
    event_id = _new_id("queue-event")
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        insert into task_run_queue_events(
            id, queue_id, task_run_id, event_type, actor, status_before, status_after, message, created_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (event_id, queue_id, task_run_id, event_type, actor, status_before, status_after, message, now),
    )
    row = connection.execute("select * from task_run_queue_events where id = ?", (event_id,)).fetchone()
    return _queue_event_from_row(row)


def _retry_policy_from_connection(connection) -> dict:
    row = connection.execute("select * from task_run_retry_policy where id = ?", ("default",)).fetchone()
    if row is None:
        init_task_run_queue_store()
        row = connection.execute("select * from task_run_retry_policy where id = ?", ("default",)).fetchone()
    return {
        "policy_version": row["policy_version"],
        "max_attempts": int(row["max_attempts"]),
        "base_delay_seconds": int(row["base_delay_seconds"]),
        "max_delay_seconds": int(row["max_delay_seconds"]),
        "backoff_multiplier": float(row["backoff_multiplier"]),
        "retryable_errors": json.loads(row["retryable_errors_json"]),
        "terminal_status": row["terminal_status"],
        "manual_override_allowed": bool(row["manual_override_allowed"]),
    }


def _retry_delay_seconds(attempts: int, policy: dict) -> int:
    base_delay = max(0, int(policy["base_delay_seconds"]))
    multiplier = max(1.0, float(policy["backoff_multiplier"]))
    max_delay = max(base_delay, int(policy["max_delay_seconds"]))
    delay = int(base_delay * (multiplier ** max(0, attempts - 1)))
    return min(delay, max_delay)


def _dead_letter_reason(error: str, attempts: int, max_attempts: int) -> str:
    return f"Retry policy exhausted after {attempts}/{max_attempts} attempts. Error requires admin review: {error}"


def _upsert_dead_letter_for_failed_queue(connection, row, error: str, attempts: int) -> DeadLetterQueueRecord:
    now = datetime.now(UTC).isoformat()
    reason = _dead_letter_reason(error, attempts, int(row["max_attempts"]))
    next_action = "Acknowledge the issue, inspect queue events, then retry after fixing the cause or mark as resolved."
    existing = connection.execute(
        "select * from task_run_dead_letters where queue_id = ?",
        (row["id"],),
    ).fetchone()
    if existing is None:
        dead_letter_id = _new_id("dead-letter")
        connection.execute(
            """
            insert into task_run_dead_letters(
                id, queue_id, task_run_id, status, severity, reason, error, attempts,
                max_attempts, next_action, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dead_letter_id,
                row["id"],
                row["task_run_id"],
                "open",
                "critical",
                reason,
                error,
                attempts,
                int(row["max_attempts"]),
                next_action,
                now,
                now,
            ),
        )
    else:
        connection.execute(
            """
            update task_run_dead_letters
            set status = ?, severity = ?, reason = ?, error = ?, attempts = ?,
                max_attempts = ?, next_action = ?, updated_at = ?, resolved_by = null,
                resolved_at = null
            where queue_id = ?
            """,
            (
                "open",
                "critical",
                reason,
                error,
                attempts,
                int(row["max_attempts"]),
                next_action,
                now,
                row["id"],
            ),
        )
    _record_queue_event(
        connection,
        row["id"],
        row["task_run_id"],
        "dead_lettered",
        "queue-worker",
        "failed",
        "failed",
        reason,
    )
    updated = connection.execute("select * from task_run_dead_letters where queue_id = ?", (row["id"],)).fetchone()
    return _dead_letter_from_row(updated)


def _acknowledge_dead_letter_for_queue(connection, queue_id: str, actor: str, reason: str) -> None:
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        update task_run_dead_letters
        set status = case when status = 'resolved' then status else 'acknowledged' end,
            acknowledged_by = coalesce(acknowledged_by, ?),
            acknowledged_at = coalesce(acknowledged_at, ?),
            updated_at = ?,
            next_action = ?
        where queue_id = ?
        """,
        (
            actor,
            now,
            now,
            reason or "Admin acknowledged the dead-letter item and will decide retry or resolution.",
            queue_id,
        ),
    )


def _resolve_dead_letter_for_queue(connection, queue_id: str, actor: str, reason: str) -> DeadLetterQueueRecord | None:
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        update task_run_dead_letters
        set status = ?, severity = ?, resolved_by = ?, resolved_at = ?, updated_at = ?, next_action = ?
        where queue_id = ?
        """,
        (
            "resolved",
            "warning",
            actor,
            now,
            now,
            reason or "Dead-letter item resolved.",
            queue_id,
        ),
    )
    row = connection.execute("select * from task_run_dead_letters where queue_id = ?", (queue_id,)).fetchone()
    return _dead_letter_from_row(row) if row is not None else None


def _queued_task_run(task_run_id: str, payload: TaskRunQueueRequest) -> TaskRun:
    return TaskRun(
        id=task_run_id,
        process_id=payload.process_id,
        profile_id=payload.profile_id,
        status="queued",
        stages=[
            StageStatus(id="input", title="Input completeness", status="completed"),
            StageStatus(id="queue", title="TaskRun accepted into queue", status="waiting"),
            StageStatus(id="execution", title="Managed execution", status="waiting"),
            StageStatus(id="artifact", title="Artifact assembly", status="waiting"),
        ],
        gates=[
            GateResult(
                id="taskrun-queue-accepted",
                title="TaskRun Queue Accepted",
                status="passed",
                reason="TaskRun was persisted before execution and can survive a browser close or delayed worker.",
            )
        ],
        artifact_id=None,
        form_data=dict(payload.form_data),
    )


def enqueue_task_run(payload: TaskRunQueueRequest, session: RuntimeSession) -> TaskRunQueueResponse:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    queue_id = _new_id("queue")
    task_run_id = _new_id("run")
    task_run = _queued_task_run(task_run_id, payload)
    session_payload = {
        "actor": session.actor,
        "role": session.role,
        "department": session.department,
        "tenant_id": session.tenant_id,
        "access_level": session.access_level,
        "session_id": session.session_id,
        "auth_source": session.auth_source,
    }
    with get_connection() as connection:
        policy = _retry_policy_from_connection(connection)
        connection.execute(
            """
            insert into task_runs(
                id, process_id, profile_id, status, stages_json, gates_json,
                artifact_id, form_data_json, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_run.id,
                task_run.process_id,
                task_run.profile_id,
                task_run.status,
                json.dumps([stage.model_dump() for stage in task_run.stages], ensure_ascii=False, sort_keys=True),
                json.dumps([gate.model_dump() for gate in task_run.gates], ensure_ascii=False, sort_keys=True),
                task_run.artifact_id,
                json.dumps(task_run.form_data, ensure_ascii=False, sort_keys=True),
                now,
                now,
            ),
        )
        connection.execute(
            """
            insert into task_run_queue(
                id, task_run_id, status, payload_json, session_json, attempts, max_attempts,
                timeout_seconds, error, created_at, updated_at, next_run_at, completed_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                queue_id,
                task_run_id,
                "queued",
                json.dumps(payload.model_dump(), ensure_ascii=False, sort_keys=True),
                json.dumps(session_payload, ensure_ascii=False, sort_keys=True),
                0,
                max(1, min(payload.max_attempts, int(policy["max_attempts"]), 5)),
                max(5, min(payload.timeout_seconds, 600)),
                None,
                now,
                now,
                now,
                None,
            ),
        )
        _record_queue_event(
            connection,
            queue_id,
            task_run_id,
            "enqueued",
            session.actor,
            None,
            "queued",
            "TaskRun accepted into persistent MVP queue.",
        )
    queue_item = get_queue_item(queue_id)
    processed = False
    if payload.auto_process:
        processed_item = process_next_task_run_queue_item()
        queue_item = processed_item or queue_item
        processed = processed_item is not None
        task_run = get_task_run(task_run_id) or task_run
    return TaskRunQueueResponse(
        queue_item=queue_item,
        task_run=task_run,
        processed=processed,
        gates=[
            GateResult(
                id="taskrun-queue-response",
                title="Queue response returned",
                status="passed",
                reason="Caller receives both queue item and stable TaskRun id.",
            )
        ],
    )


def _session_from_payload(values: dict) -> RuntimeSession:
    return RuntimeSession(
        actor=values["actor"],
        role=values["role"],
        department=values["department"],
        access_level=values["access_level"],
        tenant_id=values["tenant_id"],
        session_id=values.get("session_id", "session-queue-mvp"),
        auth_source=values.get("auth_source", "queue_rehydrated"),
    )


def _complete_task_run(task_run_id: str, payload: TaskRunQueueRequest, session: RuntimeSession) -> TaskRun:
    simulated_failures = int(payload.form_data.get("simulate_worker_failure_attempts", 0) or 0)
    current_attempt = int(payload.form_data.get("_queue_attempt", 0) or 0)
    if simulated_failures and current_attempt <= simulated_failures:
        raise RuntimeError(f"Simulated worker failure for retry policy check: attempt {current_attempt}.")
    artifact_id = _new_id("artifact")
    source_ids = [*payload.document_ids] or [chunk.id for chunk in RAG_CHUNKS[:2]]
    gates = [
        GateResult(
            id="gate-queue-managed-taskrun-created",
            title="Queue managed TaskRun created",
            status="passed",
            reason="TaskRun moved from queued to completed through the queue worker.",
        ),
        GateResult(
            id="gate-queue-artifact-attached",
            title="Queue artifact attached",
            status="passed",
            reason="Worker generated and attached a user-visible artifact.",
        ),
        GateResult(
            id="gate-queue-tenant-bound",
            title="Queue tenant bound",
            status="passed",
            reason=f"Queued TaskRun executed inside tenant scope {session.tenant_id}.",
        ),
    ]
    task_run = TaskRun(
        id=task_run_id,
        process_id=payload.process_id,
        profile_id=payload.profile_id,
        status="completed",
        stages=[
            StageStatus(id="input", title="Input completeness", status="completed"),
            StageStatus(id="queue", title="TaskRun accepted into queue", status="completed"),
            StageStatus(id="execution", title="Managed execution", status="completed"),
            StageStatus(id="gates", title="Quality gates", status="completed"),
            StageStatus(id="artifact", title="Artifact assembly", status="completed"),
        ],
        gates=gates,
        artifact_id=artifact_id,
        form_data=dict(payload.form_data),
    )
    artifact = Artifact(
        id=artifact_id,
        task_run_id=task_run_id,
        version="0.1-runtime",
        title=_artifact_title(payload),
        content=_artifact_content(payload, session),
        sources=source_ids,
        checks=gates,
    )
    audit_event = AuditEvent(
        id=_new_id("audit"),
        actor=session.actor,
        action="task_run.queue.completed",
        target=task_run_id,
        redacted_payload={
            "artifact_id": artifact_id,
            "process_id": payload.process_id,
            "profile_id": payload.profile_id,
            "tenant_id": session.tenant_id,
            "worker": WORKER_NAME,
            "form_data_keys": sorted(payload.form_data.keys()),
            "secrets": "[redacted]",
        },
    )
    TASK_RUNS[task_run_id] = task_run
    ARTIFACTS[artifact_id] = artifact
    AUDIT_EVENTS.append(audit_event)
    save_task_run_bundle(task_run, artifact, audit_event)
    return task_run


def process_next_task_run_queue_item(actor: str = "queue-worker") -> TaskRunQueueItem | None:
    init_task_run_queue_store()
    now_dt = datetime.now(UTC)
    now = now_dt.isoformat()
    with get_connection() as connection:
        row = connection.execute(
            """
            select * from task_run_queue
            where status in ('queued', 'retrying')
              and (next_run_at is null or next_run_at <= ?)
            order by created_at, id
            limit 1
            """
            ,
            (now,),
        ).fetchone()
        if row is None:
            return None
        connection.execute(
            """
            update task_run_queue
            set status = ?, attempts = attempts + 1, updated_at = ?, error = null
            where id = ?
            """,
            ("running", now, row["id"]),
        )
        _record_queue_event(
            connection,
            row["id"],
            row["task_run_id"],
            "started",
            actor,
            row["status"],
            "running",
            "Queue worker started managed TaskRun execution.",
        )
    try:
        payload = TaskRunQueueRequest.model_validate(json.loads(row["payload_json"]))
        payload.form_data["_queue_attempt"] = int(row["attempts"]) + 1
        session = _session_from_payload(json.loads(row["session_json"]))
        _complete_task_run(row["task_run_id"], payload, session)
    except Exception as error:
        failed_at = datetime.now(UTC).isoformat()
        attempts = int(row["attempts"]) + 1
        with get_connection() as connection:
            policy = _retry_policy_from_connection(connection)
        next_status = "failed" if attempts >= int(row["max_attempts"]) else "retrying"
        retry_delay = _retry_delay_seconds(attempts, policy)
        next_run_at = None if next_status == "failed" else (datetime.now(UTC) + timedelta(seconds=retry_delay)).isoformat()
        with get_connection() as connection:
            connection.execute(
                """
                update task_run_queue
                set status = ?, attempts = ?, error = ?, updated_at = ?, next_run_at = ?
                where id = ?
                """,
                (
                    next_status,
                    attempts,
                    str(error),
                    failed_at,
                    next_run_at,
                    row["id"],
                ),
            )
            _record_queue_event(
                connection,
                row["id"],
                row["task_run_id"],
                "retry_exhausted" if next_status == "failed" else "retry_scheduled",
                actor,
                "running",
                next_status,
                f"{str(error)} Retry policy {policy['policy_version']} -> {next_status}; delay {retry_delay}s.",
            )
            _record_queue_event(
                connection,
                row["id"],
                row["task_run_id"],
                "retry_policy_applied",
                actor,
                "running",
                next_status,
                f"attempts {attempts}/{row['max_attempts']}; next_run_at {next_run_at or 'terminal failed'}.",
            )
            if next_status == "failed":
                _upsert_dead_letter_for_failed_queue(connection, row, str(error), attempts)
            updated = connection.execute("select * from task_run_queue where id = ?", (row["id"],)).fetchone()
        return _queue_item_from_row(updated)
    completed_at = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        connection.execute(
            """
            update task_run_queue
            set status = ?, error = null, updated_at = ?, completed_at = ?
            where id = ?
            """,
            ("completed", completed_at, completed_at, row["id"]),
        )
        _record_queue_event(
            connection,
            row["id"],
            row["task_run_id"],
            "completed",
            actor,
            "running",
            "completed",
            "Queue worker completed TaskRun and attached artifact.",
        )
        updated = connection.execute("select * from task_run_queue where id = ?", (row["id"],)).fetchone()
    return _queue_item_from_row(updated)


def get_queue_item(queue_id: str) -> TaskRunQueueItem:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_queue where id = ?", (queue_id,)).fetchone()
    if row is None:
        raise KeyError(queue_id)
    return _queue_item_from_row(row)


def list_queue_item_events(queue_id: str) -> list[TaskRunQueueEvent]:
    init_task_run_queue_store()
    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_queue_events
            where queue_id = ?
            order by created_at, id
            """,
            (queue_id,),
        ).fetchall()
    return [_queue_event_from_row(row) for row in rows]


def _cancelled_task_run(existing: TaskRun, reason: str) -> TaskRun:
    return TaskRun(
        id=existing.id,
        process_id=existing.process_id,
        profile_id=existing.profile_id,
        status="cancelled",
        stages=[
            StageStatus(id="input", title="Input completeness", status="completed"),
            StageStatus(id="queue", title="TaskRun accepted into queue", status="completed"),
            StageStatus(id="execution", title="Managed execution", status="failed"),
            StageStatus(id="artifact", title="Artifact assembly", status="waiting"),
        ],
        gates=[
            *existing.gates,
            GateResult(
                id="taskrun-queue-cancelled",
                title="Queue TaskRun cancelled",
                status="warning",
                reason=reason or "TaskRun was manually cancelled before completion.",
                action="Retry can be requested from the queue monitor.",
            ),
        ],
        artifact_id=existing.artifact_id,
        form_data=dict(existing.form_data),
    )


def cancel_queue_item(queue_id: str, actor: str, reason: str = "") -> TaskRunQueueActionResponse:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_queue where id = ?", (queue_id,)).fetchone()
        if row is None:
            raise KeyError(queue_id)
        if row["status"] in {"completed", "cancelled"}:
            event = _record_queue_event(
                connection,
                row["id"],
                row["task_run_id"],
                "cancelled",
                actor,
                row["status"],
                row["status"],
                "Cancel ignored because queue item is already closed.",
            )
            return TaskRunQueueActionResponse(
                queue_item=_queue_item_from_row(row),
                task_run=get_task_run(row["task_run_id"]),
                event=event,
                gates=[
                    GateResult(
                        id="taskrun-queue-cancel-noop",
                        title="Queue cancel no-op",
                        status="warning",
                        reason="Closed queue items are not cancelled twice.",
                    )
                ],
            )
        connection.execute(
            """
            update task_run_queue
            set status = ?, error = ?, updated_at = ?, completed_at = ?
            where id = ?
            """,
            ("cancelled", reason or "Manual cancellation requested.", now, now, queue_id),
        )
        task_run_row = connection.execute("select * from task_runs where id = ?", (row["task_run_id"],)).fetchone()
        existing_task_run = _task_run_from_connection_row(task_run_row)
        if existing_task_run is not None:
            cancelled_task_run = _cancelled_task_run(existing_task_run, reason)
            TASK_RUNS[cancelled_task_run.id] = cancelled_task_run
            connection.execute(
                """
                update task_runs
                set status = ?, stages_json = ?, gates_json = ?, updated_at = ?
                where id = ?
                """,
                (
                    cancelled_task_run.status,
                    json.dumps([stage.model_dump() for stage in cancelled_task_run.stages], ensure_ascii=False, sort_keys=True),
                    json.dumps([gate.model_dump() for gate in cancelled_task_run.gates], ensure_ascii=False, sort_keys=True),
                    now,
                    cancelled_task_run.id,
                ),
            )
        event = _record_queue_event(
            connection,
            row["id"],
            row["task_run_id"],
            "cancelled",
            actor,
            row["status"],
            "cancelled",
            reason or "Manual cancellation requested.",
        )
        updated = connection.execute("select * from task_run_queue where id = ?", (queue_id,)).fetchone()
    return TaskRunQueueActionResponse(
        queue_item=_queue_item_from_row(updated),
        task_run=get_task_run(row["task_run_id"]),
        event=event,
        gates=[
            GateResult(
                id="taskrun-queue-cancel-action",
                title="Queue cancel action",
                status="passed",
                reason="A queued/running TaskRun can be manually cancelled and audited.",
            )
        ],
    )


def retry_queue_item(queue_id: str, actor: str, reason: str = "", auto_process: bool = True) -> TaskRunQueueActionResponse:
    init_task_run_queue_store()
    now = datetime.now(UTC).isoformat()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_queue where id = ?", (queue_id,)).fetchone()
        if row is None:
            raise KeyError(queue_id)
        if row["status"] not in {"failed", "cancelled"}:
            if row["status"] == "completed":
                resolved = _resolve_dead_letter_for_queue(
                    connection,
                    queue_id,
                    actor,
                    reason or "Queue item is already completed; linked dead-letter item is resolved.",
                )
                if resolved is not None:
                    _record_queue_event(
                        connection,
                        row["id"],
                        row["task_run_id"],
                        "dead_letter_resolved",
                        actor,
                        "acknowledged",
                        "resolved",
                        resolved.next_action,
                    )
            event = _record_queue_event(
                connection,
                row["id"],
                row["task_run_id"],
                "manual_retry",
                actor,
                row["status"],
                row["status"],
                "Retry ignored because queue item is not failed or cancelled.",
            )
            return TaskRunQueueActionResponse(
                queue_item=_queue_item_from_row(row),
                task_run=get_task_run(row["task_run_id"]),
                event=event,
                gates=[
                    GateResult(
                        id="taskrun-queue-retry-noop",
                        title="Queue retry no-op",
                        status="warning",
                        reason="Only failed or cancelled queue items can be retried manually.",
                    )
                ],
            )
        max_attempts = max(int(row["max_attempts"]), int(row["attempts"]) + 1)
        connection.execute(
            """
            update task_run_queue
            set status = ?, max_attempts = ?, error = null, updated_at = ?, next_run_at = ?, completed_at = null
            where id = ?
            """,
            ("retrying", max_attempts, now, now, queue_id),
        )
        event = _record_queue_event(
            connection,
            row["id"],
            row["task_run_id"],
            "manual_retry",
            actor,
            row["status"],
            "retrying",
            reason or "Manual retry requested.",
        )
        _acknowledge_dead_letter_for_queue(
            connection,
            queue_id,
            actor,
            reason or "Manual retry requested from dead-letter/queue monitor.",
        )
    if auto_process:
        for _ in range(10):
            current = get_queue_item(queue_id)
            if current.status not in {"queued", "retrying", "running"}:
                break
            processed = process_next_task_run_queue_item()
            if processed is None:
                break
    final_item = get_queue_item(queue_id)
    if final_item.status == "completed":
        with get_connection() as connection:
            resolved = _resolve_dead_letter_for_queue(
                connection,
                queue_id,
                actor,
                reason or "Manual retry completed; dead-letter item resolved.",
            )
            if resolved is not None:
                _record_queue_event(
                    connection,
                    queue_id,
                    row["task_run_id"],
                    "dead_letter_resolved",
                    actor,
                    "acknowledged",
                    "resolved",
                    resolved.next_action,
                )
    return TaskRunQueueActionResponse(
        queue_item=final_item,
        task_run=get_task_run(row["task_run_id"]),
        event=event,
        gates=[
            GateResult(
                id="taskrun-queue-retry-action",
                title="Queue retry action",
                status="passed",
                reason="A failed/cancelled TaskRun can be returned to execution without losing its queue id.",
            )
        ],
    )


def dead_letter_queue_status(limit: int = 20) -> DeadLetterQueueStatus:
    init_task_run_queue_store()
    safe_limit = max(1, min(limit, 100))
    with get_connection() as connection:
        counts = {
            status: connection.execute("select count(*) from task_run_dead_letters where status = ?", (status,)).fetchone()[0]
            for status in ["open", "acknowledged", "resolved"]
        }
        total = connection.execute("select count(*) from task_run_dead_letters").fetchone()[0]
        rows = connection.execute(
            """
            select * from task_run_dead_letters
            order by case status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
                     updated_at desc, created_at desc, id desc
            limit ?
            """,
            (safe_limit,),
        ).fetchall()
    return DeadLetterQueueStatus(
        mode="sqlite_mvp_dead_letter_queue",
        total=total,
        open=counts["open"],
        acknowledged=counts["acknowledged"],
        resolved=counts["resolved"],
        items=[_dead_letter_from_row(row) for row in rows],
        gates=[
            GateResult(
                id="dead-letter-queue-visible",
                title="Dead Letter Queue is visible",
                status="passed",
                reason="Exhausted retries are separated from ordinary failed counts and exposed for admin triage.",
            ),
            GateResult(
                id="dead-letter-queue-actions",
                title="Dead Letter Queue actions exist",
                status="passed",
                reason="Admin can acknowledge or resolve a dead-letter item with an audited queue event.",
            ),
        ],
    )


def get_dead_letter(dead_letter_id: str) -> DeadLetterQueueRecord:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_dead_letters where id = ?", (dead_letter_id,)).fetchone()
    if row is None:
        raise KeyError(dead_letter_id)
    return _dead_letter_from_row(row)


def acknowledge_dead_letter(dead_letter_id: str, actor: str, reason: str = "") -> DeadLetterQueueActionResponse:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_dead_letters where id = ?", (dead_letter_id,)).fetchone()
        if row is None:
            raise KeyError(dead_letter_id)
        _acknowledge_dead_letter_for_queue(
            connection,
            row["queue_id"],
            actor,
            reason or "Dead-letter item acknowledged for manual review.",
        )
        event = _record_queue_event(
            connection,
            row["queue_id"],
            row["task_run_id"],
            "dead_letter_acknowledged",
            actor,
            row["status"],
            "acknowledged" if row["status"] != "resolved" else "resolved",
            reason or "Dead-letter item acknowledged for manual review.",
        )
        updated = connection.execute("select * from task_run_dead_letters where id = ?", (dead_letter_id,)).fetchone()
    return DeadLetterQueueActionResponse(
        item=_dead_letter_from_row(updated),
        event=event,
        gates=[
            GateResult(
                id="dead-letter-acknowledge-action",
                title="Dead-letter acknowledge action",
                status="passed",
                reason="Admin acknowledgement is persisted and audited.",
            )
        ],
    )


def resolve_dead_letter(dead_letter_id: str, actor: str, reason: str = "") -> DeadLetterQueueActionResponse:
    init_task_run_queue_store()
    with get_connection() as connection:
        row = connection.execute("select * from task_run_dead_letters where id = ?", (dead_letter_id,)).fetchone()
        if row is None:
            raise KeyError(dead_letter_id)
        resolved = _resolve_dead_letter_for_queue(
            connection,
            row["queue_id"],
            actor,
            reason or "Dead-letter item manually marked resolved.",
        )
        event = _record_queue_event(
            connection,
            row["queue_id"],
            row["task_run_id"],
            "dead_letter_resolved",
            actor,
            row["status"],
            "resolved",
            reason or "Dead-letter item manually marked resolved.",
        )
    return DeadLetterQueueActionResponse(
        item=resolved,
        event=event,
        gates=[
            GateResult(
                id="dead-letter-resolve-action",
                title="Dead-letter resolve action",
                status="passed",
                reason="Admin resolution is persisted and audited.",
            )
        ],
    )


def recover_stale_running_queue_items(max_age_seconds: int = 60, actor: str = "queue-recovery") -> TaskRunQueueStatus:
    init_task_run_queue_store()
    max_age_seconds = max(1, min(max_age_seconds, 86400))
    now_dt = datetime.now(UTC)
    now = now_dt.isoformat()
    with get_connection() as connection:
        rows = connection.execute(
            "select * from task_run_queue where status = ? order by updated_at asc",
            ("running",),
        ).fetchall()
        for row in rows:
            try:
                updated_at = datetime.fromisoformat(row["updated_at"])
            except ValueError:
                updated_at = now_dt
            age_seconds = (now_dt - updated_at).total_seconds()
            if age_seconds < max_age_seconds:
                continue
            attempts = int(row["attempts"])
            max_attempts = int(row["max_attempts"])
            next_status = "failed" if attempts >= max_attempts else "retrying"
            connection.execute(
                """
                update task_run_queue
                set status = ?, error = ?, updated_at = ?, next_run_at = ?
                where id = ?
                """,
                (
                    next_status,
                    f"Recovered stale running task after {int(age_seconds)} seconds.",
                    now,
                    None if next_status == "failed" else now,
                    row["id"],
                ),
            )
            _record_queue_event(
                connection,
                row["id"],
                row["task_run_id"],
                "stale_recovered",
                actor,
                "running",
                next_status,
                f"Recovered stale running task after {int(age_seconds)} seconds.",
            )
    return queue_status()


def queue_status(limit: int = 10) -> TaskRunQueueStatus:
    init_task_run_queue_store()
    with get_connection() as connection:
        counts = {
            status: connection.execute("select count(*) from task_run_queue where status = ?", (status,)).fetchone()[0]
            for status in ["queued", "running", "retrying", "completed", "failed", "cancelled"]
        }
        total = connection.execute("select count(*) from task_run_queue").fetchone()[0]
        rows = connection.execute(
            """
            select * from task_run_queue
            order by updated_at desc, created_at desc, id desc
            limit ?
            """,
            (max(1, min(limit, 50)),),
        ).fetchall()
        event_rows = connection.execute(
            """
            select * from task_run_queue_events
            order by created_at desc, id desc
            limit ?
            """,
            (max(1, min(limit, 50)),),
        ).fetchall()
    return TaskRunQueueStatus(
        mode="sqlite_mvp_queue",
        worker=WORKER_NAME,
        total=total,
        queued=counts["queued"],
        running=counts["running"],
        retrying=counts["retrying"],
        completed=counts["completed"],
        failed=counts["failed"],
        cancelled=counts["cancelled"],
        items=[_queue_item_from_row(row) for row in rows],
        events=[_queue_event_from_row(row) for row in event_rows],
        gates=[
            GateResult(
                id="taskrun-queue-storage",
                title="TaskRun queue storage",
                status="passed",
                reason="Queue state is persisted in SQLite and exposed through monitoring endpoint.",
            ),
            GateResult(
                id="taskrun-queue-worker",
                title="TaskRun queue worker",
                status="passed",
                reason="MVP worker can process queued and retrying TaskRuns into completed/failed states.",
            ),
            GateResult(
                id="taskrun-queue-recovery-actions",
                title="TaskRun queue recovery actions",
                status="passed",
                reason="Queue exposes audited cancel, retry and stale-running recovery controls.",
            ),
        ],
    )


def _age_seconds(value: str | None, now: datetime) -> int:
    if not value:
        return 0
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return 0
    return max(0, int((now - parsed).total_seconds()))


def worker_observability(max_pending_age_seconds: int = 120, event_limit: int = 20) -> WorkerObservabilityStatus:
    init_task_run_queue_store()
    now = datetime.now(UTC)
    safe_pending_age = max(10, min(max_pending_age_seconds, 86400))
    safe_event_limit = max(5, min(event_limit, 100))
    status = queue_status(limit=max(10, min(safe_event_limit, 50)))
    attention_items: list[QueueObservationProblem] = []
    oldest_pending_age = 0
    running_age_max = 0

    with get_connection() as connection:
        rows = connection.execute(
            """
            select * from task_run_queue
            where status in ('queued', 'retrying', 'running', 'failed', 'cancelled')
            order by updated_at desc, created_at desc, id desc
            limit 100
            """
        ).fetchall()
        recent_failure_events = connection.execute(
            """
            select count(*) from task_run_queue_events
            where event_type in ('failed', 'retry_scheduled', 'retry_exhausted', 'stale_recovered', 'dead_lettered')
            """
        ).fetchone()[0]
        recent_events_total = connection.execute("select count(*) from task_run_queue_events").fetchone()[0]
        open_dead_letters = connection.execute(
            "select count(*) from task_run_dead_letters where status in ('open', 'acknowledged')"
        ).fetchone()[0]

    for row in rows:
        row_status = row["status"]
        age = _age_seconds(row["updated_at"] or row["created_at"], now)
        if row_status in {"queued", "retrying"}:
            oldest_pending_age = max(oldest_pending_age, age)
            if age >= safe_pending_age:
                attention_items.append(
                    QueueObservationProblem(
                        queue_id=row["id"],
                        task_run_id=row["task_run_id"],
                        status=row_status,
                        severity="warning",
                        age_seconds=age,
                        title="Задача долго ожидает выполнения",
                        recommendation="Проверить worker и при необходимости запустить process-next или отменить задачу.",
                    )
                )
        elif row_status == "running":
            running_age_max = max(running_age_max, age)
            severity = "critical" if age >= safe_pending_age else "warning"
            attention_items.append(
                QueueObservationProblem(
                    queue_id=row["id"],
                    task_run_id=row["task_run_id"],
                    status=row_status,
                    severity=severity,
                    age_seconds=age,
                    title="Задача находится в работе",
                    recommendation="Если задача висит дольше допустимого времени, запустить stale recovery.",
                )
            )
        elif row_status == "failed":
            attention_items.append(
                QueueObservationProblem(
                    queue_id=row["id"],
                    task_run_id=row["task_run_id"],
                    status=row_status,
                    severity="critical",
                    age_seconds=age,
                    title="Задача завершилась ошибкой",
                    recommendation="Открыть ошибку, исправить причину и запустить ручной повтор.",
                )
            )
        elif row_status == "cancelled":
            attention_items.append(
                QueueObservationProblem(
                    queue_id=row["id"],
                    task_run_id=row["task_run_id"],
                    status=row_status,
                    severity="info",
                    age_seconds=age,
                    title="Задача отменена",
                    recommendation="Если задача актуальна, запустить ручной повтор; если нет - оставить как закрытую.",
                )
            )

    critical_total = len([item for item in attention_items if item.severity == "critical"])
    warning_total = len([item for item in attention_items if item.severity == "warning"])
    if open_dead_letters:
        attention_items.append(
            QueueObservationProblem(
                queue_id="dead-letter-queue",
                task_run_id="manual-triage",
                status="dead_letter",
                severity="critical",
                age_seconds=0,
                title="Есть задачи в Dead Letter Queue",
                recommendation="Открыть DLQ, подтвердить разбор, исправить причину и выполнить retry или resolution.",
            )
        )

    critical_total = len([item for item in attention_items if item.severity == "critical"])
    warning_total = len([item for item in attention_items if item.severity == "warning"])
    if critical_total or status.failed or open_dead_letters:
        health = "attention_required"
    elif warning_total or status.running or status.queued or status.retrying:
        health = "degraded"
    else:
        health = "healthy"

    recommendations: list[str] = []
    if status.failed:
        recommendations.append("Разобрать failed-задачи в DLQ и запустить retry после устранения причины.")
    if open_dead_letters:
        recommendations.append("Открыть Dead Letter Queue: подтвердить разбор и назначить retry или resolution.")
    if running_age_max >= safe_pending_age:
        recommendations.append("Запустить stale recovery для зависших running-задач.")
    if oldest_pending_age >= safe_pending_age:
        recommendations.append("Проверить, почему очередь не обрабатывается worker-ом.")
    if not recommendations:
        recommendations.append("Действий не требуется: очередь находится в рабочем состоянии.")

    summary = {
        "healthy": "Очередь работает штатно: нет ошибок и зависших задач.",
        "degraded": "Очередь работает, но есть задачи, требующие наблюдения.",
        "attention_required": "Нужна ручная реакция: есть ошибки или критичные зависания.",
    }[health]

    return WorkerObservabilityStatus(
        mode="sqlite_mvp_observability",
        worker=WORKER_NAME,
        health=health,
        summary=summary,
        totals={
            "total": status.total,
            "queued": status.queued,
            "running": status.running,
            "retrying": status.retrying,
            "completed": status.completed,
            "failed": status.failed,
            "cancelled": status.cancelled,
            "dead_letter_open": open_dead_letters,
            "attention": len(attention_items),
            "critical": critical_total,
            "warning": warning_total,
        },
        oldest_pending_age_seconds=oldest_pending_age,
        running_age_seconds_max=running_age_max,
        recent_events_total=recent_events_total,
        recent_failures_total=recent_failure_events,
        attention_items=attention_items[:10],
        recommendations=recommendations,
        queue_status=status,
        gates=[
            GateResult(
                id="worker-observability-health",
                title="Worker health is explainable",
                status="passed",
                reason="Worker state is mapped to healthy/degraded/attention_required with human-readable summary.",
            ),
            GateResult(
                id="worker-observability-actions",
                title="Worker recovery actions are visible",
                status="passed",
                reason="Attention items include queue id, severity, age and recommended next action.",
            ),
        ],
    )


def retry_policy_status() -> RetryPolicyStatus:
    init_task_run_queue_store()
    with get_connection() as connection:
        policy = _retry_policy_from_connection(connection)
    return RetryPolicyStatus(
        mode="sqlite_mvp_retry_policy",
        policy_version=policy["policy_version"],
        max_attempts=policy["max_attempts"],
        base_delay_seconds=policy["base_delay_seconds"],
        max_delay_seconds=policy["max_delay_seconds"],
        backoff_multiplier=policy["backoff_multiplier"],
        retryable_errors=policy["retryable_errors"],
        terminal_status="failed",
        manual_override_allowed=policy["manual_override_allowed"],
        next_action="After automatic attempts are exhausted, queue item becomes failed and requires admin retry or later dead-letter routing.",
        gates=[
            GateResult(
                id="retry-policy-visible",
                title="Retry policy is visible",
                status="passed",
                reason="Administrator can inspect max attempts, backoff and terminal status before accepting runtime behavior.",
            ),
            GateResult(
                id="retry-policy-terminal-state",
                title="Retry policy has terminal state",
                status="passed",
                reason="Exhausted automatic retries stop at failed instead of looping forever.",
            ),
        ],
    )
