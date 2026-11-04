import json

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas import (
    AcceptanceDecisionRequest,
    AdminIncidentTimelineStatus,
    ArtifactDraftPersistenceRequest,
    DeadLetterQueueActionRequest,
    DeadLetterQueueActionResponse,
    DeadLetterQueueRecord,
    DeadLetterQueueStatus,
    IncidentLifecycleStatus,
    NotificationDeliveryActionRequest,
    NotificationDeliveryStatus,
    NotificationPolicyAuditStatus,
    NotificationRoutingStatus,
    NextStepReviewPersistenceRequest,
    QueueAdminActionAuditStatus,
    QueueAdminCommandCenterStatus,
    QueueAdminRecoveryPlanStatus,
    QueueEvidenceAcceptanceBatchActionRequest,
    QueueEvidenceAcceptanceBatchActionResponse,
    QueueEvidenceAcceptanceBatchGroupClosureStatus,
    QueueEvidenceAcceptanceBatchItemDecisionRequest,
    QueueEvidenceAcceptanceBatchItemDecisionResponse,
    QueueEvidenceAcceptanceBatchPlanStatus,
    QueueEvidenceAcceptanceBlockerWorklistStatus,
    QueueEvidenceAcceptanceCenterStatus,
    QueueEvidenceAcceptanceChecklistStatus,
    QueueEvidenceAcceptanceSummaryStatus,
    QueueEvidenceReviewActionRequest,
    QueueEvidenceReviewItem,
    QueueEvidenceReviewPackage,
    QueueEvidenceReviewPackageArchiveEntry,
    QueueEvidenceReviewPackageArchiveStatus,
    QueueEvidenceReviewRequest,
    QueueEvidenceReviewStatus,
    QueueManualTriageActionRequest,
    QueueManualTriageItem,
    QueueManualTriageRequest,
    QueueManualTriageStatus,
    QueueRunbookActionRequest,
    QueueRunbookActionResponse,
    QueueOperationsRunbookStatus,
    ResultActionDecisionRequest,
    TaskIntakePreviewRequest,
    TaskIntakePreviewResponse,
    TaskRun,
    TaskRunCreate,
    TaskRunQueueActionRequest,
    TaskRunQueueActionResponse,
    TaskRunQueueEvent,
    TaskRunQueueItem,
    TaskRunQueueRequest,
    TaskRunQueueResponse,
    TaskRunQueueStatus,
    TaskRunResultCenter,
    QueueAdminAlertCenterStatus,
    RetryPolicyStatus,
    WorkerSchedulerActionRequest,
    WorkerSchedulerStatus,
    WorkerObservabilityStatus,
)
from app.services.access_policy import require_process_access
from app.services.result_center import build_task_run_result_center
from app.services.security_context import RuntimeSession, require_runtime_session
from app.services.task_intake import build_task_intake_preview
from app.services.task_run_execution import create_followup_task_run, create_managed_task_run
from app.services.task_run_queue import (
    acknowledge_dead_letter,
    admin_incident_timeline_status,
    assign_manual_triage_case,
    cancel_queue_item,
    create_evidence_review_case,
    create_manual_triage_case,
    dead_letter_queue_status,
    decide_evidence_review_case,
    dispatch_notification_deliveries,
    decide_queue_evidence_acceptance_batch_item,
    enqueue_task_run,
    execute_queue_evidence_acceptance_batch_action,
    execute_queue_runbook_action,
    get_dead_letter,
    get_queue_item,
    incident_lifecycle_status,
    list_queue_item_events,
    process_next_task_run_queue_item,
    notification_delivery_status,
    notification_policy_audit_status,
    notification_routing_status,
    queue_admin_action_audit_status,
    queue_admin_command_center_status,
    queue_admin_recovery_plan_status,
    archive_queue_evidence_review_package,
    queue_evidence_acceptance_batch_group_closure,
    queue_evidence_acceptance_batch_plan,
    queue_evidence_acceptance_center_status,
    queue_evidence_acceptance_blocker_worklist,
    queue_evidence_acceptance_checklist,
    queue_evidence_acceptance_summary,
    queue_evidence_review_status,
    queue_evidence_review_package,
    queue_evidence_review_package_archive_status,
    queue_manual_triage_status,
    queue_operations_runbook_status,
    queue_status,
    queue_admin_alert_center,
    recover_stale_running_queue_items,
    resolve_dead_letter,
    resolve_manual_triage_case,
    retry_queue_item,
    retry_policy_status,
    run_scheduler_tick,
    start_worker_scheduler,
    stop_worker_scheduler,
    worker_observability,
    worker_scheduler_status,
)
from app.services.task_run_store import get_task_run as get_persisted_task_run, record_result_action

