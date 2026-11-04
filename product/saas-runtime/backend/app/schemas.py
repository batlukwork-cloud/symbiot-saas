from typing import Any, Literal
from pydantic import BaseModel, Field


class ProcessCard(BaseModel):
    id: str
    version: str
    name: str
    category: str
    description: str
    expected_output: str
    required_inputs: list[str]


class TaskRunCreate(BaseModel):
    process_id: str
    profile_id: str = "working"
    form_data: dict[str, Any] = Field(default_factory=dict)
    document_ids: list[str] = Field(default_factory=list)


class TaskIntakePreviewRequest(BaseModel):
    process_id: str
    goal: str
    expected_artifact: str
    source_context: str
    urgency: str = "normal"
    document_ids: list[str] = Field(default_factory=list)
    selected_role_ids: list[str] = Field(default_factory=list)


class WorkgroupRolePreview(BaseModel):
    runtime_role: str
    display_name: str
    symbiot_role_ref: str
    department: str
    access_level: str
    permissions: list[str]
    responsibility: str
    selection_reason: str


class WorkgroupRequirementPreview(BaseModel):
    id: str
    title: str
    required: bool
    satisfied: bool
    matched_role_ids: list[str] = Field(default_factory=list)
    missing_reason: str | None = None


class TaskIntakePreviewResponse(BaseModel):
    process_id: str
    status: Literal["ready", "needs_input", "blocked"]
    readiness_score: int
    required_fields: list[str]
    missing_fields: list[str]
    recommended_profile_id: str
    recommended_role_ids: list[str] = Field(default_factory=list)
    selected_role_ids: list[str] = Field(default_factory=list)
    workgroup: list[WorkgroupRolePreview]
    requirements: list[WorkgroupRequirementPreview] = Field(default_factory=list)
    missing_required_capabilities: list[str] = Field(default_factory=list)
    redundant_role_ids: list[str] = Field(default_factory=list)
    override_active: bool = False
    workgroup_decision: str = ""
    selection_basis: list[str]
    gates: list["GateResult"]
    next_action: str


class StageStatus(BaseModel):
    id: str
    title: str
    status: Literal["waiting", "running", "completed", "failed", "needs_action"]


class GateResult(BaseModel):
    id: str
    title: str
    status: Literal["passed", "failed", "warning", "not_run"]
    reason: str
    action: str | None = None


class TaskRun(BaseModel):
    id: str
    process_id: str
    profile_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    stages: list[StageStatus]
    gates: list[GateResult]
    artifact_id: str | None = None
    form_data: dict[str, Any] = Field(default_factory=dict)


class TaskRunQueueRequest(TaskRunCreate):
    max_attempts: int = 2
    timeout_seconds: int = 30
    auto_process: bool = True


class TaskRunQueueItem(BaseModel):
    id: str
    task_run_id: str
    status: Literal["queued", "running", "completed", "failed", "retrying", "cancelled"]
    attempts: int
    max_attempts: int
    timeout_seconds: int
    error: str | None = None
    created_at: str
    updated_at: str
    next_run_at: str | None = None
    completed_at: str | None = None


class TaskRunQueueResponse(BaseModel):
    queue_item: TaskRunQueueItem
    task_run: TaskRun
    processed: bool
    gates: list[GateResult]


class TaskRunQueueEvent(BaseModel):
    id: str
    queue_id: str
    task_run_id: str
    event_type: Literal[
        "enqueued",
        "started",
        "completed",
        "failed",
        "retry_scheduled",
        "retry_policy_applied",
        "retry_exhausted",
        "dead_lettered",
        "dead_letter_acknowledged",
        "dead_letter_resolved",
        "manual_retry",
        "cancelled",
        "stale_recovered",
    ]
    actor: str
    status_before: str | None = None
    status_after: str
    message: str
    created_at: str


class TaskRunQueueActionRequest(BaseModel):
    actor: str = "demo-user"
    reason: str = ""
    auto_process: bool = True


class TaskRunQueueActionResponse(BaseModel):
    queue_item: TaskRunQueueItem
    task_run: TaskRun | None = None
    event: TaskRunQueueEvent
    gates: list[GateResult]


class TaskRunQueueStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue"]
    worker: str
    total: int
    queued: int
    running: int
    retrying: int
    completed: int
    failed: int
    cancelled: int
    items: list[TaskRunQueueItem]
    events: list[TaskRunQueueEvent] = Field(default_factory=list)
    gates: list[GateResult]


class QueueObservationProblem(BaseModel):
    queue_id: str
    task_run_id: str
    status: str
    severity: Literal["info", "warning", "critical"]
    age_seconds: int
    title: str
    recommendation: str


class WorkerObservabilityStatus(BaseModel):
    mode: Literal["sqlite_mvp_observability"]
    worker: str
    health: Literal["healthy", "degraded", "attention_required"]
    summary: str
    totals: dict[str, int]
    oldest_pending_age_seconds: int
    running_age_seconds_max: int
    recent_events_total: int
    recent_failures_total: int
    attention_items: list[QueueObservationProblem]
    recommendations: list[str]
    queue_status: TaskRunQueueStatus
    gates: list[GateResult]


class RetryPolicyStatus(BaseModel):
    mode: Literal["sqlite_mvp_retry_policy"]
    policy_version: str
    max_attempts: int
    base_delay_seconds: int
    max_delay_seconds: int
    backoff_multiplier: float
    retryable_errors: list[str]
    terminal_status: Literal["failed"]
    manual_override_allowed: bool
    next_action: str
    gates: list[GateResult]


class DeadLetterQueueRecord(BaseModel):
    id: str
    queue_id: str
    task_run_id: str
    status: Literal["open", "acknowledged", "resolved"]
    severity: Literal["warning", "critical"]
    reason: str
    error: str | None = None
    attempts: int
    max_attempts: int
    next_action: str
    created_at: str
    updated_at: str
    acknowledged_by: str | None = None
    acknowledged_at: str | None = None
    resolved_by: str | None = None
    resolved_at: str | None = None


class DeadLetterQueueStatus(BaseModel):
    mode: Literal["sqlite_mvp_dead_letter_queue"]
    total: int
    open: int
    acknowledged: int
    resolved: int
    items: list[DeadLetterQueueRecord]
    gates: list[GateResult]


class DeadLetterQueueActionRequest(BaseModel):
    actor: str = "demo-user"
    reason: str = ""


class DeadLetterQueueActionResponse(BaseModel):
    item: DeadLetterQueueRecord
    event: TaskRunQueueEvent
    gates: list[GateResult]


class WorkerSchedulerStatus(BaseModel):
    mode: Literal["sqlite_mvp_persistent_scheduler"]
    scheduler: str
    enabled: bool
    running: bool
    status: Literal["stopped", "running"]
    interval_seconds: float
    started_at: str | None = None
    stopped_at: str | None = None
    heartbeat_at: str | None = None
    last_tick_at: str | None = None
    processed_total: int
    error_total: int
    last_error: str | None = None
    queue_status: TaskRunQueueStatus
    gates: list[GateResult]