router = APIRouter(prefix="/task-runs", tags=["task-runs"])


@router.post("/intake-preview", response_model=TaskIntakePreviewResponse)
def preview_task_intake(
    payload: TaskIntakePreviewRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskIntakePreviewResponse:
    require_process_access(payload.process_id, "view", session)
    return build_task_intake_preview(payload)


@router.post("", response_model=TaskRun)
def create_task_run(payload: TaskRunCreate, session: RuntimeSession = Depends(require_runtime_session)) -> TaskRun:
    require_process_access(payload.process_id, "execute", session)
    return create_managed_task_run(payload, session)


@router.post("/queue", response_model=TaskRunQueueResponse)
def enqueue_task_run_for_reliable_execution(
    payload: TaskRunQueueRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueResponse:
    require_process_access(payload.process_id, "execute", session)
    return enqueue_task_run(payload, session)


@router.post("/queue/process-next", response_model=TaskRunQueueStatus)
def process_next_queued_task_run(
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueStatus:
    process_next_task_run_queue_item()
    return queue_status()


@router.get("/queue/status", response_model=TaskRunQueueStatus)
def get_task_run_queue_status(
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueStatus:
    return queue_status()


@router.get("/queue/observability", response_model=WorkerObservabilityStatus)
def get_task_run_queue_observability(
    session: RuntimeSession = Depends(require_runtime_session),
) -> WorkerObservabilityStatus:
    return worker_observability()


@router.get("/queue/retry-policy", response_model=RetryPolicyStatus)
def get_task_run_queue_retry_policy(
    session: RuntimeSession = Depends(require_runtime_session),
) -> RetryPolicyStatus:
    return retry_policy_status()


@router.get("/queue/admin-alerts", response_model=QueueAdminAlertCenterStatus)
def get_task_run_queue_admin_alerts(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueAdminAlertCenterStatus:
    return queue_admin_alert_center()


@router.get("/queue/admin-recovery-plan", response_model=QueueAdminRecoveryPlanStatus)
def get_task_run_queue_admin_recovery_plan(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueAdminRecoveryPlanStatus:
    return queue_admin_recovery_plan_status()


@router.get("/queue/admin-command-center", response_model=QueueAdminCommandCenterStatus)
def get_task_run_queue_admin_command_center(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueAdminCommandCenterStatus:
    return queue_admin_command_center_status()


@router.get("/queue/incidents", response_model=IncidentLifecycleStatus)
def get_task_run_queue_incidents(
    session: RuntimeSession = Depends(require_runtime_session),
) -> IncidentLifecycleStatus:
    return incident_lifecycle_status()


@router.get("/queue/incidents/timeline", response_model=AdminIncidentTimelineStatus)
def get_task_run_queue_incident_timeline(
    limit: int = 50,
    session: RuntimeSession = Depends(require_runtime_session),
) -> AdminIncidentTimelineStatus:
    return admin_incident_timeline_status(limit=limit)


@router.get("/queue/notifications/status", response_model=NotificationDeliveryStatus)
def get_task_run_queue_notification_delivery(
    session: RuntimeSession = Depends(require_runtime_session),
) -> NotificationDeliveryStatus:
    return notification_delivery_status()


@router.post("/queue/notifications/dispatch", response_model=NotificationDeliveryStatus)
def dispatch_task_run_queue_notifications(
    payload: NotificationDeliveryActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> NotificationDeliveryStatus:
    return dispatch_notification_deliveries(actor=payload.actor or session.actor, reason=payload.reason)


@router.get("/queue/notifications/routing", response_model=NotificationRoutingStatus)
def get_task_run_queue_notification_routing(
    session: RuntimeSession = Depends(require_runtime_session),
) -> NotificationRoutingStatus:
    return notification_routing_status()


@router.get("/queue/notifications/policy-audit", response_model=NotificationPolicyAuditStatus)
def get_task_run_queue_notification_policy_audit(
    session: RuntimeSession = Depends(require_runtime_session),
) -> NotificationPolicyAuditStatus:
    return notification_policy_audit_status()


@router.get("/queue/operations-runbook", response_model=QueueOperationsRunbookStatus)
def get_task_run_queue_operations_runbook(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueOperationsRunbookStatus:
    return queue_operations_runbook_status()


@router.get("/queue/admin-action-audit", response_model=QueueAdminActionAuditStatus)
def get_task_run_queue_admin_action_audit(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueAdminActionAuditStatus:
    return queue_admin_action_audit_status()


@router.get("/queue/manual-triage", response_model=QueueManualTriageStatus)
def get_task_run_queue_manual_triage(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueManualTriageStatus:
    return queue_manual_triage_status()


@router.get("/queue/evidence-review", response_model=QueueEvidenceReviewStatus)
def get_task_run_queue_evidence_review(
    limit: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    severity: str | None = Query(None),
    sla_status: str | None = Query(None),
    owner_role: str | None = Query(None),
    source_query: str | None = Query(None),
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewStatus:
    return queue_evidence_review_status(
        limit=limit,
        status_filter=status,
        severity_filter=severity,
        sla_status_filter=sla_status,
        owner_role_filter=owner_role,
        source_query=source_query,
    )


@router.get("/queue/evidence-review/package", response_model=QueueEvidenceReviewPackage)
def get_task_run_queue_evidence_review_package(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewPackage:
    return queue_evidence_review_package(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/package/archive", response_model=QueueEvidenceReviewPackageArchiveStatus)
def get_task_run_queue_evidence_review_package_archive(
    limit: int = Query(20, ge=1, le=100),
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewPackageArchiveStatus:
    return queue_evidence_review_package_archive_status(limit=limit)


@router.post("/queue/evidence-review/package/archive", response_model=QueueEvidenceReviewPackageArchiveEntry)
def archive_task_run_queue_evidence_review_package(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewPackageArchiveEntry:
    return archive_queue_evidence_review_package(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/acceptance-checklist", response_model=QueueEvidenceAcceptanceChecklistStatus)
def get_task_run_queue_evidence_acceptance_checklist(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceChecklistStatus:
    return queue_evidence_acceptance_checklist(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/acceptance-summary", response_model=QueueEvidenceAcceptanceSummaryStatus)
def get_task_run_queue_evidence_acceptance_summary(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceSummaryStatus:
    return queue_evidence_acceptance_summary(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/acceptance-worklist", response_model=QueueEvidenceAcceptanceBlockerWorklistStatus)
def get_task_run_queue_evidence_acceptance_worklist(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceBlockerWorklistStatus:
    return queue_evidence_acceptance_blocker_worklist(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/acceptance-center", response_model=QueueEvidenceAcceptanceCenterStatus)
def get_task_run_queue_evidence_acceptance_center(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceCenterStatus:
    return queue_evidence_acceptance_center_status(actor=session.actor, tenant_id=session.tenant_id)


@router.get("/queue/evidence-review/acceptance-batch-plan", response_model=QueueEvidenceAcceptanceBatchPlanStatus)
def get_task_run_queue_evidence_acceptance_batch_plan(
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceBatchPlanStatus:
    return queue_evidence_acceptance_batch_plan(actor=session.actor, tenant_id=session.tenant_id)


@router.post("/queue/evidence-review/acceptance-batch-action", response_model=QueueEvidenceAcceptanceBatchActionResponse)
def run_task_run_queue_evidence_acceptance_batch_action(
    payload: QueueEvidenceAcceptanceBatchActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceBatchActionResponse:
    return execute_queue_evidence_acceptance_batch_action(payload, actor=session.actor, tenant_id=session.tenant_id)


@router.get(
    "/queue/evidence-review/acceptance-batch-groups/{batch_group_id}/closure",
    response_model=QueueEvidenceAcceptanceBatchGroupClosureStatus,
)
def get_task_run_queue_evidence_acceptance_batch_group_closure(
    batch_group_id: str,
    source_query: str | None = Query(None),
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceBatchGroupClosureStatus:
    return queue_evidence_acceptance_batch_group_closure(
        batch_group_id,
        actor=session.actor,
        tenant_id=session.tenant_id,
        source_query=source_query,
    )


@router.post("/queue/evidence-review/acceptance-batch-item-decision", response_model=QueueEvidenceAcceptanceBatchItemDecisionResponse)
def decide_task_run_queue_evidence_acceptance_batch_item(
    payload: QueueEvidenceAcceptanceBatchItemDecisionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceAcceptanceBatchItemDecisionResponse:
    return decide_queue_evidence_acceptance_batch_item(payload, actor=session.actor, tenant_id=session.tenant_id)


@router.post("/queue/evidence-review", response_model=QueueEvidenceReviewItem)
def create_task_run_queue_evidence_review(
    payload: QueueEvidenceReviewRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewItem:
    return create_evidence_review_case(payload, actor=session.actor)


@router.post("/queue/evidence-review/{review_id}/approve", response_model=QueueEvidenceReviewItem)
def approve_task_run_queue_evidence_review(
    review_id: str,
    payload: QueueEvidenceReviewActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewItem:
    item = decide_evidence_review_case(
        review_id,
        "approved",
        actor=payload.actor or session.actor,
        reason=payload.reason,
        review_note=payload.review_note,
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"Evidence review case {review_id} not found.")
    return item


@router.post("/queue/evidence-review/{review_id}/rework", response_model=QueueEvidenceReviewItem)
def rework_task_run_queue_evidence_review(
    review_id: str,
    payload: QueueEvidenceReviewActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueEvidenceReviewItem:
    item = decide_evidence_review_case(
        review_id,
        "rework",
        actor=payload.actor or session.actor,
        reason=payload.reason,
        review_note=payload.review_note,
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"Evidence review case {review_id} not found.")
    return item


@router.post("/queue/manual-triage", response_model=QueueManualTriageItem)
def create_task_run_queue_manual_triage(
    payload: QueueManualTriageRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueManualTriageItem:
    return create_manual_triage_case(payload, actor=session.actor)


@router.post("/queue/manual-triage/{case_id}/assign", response_model=QueueManualTriageItem)
def assign_task_run_queue_manual_triage(
    case_id: str,
    payload: QueueManualTriageActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueManualTriageItem:
    item = assign_manual_triage_case(case_id, actor=payload.actor or session.actor, reason=payload.reason)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Manual triage case {case_id} not found.")
    return item


@router.post("/queue/manual-triage/{case_id}/resolve", response_model=QueueManualTriageItem)
def resolve_task_run_queue_manual_triage(
    case_id: str,
    payload: QueueManualTriageActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueManualTriageItem:
    item = resolve_manual_triage_case(
        case_id,
        actor=payload.actor or session.actor,
        reason=payload.reason,
        resolution=payload.resolution,
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"Manual triage case {case_id} not found.")
    return item


@router.post("/queue/operations-runbook/actions/{step_id}", response_model=QueueRunbookActionResponse)
def execute_task_run_queue_operations_runbook_action(
    step_id: str,
    payload: QueueRunbookActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> QueueRunbookActionResponse:
    return execute_queue_runbook_action(
        step_id=step_id,
        actor=payload.actor or session.actor,
        reason=payload.reason,
        interval_seconds=payload.interval_seconds,
    )


@router.get("/queue/scheduler/status", response_model=WorkerSchedulerStatus)
def get_task_run_queue_scheduler_status(
    session: RuntimeSession = Depends(require_runtime_session),
) -> WorkerSchedulerStatus:
    return worker_scheduler_status()


@router.post("/queue/scheduler/start", response_model=WorkerSchedulerStatus)
def start_task_run_queue_scheduler(
    payload: WorkerSchedulerActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> WorkerSchedulerStatus:
    return start_worker_scheduler(
        actor=payload.actor or session.actor,
        interval_seconds=payload.interval_seconds,
        reason=payload.reason,
    )


@router.post("/queue/scheduler/stop", response_model=WorkerSchedulerStatus)
def stop_task_run_queue_scheduler(
    payload: WorkerSchedulerActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> WorkerSchedulerStatus:
    return stop_worker_scheduler(actor=payload.actor or session.actor, reason=payload.reason)


@router.post("/queue/scheduler/tick", response_model=WorkerSchedulerStatus)
def run_task_run_queue_scheduler_tick(
    payload: WorkerSchedulerActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> WorkerSchedulerStatus:
    run_scheduler_tick(actor=payload.actor or session.actor)
    return worker_scheduler_status()


@router.post("/queue/recover-stale", response_model=TaskRunQueueStatus)
def recover_stale_queued_task_runs(
    max_age_seconds: int = 60,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueStatus:
    return recover_stale_running_queue_items(max_age_seconds=max_age_seconds, actor=session.actor)


@router.get("/queue/dead-letters", response_model=DeadLetterQueueStatus)
def get_task_run_dead_letter_queue(
    session: RuntimeSession = Depends(require_runtime_session),
) -> DeadLetterQueueStatus:
    return dead_letter_queue_status()


@router.get("/queue/dead-letters/{dead_letter_id}", response_model=DeadLetterQueueRecord)
def get_task_run_dead_letter_item(
    dead_letter_id: str,
    session: RuntimeSession = Depends(require_runtime_session),
) -> DeadLetterQueueRecord:
    try:
        return get_dead_letter(dead_letter_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dead-letter item {dead_letter_id} not found.") from None


@router.post("/queue/dead-letters/{dead_letter_id}/acknowledge", response_model=DeadLetterQueueActionResponse)
def acknowledge_task_run_dead_letter_item(
    dead_letter_id: str,
    payload: DeadLetterQueueActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> DeadLetterQueueActionResponse:
    try:
        return acknowledge_dead_letter(dead_letter_id, actor=payload.actor or session.actor, reason=payload.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dead-letter item {dead_letter_id} not found.") from None


@router.post("/queue/dead-letters/{dead_letter_id}/resolve", response_model=DeadLetterQueueActionResponse)
def resolve_task_run_dead_letter_item(
    dead_letter_id: str,
    payload: DeadLetterQueueActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> DeadLetterQueueActionResponse:
    try:
        return resolve_dead_letter(dead_letter_id, actor=payload.actor or session.actor, reason=payload.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dead-letter item {dead_letter_id} not found.") from None


@router.post("/queue/{queue_id}/cancel", response_model=TaskRunQueueActionResponse)
def cancel_queued_task_run(
    queue_id: str,
    payload: TaskRunQueueActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueActionResponse:
    return cancel_queue_item(queue_id, actor=payload.actor or session.actor, reason=payload.reason)


@router.post("/queue/{queue_id}/retry", response_model=TaskRunQueueActionResponse)
def retry_queued_task_run(
    queue_id: str,
    payload: TaskRunQueueActionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueActionResponse:
    return retry_queue_item(
        queue_id,
        actor=payload.actor or session.actor,
        reason=payload.reason,
        auto_process=payload.auto_process,
    )


@router.get("/queue/{queue_id}", response_model=TaskRunQueueItem)
def get_queued_task_run_item(
    queue_id: str,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunQueueItem:
    try:
        return get_queue_item(queue_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Queue item {queue_id} not found.") from None


@router.get("/queue/{queue_id}/events", response_model=list[TaskRunQueueEvent])
def get_queued_task_run_item_events(
    queue_id: str,
    session: RuntimeSession = Depends(require_runtime_session),
) -> list[TaskRunQueueEvent]:
    return list_queue_item_events(queue_id)


@router.get("/{task_run_id}", response_model=TaskRun)
def get_task_run(task_run_id: str) -> TaskRun:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    return task_run


@router.get("/{task_run_id}/result-center", response_model=TaskRunResultCenter)
def get_task_run_result_center(
    task_run_id: str,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "view", session)
    return build_task_run_result_center(task_run_id)


@router.post("/{task_run_id}/acceptance-decision", response_model=TaskRunResultCenter)
def save_task_run_acceptance_decision(
    task_run_id: str,
    payload: AcceptanceDecisionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "execute", session)
    action_id = f"acceptance-decision-{payload.route}"
    try:
        record_result_action(task_run_id, action_id, session.actor, payload.comment)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.") from None
    return build_task_run_result_center(task_run_id)


@router.post("/{task_run_id}/workspace/artifact-draft", response_model=TaskRunResultCenter)
def save_task_run_workspace_artifact_draft(
    task_run_id: str,
    payload: ArtifactDraftPersistenceRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "execute", session)
    comment = json.dumps(payload.model_dump(), ensure_ascii=False)
    try:
        record_result_action(task_run_id, "workspace-artifact-draft-save", session.actor, comment)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.") from None
    return build_task_run_result_center(task_run_id)


@router.post("/{task_run_id}/workspace/artifact-draft/reset", response_model=TaskRunResultCenter)
def reset_task_run_workspace_artifact_draft(
    task_run_id: str,
    payload: ResultActionDecisionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "execute", session)
    try:
        record_result_action(task_run_id, "workspace-artifact-draft-reset", session.actor, payload.comment)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.") from None
    return build_task_run_result_center(task_run_id)


@router.post("/{task_run_id}/workspace/next-step-review", response_model=TaskRunResultCenter)
def confirm_task_run_workspace_next_step_review(
    task_run_id: str,
    payload: NextStepReviewPersistenceRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "execute", session)
    comment = json.dumps(payload.model_dump(), ensure_ascii=False)
    try:
        record_result_action(task_run_id, "workspace-next-step-review-confirm", session.actor, comment)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.") from None
    return build_task_run_result_center(task_run_id)


@router.post("/{task_run_id}/result-actions/{action_id}", response_model=TaskRunResultCenter)
def apply_task_run_result_action(
    task_run_id: str,
    action_id: str,
    payload: ResultActionDecisionRequest,
    session: RuntimeSession = Depends(require_runtime_session),
) -> TaskRunResultCenter:
    allowed_actions = {"accept-result", "return-to-revision", "create-next-task", "export-evidence"}
    if action_id not in allowed_actions:
        raise HTTPException(status_code=400, detail=f"Unsupported result action {action_id}.")
    task_run = get_persisted_task_run(task_run_id)
    if task_run is None:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.")
    require_process_access(task_run.process_id, "execute", session)
    related_task_run_id = None
    if action_id == "create-next-task":
        related_task_run_id = create_followup_task_run(task_run, session, payload).id
    try:
        record_result_action(task_run_id, action_id, session.actor, payload.comment, related_task_run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"TaskRun {task_run_id} not found.") from None
    return build_task_run_result_center(task_run_id)