class WorkerSchedulerActionRequest(BaseModel):
    actor: str = "demo-user"
    interval_seconds: float = 1.0
    reason: str = ""


class QueueAdminAlert(BaseModel):
    id: str
    severity: Literal["info", "warning", "critical"]
    title: str
    message: str
    recommended_action: str
    source: Literal["queue", "worker", "scheduler", "dead_letter_queue", "retry_policy"]
    owner_role: str
    response_minutes: int | None = None
    response_due_at: str | None = None
    sla_status: Literal["not_applicable", "within_sla", "overdue"]
    escalation_target: str | None = None
    notification_draft: str | None = None
    related_queue_id: str | None = None
    related_task_run_id: str | None = None


class QueueAdminAction(BaseModel):
    id: str
    title: str
    description: str
    enabled: bool
    endpoint: str | None = None


class QueueAdminAlertCenterStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_admin_alert_center"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    open_alerts: int
    critical_alerts: int
    warning_alerts: int
    scheduler_status: WorkerSchedulerStatus
    observability: WorkerObservabilityStatus
    dead_letter_queue: DeadLetterQueueStatus
    alerts: list[QueueAdminAlert]
    actions: list[QueueAdminAction]
    gates: list[GateResult]


class QueueRecoveryStep(BaseModel):
    id: str
    priority: int
    title: str
    condition: str
    owner_role: str
    action_label: str
    action_endpoint: str | None = None
    action_kind: Literal["guided_action", "admin_action", "review_only", "monitor_only"]
    expected_result: str
    evidence_source: str
    related_alert_id: str | None = None
    related_runbook_step_id: str | None = None
    related_queue_id: str | None = None
    related_task_run_id: str | None = None
    status: Literal["ready", "needs_attention", "blocked", "completed"]


class QueueAdminRecoveryPlanStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_admin_recovery_plan"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    recommended_mode: Literal["monitor", "guided_recovery", "manual_triage", "emergency_stop"]
    primary_step_id: str | None = None
    steps_total: int
    steps_needing_attention: int
    blocked_steps: int
    plan: list[QueueRecoveryStep]
    gates: list[GateResult]


class QueueAdminCommandCenterSource(BaseModel):
    id: str
    title: str
    status: Literal["normal", "warning", "critical"]
    summary: str
    endpoint: str
    evidence_source: str


class QueueAdminCommandCenterAction(BaseModel):
    id: str
    label: str
    action_kind: Literal["guided_action", "admin_action", "review_only", "monitor_only"]
    enabled: bool
    endpoint: str | None = None
    owner_role: str
    reason: str
    evidence_source: str


class QueueAdminCommandCenterStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_admin_command_center"]
    status: Literal["normal", "warning", "critical"]
    operator_mode: Literal["monitor", "guided_recovery", "manual_triage", "emergency_stop"]
    headline: str
    summary: str
    primary_action_id: str | None = None
    actions_total: int
    blockers_total: int
    sources_total: int
    actions: list[QueueAdminCommandCenterAction]
    sources: list[QueueAdminCommandCenterSource]
    gates: list[GateResult]


class IncidentLifecycleItem(BaseModel):
    id: str
    source: Literal["alert", "dead_letter_queue", "queue", "scheduler", "worker"]
    severity: Literal["info", "warning", "critical"]
    status: Literal["open", "acknowledged", "resolved"]
    title: str
    owner_role: str
    response_due_at: str | None = None
    sla_status: Literal["not_applicable", "within_sla", "overdue"]
    age_seconds: int
    updated_at: str | None = None
    current_step: str
    next_action: str
    action_label: str
    action_endpoint: str | None = None
    escalation_target: str | None = None
    related_queue_id: str | None = None
    related_task_run_id: str | None = None
    evidence_ref: str | None = None


class IncidentLifecycleStatus(BaseModel):
    mode: Literal["sqlite_mvp_incident_lifecycle"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    total: int
    open: int
    acknowledged: int
    resolved: int
    overdue: int
    incidents: list[IncidentLifecycleItem]
    gates: list[GateResult]


class NotificationChannel(BaseModel):
    id: str
    name: str
    channel_type: Literal["local_log", "email", "telegram", "webhook"]
    enabled: bool
    delivery_mode: Literal["dry_run", "disabled", "external_not_configured"]
    target_ref: str
    safe_for_mvp: bool
    last_error: str | None = None


class NotificationDeliveryItem(BaseModel):
    id: str
    incident_id: str
    channel_id: str
    channel_type: Literal["local_log", "email", "telegram", "webhook"]
    status: Literal["queued", "delivered", "blocked", "failed"]
    severity: Literal["info", "warning", "critical"]
    title: str
    owner_role: str
    message: str
    dry_run: bool
    created_at: str
    updated_at: str
    delivered_at: str | None = None
    attempt_count: int
    error: str | None = None
    evidence_ref: str | None = None


class NotificationDeliveryStatus(BaseModel):
    mode: Literal["sqlite_mvp_notification_delivery"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    total: int
    queued: int
    delivered: int
    blocked: int
    failed: int
    active_incidents: int
    channels: list[NotificationChannel]
    items: list[NotificationDeliveryItem]
    gates: list[GateResult]


class NotificationDeliveryActionRequest(BaseModel):
    actor: str = "demo-user"
    reason: str = ""


class NotificationRoutePreference(BaseModel):
    id: str
    severity: Literal["info", "warning", "critical"]
    source: Literal["all", "alert", "dead_letter_queue", "queue", "scheduler", "worker"]
    owner_role: str
    channel_ids: list[str]
    response_minutes: int | None = None
    escalation_target: str | None = None
    enabled: bool
    delivery_mode: Literal["local_log_only", "external_blocked"]
    reason: str
    updated_at: str


class NotificationRoutingStatus(BaseModel):
    mode: Literal["sqlite_mvp_notification_routing"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    routes_total: int
    active_routes: int
    external_routes_blocked: int
    routes: list[NotificationRoutePreference]
    gates: list[GateResult]


class NotificationPolicyAuditItem(BaseModel):
    id: str
    title: str
    status: Literal["passed", "warning", "failed"]
    severity: Literal["info", "warning", "critical"]
    policy_area: Literal["channels", "routes", "sla", "delivery", "secrets", "evidence"]
    owner_role: str
    rule: str
    evidence_source: str
    remediation: str | None = None


class NotificationPolicyAuditStatus(BaseModel):
    mode: Literal["sqlite_mvp_notification_policy_audit"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    checks_total: int
    passed: int
    warnings: int
    failed: int
    external_delivery_allowed: bool
    production_gate_required: bool
    items: list[NotificationPolicyAuditItem]
    gates: list[GateResult]


class IncidentTimelineEvent(BaseModel):
    id: str
    timestamp: str
    event_type: Literal[
        "incident_open",
        "notification_delivered",
        "runbook_action",
        "dlq_acknowledged",
        "manual_retry",
        "incident_resolved",
        "audit_evidence",
    ]
    title: str
    actor: str
    status: Literal["info", "warning", "critical", "resolved"]
    source: str
    related_queue_id: str | None = None
    related_task_run_id: str | None = None
    evidence_ref: str | None = None


class AdminIncidentTimelineStatus(BaseModel):
    mode: Literal["sqlite_mvp_admin_incident_timeline"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    events_total: int
    unresolved_events: int
    timeline: list[IncidentTimelineEvent]
    gates: list[GateResult]


class QueueRunbookStep(BaseModel):
    id: str
    title: str
    trigger: str
    owner_role: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["ready", "needs_attention", "blocked"]
    action: str
    evidence_source: str
    endpoint: str | None = None
    action_label: str | None = None
    action_kind: Literal[
        "start_scheduler",
        "stop_scheduler",
        "scheduler_tick",
        "dispatch_notifications",
        "review_only",
        "verify_only",
    ] = "review_only"
    executable: bool = False


class QueueOperationsRunbookStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_operations_runbook"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    response_mode: Literal["monitor", "operator_action", "emergency_stop"]
    primary_action: str
    priority_step_ids: list[str]
    steps_total: int
    steps_ready: int
    steps_needing_attention: int
    emergency_stop_required: bool
    steps: list[QueueRunbookStep]
    gates: list[GateResult]


class QueueRunbookActionRequest(BaseModel):
    actor: str = "runtime-operator"
    reason: str = ""
    interval_seconds: float = 0.5


class QueueRunbookActionResponse(BaseModel):
    step_id: str
    action_kind: str
    executed: bool
    status: Literal["completed", "review_required", "blocked"]
    message: str
    runbook: QueueOperationsRunbookStatus
    gates: list[GateResult]


class QueueAdminActionAuditEvent(BaseModel):
    id: str
    action_id: str
    action_kind: str
    actor: str
    reason: str
    executed: bool
    status_before: str
    status_after: str
    message: str
    evidence_ref: str
    created_at: str
    previous_hash: str
    event_hash: str


class QueueAdminActionAuditStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_admin_action_audit"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    events_total: int
    chain_valid: bool
    head_hash: str
    latest_event_id: str | None = None
    events: list[QueueAdminActionAuditEvent]
    gates: list[GateResult]


class QueueManualTriageRequest(BaseModel):
    source_action_id: str
    title: str
    owner_role: str = "runtime-admin"
    severity: Literal["info", "warning", "critical"] = "warning"
    reason: str
    evidence_ref: str
    related_runbook_step_id: str | None = None
    related_queue_id: str | None = None
    related_task_run_id: str | None = None


class QueueManualTriageActionRequest(BaseModel):
    actor: str = "runtime-operator"
    reason: str = ""
    resolution: str = ""


class QueueManualTriageItem(BaseModel):
    id: str
    source_action_id: str
    title: str
    owner_role: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["open", "assigned", "resolved"]
    reason: str
    resolution: str | None = None
    evidence_ref: str
    related_runbook_step_id: str | None = None
    related_queue_id: str | None = None
    related_task_run_id: str | None = None
    created_at: str
    updated_at: str
    assigned_by: str | None = None
    assigned_at: str | None = None
    resolved_by: str | None = None
    resolved_at: str | None = None


class QueueManualTriageStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_manual_triage"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    total: int
    open: int
    assigned: int
    resolved: int
    items: list[QueueManualTriageItem]
    gates: list[GateResult]


class QueueEvidenceReviewRequest(BaseModel):
    source_ref: str
    title: str
    owner_role: str = "qa-evidence"
    severity: Literal["info", "warning", "critical"] = "warning"
    reason: str
    evidence_ref: str
    related_manual_triage_id: str | None = None
    related_action_id: str | None = None
    related_task_run_id: str | None = None


class QueueEvidenceReviewActionRequest(BaseModel):
    actor: str = "runtime-operator"
    reason: str = ""
    review_note: str = ""


class QueueEvidenceReviewItem(BaseModel):
    id: str
    source_ref: str
    title: str
    owner_role: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["pending", "approved", "rework"]
    reason: str
    review_note: str | None = None
    evidence_ref: str
    related_manual_triage_id: str | None = None
    related_action_id: str | None = None
    related_task_run_id: str | None = None
    created_at: str
    updated_at: str
    age_seconds: int = 0
    response_due_at: str | None = None
    sla_status: Literal["not_applicable", "within_sla", "overdue"] = "not_applicable"
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    decision_quality: Literal["needs_decision", "accepted", "needs_rework"] = "needs_decision"
    decision_summary: str = ""
    next_action: str = ""


class QueueEvidenceReviewStatus(BaseModel):
    mode: Literal["sqlite_mvp_queue_evidence_review"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    total: int
    pending: int
    approved: int
    rework: int
    overdue: int = 0
    oldest_open_age_seconds: int = 0
    next_due_at: str | None = None
    latest_review_id: str | None = None
    items: list[QueueEvidenceReviewItem]
    decision_events: list[QueueAdminActionAuditEvent] = []
    gates: list[GateResult]


class QueueEvidenceReviewPackage(BaseModel):
    id: str
    generated_at: str
    actor: str
    tenant_id: str
    export_scope: Literal["internal_evidence"]
    external_export_allowed: bool
    package_hash: str
    review_status: QueueEvidenceReviewStatus
    open_items: list[QueueEvidenceReviewItem]
    decision_events: list[QueueAdminActionAuditEvent]
    acceptance_summary: dict[str, Any]
    gates: list[GateResult]


class QueueEvidenceReviewPackageArchiveEntry(BaseModel):
    id: str
    package_id: str
    package_hash: str
    archived_at: str
    actor: str
    tenant_id: str
    status: Literal["ready", "blocked"]
    pending: int
    rework: int
    overdue: int
    decision_events_total: int
    open_items_total: int
    archive_path: str


class QueueEvidenceReviewPackageArchiveStatus(BaseModel):
    mode: Literal["local_jsonl_evidence_package_archive"]
    storage: str
    entries_total: int
    latest_entry_id: str | None = None
    latest_package_hash: str | None = None
    entries: list[QueueEvidenceReviewPackageArchiveEntry]
    gates: list[GateResult]


class QueueEvidenceAcceptanceChecklistItem(BaseModel):
    id: str
    title: str
    status: Literal["passed", "warning", "failed"]
    owner_role: str
    reason: str
    action: str
    action_label: str
    action_kind: Literal[
        "refresh_package",
        "save_archive",
        "filter_pending",
        "filter_rework",
        "filter_overdue",
        "review_decision_trail",
        "review_package_gates",
        "none",
    ]
    action_target: str | None = None
    evidence_ref: str | None = None


class QueueEvidenceAcceptanceChecklistStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_checklist"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    package_id: str
    package_hash: str
    archive_entries_total: int
    ready_for_internal_acceptance: bool
    items: list[QueueEvidenceAcceptanceChecklistItem]
    gates: list[GateResult]


class QueueEvidenceAcceptanceSummaryStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_summary"]
    status: Literal["normal", "warning", "critical"]
    ready_for_internal_acceptance: bool
    headline: str
    summary: str
    blockers_total: int
    warnings_total: int
    passed_total: int
    checklist_items_total: int
    package_id: str
    package_hash: str
    primary_blocker_id: str | None = None
    primary_blocker_title: str | None = None
    primary_blocker_status: Literal["passed", "warning", "failed"] | None = None
    primary_owner_role: str | None = None
    primary_reason: str | None = None
    primary_action_label: str | None = None
    primary_action_kind: str | None = None
    primary_action_target: str | None = None
    next_action: str
    gates: list[GateResult]


class QueueEvidenceAcceptanceBlockerWorklistStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_blocker_worklist"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    blockers_total: int
    warnings_total: int
    actionable_total: int
    package_id: str
    package_hash: str
    first_action_label: str | None = None
    first_action_kind: str | None = None
    items: list[QueueEvidenceAcceptanceChecklistItem]
    gates: list[GateResult]


class QueueEvidenceAcceptanceBatchGroup(BaseModel):
    id: str
    title: str
    action_kind: str
    action_label: str
    action_target: str | None = None
    status: Literal["warning", "critical"]
    items_total: int
    owner_roles: list[str]
    item_ids: list[str]
    reason: str
    next_action: str


class QueueEvidenceAcceptanceBatchPlanStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_batch_plan"]
    status: Literal["normal", "warning", "critical"]
    summary: str
    groups_total: int
    blockers_total: int
    warnings_total: int
    package_id: str
    package_hash: str
    first_group_id: str | None = None
    first_action_label: str | None = None
    first_action_kind: str | None = None
    first_action_target: str | None = None
    groups: list[QueueEvidenceAcceptanceBatchGroup]
    gates: list[GateResult]


class QueueEvidenceAcceptanceBatchActionRequest(BaseModel):
    group_id: str
    action_kind: str
    action_label: str
    action_target: str | None = None
    item_ids: list[str] = []
    owner_roles: list[str] = []
    reason: str = ""
    actor: str = ""


class QueueEvidenceAcceptanceBatchActionResponse(BaseModel):
    mode: Literal["queue_evidence_acceptance_batch_action_session"]
    status: Literal["completed", "review_required", "blocked"]
    batch_group_id: str
    action_kind: str
    action_label: str
    action_target: str | None = None
    items_total: int
    message: str
    review_status: QueueEvidenceReviewStatus
    audit_event: QueueAdminActionAuditEvent
    gates: list[GateResult]


class QueueEvidenceAcceptanceBatchItemDecisionRequest(BaseModel):
    batch_group_id: str
    review_id: str
    decision: Literal["approve", "rework"]
    actor: str = ""
    reason: str = ""
    review_note: str = ""


class QueueEvidenceAcceptanceBatchItemDecisionResponse(BaseModel):
    mode: Literal["queue_evidence_acceptance_batch_item_decision"]
    status: Literal["completed", "blocked"]
    batch_group_id: str
    review_id: str
    decision: Literal["approved", "rework"]
    message: str
    review_item: QueueEvidenceReviewItem | None = None
    review_status: QueueEvidenceReviewStatus
    audit_event: QueueAdminActionAuditEvent
    gates: list[GateResult]


class QueueEvidenceAcceptanceBatchGroupClosureStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_batch_group_closure"]
    status: Literal["open", "closed", "blocked"]
    batch_group_id: str
    action_kind: str
    action_label: str
    action_target: str | None = None
    total_items: int
    open_items: int
    closed_items: int
    pending_items: int
    rework_items: int
    approved_items: int
    next_review_id: str | None = None
    next_action_label: str | None = None
    summary: str
    review_status: QueueEvidenceReviewStatus
    gates: list[GateResult]


class QueueEvidenceAcceptanceCenterStatus(BaseModel):
    mode: Literal["queue_evidence_acceptance_center"]
    status: Literal["normal", "warning", "critical"]
    headline: str
    summary: str
    ready_for_internal_acceptance: bool
    blockers_total: int
    warnings_total: int
    worklist_actions_total: int
    batch_groups_total: int
    primary_action_label: str | None = None
    primary_action_kind: str | None = None
    first_group_id: str | None = None
    next_review_id: str | None = None
    sections_total: int
    technical_panels_replaced: int
    checklist: QueueEvidenceAcceptanceChecklistStatus
    acceptance_summary: QueueEvidenceAcceptanceSummaryStatus
    worklist: QueueEvidenceAcceptanceBlockerWorklistStatus
    batch_plan: QueueEvidenceAcceptanceBatchPlanStatus
    first_group_closure: QueueEvidenceAcceptanceBatchGroupClosureStatus | None = None
    gates: list[GateResult]


class DocumentRecord(BaseModel):
    id: str
    name: str
    type: str
    index_status: Literal["uploaded", "extracting", "indexed", "failed"]
    access_scope: str


class DocumentIngestRequest(BaseModel):
    name: str
    type: str = "txt"
    content: str
    access_scope: str = "tenant:demo"


class SourceIntakeLinkRequest(BaseModel):
    url: str
    title: str | None = None
    note: str | None = None
    access_scope: str = "tenant:demo"


class SourceIntakeItem(BaseModel):
    id: str
    kind: Literal["document", "upload", "link"]
    title: str
    status: Literal["indexed", "ready", "needs_ocr", "needs_approval", "registered", "blocked", "warning"]
    access_scope: str
    reference: str
    document_id: str | None = None
    upload_id: str | None = None
    url: str | None = None
    rag_status: str | None = None
    ocr_job_id: str | None = None
    checks: list[GateResult] = Field(default_factory=list)


class SourceIntakeSummary(BaseModel):
    active_source_ids: list[str]
    ready_document_ids: list[str]
    items: list[SourceIntakeItem]
    upload_runtime_ready: bool
    supported_inputs: list[str]
    next_action: str


class FilePolicyCheckRequest(BaseModel):
    name: str
    type: str
    size_bytes: int
    content_type: str = "application/octet-stream"
    access_scope: str = "tenant:demo"


class Artifact(BaseModel):
    id: str
    task_run_id: str
    version: str
    title: str
    content: str
    sources: list[str]
    checks: list[GateResult]


class ArtifactVersionRecord(BaseModel):
    id: str
    artifact_id: str
    task_run_id: str
    version: str
    title: str
    content_hash: str
    source: str
    created_at: str


class ArtifactRollbackRequest(BaseModel):
    actor: str = "demo-user"
    reason: str = "Rollback requested from Result Center."


class ArtifactVersionDiff(BaseModel):
    field: Literal["title", "content", "sources", "checks", "content_hash"]
    status: Literal["same", "changed"]
    before: str
    after: str
    summary: str


class ArtifactContentDiffLine(BaseModel):
    type: Literal["added", "removed", "unchanged"]
    text: str
    base_line: int | None = None
    target_line: int | None = None


class ArtifactVersionCompareResult(BaseModel):
    artifact_id: str
    base_version: ArtifactVersionRecord
    target_version: ArtifactVersionRecord
    semantic_change: bool
    content_delta_chars: int
    content_delta_words: int
    added_lines: int = 0
    removed_lines: int = 0
    unchanged_lines: int = 0
    content_diff_total: int = 0
    content_diff_offset: int = 0
    content_diff_limit: int = 120
    content_diff_truncated: bool = False
    content_diff_next_offset: int | None = None
    diffs: list[ArtifactVersionDiff]
    content_diff: list[ArtifactContentDiffLine] = Field(default_factory=list)
    summary: str
    gates: list[GateResult]


class ArtifactDiffJobCreateRequest(BaseModel):
    actor: str = "demo-user"
    max_diff_lines: int = 120
    diff_offset: int = 0


class ArtifactDiffJobRecord(BaseModel):
    id: str
    artifact_id: str
    version_id: str
    status: Literal["queued", "running", "completed", "failed"]
    requested_by: str
    max_diff_lines: int
    diff_offset: int = 0
    compare_result: ArtifactVersionCompareResult | None = None
    error: str | None = None
    created_at: str
    completed_at: str | None = None
    gates: list[GateResult]


class ArtifactCompareActionRequest(BaseModel):
    actor: str = "demo-user"
    comment: str = ""


class ArtifactCompareActionRecord(BaseModel):
    id: str
    job_id: str
    artifact_id: str
    version_id: str
    action_id: Literal["accept-comparison", "send-to-revision", "prepare-restore"]
    actor: str
    status: Literal["recorded"]
    comment: str
    created_at: str
    gates: list[GateResult]


class ArtifactExportDraft(BaseModel):
    artifact_id: str
    filename: str
    content_type: Literal["application/json"]
    content: dict[str, Any]
    content_hash: str
    gates: list[GateResult]


class AuditEvent(BaseModel):
    id: str
    actor: str
    action: str
    target: str
    redacted_payload: dict[str, Any]


class ArtifactEvidencePackage(BaseModel):
    artifact_id: str
    generated_at: str
    artifact: Artifact
    versions: list[ArtifactVersionRecord]
    diff_jobs: list[ArtifactDiffJobRecord]
    compare_actions: list[ArtifactCompareActionRecord]
    audit_events: list[AuditEvent]
    package_hash: str
    gates: list[GateResult]


class ArtifactRollbackResult(BaseModel):
    artifact: Artifact
    restored_from: ArtifactVersionRecord
    created_version: ArtifactVersionRecord
    audit_event: AuditEvent
    gates: list[GateResult]


class AuditEventHash(BaseModel):
    id: str
    previous_hash: str
    event_hash: str


class AuditRetentionStatus(BaseModel):
    mode: Literal["mvp_local_evidence", "production_policy_pending"]
    retention_policy: str
    storage: str
    events_total: int
    immutable_chain: bool
    chain_valid: bool
    head_hash: str
    export_allowed: bool
    external_export_allowed: bool
    stop_condition: str
    gates: list[GateResult]


class AuditPersistenceStatus(BaseModel):
    storage: str
    persistent: bool
    db_path: str
    events_total: int
    seed_source: str
    sync_mode: Literal["seeded_from_runtime", "live_persistent"]
    chain_valid: bool
    head_hash: str
    retention_schedule_status: Literal["pending_approval", "approved"]
    external_export_allowed: bool
    gates: list[GateResult]


class AuditExportPackage(BaseModel):
    id: str
    generated_at: str
    actor: str
    tenant_id: str
    export_scope: Literal["internal_evidence"]
    external_export_allowed: bool
    events_total: int
    event_hashes: list[AuditEventHash]
    package_hash: str
    redaction_policy: str
    gates: list[GateResult]


class EvidenceAccessDecision(BaseModel):
    id: str
    actor: str
    role: str
    tenant_id: str
    resource: Literal["audit_events", "audit_export_package", "release_evidence"]
    action: Literal["view_status", "view_events", "download_internal_package", "external_export"]
    allowed: bool
    status: Literal["allowed", "blocked"]
    reason: str
    role_directory_ref: dict[str, Any] | None
    retention_schedule_status: Literal["pending_approval", "approved"]
    external_export_allowed: bool
    package_access_allowed: bool
    checks: list[GateResult]


class EvidenceAccessModelStatus(BaseModel):
    mode: str
    policy_version: str
    storage: str
    view_roles: list[str]
    package_roles: list[str]
    external_export_allowed: bool
    retention_schedule_status: Literal["pending_approval", "approved"]
    audit_events_total: int
    audit_chain_valid: bool
    audit_head_hash: str
    gates: list[GateResult]


class EvidenceAccessAuditEvent(BaseModel):
    id: str
    actor: str
    role: str
    tenant_id: str
    resource: str
    action: str
    status: str
    reason: str
    created_at: str
    previous_hash: str | None = None
    event_hash: str | None = None


class EvidenceAccessAuditVerification(BaseModel):
    mode: str
    valid: bool
    events_total: int
    genesis_hash: str
    head_hash: str
    failed_event_id: str | None = None
    checked_at: str


class RagChunk(BaseModel):
    id: str
    document_id: str
    title: str
    text: str
    score: float
    access_scope: str


class RagSearchResponse(BaseModel):
    query: str
    chunks: list[RagChunk]
    min_score: float
    source_coverage: Literal["passed", "warning", "failed"]
    index_mode: Literal["keyword", "vector_mvp", "pgvector_ready", "pgvector_live", "pgvector_fallback"] = "keyword"


class VectorIndexStatus(BaseModel):
    mode: Literal["vector_mvp", "pgvector_ready", "pgvector_live", "pgvector_fallback"]
    model: str
    dimension: int
    chunks_total: int
    vectors_total: int
    ready: bool
    storage: str
    embedding_provider: str = "deterministic_local"
    pgvector_migration: str | None = None
    pgvector_ready: bool = False
    pgvector_connected: bool = False
    pgvector_tables_ready: bool = False
    pgvector_vectors_total: int = 0
    fallback_reason: str | None = None


class FilePolicyEvidence(BaseModel):
    status: Literal["passed", "failed", "warning"]
    allowed: bool
    ocr_required: bool
    scan_required: bool
    max_size_bytes: int
    checks: list[GateResult]
    asvs_controls: list[str]
    nist_controls: list[str]


class OcrJobRecord(BaseModel):
    id: str
    file_id: str
    status: Literal["queued", "not_required", "running", "completed", "failed"]
    engine: str
    dispatch_path: str
    command_hint: str
    created_at: str
    result_path: str | None = None
    document_id: str | None = None
    text_chars: int = 0
    completed_at: str | None = None
    error: str | None = None
    classification_id: str | None = None
    approval_id: str | None = None
    rag_status: Literal["not_checked", "clean_allowed", "needs_approval", "approved_indexed", "blocked", "failed"] = "not_checked"


class OcrExecutionEvidence(BaseModel):
    job: OcrJobRecord
    indexed_document: DocumentRecord | None = None
    manifest_path: str | None = None
    output_text_files: list[str] = Field(default_factory=list)
    accepted_for_rag: bool
    pii_classification: "PiiClassificationEvidence | None" = None
    human_approval: "HumanApprovalRecord | None" = None


class OcrWorkerStatus(BaseModel):
    worker: str
    pipeline_path: str
    python_command: str
    queued_jobs: int
    completed_jobs: int
    failed_jobs: int
    ready: bool


class EmbeddingProviderStatus(BaseModel):
    provider: str
    model: str
    dimension: int
    configured: bool
    fallback_used: bool
    pgvector_target: bool
    pgvector_migration_path: str
    notes: list[str]


class FileUploadRecord(BaseModel):
    id: str
    name: str
    type: str
    size_bytes: int
    sha256: str
    access_scope: str
    storage_key: str
    policy_status: Literal["passed", "failed", "warning"]
    scan_status: Literal["passed", "failed", "warning"]
    ocr_job_id: str | None = None
    classification_id: str | None = None
    approval_id: str | None = None
    rag_status: Literal["not_checked", "clean_allowed", "needs_approval", "approved_indexed", "blocked", "failed"] = "not_checked"
    document_id: str | None = None
    created_at: str


class FileUploadEvidence(BaseModel):
    upload: FileUploadRecord
    policy: FilePolicyEvidence
    scan: GateResult
    ocr_job: OcrJobRecord | None = None
    accepted_for_runtime: bool
    pii_classification: "PiiClassificationEvidence | None" = None
    human_approval: "HumanApprovalRecord | None" = None
    rag_status: Literal["not_checked", "clean_allowed", "needs_approval", "blocked"] = "not_checked"


class UploadRuntimeStatus(BaseModel):
    storage_path: str
    uploads_total: int
    ocr_jobs_total: int
    scanner_adapter: str
    ocr_dispatcher: str
    ocr_pipeline_path: str
    ready: bool


class LlmGatewayEvidence(BaseModel):
    task_run_id: str
    provider_id: str
    provider_type: Literal["mock", "openai_compatible", "local", "disabled"]
    model: str
    prompt_template_version: str
    input_tokens_estimate: int
    output_tokens_estimate: int
    fallback_used: bool
    secrets_redacted: bool
    response_status: Literal["completed", "failed", "fallback"]


class LlmProviderConfig(BaseModel):
    id: str
    provider_type: Literal["mock", "openai_compatible", "local", "disabled"]
    status: Literal["enabled", "disabled", "not_configured"]
    model: str
    base_url_configured: bool
    api_key_configured: bool
    secrets_redacted: bool
    fallback_priority: int
    asvs_controls: list[str]
    nist_controls: list[str]


class QualityGateDefinition(BaseModel):
    id: str
    title: str
    category: str
    standard_map: list[str]
    owner_role: str
    severity: Literal["low", "medium", "high", "critical"]
    evidence_required: str
    fail_action: str


class QualityEvidence(BaseModel):
    task_run_id: str
    gates: list[GateResult]
    overall_status: Literal["passed", "failed", "warning"]
    evidence_summary: str


class RuntimeEvidence(BaseModel):
    task_run_id: str
    rag: RagSearchResponse
    llm: LlmGatewayEvidence
    quality: QualityEvidence
    audit_event_ids: list[str]


class ResultAction(BaseModel):
    id: str
    title: str
    status: Literal["available", "blocked", "completed"]
    description: str
    next_status: str | None = None


class ResultActionDecisionRequest(BaseModel):
    comment: str | None = None
    followup_goal: str | None = None
    followup_expected_artifact: str | None = None
    followup_source_context: str | None = None
    followup_urgency: str | None = None


class AcceptanceDecisionRequest(BaseModel):
    route: Literal["accept", "revise", "continue"]
    comment: str | None = None


class ArtifactDraftPersistenceRequest(BaseModel):
    title: str
    body: str
    next: str


class NextStepReviewPersistenceRequest(BaseModel):
    goal: str
    expected_artifact: str
    source_context: str
    urgency: str
    source_label: str
    confirmed_at_label: str


class ResultActionRecord(BaseModel):
    id: str
    task_run_id: str
    action_id: str
    actor: str
    status: Literal["completed"]
    comment: str | None = None
    related_task_run_id: str | None = None
    created_at: str


class AcceptanceDecisionRouteOption(BaseModel):
    id: Literal["accept", "revise", "continue"]
    title: str
    primary: str
    detail: str
    status: Literal["accept", "revise", "continue"]
    availability: Literal["available", "blocked", "selected"]


class AcceptanceDecisionImpactItem(BaseModel):
    title: str
    value: str
    detail: str
    status: Literal["accept", "revise", "continue", "asset", "instruction", "cycle", "review", "stop", "ready"]


class AcceptanceDecisionState(BaseModel):
    selected_route: Literal["accept", "revise", "continue"] | None = None
    selected_action_id: str | None = None
    selected_at: str | None = None
    selected_by: str | None = None
    summary: str
    routes: list[AcceptanceDecisionRouteOption]
    impacts: list[AcceptanceDecisionImpactItem]
    checklist: list[AcceptanceDecisionImpactItem]
    gates: list[GateResult]


class PersistedArtifactDraftState(BaseModel):
    status: Literal["empty", "saved", "reset"]
    title: str | None = None
    body: str | None = None
    next: str | None = None
    saved_at: str | None = None
    saved_by: str | None = None
    summary: str


class PersistedNextStepReviewState(BaseModel):
    confirmed: bool
    goal: str | None = None
    expected_artifact: str | None = None
    source_context: str | None = None
    urgency: str | None = None
    source_label: str | None = None
    confirmed_at_label: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    summary: str


class UserWorkspacePersistenceState(BaseModel):
    artifact_draft: PersistedArtifactDraftState
    next_step_review: PersistedNextStepReviewState
    gates: list[GateResult]
    summary: str


class FollowupLineageItem(BaseModel):
    task_run_id: str
    artifact_title: str | None = None
    action_id: str
    goal: str | None = None
    expected_artifact: str | None = None
    source_label: str | None = None
    created_at: str


class FollowupContinuityState(BaseModel):
    is_followup: bool
    cycle_number: int = 1
    source_task_run_id: str | None = None
    source_artifact_title: str | None = None
    source_action_id: str | None = None
    goal: str | None = None
    expected_artifact: str | None = None
    source_context: str | None = None
    urgency: str | None = None
    source_label: str | None = None
    confirmed_at: str | None = None
    lineage: list[FollowupLineageItem] = Field(default_factory=list)
    summary: str
    gates: list[GateResult]


class ScenarioResumeStep(BaseModel):
    id: str
    title: str
    status: Literal["done", "active", "waiting"]
    detail: str
    action_id: str | None = None
    target_task_run_id: str | None = None


class ScenarioResumeState(BaseModel):
    is_resumable: bool
    scenario_label: str
    primary_action: Literal["review-result", "continue-edit", "confirm-next-step", "create-next-task", "open-followup"]
    primary_action_label: str
    primary_action_target_task_run_id: str | None = None
    summary: str
    steps: list[ScenarioResumeStep]
    gates: list[GateResult]


class FollowupExecutionWorkspaceItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "active", "waiting", "blocked"]


class FollowupExecutionWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    source_task_run_id: str | None = None
    current_task_run_id: str
    title: str
    summary: str
    primary_action: Literal["review-current-result", "accept-current-result", "continue-from-source", "create-next-cycle"]
    primary_action_label: str
    inherited_workgroup: list[str] = Field(default_factory=list)
    items: list[FollowupExecutionWorkspaceItem]
    gates: list[GateResult]


class CurrentCycleOutcomeItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "active", "waiting", "blocked", "accept", "revise", "continue"]


class CurrentCycleOutcomeWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    artifact_title: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    primary_action: Literal["choose-route", "accept-current-result", "revise-current-result", "continue-next-cycle"]
    primary_action_label: str
    summary: str
    items: list[CurrentCycleOutcomeItem]
    route_items: list[CurrentCycleOutcomeItem]
    gates: list[GateResult]


class OutcomeNextCycleLaunchPayload(BaseModel):
    goal: str
    expected_artifact: str
    source_context: str
    urgency: str
    source_label: str
    confirmed_at_label: str


class OutcomeNextCycleLaunchItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "active", "waiting", "blocked", "continue", "review", "cycle"]


class OutcomeNextCycleLauncherState(BaseModel):
    is_active: bool
    cycle_number: int
    target_cycle_number: int
    selected_route: Literal["accept", "revise", "continue"] | None = None
    review_confirmed: bool
    linked_task_run_id: str | None = None
    primary_action: Literal[
        "choose-route",
        "accept-current-result",
        "revise-current-result",
        "confirm-next-cycle",
        "create-next-cycle",
        "open-next-cycle",
    ]
    primary_action_label: str
    summary: str
    launch_payload: OutcomeNextCycleLaunchPayload
    items: list[OutcomeNextCycleLaunchItem]
    gates: list[GateResult]


class CycleExecutionBriefItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "active", "waiting", "blocked", "inherited", "check", "stop"]


class CycleExecutionBriefState(BaseModel):
    is_active: bool
    cycle_number: int
    source_task_run_id: str | None = None
    current_task_run_id: str
    inherited_outcome: str
    primary_action: Literal["review-inherited-outcome", "execute-cycle", "accept-cycle-result"]
    primary_action_label: str
    summary: str
    items: list[CycleExecutionBriefItem]
    gates: list[GateResult]


class CycleAcceptanceWorkspaceItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["criteria", "signal", "decision", "asset", "next", "stop", "risk", "ready", "blocked"]


class CycleAcceptanceWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    result_title: str
    selected_route: Literal["accept", "revise", "continue"] | None = None
    primary_action: Literal[
        "wait-cycle-result",
        "choose-cycle-route",
        "accept-cycle-result",
        "revise-cycle-result",
        "continue-next-cycle",
        "open-next-cycle",
    ]
    primary_action_label: str
    summary: str
    acceptance_items: list[CycleAcceptanceWorkspaceItem]
    decision_items: list[CycleAcceptanceWorkspaceItem]
    gates: list[GateResult]


class CycleContinuityWorkspaceItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["basis", "active", "ready", "acceptance", "next", "stop", "waiting"]


class CycleContinuityWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    title: str
    summary: str
    primary_action: Literal["review-cycle-basis", "execute-cycle", "accept-cycle-result", "continue-chain"]
    primary_action_label: str
    items: list[CycleContinuityWorkspaceItem]
    gates: list[GateResult]


class AccumulatedBusinessAssetItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["basis", "chain", "value", "reusable", "next", "limit", "waiting"]


class AccumulatedBusinessAssetWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    title: str
    summary: str
    primary_action: Literal["review-asset", "accept-current-asset", "continue-asset-chain"]
    primary_action_label: str
    items: list[AccumulatedBusinessAssetItem]
    gates: list[GateResult]


class BusinessAssetDecisionItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["accept", "revise", "continue", "effect", "guard", "proof", "waiting"]


class BusinessAssetDecisionWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["choose-asset-route", "accept-asset", "revise-asset", "continue-asset", "open-next-cycle"]
    primary_action_label: str
    items: list[BusinessAssetDecisionItem]
    gates: list[GateResult]


class BusinessAssetRouteOutcomeItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["selected", "outcome", "next", "handoff", "proof", "guard", "waiting"]


class BusinessAssetRouteOutcomeWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-route-outcome", "confirm-accepted-asset", "revise-asset", "open-next-cycle"]
    primary_action_label: str
    items: list[BusinessAssetRouteOutcomeItem]
    gates: list[GateResult]


class BusinessAssetManualReviewItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["scenario", "clarity", "business", "next", "proof", "guard", "manual", "waiting"]


class BusinessAssetManualReviewWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-manual-check", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetManualReviewItem]
    gates: list[GateResult]


class BusinessAssetGAcceptancePackageItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["scope", "route", "proof", "condition", "risk", "decision", "guard", "waiting"]


class BusinessAssetGAcceptancePackageWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-g-package", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetGAcceptancePackageItem]
    gates: list[GateResult]


class BusinessAssetGReviewExecutionItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "check", "proof", "condition", "decision", "guard", "waiting"]


class BusinessAssetGReviewExecutionWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["execute-g-review", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetGReviewExecutionItem]
    gates: list[GateResult]


class BusinessAssetGCheckHandoffItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["target", "criteria", "evidence", "stop", "next", "owner", "guard", "waiting"]


class BusinessAssetGCheckHandoffWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-handoff", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetGCheckHandoffItem]
    gates: list[GateResult]


class BusinessAssetGDecisionDraftOption(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["accept", "revise", "continue", "guard", "waiting"]


class BusinessAssetGDecisionDraftWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-decision-draft", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    options: list[BusinessAssetGDecisionDraftOption]
    gates: list[GateResult]


class BusinessAssetGDecisionImpactItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["selected", "effect", "next", "manual", "guard", "waiting"]


class BusinessAssetGDecisionImpactWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-impact", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetGDecisionImpactItem]
    gates: list[GateResult]


class BusinessAssetGDecisionReadinessItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["ready", "evidence", "blocker", "manual", "guard", "waiting"]


class BusinessAssetGDecisionReadinessWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-readiness", "open-next-cycle", "return-to-decision"]
    primary_action_label: str
    items: list[BusinessAssetGDecisionReadinessItem]
    gates: list[GateResult]


class BusinessAssetGDecisionChecklistItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["check", "focus", "blocker", "manual", "guard", "waiting"]


class BusinessAssetGDecisionChecklistWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-checklist", "open-next-cycle", "return-to-readiness"]
    primary_action_label: str
    checklist: list[BusinessAssetGDecisionChecklistItem]
    gates: list[GateResult]


class BusinessAssetGDecisionReviewSummaryItem(BaseModel):
    id: str
    title: str
    value: str
    detail: str
    status: Literal["summary", "check", "blocker", "manual", "guard", "waiting"]


class BusinessAssetGDecisionReviewSummaryWorkspaceState(BaseModel):
    is_active: bool
    cycle_number: int
    accumulated_cycles: int
    current_task_run_id: str
    source_task_run_id: str | None = None
    selected_route: Literal["accept", "revise", "continue"] | None = None
    title: str
    summary: str
    primary_action: Literal["review-summary", "open-next-cycle", "return-to-checklist"]
    primary_action_label: str
    review_items: list[BusinessAssetGDecisionReviewSummaryItem]
    gates: list[GateResult]


class TaskRunResultCenter(BaseModel):
    task_run_id: str
    product_status: Literal["waiting", "running", "ready_for_acceptance", "needs_revision", "accepted"]
    artifact: Artifact | None
    evidence: RuntimeEvidence
    timeline: list[StageStatus]
    gates: list[GateResult]
    actions: list[ResultAction]
    action_history: list[ResultActionRecord] = Field(default_factory=list)
    acceptance_checklist: list[GateResult]
    acceptance_decision: AcceptanceDecisionState
    user_workspace_state: UserWorkspacePersistenceState
    followup_continuity: FollowupContinuityState
    scenario_resume: ScenarioResumeState
    followup_execution_workspace: FollowupExecutionWorkspaceState
    current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState
    outcome_next_cycle_launcher: OutcomeNextCycleLauncherState
    cycle_execution_brief: CycleExecutionBriefState
    cycle_acceptance_workspace: CycleAcceptanceWorkspaceState
    cycle_continuity_workspace: CycleContinuityWorkspaceState
    accumulated_business_asset_workspace: AccumulatedBusinessAssetWorkspaceState
    business_asset_decision_workspace: BusinessAssetDecisionWorkspaceState
    business_asset_route_outcome_workspace: BusinessAssetRouteOutcomeWorkspaceState
    business_asset_manual_review_workspace: BusinessAssetManualReviewWorkspaceState
    business_asset_g_acceptance_package_workspace: BusinessAssetGAcceptancePackageWorkspaceState
    business_asset_g_review_execution_workspace: BusinessAssetGReviewExecutionWorkspaceState
    business_asset_g_check_handoff_workspace: BusinessAssetGCheckHandoffWorkspaceState
    business_asset_g_decision_draft_workspace: BusinessAssetGDecisionDraftWorkspaceState
    business_asset_g_decision_impact_workspace: BusinessAssetGDecisionImpactWorkspaceState
    business_asset_g_decision_readiness_workspace: BusinessAssetGDecisionReadinessWorkspaceState
    business_asset_g_decision_checklist_workspace: BusinessAssetGDecisionChecklistWorkspaceState
    business_asset_g_decision_review_summary_workspace: BusinessAssetGDecisionReviewSummaryWorkspaceState
    next_step: str


class PiiFinding(BaseModel):
    id: str
    pii_type: str
    label: str
    severity: Literal["low", "medium", "high", "critical"]
    evidence_preview: str
    start: int
    end: int
    confidence: float


class PiiClassificationRequest(BaseModel):
    text: str
    artifact_id: str | None = None
    access_scope: str = "tenant:demo"
    purpose: str = "runtime_export"


class PiiClassificationEvidence(BaseModel):
    id: str
    artifact_id: str | None
    access_scope: str
    purpose: str
    pii_detected: bool
    risk_level: Literal["none", "low", "medium", "high", "critical"]
    findings: list[PiiFinding]
    redacted_text: str
    asvs_controls: list[str]
    nist_controls: list[str]
    gates: list[GateResult]


class ApprovalCreateRequest(BaseModel):
    artifact_id: str
    classification_id: str
    requester: str = "demo-user"
    reviewer: str = "Dmitry"
    purpose: str = "external_export"


class HumanApprovalRecord(BaseModel):
    id: str
    artifact_id: str
    classification_id: str
    requester: str
    reviewer: str
    purpose: str
    status: Literal["pending", "approved", "rejected"]
    created_at: str
    decided_at: str | None = None
    decision_comment: str | None = None


class HumanApprovalDecisionRequest(BaseModel):
    reviewer: str = "Dmitry"
    decision_comment: str = "Approved for controlled MVP evidence."


class RagApprovalReleaseEvidence(BaseModel):
    job: OcrJobRecord
    approval: HumanApprovalRecord
    indexed_document: DocumentRecord | None
    accepted_for_rag: bool
    gates: list[GateResult]


class UploadApprovalReleaseEvidence(BaseModel):
    upload: FileUploadRecord
    approval: HumanApprovalRecord
    indexed_document: DocumentRecord | None
    accepted_for_rag: bool
    gates: list[GateResult]


class ExportRequest(BaseModel):
    artifact_id: str
    classification_id: str
    approval_id: str | None = None
    channel: Literal["download", "email", "api", "external_share"] = "download"
    requester: str = "demo-user"


class ExportDecision(BaseModel):
    id: str
    artifact_id: str
    channel: str
    status: Literal["allowed", "blocked"]
    reason: str
    classification_id: str
    approval_id: str | None
    redacted_content: str | None = None
    gates: list[GateResult]


class DataProtectionStatus(BaseModel):
    classifier: str
    approvals_total: int
    pending_approvals: int
    exports_total: int
    blocked_exports: int
    rag_releases_total: int = 0
    client_data_ready: bool
    client_data_condition: str
    gates: list[GateResult]
