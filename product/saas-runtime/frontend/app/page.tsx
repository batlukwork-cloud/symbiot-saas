"use client";

import { useEffect, useMemo, useState } from "react";

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const BEARER_TOKEN = process.env.NEXT_PUBLIC_SYMBIOT_BEARER_TOKEN ?? "";
const AUTH_HEADERS: Record<string, string> = BEARER_TOKEN
  ? { Authorization: `Bearer ${BEARER_TOKEN}` }
  : {
      "x-symbiot-session": process.env.NEXT_PUBLIC_SYMBIOT_SESSION ?? "symbiot-demo-session-token",
      "x-tenant-id": process.env.NEXT_PUBLIC_TENANT_ID ?? "tenant:demo",
      "x-actor": "demo-user",
      "x-role": process.env.NEXT_PUBLIC_SYMBIOT_ROLE ?? "runtime-operator",
      "x-department": process.env.NEXT_PUBLIC_SYMBIOT_DEPARTMENT ?? "sales",
      "x-access-level": process.env.NEXT_PUBLIC_SYMBIOT_ACCESS_LEVEL ?? "standard"
    };
const ADMIN_HEADERS: Record<string, string> = BEARER_TOKEN
  ? AUTH_HEADERS
  : {
      ...AUTH_HEADERS,
      "x-actor": "role-admin-ui",
      "x-role": "admin",
      "x-department": "management",
      "x-access-level": "admin"
    };
const ACCESS_LEVEL_OPTIONS = ["read", "standard", "manager", "admin"];
const ROLE_STATUS_OPTIONS = ["active", "disabled"];

type ProcessCard = {
  id: string;
  version: string;
  name: string;
  category: string;
  description: string;
  expected_output: string;
  required_inputs: string[];
};

type StageStatus = {
  id: string;
  title: string;
  status: "waiting" | "running" | "completed" | "failed" | "needs_action";
};

type GateResult = {
  id: string;
  title: string;
  status: "passed" | "failed" | "warning" | "not_run";
  reason: string;
  action?: string | null;
};

type TaskRun = {
  id: string;
  process_id: string;
  profile_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stages: StageStatus[];
  gates: GateResult[];
  artifact_id: string | null;
  form_data: Record<string, unknown>;
};

type TaskRunQueueItem = {
  id: string;
  task_run_id: string;
  status: "queued" | "running" | "completed" | "failed" | "retrying" | "cancelled";
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
  next_run_at?: string | null;
  completed_at?: string | null;
};

type TaskRunQueueEvent = {
  id: string;
  queue_id: string;
  task_run_id: string;
  event_type:
    | "enqueued"
    | "started"
    | "completed"
    | "failed"
    | "retry_scheduled"
    | "retry_policy_applied"
    | "retry_exhausted"
    | "dead_lettered"
    | "dead_letter_acknowledged"
    | "dead_letter_resolved"
    | "manual_retry"
    | "cancelled"
    | "stale_recovered";
  actor: string;
  status_before?: string | null;
  status_after: string;
  message: string;
  created_at: string;
};

type TaskRunQueueStatus = {
  mode: "sqlite_mvp_queue";
  worker: string;
  total: number;
  queued: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  cancelled: number;
  items: TaskRunQueueItem[];
  events: TaskRunQueueEvent[];
  gates: GateResult[];
};

type QueueObservationProblem = {
  queue_id: string;
  task_run_id: string;
  status: string;
  severity: "info" | "warning" | "critical";
  age_seconds: number;
  title: string;
  recommendation: string;
};

type WorkerObservabilityStatus = {
  mode: "sqlite_mvp_observability";
  worker: string;
  health: "healthy" | "degraded" | "attention_required";
  summary: string;
  totals: Record<string, number>;
  oldest_pending_age_seconds: number;
  running_age_seconds_max: number;
  recent_events_total: number;
  recent_failures_total: number;
  attention_items: QueueObservationProblem[];
  recommendations: string[];
  queue_status: TaskRunQueueStatus;
  gates: GateResult[];
};

type RetryPolicyStatus = {
  mode: "sqlite_mvp_retry_policy";
  policy_version: string;
  max_attempts: number;
  base_delay_seconds: number;
  max_delay_seconds: number;
  backoff_multiplier: number;
  retryable_errors: string[];
  terminal_status: "failed";
  manual_override_allowed: boolean;
  next_action: string;
  gates: GateResult[];
};

type WorkerSchedulerStatus = {
  mode: "sqlite_mvp_persistent_scheduler";
  scheduler: string;
  enabled: boolean;
  running: boolean;
  status: "stopped" | "running";
  interval_seconds: number;
  started_at?: string | null;
  stopped_at?: string | null;
  heartbeat_at?: string | null;
  last_tick_at?: string | null;
  processed_total: number;
  error_total: number;
  last_error?: string | null;
  queue_status: TaskRunQueueStatus;
  gates: GateResult[];
};

type QueueAdminAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  recommended_action: string;
  source: "queue" | "worker" | "scheduler" | "dead_letter_queue" | "retry_policy";
  owner_role: string;
  response_minutes?: number | null;
  response_due_at?: string | null;
  sla_status: "not_applicable" | "within_sla" | "overdue";
  escalation_target?: string | null;
  notification_draft?: string | null;
  related_queue_id?: string | null;
  related_task_run_id?: string | null;
};

type QueueAdminAction = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  endpoint?: string | null;
};

type QueueAdminAlertCenterStatus = {
  mode: "sqlite_mvp_queue_admin_alert_center";
  status: "normal" | "warning" | "critical";
  summary: string;
  open_alerts: number;
  critical_alerts: number;
  warning_alerts: number;
  scheduler_status: WorkerSchedulerStatus;
  observability: WorkerObservabilityStatus;
  dead_letter_queue: DeadLetterQueueStatus;
  alerts: QueueAdminAlert[];
  actions: QueueAdminAction[];
  gates: GateResult[];
};

type QueueRecoveryStep = {
  id: string;
  priority: number;
  title: string;
  condition: string;
  owner_role: string;
  action_label: string;
  action_endpoint?: string | null;
  action_kind: "guided_action" | "admin_action" | "review_only" | "monitor_only";
  expected_result: string;
  evidence_source: string;
  related_alert_id?: string | null;
  related_runbook_step_id?: string | null;
  related_queue_id?: string | null;
  related_task_run_id?: string | null;
  status: "ready" | "needs_attention" | "blocked" | "completed";
};

type QueueAdminRecoveryPlanStatus = {
  mode: "sqlite_mvp_queue_admin_recovery_plan";
  status: "normal" | "warning" | "critical";
  summary: string;
  recommended_mode: "monitor" | "guided_recovery" | "manual_triage" | "emergency_stop";
  primary_step_id?: string | null;
  steps_total: number;
  steps_needing_attention: number;
  blocked_steps: number;
  plan: QueueRecoveryStep[];
  gates: GateResult[];
};

type QueueAdminCommandCenterSource = {
  id: string;
  title: string;
  status: "normal" | "warning" | "critical";
  summary: string;
  endpoint: string;
  evidence_source: string;
};

type QueueAdminCommandCenterAction = {
  id: string;
  label: string;
  action_kind: "guided_action" | "admin_action" | "review_only" | "monitor_only";
  enabled: boolean;
  endpoint?: string | null;
  owner_role: string;
  reason: string;
  evidence_source: string;
};

type QueueAdminCommandCenterStatus = {
  mode: "sqlite_mvp_queue_admin_command_center";
  status: "normal" | "warning" | "critical";
  operator_mode: "monitor" | "guided_recovery" | "manual_triage" | "emergency_stop";
  headline: string;
  summary: string;
  primary_action_id?: string | null;
  actions_total: number;
  blockers_total: number;
  sources_total: number;
  actions: QueueAdminCommandCenterAction[];
  sources: QueueAdminCommandCenterSource[];
  gates: GateResult[];
};

type QueueAdminActionAuditEvent = {
  id: string;
  action_id: string;
  action_kind: string;
  actor: string;
  reason: string;
  executed: boolean;
  status_before: string;
  status_after: string;
  message: string;
  evidence_ref: string;
  created_at: string;
  previous_hash: string;
  event_hash: string;
};

type QueueAdminActionAuditStatus = {
  mode: "sqlite_mvp_queue_admin_action_audit";
  status: "normal" | "warning" | "critical";
  summary: string;
  events_total: number;
  chain_valid: boolean;
  head_hash: string;
  latest_event_id?: string | null;
  events: QueueAdminActionAuditEvent[];
  gates: GateResult[];
};

type QueueManualTriageItem = {
  id: string;
  source_action_id: string;
  title: string;
  owner_role: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "assigned" | "resolved";
  reason: string;
  resolution?: string | null;
  evidence_ref: string;
  related_runbook_step_id?: string | null;
  related_queue_id?: string | null;
  related_task_run_id?: string | null;
  created_at: string;
  updated_at: string;
  assigned_by?: string | null;
  assigned_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
};

type QueueManualTriageStatus = {
  mode: "sqlite_mvp_queue_manual_triage";
  status: "normal" | "warning" | "critical";
  summary: string;
  total: number;
  open: number;
  assigned: number;
  resolved: number;
  items: QueueManualTriageItem[];
  gates: GateResult[];
};

type QueueEvidenceReviewItem = {
  id: string;
  source_ref: string;
  title: string;
  owner_role: string;
  severity: "info" | "warning" | "critical";
  status: "pending" | "approved" | "rework";
  reason: string;
  review_note?: string | null;
  evidence_ref: string;
  related_manual_triage_id?: string | null;
  related_action_id?: string | null;
  related_task_run_id?: string | null;
  created_at: string;
  updated_at: string;
  age_seconds: number;
  response_due_at?: string | null;
  sla_status: "not_applicable" | "within_sla" | "overdue";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  decision_quality: "needs_decision" | "accepted" | "needs_rework";
  decision_summary: string;
  next_action: string;
};

type EvidenceReviewFilterValue = "all" | "pending" | "approved" | "rework";
type EvidenceReviewSlaFilterValue = "all" | "not_applicable" | "within_sla" | "overdue";
type EvidenceReviewSeverityFilterValue = "all" | "info" | "warning" | "critical";

type QueueEvidenceReviewStatus = {
  mode: "sqlite_mvp_queue_evidence_review";
  status: "normal" | "warning" | "critical";
  summary: string;
  total: number;
  pending: number;
  approved: number;
  rework: number;
  overdue: number;
  oldest_open_age_seconds: number;
  next_due_at?: string | null;
  latest_review_id?: string | null;
  items: QueueEvidenceReviewItem[];
  decision_events: QueueAdminActionAuditEvent[];
  gates: GateResult[];
};

type QueueEvidenceReviewPackage = {
  id: string;
  generated_at: string;
  actor: string;
  tenant_id: string;
  export_scope: "internal_evidence";
  external_export_allowed: boolean;
  package_hash: string;
  review_status: QueueEvidenceReviewStatus;
  open_items: QueueEvidenceReviewItem[];
  decision_events: QueueAdminActionAuditEvent[];
  acceptance_summary: {
    total: number;
    pending: number;
    rework: number;
    approved: number;
    overdue: number;
    status: "normal" | "warning" | "critical";
    ready_for_internal_acceptance: boolean;
    blocking_reason?: string | null;
  };
  gates: GateResult[];
};

type QueueEvidenceReviewPackageArchiveEntry = {
  id: string;
  package_id: string;
  package_hash: string;
  archived_at: string;
  actor: string;
  tenant_id: string;
  status: "ready" | "blocked";
  pending: number;
  rework: number;
  overdue: number;
  decision_events_total: number;
  open_items_total: number;
  archive_path: string;
};

type QueueEvidenceReviewPackageArchiveStatus = {
  mode: "local_jsonl_evidence_package_archive";
  storage: string;
  entries_total: number;
  latest_entry_id?: string | null;
  latest_package_hash?: string | null;
  entries: QueueEvidenceReviewPackageArchiveEntry[];
  gates: GateResult[];
};

type QueueEvidenceAcceptanceChecklistItem = {
  id: string;
  title: string;
  status: "passed" | "warning" | "failed";
  owner_role: string;
  reason: string;
  action: string;
  action_label: string;
  action_kind:
    | "refresh_package"
    | "save_archive"
    | "filter_pending"
    | "filter_rework"
    | "filter_overdue"
    | "review_decision_trail"
    | "review_package_gates"
    | "none";
  action_target?: string | null;
  evidence_ref?: string | null;
};

type QueueEvidenceAcceptanceChecklistStatus = {
  mode: "queue_evidence_acceptance_checklist";
  status: "normal" | "warning" | "critical";
  summary: string;
  package_id: string;
  package_hash: string;
  archive_entries_total: number;
  ready_for_internal_acceptance: boolean;
  items: QueueEvidenceAcceptanceChecklistItem[];
  gates: GateResult[];
};

type QueueEvidenceAcceptanceSummaryStatus = {
  mode: "queue_evidence_acceptance_summary";
  status: "normal" | "warning" | "critical";
  ready_for_internal_acceptance: boolean;
  headline: string;
  summary: string;
  blockers_total: number;
  warnings_total: number;
  passed_total: number;
  checklist_items_total: number;
  package_id: string;
  package_hash: string;
  primary_blocker_id?: string | null;
  primary_blocker_title?: string | null;
  primary_blocker_status?: "passed" | "warning" | "failed" | null;
  primary_owner_role?: string | null;
  primary_reason?: string | null;
  primary_action_label?: string | null;
  primary_action_kind?: QueueEvidenceAcceptanceChecklistItem["action_kind"] | null;
  primary_action_target?: string | null;
  next_action: string;
  gates: GateResult[];
};

type QueueEvidenceAcceptanceBlockerWorklistStatus = {
  mode: "queue_evidence_acceptance_blocker_worklist";
  status: "normal" | "warning" | "critical";
  summary: string;
  blockers_total: number;
  warnings_total: number;
  actionable_total: number;
  package_id: string;
  package_hash: string;
  first_action_label?: string | null;
  first_action_kind?: QueueEvidenceAcceptanceChecklistItem["action_kind"] | null;
  items: QueueEvidenceAcceptanceChecklistItem[];
  gates: GateResult[];
};

type QueueEvidenceAcceptanceBatchGroup = {
  id: string;
  title: string;
  action_kind: QueueEvidenceAcceptanceChecklistItem["action_kind"] | string;
  action_label: string;
  action_target?: string | null;
  status: "warning" | "critical";
  items_total: number;
  owner_roles: string[];
  item_ids: string[];
  reason: string;
  next_action: string;
};

type QueueEvidenceAcceptanceBatchPlanStatus = {
  mode: "queue_evidence_acceptance_batch_plan";
  status: "normal" | "warning" | "critical";
  summary: string;
  groups_total: number;
  blockers_total: number;
  warnings_total: number;
  package_id: string;
  package_hash: string;
  first_group_id?: string | null;
  first_action_label?: string | null;
  first_action_kind?: QueueEvidenceAcceptanceChecklistItem["action_kind"] | string | null;
  first_action_target?: string | null;
  groups: QueueEvidenceAcceptanceBatchGroup[];
  gates: GateResult[];
};

type QueueEvidenceAcceptanceBatchActionResponse = {
  mode: "queue_evidence_acceptance_batch_action_session";
  status: "completed" | "review_required" | "blocked";
  batch_group_id: string;
  action_kind: QueueEvidenceAcceptanceBatchGroup["action_kind"];
  action_label: string;
  action_target?: string | null;
  items_total: number;
  message: string;
  review_status: QueueEvidenceReviewStatus;
  audit_event: QueueAdminActionAuditEvent;
  gates: GateResult[];
};

type QueueEvidenceAcceptanceBatchItemDecisionResponse = {
  mode: "queue_evidence_acceptance_batch_item_decision";
  status: "completed" | "blocked";
  batch_group_id: string;
  review_id: string;
  decision: "approved" | "rework";
  message: string;
  review_item?: QueueEvidenceReviewItem | null;
  review_status: QueueEvidenceReviewStatus;
  audit_event: QueueAdminActionAuditEvent;
  gates: GateResult[];
};

type QueueEvidenceAcceptanceBatchGroupClosureStatus = {
  mode: "queue_evidence_acceptance_batch_group_closure";
  status: "open" | "closed" | "blocked";
  batch_group_id: string;
  action_kind: string;
  action_label: string;
  action_target?: string | null;
  total_items: number;
  open_items: number;
  closed_items: number;
  pending_items: number;
  rework_items: number;
  approved_items: number;
  next_review_id?: string | null;
  next_action_label?: string | null;
  summary: string;
  review_status: QueueEvidenceReviewStatus;
  gates: GateResult[];
};

type QueueEvidenceAcceptanceCenterStatus = {
  mode: "queue_evidence_acceptance_center";
  status: "normal" | "warning" | "critical";
  headline: string;
  summary: string;
  ready_for_internal_acceptance: boolean;
  blockers_total: number;
  warnings_total: number;
  worklist_actions_total: number;
  batch_groups_total: number;
  primary_action_label?: string | null;
  primary_action_kind?: QueueEvidenceAcceptanceChecklistItem["action_kind"] | string | null;
  first_group_id?: string | null;
  next_review_id?: string | null;
  sections_total: number;
  technical_panels_replaced: number;
  checklist: QueueEvidenceAcceptanceChecklistStatus;
  acceptance_summary: QueueEvidenceAcceptanceSummaryStatus;
  worklist: QueueEvidenceAcceptanceBlockerWorklistStatus;
  batch_plan: QueueEvidenceAcceptanceBatchPlanStatus;
  first_group_closure?: QueueEvidenceAcceptanceBatchGroupClosureStatus | null;
  gates: GateResult[];
};

type IncidentLifecycleItem = {
  id: string;
  source: "alert" | "dead_letter_queue" | "queue" | "scheduler" | "worker";
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  title: string;
  owner_role: string;
  response_due_at?: string | null;
  sla_status: "not_applicable" | "within_sla" | "overdue";
  age_seconds: number;
  updated_at?: string | null;
  current_step: string;
  next_action: string;
  action_label: string;
  action_endpoint?: string | null;
  escalation_target?: string | null;
  related_queue_id?: string | null;
  related_task_run_id?: string | null;
  evidence_ref?: string | null;
};

type IncidentLifecycleStatus = {
  mode: "sqlite_mvp_incident_lifecycle";
  status: "normal" | "warning" | "critical";
  summary: string;
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  overdue: number;
  incidents: IncidentLifecycleItem[];
  gates: GateResult[];
};

type NotificationChannel = {
  id: string;
  name: string;
  channel_type: "local_log" | "email" | "telegram" | "webhook";
  enabled: boolean;
  delivery_mode: "dry_run" | "disabled" | "external_not_configured";
  target_ref: string;
  safe_for_mvp: boolean;
  last_error?: string | null;
};

type NotificationDeliveryItem = {
  id: string;
  incident_id: string;
  channel_id: string;
  channel_type: "local_log" | "email" | "telegram" | "webhook";
  status: "queued" | "delivered" | "blocked" | "failed";
  severity: "info" | "warning" | "critical";
  title: string;
  owner_role: string;
  message: string;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
  delivered_at?: string | null;
  attempt_count: number;
  error?: string | null;
  evidence_ref?: string | null;
};

type NotificationDeliveryStatus = {
  mode: "sqlite_mvp_notification_delivery";
  status: "normal" | "warning" | "critical";
  summary: string;
  total: number;
  queued: number;
  delivered: number;
  blocked: number;
  failed: number;
  active_incidents: number;
  channels: NotificationChannel[];
  items: NotificationDeliveryItem[];
  gates: GateResult[];
};

type NotificationRoutePreference = {
  id: string;
  severity: "info" | "warning" | "critical";
  source: "all" | "alert" | "dead_letter_queue" | "queue" | "scheduler" | "worker";
  owner_role: string;
  channel_ids: string[];
  response_minutes?: number | null;
  escalation_target?: string | null;
  enabled: boolean;
  delivery_mode: "local_log_only" | "external_blocked";
  reason: string;
  updated_at: string;
};

type NotificationRoutingStatus = {
  mode: "sqlite_mvp_notification_routing";
  status: "normal" | "warning" | "critical";
  summary: string;
  routes_total: number;
  active_routes: number;
  external_routes_blocked: number;
  routes: NotificationRoutePreference[];
  gates: GateResult[];
};

type NotificationPolicyAuditItem = {
  id: string;
  title: string;
  status: "passed" | "warning" | "failed";
  severity: "info" | "warning" | "critical";
  policy_area: "channels" | "routes" | "sla" | "delivery" | "secrets" | "evidence";
  owner_role: string;
  rule: string;
  evidence_source: string;
  remediation?: string | null;
};

type NotificationPolicyAuditStatus = {
  mode: "sqlite_mvp_notification_policy_audit";
  status: "normal" | "warning" | "critical";
  summary: string;
  checks_total: number;
  passed: number;
  warnings: number;
  failed: number;
  external_delivery_allowed: boolean;
  production_gate_required: boolean;
  items: NotificationPolicyAuditItem[];
  gates: GateResult[];
};

type IncidentTimelineEvent = {
  id: string;
  timestamp: string;
  event_type:
    | "incident_open"
    | "notification_delivered"
    | "runbook_action"
    | "dlq_acknowledged"
    | "manual_retry"
    | "incident_resolved"
    | "audit_evidence";
  title: string;
  actor: string;
  status: "info" | "warning" | "critical" | "resolved";
  source: string;
  related_queue_id?: string | null;
  related_task_run_id?: string | null;
  evidence_ref?: string | null;
};

type AdminIncidentTimelineStatus = {
  mode: "sqlite_mvp_admin_incident_timeline";
  status: "normal" | "warning" | "critical";
  summary: string;
  events_total: number;
  unresolved_events: number;
  timeline: IncidentTimelineEvent[];
  gates: GateResult[];
};

type QueueRunbookStep = {
  id: string;
  title: string;
  trigger: string;
  owner_role: string;
  severity: "info" | "warning" | "critical";
  status: "ready" | "needs_attention" | "blocked";
  action: string;
  evidence_source: string;
  endpoint?: string | null;
  action_label?: string | null;
  action_kind:
    | "start_scheduler"
    | "stop_scheduler"
    | "scheduler_tick"
    | "dispatch_notifications"
    | "review_only"
    | "verify_only";
  executable: boolean;
};

type QueueOperationsRunbookStatus = {
  mode: "sqlite_mvp_queue_operations_runbook";
  status: "normal" | "warning" | "critical";
  summary: string;
  response_mode: "monitor" | "operator_action" | "emergency_stop";
  primary_action: string;
  priority_step_ids: string[];
  steps_total: number;
  steps_ready: number;
  steps_needing_attention: number;
  emergency_stop_required: boolean;
  steps: QueueRunbookStep[];
  gates: GateResult[];
};

type QueueRunbookActionResponse = {
  step_id: string;
  action_kind: QueueRunbookStep["action_kind"] | string;
  executed: boolean;
  status: "completed" | "review_required" | "blocked";
  message: string;
  runbook: QueueOperationsRunbookStatus;
  gates: GateResult[];
};

type DeadLetterQueueRecord = {
  id: string;
  queue_id: string;
  task_run_id: string;
  status: "open" | "acknowledged" | "resolved";
  severity: "warning" | "critical";
  reason: string;
  error?: string | null;
  attempts: number;
  max_attempts: number;
  next_action: string;
  created_at: string;
  updated_at: string;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
};

type DeadLetterQueueStatus = {
  mode: "sqlite_mvp_dead_letter_queue";
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  items: DeadLetterQueueRecord[];
  gates: GateResult[];
};

type TaskRunQueueResponse = {
  queue_item: TaskRunQueueItem;
  task_run: TaskRun;
  processed: boolean;
  gates: GateResult[];
};

type Artifact = {
  id: string;
  task_run_id: string;
  version: string;
  title: string;
  content: string;
  sources: string[];
  checks: GateResult[];
};

type ArtifactVersionRecord = {
  id: string;
  artifact_id: string;
  task_run_id: string;
  version: string;
  title: string;
  content_hash: string;
  source: string;
  created_at: string;
};

type ArtifactRollbackResult = {
  artifact: Artifact;
  restored_from: ArtifactVersionRecord;
  created_version: ArtifactVersionRecord;
  audit_event: AuditEvent;
  gates: GateResult[];
};

type ArtifactVersionDiff = {
  field: "title" | "content" | "sources" | "checks" | "content_hash";
  status: "same" | "changed";
  before: string;
  after: string;
  summary: string;
};

type ArtifactContentDiffLine = {
  type: "added" | "removed" | "unchanged";
  text: string;
  base_line?: number | null;
  target_line?: number | null;
};

type ArtifactVersionCompareResult = {
  artifact_id: string;
  base_version: ArtifactVersionRecord;
  target_version: ArtifactVersionRecord;
  semantic_change: boolean;
  content_delta_chars: number;
  content_delta_words: number;
  added_lines: number;
  removed_lines: number;
  unchanged_lines: number;
  content_diff_total: number;
  content_diff_offset: number;
  content_diff_limit: number;
  content_diff_truncated: boolean;
  content_diff_next_offset?: number | null;
  diffs: ArtifactVersionDiff[];
  content_diff: ArtifactContentDiffLine[];
  summary: string;
  gates: GateResult[];
};

type ArtifactDiffJobRecord = {
  id: string;
  artifact_id: string;
  version_id: string;
  status: "queued" | "running" | "completed" | "failed";
  requested_by: string;
  max_diff_lines: number;
  diff_offset: number;
  compare_result?: ArtifactVersionCompareResult | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  gates: GateResult[];
};

type ArtifactCompareActionRecord = {
  id: string;
  job_id: string;
  artifact_id: string;
  version_id: string;
  action_id: "accept-comparison" | "send-to-revision" | "prepare-restore";
  actor: string;
  status: "recorded";
  comment: string;
  created_at: string;
  gates: GateResult[];
};

type ArtifactExportDraft = {
  artifact_id: string;
  filename: string;
  content_type: "application/json";
  content: Record<string, unknown>;
  content_hash: string;
  gates: GateResult[];
};

type ArtifactEvidencePackage = {
  artifact_id: string;
  generated_at: string;
  artifact: Artifact;
  versions: ArtifactVersionRecord[];
  diff_jobs: ArtifactDiffJobRecord[];
  compare_actions: ArtifactCompareActionRecord[];
  audit_events: AuditEvent[];
  package_hash: string;
  gates: GateResult[];
};


type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  redacted_payload: Record<string, unknown>;
};

type AuditEventHash = {
  id: string;
  previous_hash: string;
  event_hash: string;
};

type AuditRetentionStatus = {
  mode: "mvp_local_evidence" | "production_policy_pending";
  retention_policy: string;
  storage: string;
  events_total: number;
  immutable_chain: boolean;
  chain_valid: boolean;
  head_hash: string;
  export_allowed: boolean;
  external_export_allowed: boolean;
  stop_condition: string;
  gates: GateResult[];
};

type AuditPersistenceStatus = {
  storage: string;
  persistent: boolean;
  db_path: string;
  events_total: number;
  seed_source: string;
  sync_mode: "seeded_from_runtime" | "live_persistent";
  chain_valid: boolean;
  head_hash: string;
  retention_schedule_status: "pending_approval" | "approved";
  external_export_allowed: boolean;
  gates: GateResult[];
};

type AuditExportPackage = {
  id: string;
  generated_at: string;
  actor: string;
  tenant_id: string;
  export_scope: "internal_evidence";
  external_export_allowed: boolean;
  events_total: number;
  event_hashes: AuditEventHash[];
  package_hash: string;
  redaction_policy: string;
  gates: GateResult[];
};

type EvidenceAccessModelStatus = {
  mode: string;
  policy_version: string;
  storage: string;
  view_roles: string[];
  package_roles: string[];
  external_export_allowed: boolean;
  retention_schedule_status: "pending_approval" | "approved";
  audit_events_total: number;
  audit_chain_valid: boolean;
  audit_head_hash: string;
  gates: GateResult[];
};

type EvidenceAccessDecision = {
  id: string;
  actor: string;
  role: string;
  tenant_id: string;
  resource: "audit_events" | "audit_export_package" | "release_evidence";
  action: "view_status" | "view_events" | "download_internal_package" | "external_export";
  allowed: boolean;
  status: "allowed" | "blocked";
  reason: string;
  external_export_allowed: boolean;
  package_access_allowed: boolean;
};

type EvidenceAccessAuditVerification = {
  mode: string;
  valid: boolean;
  events_total: number;
  head_hash: string;
};

type RagChunk = {
  id: string;
  document_id: string;
  title: string;
  text: string;
  score: number;
  access_scope: string;
};

type RagSearchResponse = {
  query: string;
  chunks: RagChunk[];
  min_score: number;
  source_coverage: "passed" | "warning" | "failed";
};

type LlmGatewayEvidence = {
  task_run_id: string;
  provider_id: string;
  provider_type: "mock" | "openai_compatible" | "local" | "disabled";
  model: string;
  prompt_template_version: string;
  input_tokens_estimate: number;
  output_tokens_estimate: number;
  fallback_used: boolean;
  secrets_redacted: boolean;
  response_status: "completed" | "failed" | "fallback";
};

type LlmProviderConfig = {
  id: string;
  provider_type: "mock" | "openai_compatible" | "local" | "disabled";
  status: "enabled" | "disabled" | "not_configured";
  model: string;
  base_url_configured: boolean;
  api_key_configured: boolean;
  secrets_redacted: boolean;
  fallback_priority: number;
  asvs_controls: string[];
  nist_controls: string[];
};

type QualityGateDefinition = {
  id: string;
  title: string;
  category: string;
  standard_map: string[];
  owner_role: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence_required: string;
  fail_action: string;
};

type StorageStatus = {
  type: string;
  path: string;
  exists: boolean;
  documents: number;
  chunks: number;
  vectors: number;
  vector_index_ready: boolean;
  vector_model: string;
  persistent: boolean;
};

type VectorIndexStatus = {
  mode: "vector_mvp" | "pgvector_ready" | "pgvector_live" | "pgvector_fallback";
  model: string;
  dimension: number;
  chunks_total: number;
  vectors_total: number;
  ready: boolean;
  storage: string;
  embedding_provider: string;
  pgvector_migration: string | null;
  pgvector_ready: boolean;
  pgvector_connected: boolean;
  pgvector_tables_ready: boolean;
  pgvector_vectors_total: number;
  fallback_reason: string | null;
};

type FilePolicyEvidence = {
  status: "passed" | "failed" | "warning";
  allowed: boolean;
  ocr_required: boolean;
  scan_required: boolean;
  max_size_bytes: number;
  checks: GateResult[];
  asvs_controls: string[];
  nist_controls: string[];
};

type UploadRuntimeStatus = {
  storage_path: string;
  uploads_total: number;
  ocr_jobs_total: number;
  scanner_adapter: string;
  ocr_dispatcher: string;
  ocr_pipeline_path: string;
  ready: boolean;
};

type SourceIntakeItem = {
  id: string;
  kind: "document" | "upload" | "link";
  title: string;
  status: "indexed" | "ready" | "needs_ocr" | "needs_approval" | "registered" | "blocked" | "warning";
  access_scope: string;
  reference: string;
  document_id: string | null;
  upload_id: string | null;
  url: string | null;
  rag_status: string | null;
  ocr_job_id: string | null;
  checks: GateResult[];
};

type SourceIntakeSummary = {
  active_source_ids: string[];
  ready_document_ids: string[];
  items: SourceIntakeItem[];
  upload_runtime_ready: boolean;
  supported_inputs: string[];
  next_action: string;
};

type FileUploadEvidence = {
  upload: {
    id: string;
    name: string;
    rag_status: string;
    document_id: string | null;
  };
  accepted_for_runtime: boolean;
};

type OcrWorkerStatus = {
  worker: string;
  pipeline_path: string;
  python_command: string;
  queued_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  ready: boolean;
};

type EmbeddingProviderStatus = {
  provider: string;
  model: string;
  dimension: number;
  configured: boolean;
  fallback_used: boolean;
  pgvector_target: boolean;
  pgvector_migration_path: string;
  notes: string[];
};

type QualityEvidence = {
  task_run_id: string;
  gates: GateResult[];
  overall_status: "passed" | "failed" | "warning";
  evidence_summary: string;
};

type RuntimeEvidence = {
  task_run_id: string;
  rag: RagSearchResponse;
  llm: LlmGatewayEvidence;
  quality: QualityEvidence;
  audit_event_ids: string[];
};

type ResultAction = {
  id: string;
  title: string;
  status: "available" | "blocked" | "completed";
  description: string;
  next_status: string | null;
};

type ResultActionRecord = {
  id: string;
  task_run_id: string;
  action_id: string;
  actor: string;
  status: "completed";
  comment: string | null;
  related_task_run_id: string | null;
  created_at: string;
};

type FollowupBrief = {
  goal: string;
  expected_artifact: string;
  source_context: string;
  urgency: string;
};

type NextStepReviewSnapshot = FollowupBrief & {
  source_label: string;
  confirmed_at_label: string;
};

type PersistedArtifactDraftState = {
  status: "empty" | "saved" | "reset";
  title: string | null;
  body: string | null;
  next: string | null;
  saved_at: string | null;
  saved_by: string | null;
  summary: string;
};

type PersistedNextStepReviewState = {
  confirmed: boolean;
  goal: string | null;
  expected_artifact: string | null;
  source_context: string | null;
  urgency: string | null;
  source_label: string | null;
  confirmed_at_label: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  summary: string;
};

type UserWorkspacePersistenceState = {
  artifact_draft: PersistedArtifactDraftState;
  next_step_review: PersistedNextStepReviewState;
  gates: GateResult[];
  summary: string;
};

type FollowupLineageItem = {
  task_run_id: string;
  artifact_title: string | null;
  action_id: string;
  goal: string | null;
  expected_artifact: string | null;
  source_label: string | null;
  created_at: string;
};

type FollowupContinuityState = {
  is_followup: boolean;
  cycle_number: number;
  source_task_run_id: string | null;
  source_artifact_title: string | null;
  source_action_id: string | null;
  goal: string | null;
  expected_artifact: string | null;
  source_context: string | null;
  urgency: string | null;
  source_label: string | null;
  confirmed_at: string | null;
  lineage: FollowupLineageItem[];
  summary: string;
  gates: GateResult[];
};

type ScenarioResumeStep = {
  id: string;
  title: string;
  status: "done" | "active" | "waiting";
  detail: string;
  action_id: string | null;
  target_task_run_id: string | null;
};

type ScenarioResumeState = {
  is_resumable: boolean;
  scenario_label: string;
  primary_action: "review-result" | "continue-edit" | "confirm-next-step" | "create-next-task" | "open-followup";
  primary_action_label: string;
  primary_action_target_task_run_id: string | null;
  summary: string;
  steps: ScenarioResumeStep[];
  gates: GateResult[];
};

type FollowupExecutionWorkspaceItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "active" | "waiting" | "blocked";
};

type FollowupExecutionWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  source_task_run_id: string | null;
  current_task_run_id: string;
  title: string;
  summary: string;
  primary_action: "review-current-result" | "accept-current-result" | "continue-from-source" | "create-next-cycle";
  primary_action_label: string;
  inherited_workgroup: string[];
  items: FollowupExecutionWorkspaceItem[];
  gates: GateResult[];
};

type CurrentCycleOutcomeItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "active" | "waiting" | "blocked" | "accept" | "revise" | "continue";
};

type CurrentCycleOutcomeWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  artifact_title: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  primary_action: "choose-route" | "accept-current-result" | "revise-current-result" | "continue-next-cycle";
  primary_action_label: string;
  summary: string;
  items: CurrentCycleOutcomeItem[];
  route_items: CurrentCycleOutcomeItem[];
  gates: GateResult[];
};

type OutcomeNextCycleLaunchPayload = {
  goal: string;
  expected_artifact: string;
  source_context: string;
  urgency: string;
  source_label: string;
  confirmed_at_label: string;
};

type OutcomeNextCycleLaunchItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "active" | "waiting" | "blocked" | "continue" | "review" | "cycle";
};

type OutcomeNextCycleLauncherState = {
  is_active: boolean;
  cycle_number: number;
  target_cycle_number: number;
  selected_route: "accept" | "revise" | "continue" | null;
  review_confirmed: boolean;
  linked_task_run_id: string | null;
  primary_action:
    | "choose-route"
    | "accept-current-result"
    | "revise-current-result"
    | "confirm-next-cycle"
    | "create-next-cycle"
    | "open-next-cycle";
  primary_action_label: string;
  summary: string;
  launch_payload: OutcomeNextCycleLaunchPayload;
  items: OutcomeNextCycleLaunchItem[];
  gates: GateResult[];
};

type CycleExecutionBriefItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "active" | "waiting" | "blocked" | "inherited" | "check" | "stop";
};

type CycleExecutionBriefState = {
  is_active: boolean;
  cycle_number: number;
  source_task_run_id: string | null;
  current_task_run_id: string;
  inherited_outcome: string;
  primary_action: "review-inherited-outcome" | "execute-cycle" | "accept-cycle-result";
  primary_action_label: string;
  summary: string;
  items: CycleExecutionBriefItem[];
  gates: GateResult[];
};

type CycleAcceptanceWorkspaceItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "criteria" | "signal" | "decision" | "asset" | "next" | "stop" | "risk" | "ready" | "blocked";
};

type CycleAcceptanceWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  result_title: string;
  selected_route: "accept" | "revise" | "continue" | null;
  primary_action:
    | "wait-cycle-result"
    | "choose-cycle-route"
    | "accept-cycle-result"
    | "revise-cycle-result"
    | "continue-next-cycle"
    | "open-next-cycle";
  primary_action_label: string;
  summary: string;
  acceptance_items: CycleAcceptanceWorkspaceItem[];
  decision_items: CycleAcceptanceWorkspaceItem[];
  gates: GateResult[];
};

type CycleContinuityWorkspaceItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "basis" | "active" | "ready" | "acceptance" | "next" | "stop" | "waiting";
};

type CycleContinuityWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  title: string;
  summary: string;
  primary_action: "review-cycle-basis" | "execute-cycle" | "accept-cycle-result" | "continue-chain";
  primary_action_label: string;
  items: CycleContinuityWorkspaceItem[];
  gates: GateResult[];
};

type AccumulatedBusinessAssetItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "basis" | "chain" | "value" | "reusable" | "next" | "limit" | "waiting";
};

type AccumulatedBusinessAssetWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  title: string;
  summary: string;
  primary_action: "review-asset" | "accept-current-asset" | "continue-asset-chain";
  primary_action_label: string;
  items: AccumulatedBusinessAssetItem[];
  gates: GateResult[];
};

type BusinessAssetDecisionItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "accept" | "revise" | "continue" | "effect" | "guard" | "proof" | "waiting";
};

type BusinessAssetDecisionWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "choose-asset-route" | "accept-asset" | "revise-asset" | "continue-asset" | "open-next-cycle";
  primary_action_label: string;
  items: BusinessAssetDecisionItem[];
  gates: GateResult[];
};

type BusinessAssetRouteOutcomeItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "selected" | "outcome" | "next" | "handoff" | "proof" | "guard" | "waiting";
};

type BusinessAssetRouteOutcomeWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-route-outcome" | "confirm-accepted-asset" | "revise-asset" | "open-next-cycle";
  primary_action_label: string;
  items: BusinessAssetRouteOutcomeItem[];
  gates: GateResult[];
};

type BusinessAssetManualReviewItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "scenario" | "clarity" | "business" | "next" | "proof" | "guard" | "manual" | "waiting";
};

type BusinessAssetManualReviewWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-manual-check" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetManualReviewItem[];
  gates: GateResult[];
};

type BusinessAssetGAcceptancePackageItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "scope" | "route" | "proof" | "condition" | "risk" | "decision" | "guard" | "waiting";
};

type BusinessAssetGAcceptancePackageWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-g-package" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetGAcceptancePackageItem[];
  gates: GateResult[];
};

type BusinessAssetGReviewExecutionItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "check" | "proof" | "condition" | "decision" | "guard" | "waiting";
};

type BusinessAssetGReviewExecutionWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "execute-g-review" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetGReviewExecutionItem[];
  gates: GateResult[];
};

type BusinessAssetGCheckHandoffItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "target" | "criteria" | "evidence" | "stop" | "next" | "owner" | "guard" | "waiting";
};

type BusinessAssetGCheckHandoffWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-handoff" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetGCheckHandoffItem[];
  gates: GateResult[];
};

type BusinessAssetGDecisionDraftOption = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "accept" | "revise" | "continue" | "guard" | "waiting";
};

type BusinessAssetGDecisionDraftWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-decision-draft" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  options: BusinessAssetGDecisionDraftOption[];
  gates: GateResult[];
};

type BusinessAssetGDecisionImpactItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "selected" | "effect" | "next" | "manual" | "guard" | "waiting";
};

type BusinessAssetGDecisionImpactWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-impact" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetGDecisionImpactItem[];
  gates: GateResult[];
};

type BusinessAssetGDecisionReadinessItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "ready" | "evidence" | "blocker" | "manual" | "guard" | "waiting";
};

type BusinessAssetGDecisionReadinessWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-readiness" | "open-next-cycle" | "return-to-decision";
  primary_action_label: string;
  items: BusinessAssetGDecisionReadinessItem[];
  gates: GateResult[];
};

type BusinessAssetGDecisionChecklistItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "check" | "focus" | "blocker" | "manual" | "guard" | "waiting";
};

type BusinessAssetGDecisionChecklistWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-checklist" | "open-next-cycle" | "return-to-readiness";
  primary_action_label: string;
  checklist: BusinessAssetGDecisionChecklistItem[];
  gates: GateResult[];
};

type BusinessAssetGDecisionReviewSummaryItem = {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: "summary" | "check" | "blocker" | "manual" | "guard" | "waiting";
};

type BusinessAssetGDecisionReviewSummaryWorkspaceState = {
  is_active: boolean;
  cycle_number: number;
  accumulated_cycles: number;
  current_task_run_id: string;
  source_task_run_id: string | null;
  selected_route: "accept" | "revise" | "continue" | null;
  title: string;
  summary: string;
  primary_action: "review-summary" | "open-next-cycle" | "return-to-checklist";
  primary_action_label: string;
  review_items: BusinessAssetGDecisionReviewSummaryItem[];
  gates: GateResult[];
};

type TaskRunResultCenter = {
  task_run_id: string;
  product_status: "waiting" | "running" | "ready_for_acceptance" | "needs_revision" | "accepted";
  artifact: Artifact | null;
  evidence: RuntimeEvidence;
  timeline: StageStatus[];
  gates: GateResult[];
  actions: ResultAction[];
  action_history: ResultActionRecord[];
  acceptance_checklist: GateResult[];
  acceptance_decision: AcceptanceDecisionState;
  user_workspace_state: UserWorkspacePersistenceState;
  followup_continuity: FollowupContinuityState;
  scenario_resume: ScenarioResumeState;
  followup_execution_workspace: FollowupExecutionWorkspaceState;
  current_cycle_outcome_workspace: CurrentCycleOutcomeWorkspaceState;
  outcome_next_cycle_launcher: OutcomeNextCycleLauncherState;
  cycle_execution_brief: CycleExecutionBriefState;
  cycle_acceptance_workspace: CycleAcceptanceWorkspaceState;
  cycle_continuity_workspace: CycleContinuityWorkspaceState;
  accumulated_business_asset_workspace: AccumulatedBusinessAssetWorkspaceState;
  business_asset_decision_workspace: BusinessAssetDecisionWorkspaceState;
  business_asset_route_outcome_workspace: BusinessAssetRouteOutcomeWorkspaceState;
  business_asset_manual_review_workspace: BusinessAssetManualReviewWorkspaceState;
  business_asset_g_acceptance_package_workspace: BusinessAssetGAcceptancePackageWorkspaceState;
  business_asset_g_review_execution_workspace: BusinessAssetGReviewExecutionWorkspaceState;
  business_asset_g_check_handoff_workspace: BusinessAssetGCheckHandoffWorkspaceState;
  business_asset_g_decision_draft_workspace: BusinessAssetGDecisionDraftWorkspaceState;
  business_asset_g_decision_impact_workspace: BusinessAssetGDecisionImpactWorkspaceState;
  business_asset_g_decision_readiness_workspace: BusinessAssetGDecisionReadinessWorkspaceState;
  business_asset_g_decision_checklist_workspace: BusinessAssetGDecisionChecklistWorkspaceState;
  business_asset_g_decision_review_summary_workspace: BusinessAssetGDecisionReviewSummaryWorkspaceState;
  next_step: string;
};

type PiiFinding = {
  id: string;
  pii_type: string;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence_preview: string;
  confidence: number;
};

type PiiClassificationEvidence = {
  id: string;
  artifact_id: string | null;
  pii_detected: boolean;
  risk_level: "none" | "low" | "medium" | "high" | "critical";
  findings: PiiFinding[];
  redacted_text: string;
  gates: GateResult[];
};

type HumanApprovalRecord = {
  id: string;
  artifact_id: string;
  classification_id: string;
  reviewer: string;
  status: "pending" | "approved" | "rejected";
  decision_comment: string | null;
};

type ExportDecision = {
  id: string;
  artifact_id: string;
  channel: string;
  status: "allowed" | "blocked";
  reason: string;
  classification_id: string;
  approval_id: string | null;
  redacted_content: string | null;
  gates: GateResult[];
};

type DataProtectionStatus = {
  classifier: string;
  approvals_total: number;
  pending_approvals: number;
  exports_total: number;
  blocked_exports: number;
  client_data_ready: boolean;
  client_data_condition: string;
  gates: GateResult[];
};

type SecuritySession = {
  authenticated: boolean;
  actor: string;
  role: string;
  department: string;
  access_level: string;
  tenant_id: string;
  session_id: string;
  auth_source: string;
};

type AccessPolicy = {
  process_id: string;
  tenant_id: string;
  view_roles: string[];
  execute_roles: string[];
  allowed_departments: string[];
  min_access_level: string;
  policy_version: string;
  status: string;
  updated_at?: string;
  updated_by?: string;
};

type AccessPolicyStoreStatus = {
  storage: string;
  persistent: boolean;
  policies_total: number;
  audit_events_total: number;
  audit_chain_mode: string;
  audit_chain_valid: boolean;
  audit_head_hash: string;
  policy_tables: string[];
};

type AccessPolicyAuditEvent = {
  id: string;
  process_id: string;
  actor: string;
  role: string;
  action: string;
  created_at: string;
  previous_hash: string;
  event_hash: string;
};

type AccessPolicyAuditVerification = {
  mode: string;
  valid: boolean;
  events_total: number;
  head_hash: string;
  failed_event_id: string | null;
  checked_at: string;
};

type RuntimeRole = {
  runtime_role: string;
  display_name: string;
  symbiot_role_ref: string;
  department: string;
  access_level: string;
  permissions: string[];
  status: string;
  alias_of?: string;
};

type RoleDirectoryStatus = {
  source: string;
  version: string;
  roles_total: number;
  active_roles_total: number;
  runtime_roles: string[];
  symbiot_refs_total: number;
  departments: string[];
  permission_groups_total: number;
  coverage_ready: boolean;
  missing_required_permissions: string[];
  mvp_ready: boolean;
};

type RoleDirectoryCoverage = {
  version: string;
  roles_total: number;
  active_roles_total: number;
  departments: string[];
  permission_groups_total: number;
  required_permissions: string[];
  missing_required_permissions: string[];
  roles_without_permissions: string[];
  coverage_ready: boolean;
  permission_summary: Record<string, string[]>;
};

type RoleDirectoryAdminStatus = {
  mode: string;
  persistent: boolean;
  overrides_total: number;
  audit_events_total: number;
  audit_chain_mode: string;
  audit_chain_valid: boolean;
  audit_head_hash: string;
  coverage_ready: boolean;
  admin_workflow_ready: boolean;
  blocked_operations: string[];
};

type RoleDirectoryAuditVerification = {
  mode: string;
  valid: boolean;
  events_total: number;
  head_hash: string;
  failed_event_id: string | null;
  checked_at: string;
};

type RoleDirectory = {
  version: string;
  source: string;
  obsidian_registry: string;
  permission_model: {
    version: string;
    default_deny: boolean;
    permission_groups: Record<string, string>;
  };
  roles: RuntimeRole[];
};

type IdentityProviderStatus = {
  mode: string;
  provider: string;
  target_protocol: string;
  demo_headers_enabled: boolean;
  jwt_dependency_available: boolean;
  jwks_source: string;
  verified_jwt_validation_ready: boolean;
  production_sso_ready: boolean;
  configured_fields: Record<string, boolean>;
  required_claims: string[];
  mapped_runtime_headers: Record<string, string>;
  stop_condition: string;
  gates: GateResult[];
};

type KeycloakBootstrapStatus = {
  provider: string;
  realm: string;
  client_id: string;
  realm_import_path: string;
  realm_import_exists: boolean;
  realm_ready: boolean;
  client_ready: boolean;
  roles_ready: boolean;
  claims_ready: boolean;
  bootstrap_users_ready: boolean;
  bootstrap_package_ready: boolean;
  production_endpoint_ready: boolean;
  roles_expected: string[];
  roles_found: string[];
  claims_expected: string[];
  claims_found: string[];
  bootstrap_users: string[];
  import_command: string;
  stop_condition: string;
  gates: GateResult[];
};

type KeycloakProductionReadinessStatus = {
  provider: string;
  mode: string;
  issuer: string;
  jwks_url: string;
  client_id_configured: boolean;
  audience_configured: boolean;
  inline_jwks_disabled: boolean;
  issuer_policy: {
    production_like: boolean;
    reasons: string[];
  };
  jwks_policy: {
    production_like: boolean;
    reasons: string[];
  };
  jwks_live: {
    reachable: boolean;
    http_status: number | null;
    keys_total: number;
    error: string | null;
  };
  bootstrap_package_ready: boolean;
  required_env_ready: boolean;
  live_jwks_ready: boolean;
  production_endpoint_ready: boolean;
  stop_condition: string;
  gates: GateResult[];
};

type RoleEditorDraft = {
  department: string;
  access_level: string;
  status: string;
  permissions: string[];
};

type AccessPolicyDirectoryValidation = {
  valid: boolean;
  policies_total: number;
  invalid_policies_total: number;
  known_runtime_roles: string[];
};

type RuntimeState = "loading" | "ready" | "running" | "complete" | "error";

type ProductTaskBrief = {
  goal: string;
  expectedArtifact: string;
  sourceContext: string;
  urgency: string;
};

type MissionCard = {
  title: string;
  value: string;
  detail: string;
};

type MissionProgressItem = {
  title: string;
  status: "done" | "active" | "waiting";
  detail: string;
};

type UserMissionCommand = {
  title: string;
  detail: string;
  actionLabel: string;
  action: "prepare" | "launch" | "result" | "next";
};

type LaunchReadinessItem = {
  title: string;
  status: "done" | "active" | "waiting";
  detail: string;
};

type CampaignMapItem = {
  title: string;
  status: "done" | "active" | "blocked" | "waiting";
  detail: string;
};

type MaturityLevelItem = {
  id: "raw" | "structured" | "controlled" | "monetizable" | "scalable";
  title: string;
  description: string;
};

type ExecutionProfile = {
  id: "single" | "gate" | "segment";
  title: string;
  mode: "R" | "G" | "SAFE_THROW";
  description: string;
  next: string;
};

type ScenarioPack = {
  id: string;
  title: string;
  description: string;
  goal: string;
  expectedArtifact: string;
  sourceContext: string;
  urgency: string;
};

type RolePack = {
  id: string;
  title: string;
  description: string;
  roles: string[];
  runtimeRoleIds: string[];
};

type BusinessMissionTemplate = {
  id: string;
  title: string;
  category: string;
  outcome: string;
  goodFor: string;
  metric: string;
  scenarioPackId: string;
  rolePackId: string;
  task: ProductTaskBrief;
};

function formDataText(formData: Record<string, unknown>, key: string): string | null {
  const value = formData[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formDataStringList(formData: Record<string, unknown>, key: string): string[] {
  const value = formData[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function missionFromTaskRunPayload(formData: Record<string, unknown>): BusinessMissionTemplate | null {
  const missionId = formDataText(formData, "business_mission_id");
  const explicitMission = BUSINESS_MISSIONS.find((mission) => mission.id === missionId);
  if (explicitMission) {
    return explicitMission;
  }
  const goal = formDataText(formData, "goal");
  const expectedArtifact = formDataText(formData, "expected_artifact");
  return (
    BUSINESS_MISSIONS.find(
      (mission) => mission.task.goal === goal || mission.task.expectedArtifact === expectedArtifact
    ) ?? null
  );
}

type ToolLoadoutItem = {
  title: string;
  status: "ready" | "partial" | "waiting";
  detail: string;
};

type RealWorldLinkItem = {
  title: string;
  detail: string;
  status: "available" | "pending";
};

type ResultDecisionCard = {
  id: "accept-result" | "return-to-revision" | "create-next-task";
  title: string;
  description: string;
  action: ResultAction | null;
  tone: "accept" | "revision" | "next";
};

type ResultAcceptanceBridgeItem = {
  title: string;
  status: "ready" | "attention" | "next";
  value: string;
  detail: string;
};

type UserContinuationStep = {
  title: string;
  status: "done" | "active" | "waiting";
  detail: string;
};

type NextCycleOpeningItem = {
  title: string;
  status: "source" | "target" | "action";
  value: string;
  detail: string;
};

type UserCycleSummaryItem = {
  title: string;
  value: string;
  detail: string;
};

type CycleHandoffItem = {
  title: string;
  value: string;
  detail: string;
  status: "accepted" | "current" | "next";
};

type BusinessValueChainItem = {
  title: string;
  value: string;
  detail: string;
  status: "outcome" | "effect" | "action" | "asset";
};

type ScenarioPackageSummaryItem = {
  title: string;
  value: string;
  detail: string;
  status: "mission" | "assets" | "decision" | "repeat";
};

type ScenarioPackageActionItem = {
  title: string;
  value: string;
  detail: string;
  href: "#business-result-detail" | "#result-decision" | "#result-center";
  status: "review" | "decide" | "continue";
};

type SecondCycleProgressItem = {
  title: string;
  value: string;
  detail: string;
  status: "accepted" | "progress" | "asset" | "next";
};

type ClientResultPackageItem = {
  title: string;
  value: string;
  detail: string;
  status: "summary" | "value" | "proof" | "handoff";
};

type ContinuityPackItem = {
  title: string;
  value: string;
  detail: string;
  status: "confirmed" | "carried" | "cycle" | "review" | "package" | "next";
};

type ResultDeliveryWorkspaceItem = {
  title: string;
  value: string;
  detail: string;
  status: "artifact" | "action" | "reuse" | "handoff" | "quality" | "next";
};

type GuidedRepeatRunWorkspaceItem = {
  title: string;
  value: string;
  detail: string;
  status: "source" | "ready" | "payload" | "handoff" | "cycle" | "control";
};

type RepeatRunExecutionBoardItem = {
  title: string;
  value: string;
  detail: string;
  status: "input" | "team" | "execution" | "acceptance" | "ready" | "control" | "stop" | "outcome";
};

type RepeatRunAcceptanceBoardItem = {
  title: string;
  value: string;
  detail: string;
  status: "criteria" | "signal" | "decision" | "stop" | "asset" | "next" | "risk" | "ready";
};

type AcceptanceDecisionRoute = "accept" | "revise" | "continue";

type AcceptanceDecisionRouterItem = {
  title: string;
  value: string;
  detail: string;
  status: "accept" | "revise" | "continue" | "asset" | "instruction" | "cycle" | "review" | "stop" | "ready";
};

type AcceptanceDecisionRouteOption = {
  id: AcceptanceDecisionRoute;
  title: string;
  primary: string;
  detail: string;
  status: AcceptanceDecisionRoute;
  availability: "available" | "blocked" | "selected";
};

type AcceptanceDecisionState = {
  selected_route: AcceptanceDecisionRoute | null;
  selected_action_id: string | null;
  selected_at: string | null;
  selected_by: string | null;
  summary: string;
  routes: AcceptanceDecisionRouteOption[];
  impacts: AcceptanceDecisionRouterItem[];
  checklist: AcceptanceDecisionRouterItem[];
  gates: GateResult[];
};

type ArtifactComposerDraft = {
  title: string;
  body: string;
  proof: string;
  next: string;
  checklist: string[];
};

type ArtifactEditorDraft = {
  title: string;
  body: string;
  next: string;
};

type EvidenceJournalItem = {
  title: string;
  status: "done" | "attention" | "waiting";
  description: string;
  detail: string;
};

type RoleSelectionStep = {
  title: string;
  status: "ready" | "attention" | "waiting";
  detail: string;
};

type QualityCheckpoint = {
  title: string;
  status: "passed" | "warning" | "failed" | "waiting";
  detail: string;
  action: string;
};

type ViewMode = "user" | "manager" | "admin" | "qa";

type ViewModeOption = {
  id: ViewMode;
  title: string;
  description: string;
};

type WorkgroupRolePreview = {
  runtime_role: string;
  display_name: string;
  symbiot_role_ref: string;
  department: string;
  access_level: string;
  permissions: string[];
  responsibility: string;
  selection_reason: string;
};

type WorkgroupRequirementPreview = {
  id: string;
  title: string;
  required: boolean;
  satisfied: boolean;
  matched_role_ids: string[];
  missing_reason: string | null;
};

type TaskIntakePreview = {
  process_id: string;
  status: "ready" | "needs_input" | "blocked";
  readiness_score: number;
  required_fields: string[];
  missing_fields: string[];
  recommended_profile_id: string;
  recommended_role_ids: string[];
  selected_role_ids: string[];
  workgroup: WorkgroupRolePreview[];
  requirements: WorkgroupRequirementPreview[];
  missing_required_capabilities: string[];
  redundant_role_ids: string[];
  override_active: boolean;
  workgroup_decision: string;
  selection_basis: string[];
  gates: GateResult[];
  next_action: string;
};

const DEFAULT_PRODUCT_TASK: ProductTaskBrief = {
  goal: "Подготовить коммерческое предложение по внедрению Симбиота как AI Runtime Platform для управляемого выполнения бизнес-процессов.",
  expectedArtifact: "Коммерческое предложение / краткий бизнес-артефакт с источниками, evidence и следующим шагом.",
  sourceContext: "Demo-источник doc-demo-001: продуктовая demo-база без реальных клиентских данных.",
  urgency: "G4 MVP Demo"
};

const PRODUCT_STEPS = [
  "Задать миссию",
  "Собрать команду",
  "Запустить работу",
  "Получить результат",
  "Проверить качество",
  "Решить что дальше"
];

const MATURITY_LEVELS: MaturityLevelItem[] = [
  {
    id: "raw",
    title: "Сырой вход",
    description: "Есть намерение или текст задачи, но маршрут еще не управляется."
  },
  {
    id: "structured",
    title: "Структурировано",
    description: "Задача описана, вход проверен, рабочая группа подобрана."
  },
  {
    id: "controlled",
    title: "Управляемо",
    description: "Есть TaskRun, результат, проверки, паспорт и журнал доказательств."
  },
  {
    id: "monetizable",
    title: "Готово к ценности",
    description: "Результат принят и может быть использован как платный рабочий сценарий."
  },
  {
    id: "scalable",
    title: "Масштабируемо",
    description: "Сценарий повторяется как шаблон для ролей, клиентов и пакетов."
  }
];

const EXECUTION_PROFILES: ExecutionProfile[] = [
  {
    id: "single",
    title: "Одна задача",
    mode: "R",
    description: "Подходит, когда нужен один понятный результат без цепочки решений.",
    next: "Выполнить, проверить и закрыть результат."
  },
  {
    id: "gate",
    title: "Точка решения",
    mode: "G",
    description: "Подходит, когда нужно ручное решение владельца перед продолжением.",
    next: "Подготовить пакет решения и остановиться до приемки."
  },
  {
    id: "segment",
    title: "Отрезок работ",
    mode: "SAFE_THROW",
    description: "Подходит, когда задача является цепочкой связанных шагов внутри согласованного маршрута.",
    next: "Двигаться по графику до лимита или стоп-условия."
  }
];

const SCENARIO_PACKS: ScenarioPack[] = [
  {
    id: "managed-result",
    title: "Управляемый результат",
    description: "Быстрый проход от задачи к проверяемому артефакту и приемке.",
    goal: DEFAULT_PRODUCT_TASK.goal,
    expectedArtifact: DEFAULT_PRODUCT_TASK.expectedArtifact,
    sourceContext: DEFAULT_PRODUCT_TASK.sourceContext,
    urgency: "G3 Product-Fit"
  },
  {
    id: "document-review",
    title: "Документ и вывод",
    description: "Разбор входящего документа, источники, вывод и контролируемая доработка.",
    goal: "Разобрать входящий материал и подготовить проверяемый вывод для решения.",
    expectedArtifact: "Краткий вывод с источниками, рисками и следующим действием.",
    sourceContext: "Пакет документов и база знаний клиента.",
    urgency: "safe throw document workflow"
  },
  {
    id: "client-delivery",
    title: "Клиентский результат",
    description: "Сценарий для результата, который можно показать заказчику или руководителю.",
    goal: "Подготовить клиентский результат с понятной приемкой и доказательной базой.",
    expectedArtifact: "Клиентский артефакт с паспортом, журналом доказательств и решением.",
    sourceContext: "Коммерческий сценарий, требования заказчика и текущий контекст проекта.",
    urgency: "safe throw client delivery"
  }
];

const ROLE_PACKS: RolePack[] = [
  {
    id: "core-delivery",
    title: "Базовая команда",
    description: "Исполнение, качество, риски и фиксация результата.",
    roles: ["Диспетчер", "Коммерция", "QA", "Риски", "ЛОС"],
    runtimeRoleIds: ["runtime-operator", "commercial-director", "qa-lead", "kontroler-riskov", "sekretar-los"]
  },
  {
    id: "commercial",
    title: "Коммерческий контур",
    description: "Офферы, клиентские сценарии и упаковка результата.",
    roles: ["Коммерция", "Продажи", "Маркетинг", "QA", "Риски", "Архив", "Методолог", "ЛОС"],
    runtimeRoleIds: [
      "runtime-operator",
      "commercial-director",
      "direktor-po-prodazham",
      "direktor-po-marketingu",
      "qa-lead",
      "kontroler-riskov",
      "arhivarius-i-reestrator",
      "metodolog",
      "sekretar-los"
    ]
  },
  {
    id: "evidence",
    title: "Доказательный контур",
    description: "Источники, версии, аудит и приемка.",
    roles: ["QA", "Риски", "Архив", "Методолог", "ЛОС"],
    runtimeRoleIds: [
      "runtime-operator",
      "qa-lead",
      "kontroler-riskov",
      "arhivarius-i-reestrator",
      "metodolog",
      "sekretar-los"
    ]
  }
];

const BUSINESS_MISSIONS: BusinessMissionTemplate[] = [
  {
    id: "proposal-smb",
    title: "Коммерческое предложение",
    category: "Продажи",
    outcome: "Готовый оффер для клиента с аргументами, источниками и следующим шагом.",
    goodFor: "Когда заявка есть, а менеджеру нужно быстро собрать понятное КП.",
    metric: "Время подготовки КП и следующий контакт с клиентом.",
    scenarioPackId: "client-delivery",
    rolePackId: "commercial",
    task: {
      goal: "Подготовить коммерческое предложение по внедрению AI-команды Симбиота для малого или среднего бизнеса.",
      expectedArtifact: "Краткое коммерческое предложение: проблема клиента, решение, состав AI-команды, эффект и следующий шаг.",
      sourceContext: "Demo-источник doc-demo-001 и матрица Just AI reference: SMB-версия AI-агентной платформы без клиентских данных.",
      urgency: "SMB sales mission"
    }
  },
  {
    id: "support-knowledge",
    title: "Ответы клиентам из базы знаний",
    category: "Поддержка",
    outcome: "Черновик ответов на типовые вопросы с опорой на документы и передачей сложных случаев человеку.",
    goodFor: "Когда обращения повторяются, а владелец хочет разгрузить поддержку.",
    metric: "Доля закрытых типовых вопросов и список тем для доработки базы знаний.",
    scenarioPackId: "document-review",
    rolePackId: "evidence",
    task: {
      goal: "Разобрать материалы компании и подготовить набор ответов на типовые вопросы клиентов.",
      expectedArtifact: "FAQ-пакет: вопросы, ответы, источники, спорные места и рекомендации по передаче оператору.",
      sourceContext: "Demo-источник doc-demo-001: имитация базы знаний компании без реальных клиентских данных.",
      urgency: "SMB support mission"
    }
  },
  {
    id: "lead-qualification",
    title: "Квалификация заявки",
    category: "Продажи",
    outcome: "Понятная карточка лида: потребность, срочность, риск, следующий шаг для менеджера.",
    goodFor: "Когда входящих заявок много, а менеджер должен видеть приоритет.",
    metric: "Количество квалифицированных заявок и скорость передачи в продажу.",
    scenarioPackId: "managed-result",
    rolePackId: "commercial",
    task: {
      goal: "Квалифицировать входящую заявку и определить следующий лучший шаг для продажи.",
      expectedArtifact: "Карточка квалификации: потребность, бюджетный сигнал, срочность, возражения, рекомендованный follow-up.",
      sourceContext: "Demo-источник doc-demo-001: пример входящей заявки и контекст продукта.",
      urgency: "SMB lead mission"
    }
  },
  {
    id: "document-summary",
    title: "Разбор документа",
    category: "Документы",
    outcome: "Короткий вывод, риски и список решений для руководителя.",
    goodFor: "Когда надо быстро понять договор, письмо, ТЗ или отчет.",
    metric: "Время до управленческого решения.",
    scenarioPackId: "document-review",
    rolePackId: "evidence",
    task: {
      goal: "Разобрать входящий документ и подготовить управленческий вывод для решения.",
      expectedArtifact: "Вывод по документу: суть, риски, спорные места, источники и следующий шаг.",
      sourceContext: "Demo-источник doc-demo-001: документ для MVP-разбора без реальных персональных данных.",
      urgency: "SMB document mission"
    }
  },
  {
    id: "hr-screening",
    title: "Первичный HR-скрининг",
    category: "HR",
    outcome: "Карточка кандидата с fit-score, вопросами и рекомендацией по следующему этапу.",
    goodFor: "Когда HR нужно быстро отсортировать отклики без сложной ATS.",
    metric: "Скорость первичного отбора и качество вопросов к кандидату.",
    scenarioPackId: "managed-result",
    rolePackId: "core-delivery",
    task: {
      goal: "Провести первичный разбор кандидата и подготовить рекомендацию по следующему шагу.",
      expectedArtifact: "HR-карточка: fit-score, сильные стороны, риски, уточняющие вопросы и решение по следующему этапу.",
      sourceContext: "Demo-источник doc-demo-001: пример профиля кандидата без реальных персональных данных.",
      urgency: "SMB HR mission"
    }
  },
  {
    id: "ops-report",
    title: "Операционный отчет",
    category: "Операции",
    outcome: "Сжатый отчет: что произошло, что блокирует, что делать дальше.",
    goodFor: "Когда руководитель хочет регулярный контроль без ручной сборки сводки.",
    metric: "Количество решений без дополнительного уточнения.",
    scenarioPackId: "managed-result",
    rolePackId: "core-delivery",
    task: {
      goal: "Собрать короткий операционный отчет по текущей ситуации и выделить следующий управленческий шаг.",
      expectedArtifact: "Операционная сводка: статус, факты, блокеры, ответственные и следующий шаг.",
      sourceContext: "Demo-источник doc-demo-001: рабочий контекст компании без реальных операционных данных.",
      urgency: "SMB operations mission"
    }
  }
];

function recommendRolePackId(task: ProductTaskBrief): string {
  const text = `${task.goal} ${task.expectedArtifact} ${task.sourceContext}`.toLowerCase();
  if (
    text.includes("коммер") ||
    text.includes("предлож") ||
    text.includes("продаж") ||
    text.includes("маркет") ||
    text.includes("клиент")
  ) {
    return "commercial";
  }
  if (
    text.includes("источник") ||
    text.includes("доказ") ||
    text.includes("аудит") ||
    text.includes("провер") ||
    text.includes("верси")
  ) {
    return "evidence";
  }
  return "core-delivery";
}

const PRODUCT_CONTROL_BLOCKS = [
  {
    title: "Пользовательский экран",
    progress: 15,
    summary: "Есть рабочий сценарий, но интерфейс еще нужно упростить до ощущения готового продукта.",
    next: "Довести первый экран, результат и действия пользователя."
  },
  {
    title: "Движок выполнения задач",
    progress: 10,
    summary: "TaskRun запускается и возвращает результат, но нет полноценной очереди, повторов и стабильных статусов.",
    next: "Сделать надежное выполнение задачи от входа до результата."
  },
  {
    title: "Роли и рабочие группы",
    progress: 15,
    summary: "Состав команды виден, но роли еще не управляют задачей как полноценные цифровые сотрудники.",
    next: "Связать роли, права, проверки и вклад в результат."
  },
  {
    title: "База знаний и документы",
    progress: 5,
    summary: "Контур загрузки и поиска есть, но работа с реальными документами еще не стала продуктовой.",
    next: "Довести загрузку, OCR, индексацию и поиск по источникам."
  },
  {
    title: "AI-ответы и модели",
    progress: 5,
    summary: "Провайдеры и шлюз заложены, но качество ответов еще не подтверждено на реальных задачах.",
    next: "Подключить реальные модели, eval-наборы и контроль качества ответа."
  },
  {
    title: "Безопасность и доступы",
    progress: 12,
    summary: "Базовые правила доступа начаты, но нужны настоящий вход, роли, ключи и защита данных.",
    next: "Закрыть вход пользователя, tenant isolation, секреты и audit."
  },
  {
    title: "Результаты и доказательства",
    progress: 13,
    summary: "Результат, версия и evidence показываются, но доказательная цепочка еще неполная.",
    next: "Собрать единый центр результата, версии, источники, проверки и действия."
  },
  {
    title: "Администрирование системы",
    progress: 5,
    summary: "Технические контуры есть, но админка для управления системой почти не готова.",
    next: "Сделать управление пользователями, ролями, процессами и настройками."
  },
  {
    title: "Надежность и запуск",
    progress: 3,
    summary: "Локальный запуск работает, но промышленная эксплуатация пока не подготовлена.",
    next: "Добавить мониторинг, бэкапы, логи, миграции и устойчивый запуск."
  },
  {
    title: "Проверка и релиз",
    progress: 5,
    summary: "КСГ ведется, но продукт еще не прошел полный приемочный прогон.",
    next: "Закрывать блоки отчетами, тестами и финальной приемкой."
  }
];

const VIEW_MODES: ViewModeOption[] = [
  {
    id: "user",
    title: "Пользователь",
    description: "Бизнес-сценарий, результат и понятные действия."
  },
  {
    id: "manager",
    title: "Руководитель",
    description: "Прогресс продукта, риски, результат и контроль готовности."
  },
  {
    id: "admin",
    title: "Администратор",
    description: "Роли, доступы, настройки и управление контуром."
  },
  {
    id: "qa",
    title: "QA / разработчик",
    description: "Глубокая техническая проверка, доказательства и служебные журналы."
  }
];

function resolveApiBase(): string {
  if (CONFIGURED_API_BASE) {
    return CONFIGURED_API_BASE;
  }
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "127.0.0.1";
    if (window.location.port === "3020") {
      return `${protocol}//${hostname}:8020`;
    }
    if (window.location.port === "3000") {
      return `${protocol}//${hostname}:8000`;
    }
  }
  return "http://127.0.0.1:8000";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, { headers: AUTH_HEADERS });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path}: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}

async function optionalJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return await getJson<T>(path);
  } catch {
    return fallback;
  }
}

async function postJson<T>(path: string, payload: object, headers = AUTH_HEADERS): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path}: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, payload: object, headers = AUTH_HEADERS): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path}: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}

async function postForm<T>(path: string, payload: FormData, headers = AUTH_HEADERS): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: "POST",
    headers,
    body: payload
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path}: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}

export default function Home() {
  const [processes, setProcesses] = useState<ProcessCard[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("user");
  const [taskRun, setTaskRun] = useState<TaskRun | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactVersions, setArtifactVersions] = useState<ArtifactVersionRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditRetention, setAuditRetention] = useState<AuditRetentionStatus | null>(null);
  const [auditPersistence, setAuditPersistence] = useState<AuditPersistenceStatus | null>(null);
  const [auditExport, setAuditExport] = useState<AuditExportPackage | null>(null);
  const [evidenceAccess, setEvidenceAccess] = useState<EvidenceAccessModelStatus | null>(null);
  const [evidenceAccessDecision, setEvidenceAccessDecision] = useState<EvidenceAccessDecision | null>(null);
  const [evidenceAccessAudit, setEvidenceAccessAudit] = useState<EvidenceAccessAuditVerification | null>(null);
  const [runtimeEvidence, setRuntimeEvidence] = useState<RuntimeEvidence | null>(null);
  const [resultCenter, setResultCenter] = useState<TaskRunResultCenter | null>(null);
  const [queueStatus, setQueueStatus] = useState<TaskRunQueueStatus | null>(null);
  const [workerObservability, setWorkerObservability] = useState<WorkerObservabilityStatus | null>(null);
  const [retryPolicy, setRetryPolicy] = useState<RetryPolicyStatus | null>(null);
  const [workerScheduler, setWorkerScheduler] = useState<WorkerSchedulerStatus | null>(null);
  const [queueAdminAlerts, setQueueAdminAlerts] = useState<QueueAdminAlertCenterStatus | null>(null);
  const [queueAdminRecoveryPlan, setQueueAdminRecoveryPlan] = useState<QueueAdminRecoveryPlanStatus | null>(null);
  const [queueAdminCommandCenter, setQueueAdminCommandCenter] = useState<QueueAdminCommandCenterStatus | null>(null);
  const [incidentLifecycle, setIncidentLifecycle] = useState<IncidentLifecycleStatus | null>(null);
  const [incidentTimeline, setIncidentTimeline] = useState<AdminIncidentTimelineStatus | null>(null);
  const [notificationDelivery, setNotificationDelivery] = useState<NotificationDeliveryStatus | null>(null);
  const [notificationRouting, setNotificationRouting] = useState<NotificationRoutingStatus | null>(null);
  const [notificationPolicyAudit, setNotificationPolicyAudit] = useState<NotificationPolicyAuditStatus | null>(null);
  const [queueRunbook, setQueueRunbook] = useState<QueueOperationsRunbookStatus | null>(null);
  const [queueAdminActionAudit, setQueueAdminActionAudit] = useState<QueueAdminActionAuditStatus | null>(null);
  const [queueManualTriage, setQueueManualTriage] = useState<QueueManualTriageStatus | null>(null);
  const [queueEvidenceReview, setQueueEvidenceReview] = useState<QueueEvidenceReviewStatus | null>(null);
  const [evidenceReviewStatusFilter, setEvidenceReviewStatusFilter] = useState<EvidenceReviewFilterValue>("all");
  const [evidenceReviewSlaFilter, setEvidenceReviewSlaFilter] = useState<EvidenceReviewSlaFilterValue>("all");
  const [evidenceReviewSeverityFilter, setEvidenceReviewSeverityFilter] = useState<EvidenceReviewSeverityFilterValue>("all");
  const [evidenceReviewOwnerFilter, setEvidenceReviewOwnerFilter] = useState("");
  const [evidenceReviewSourceFilter, setEvidenceReviewSourceFilter] = useState("");
  const [evidenceReviewDecisionNote, setEvidenceReviewDecisionNote] = useState("");
  const [evidenceReviewPackage, setEvidenceReviewPackage] = useState<QueueEvidenceReviewPackage | null>(null);
  const [evidenceReviewPackageArchive, setEvidenceReviewPackageArchive] = useState<QueueEvidenceReviewPackageArchiveStatus | null>(null);
  const [evidenceAcceptanceChecklist, setEvidenceAcceptanceChecklist] = useState<QueueEvidenceAcceptanceChecklistStatus | null>(null);
  const [evidenceAcceptanceSummary, setEvidenceAcceptanceSummary] = useState<QueueEvidenceAcceptanceSummaryStatus | null>(null);
  const [evidenceAcceptanceWorklist, setEvidenceAcceptanceWorklist] = useState<QueueEvidenceAcceptanceBlockerWorklistStatus | null>(null);
  const [evidenceAcceptanceCenter, setEvidenceAcceptanceCenter] = useState<QueueEvidenceAcceptanceCenterStatus | null>(null);
  const [evidenceAcceptanceBatchPlan, setEvidenceAcceptanceBatchPlan] = useState<QueueEvidenceAcceptanceBatchPlanStatus | null>(null);
  const [evidenceAcceptanceBatchAction, setEvidenceAcceptanceBatchAction] = useState<QueueEvidenceAcceptanceBatchActionResponse | null>(null);
  const [evidenceAcceptanceBatchItemDecision, setEvidenceAcceptanceBatchItemDecision] = useState<QueueEvidenceAcceptanceBatchItemDecisionResponse | null>(null);
  const [evidenceAcceptanceBatchGroupClosure, setEvidenceAcceptanceBatchGroupClosure] =
    useState<QueueEvidenceAcceptanceBatchGroupClosureStatus | null>(null);
  const [deadLetterQueue, setDeadLetterQueue] = useState<DeadLetterQueueStatus | null>(null);
  const [queueMessage, setQueueMessage] = useState("");
  const [resultActionState, setResultActionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [resultActionMessage, setResultActionMessage] = useState("");
  const [rollbackState, setRollbackState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [rollbackMessage, setRollbackMessage] = useState("");
  const [versionCompare, setVersionCompare] = useState<ArtifactVersionCompareResult | null>(null);
  const [artifactDiffJob, setArtifactDiffJob] = useState<ArtifactDiffJobRecord | null>(null);
  const [versionCompareState, setVersionCompareState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [versionCompareMessage, setVersionCompareMessage] = useState("");
  const [compareActionState, setCompareActionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [compareActionMessage, setCompareActionMessage] = useState("");
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<ArtifactVersionRecord | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [artifactExportDraft, setArtifactExportDraft] = useState<ArtifactExportDraft | null>(null);
  const [artifactEvidencePackage, setArtifactEvidencePackage] = useState<ArtifactEvidencePackage | null>(null);
  const [artifactPackageMessage, setArtifactPackageMessage] = useState("");
  const [reloadTaskRunId, setReloadTaskRunId] = useState("");
  const [reloadState, setReloadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [reloadMessage, setReloadMessage] = useState("");
  const [openedFollowupTaskRunId, setOpenedFollowupTaskRunId] = useState("");
  const [cycleSourceTaskRunId, setCycleSourceTaskRunId] = useState("");
  const [cycleNumber, setCycleNumber] = useState(1);
  const [apiBase, setApiBase] = useState("resolving");
  const [followupBrief, setFollowupBrief] = useState<FollowupBrief>({
    goal: "Сформировать следующий управляемый TaskRun на базе принятого результата.",
    expected_artifact: "Следующий артефакт с evidence и приемкой.",
    source_context: "Result Center: пользователь принял результат и сформировал следующий шаг.",
    urgency: "G3 Product Runtime"
  });
  const [providers, setProviders] = useState<LlmProviderConfig[]>([]);
  const [gateCatalog, setGateCatalog] = useState<QualityGateDefinition[]>([]);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [vectorStatus, setVectorStatus] = useState<VectorIndexStatus | null>(null);
  const [filePolicy, setFilePolicy] = useState<FilePolicyEvidence | null>(null);
  const [uploadRuntime, setUploadRuntime] = useState<UploadRuntimeStatus | null>(null);
  const [ocrWorker, setOcrWorker] = useState<OcrWorkerStatus | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingProviderStatus | null>(null);
  const [dataProtectionStatus, setDataProtectionStatus] = useState<DataProtectionStatus | null>(null);
  const [securitySession, setSecuritySession] = useState<SecuritySession | null>(null);
  const [identityProvider, setIdentityProvider] = useState<IdentityProviderStatus | null>(null);
  const [keycloakBootstrap, setKeycloakBootstrap] = useState<KeycloakBootstrapStatus | null>(null);
  const [keycloakProduction, setKeycloakProduction] = useState<KeycloakProductionReadinessStatus | null>(null);
  const [accessPolicies, setAccessPolicies] = useState<AccessPolicy[]>([]);
  const [policyStoreStatus, setPolicyStoreStatus] = useState<AccessPolicyStoreStatus | null>(null);
  const [policyAudit, setPolicyAudit] = useState<AccessPolicyAuditEvent[]>([]);
  const [policyAuditVerification, setPolicyAuditVerification] = useState<AccessPolicyAuditVerification | null>(null);
  const [roleDirectoryStatus, setRoleDirectoryStatus] = useState<RoleDirectoryStatus | null>(null);
  const [roleDirectoryCoverage, setRoleDirectoryCoverage] = useState<RoleDirectoryCoverage | null>(null);
  const [roleAdminStatus, setRoleAdminStatus] = useState<RoleDirectoryAdminStatus | null>(null);
  const [roleAuditVerification, setRoleAuditVerification] = useState<RoleDirectoryAuditVerification | null>(null);
  const [roleDirectory, setRoleDirectory] = useState<RoleDirectory | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("observer");
  const [roleDraft, setRoleDraft] = useState<RoleEditorDraft | null>(null);
  const [roleEditorState, setRoleEditorState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [roleEditorMessage, setRoleEditorMessage] = useState<string>("");
  const [policyDirectoryValidation, setPolicyDirectoryValidation] =
    useState<AccessPolicyDirectoryValidation | null>(null);
  const [piiEvidence, setPiiEvidence] = useState<PiiClassificationEvidence | null>(null);
  const [approval, setApproval] = useState<HumanApprovalRecord | null>(null);
  const [blockedExport, setBlockedExport] = useState<ExportDecision | null>(null);
  const [approvedExport, setApprovedExport] = useState<ExportDecision | null>(null);
  const [productTask, setProductTask] = useState<ProductTaskBrief>(DEFAULT_PRODUCT_TASK);
  const [selectedBusinessMissionId, setSelectedBusinessMissionId] = useState(BUSINESS_MISSIONS[0].id);
  const [selectedScenarioPackId, setSelectedScenarioPackId] = useState(SCENARIO_PACKS[0].id);
  const [selectedRolePackId, setSelectedRolePackId] = useState(ROLE_PACKS[0].id);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(ROLE_PACKS[0].runtimeRoleIds);
  const [rolePackOverride, setRolePackOverride] = useState(false);
  const [scenarioRestoreMessage, setScenarioRestoreMessage] = useState("");
  const [artifactEditorDraft, setArtifactEditorDraft] = useState<ArtifactEditorDraft | null>(null);
  const [artifactEditorSavedDraft, setArtifactEditorSavedDraft] = useState<ArtifactEditorDraft | null>(null);
  const [artifactEditorStatus, setArtifactEditorStatus] = useState<"draft" | "saved">("draft");
  const [nextStepReviewConfirmed, setNextStepReviewConfirmed] = useState(false);
  const [nextStepReviewSnapshot, setNextStepReviewSnapshot] = useState<NextStepReviewSnapshot | null>(null);
  const [acceptanceDecisionRoute, setAcceptanceDecisionRoute] = useState<AcceptanceDecisionRoute>("accept");
  const [acceptanceDecisionState, setAcceptanceDecisionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [acceptanceDecisionMessage, setAcceptanceDecisionMessage] = useState("");
  const [workspacePersistenceState, setWorkspacePersistenceState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [workspacePersistenceMessage, setWorkspacePersistenceMessage] = useState("");
  const [coreUpdateStatus, setCoreUpdateStatus] = useState("Комплект ядра v0.1 подключен");
  const [activeVaultView, setActiveVaultView] = useState<"files" | "search" | "graph" | "evidence" | "updates">("files");
  const [activeVaultTab, setActiveVaultTab] = useState<"mission" | "result" | "evidence" | "updates">("mission");
  const [vaultSearchQuery, setVaultSearchQuery] = useState("");
  const [missionNoteDraft, setMissionNoteDraft] = useState(
    [
      "# Бизнес-миссия",
      "",
      "## Цель",
      DEFAULT_PRODUCT_TASK.goal,
      "",
      "## Ожидаемый результат",
      DEFAULT_PRODUCT_TASK.expectedArtifact,
      "",
      "## Регламент",
      "1. Проверить входные материалы.",
      "2. Подобрать AI-команду.",
      "3. Запустить автоном.",
      "4. Проверить evidence и принять решение.",
      "",
      "## Стоп-условия",
      "- Не обещать production/release без evidence.",
      "- Не повышать readiness без proof."
    ].join("\n")
  );
  const nextStepUsesEditedArtifact = artifactEditorSavedDraft !== null;
  const nextStepBrief = useMemo<FollowupBrief>(() => {
    if (!artifactEditorSavedDraft) {
      return followupBrief;
    }

    return {
      goal: `Продолжить сценарий по сохраненной правке: ${artifactEditorSavedDraft.title}`,
      expected_artifact: `${artifactEditorSavedDraft.title} / следующая рабочая версия`,
      source_context: `Result Center: пользователь сохранил локальную правку. Текст результата: ${artifactEditorSavedDraft.body}`,
      urgency: artifactEditorSavedDraft.next
    };
  }, [artifactEditorSavedDraft, followupBrief]);
  const nextStepSourceLabel = nextStepUsesEditedArtifact ? "по сохраненной правке" : "по версии Симбиота";
  const nextStepPayloadForCreation = useMemo<NextStepReviewSnapshot>(
    () =>
      nextStepReviewSnapshot ?? {
        ...nextStepBrief,
        source_label: nextStepSourceLabel,
        confirmed_at_label: nextStepReviewConfirmed ? "Подтверждено в Product Workbench" : "Ожидает подтверждения"
      },
    [nextStepBrief, nextStepReviewConfirmed, nextStepReviewSnapshot, nextStepSourceLabel]
  );
  const nextStepReviewReadyForCreation = Boolean(
    nextStepReviewConfirmed || resultCenter?.user_workspace_state?.next_step_review?.confirmed
  );
  const nextStepReviewItems = useMemo(
    () => [
      {
        title: "Будет создано",
        value: nextStepBrief.expected_artifact,
        detail: nextStepBrief.goal
      },
      {
        title: "Основа",
        value: nextStepSourceLabel,
        detail: nextStepUsesEditedArtifact
          ? "Следующий запуск возьмет сохраненную пользователем правку."
          : "Следующий запуск пока опирается на версию Симбиота."
      },
      {
        title: "Первое действие",
        value: nextStepBrief.urgency,
        detail: "Это действие попадет в следующий цикл как стартовая инструкция."
      }
    ],
    [nextStepBrief.expected_artifact, nextStepBrief.goal, nextStepBrief.urgency, nextStepSourceLabel, nextStepUsesEditedArtifact]
  );
  useEffect(() => {
    setNextStepReviewConfirmed(false);
    setNextStepReviewSnapshot(null);
  }, [nextStepBrief.expected_artifact, nextStepBrief.goal, nextStepBrief.source_context, nextStepBrief.urgency]);
  const [sourceLink, setSourceLink] = useState("");
  const [sourceIntake, setSourceIntake] = useState<SourceIntakeSummary | null>(null);
  const [sourceIntakeState, setSourceIntakeState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [sourceIntakeMessage, setSourceIntakeMessage] = useState("");
  const [showWorkspacePanel, setShowWorkspacePanel] = useState(false);
  const [taskIntakePreview, setTaskIntakePreview] = useState<TaskIntakePreview | null>(null);
  const [taskIntakeState, setTaskIntakeState] = useState<"waiting" | "checking" | "ready" | "needs_input" | "error">(
    "waiting"
  );
  const [state, setState] = useState<RuntimeState>("loading");
  const [error, setError] = useState<string>("");

  const selectedProcess = useMemo(
    () => processes.find((process) => process.id === selectedProcessId) ?? processes[0],
    [processes, selectedProcessId]
  );
  const activeViewMode = useMemo(
    () => VIEW_MODES.find((mode) => mode.id === viewMode) ?? VIEW_MODES[0],
    [viewMode]
  );
  const showManagerLayer = viewMode === "manager" || viewMode === "admin" || viewMode === "qa";
  const showAdminLayer = viewMode === "admin" || viewMode === "qa";
  const showQaLayer = viewMode === "qa";
  const visibilitySummary =
    viewMode === "user"
      ? ["Миссия", "Рабочая группа", "Центр результата", "Приемка"]
      : viewMode === "manager"
        ? ["Пользовательский сценарий", "Прогресс", "Риски", "Версии и evidence"]
        : viewMode === "admin"
          ? ["Роли", "Доступы", "Настройки", "Политики"]
          : ["Gates", "Evidence", "Audit", "RAG/OCR", "Служебные журналы"];
  const selectedRuntimeRole = useMemo(
    () => roleDirectory?.roles.find((role) => role.runtime_role === selectedRoleId) ?? roleDirectory?.roles[0] ?? null,
    [roleDirectory, selectedRoleId]
  );
  const selectedScenarioPack = useMemo(
    () => SCENARIO_PACKS.find((pack) => pack.id === selectedScenarioPackId) ?? SCENARIO_PACKS[0],
    [selectedScenarioPackId]
  );
  const selectedBusinessMission = useMemo(
    () => BUSINESS_MISSIONS.find((mission) => mission.id === selectedBusinessMissionId) ?? BUSINESS_MISSIONS[0],
    [selectedBusinessMissionId]
  );
  const selectedRolePack = useMemo(
    () => ROLE_PACKS.find((pack) => pack.id === selectedRolePackId) ?? ROLE_PACKS[0],
    [selectedRolePackId]
  );
  const recommendedRolePackId = useMemo(() => recommendRolePackId(productTask), [productTask]);
  const recommendedRolePack = useMemo(
    () => ROLE_PACKS.find((pack) => pack.id === recommendedRolePackId) ?? ROLE_PACKS[0],
    [recommendedRolePackId]
  );
  const roleCandidateIds = useMemo(() => {
    const ids = [
      ...(taskIntakePreview?.recommended_role_ids ?? recommendedRolePack.runtimeRoleIds),
      ...selectedRoleIds,
      "arhivarius-i-reestrator",
      "metodolog",
      "dizayner",
      "dizayner-produkta-i-interfeysov"
    ];
    return [...new Set(ids)].filter((roleId) => roleDirectory?.roles.some((role) => role.runtime_role === roleId) ?? true);
  }, [recommendedRolePack.runtimeRoleIds, roleDirectory, selectedRoleIds, taskIntakePreview]);
  const activeDocumentIds = useMemo(
    () => (sourceIntake?.ready_document_ids.length ? sourceIntake.ready_document_ids : ["doc-demo-001"]),
    [sourceIntake]
  );
  const readySourceItems = useMemo(
    () => (sourceIntake?.items ?? []).filter((item) => item.status === "indexed" || item.status === "ready"),
    [sourceIntake]
  );
  const missionMaterialSummary = useMemo(
    () => ({
      evidence:
        readySourceItems.length > 0
          ? `${readySourceItems.length} материалов готовы к использованию в миссии.`
          : "Demo-источник уже подключен; можно добавить свои материалы для более точного результата.",
      route: `${selectedRolePack.title} получает материалы как контекст для миссии.`,
      result: `На выходе нужен проверяемый результат: ${productTask.expectedArtifact}`
    }),
    [productTask.expectedArtifact, readySourceItems.length, selectedRolePack.title]
  );
  const permissionEntries = useMemo(
    () => Object.entries(roleDirectory?.permission_model.permission_groups ?? {}),
    [roleDirectory]
  );
  const workbenchChecks = useMemo(
    () => [
      {
        title: "Пользовательский вход",
        status: taskIntakePreview?.status === "ready" ? "passed" : "warning",
        detail: taskIntakePreview
          ? `${taskIntakePreview.readiness_score}% · ${taskIntakePreview.next_action}`
          : selectedProcess
            ? `Процесс выбран: ${selectedProcess.name}`
            : "Нужно выбрать процесс из каталога"
      },
      {
        title: "Рабочая группа",
        status: taskIntakePreview?.workgroup.length ? "passed" : "warning",
        detail: taskIntakePreview?.workgroup.length
          ? `${taskIntakePreview.workgroup.length} ролей подобраны для задачи`
          : roleDirectoryStatus?.coverage_ready
            ? `${roleDirectoryStatus.active_roles_total} активных runtime-ролей доступны`
            : "Каталог ролей еще не подтвержден"
      },
      {
        title: "Контроль качества",
        status: gateCatalog.length ? "passed" : "warning",
        detail: gateCatalog.length ? `${gateCatalog.length} gates доступны для проверки` : "Каталог gates не загружен"
      },
      {
        title: "Результат",
        status: artifact ? "passed" : state === "running" ? "warning" : "not_run",
        detail: artifact ? artifact.title : "Появится после запуска сценария"
      }
    ],
    [artifact, gateCatalog.length, roleDirectoryStatus, selectedProcess, state, taskIntakePreview]
  );
  const productFitScore = useMemo(() => {
    const passed = workbenchChecks.filter((check) => check.status === "passed").length;
    return Math.round((passed / workbenchChecks.length) * 100);
  }, [workbenchChecks]);
  const selectedWorkgroup = useMemo(
    () =>
      taskIntakePreview?.workgroup ??
      ([
        roleDirectory?.roles.find((role) => role.runtime_role === "runtime-operator"),
        roleDirectory?.roles.find((role) => role.runtime_role === "qa-lead"),
        roleDirectory?.roles.find((role) => role.runtime_role === "role-admin")
      ].filter(Boolean) as RuntimeRole[]).map((role) => ({
        runtime_role: role.runtime_role,
        display_name: role.display_name,
        symbiot_role_ref: role.symbiot_role_ref,
        department: role.department,
        access_level: role.access_level,
        permissions: role.permissions,
        responsibility: "Ожидает расчета Task Intake Preview.",
        selection_reason: "Fallback preview до ответа backend."
      })),
    [roleDirectory, taskIntakePreview]
  );
  const launchBlocker = useMemo(() => {
    if (state === "running") {
      return "Сценарий уже выполняется.";
    }
    if (!selectedProcess) {
      return "Не загружен каталог процессов.";
    }
    if (taskIntakeState === "checking") {
      return "Проверяется вход задачи.";
    }
    if (taskIntakeState === "error") {
      return "Task Intake Preview не получил ответ от backend.";
    }
    if (taskIntakeState !== "ready") {
      return "Task Intake еще не готов к запуску.";
    }
    return "";
  }, [selectedProcess, state, taskIntakeState]);
  const missionCards = useMemo<MissionCard[]>(
    () => [
      {
        title: "Бизнес-миссия",
        value: selectedBusinessMission.title,
        detail: selectedBusinessMission.outcome
      },
      {
        title: "Задача",
        value: productTask.goal,
        detail: "Проверять формулировку задачи нужно здесь: это главный вход миссии."
      },
      {
        title: "Артефакт",
        value: productTask.expectedArtifact,
        detail: "Итог должен быть проверяемым и пригодным для следующего решения."
      },
      {
        title: "Demo-источник",
        value: "doc-demo-001",
        detail: "На G4 используется только demo-база; реальные клиентские данные не загружаются."
      },
      {
        title: "Сценарий",
        value: selectedProcess?.name ?? "Бизнес-сценарий готовится",
        detail: selectedProcess ? `Выход: ${selectedProcess.expected_output}` : "Сценарий будет выбран из каталога процессов."
      },
      {
        title: "Переход",
        value: taskIntakePreview?.next_action ?? launchBlocker ?? "Система готовит маршрут выполнения.",
        detail: `Готовность входа: ${taskIntakePreview?.readiness_score ?? 0}%`
      }
    ],
    [launchBlocker, productTask, selectedBusinessMission, selectedProcess, taskIntakePreview]
  );
  const missionProgress = useMemo<MissionProgressItem[]>(
    () => [
      {
        title: "Вход",
        status: taskIntakeState === "ready" ? "done" : "active",
        detail: taskIntakePreview ? `${taskIntakePreview.readiness_score}% готовности` : "Система проверяет миссию"
      },
      {
        title: "Команда",
        status: selectedWorkgroup.length ? "done" : taskIntakeState === "ready" ? "active" : "waiting",
        detail: selectedWorkgroup.length ? `${selectedWorkgroup.length} участников` : "Роли будут подобраны"
      },
      {
        title: "Выполнение",
        status: state === "running" ? "active" : taskRun ? "done" : "waiting",
        detail: taskRun ? `Запуск ${taskRun.id}` : "Ожидает запуска"
      },
      {
        title: "Проверка",
        status: artifact ? "done" : state === "running" ? "active" : "waiting",
        detail: artifact ? `${artifact.checks.length} проверок` : "Появится после результата"
      },
      {
        title: "Приемка",
        status: resultCenter?.product_status === "accepted" ? "done" : resultCenter ? "active" : "waiting",
        detail: resultCenter ? resultCenter.product_status : "Ожидает Result Center"
      }
    ],
    [artifact, resultCenter, selectedWorkgroup.length, state, taskIntakePreview, taskIntakeState, taskRun]
  );
  const campaignBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (launchBlocker) {
      blockers.push(launchBlocker);
    }
    if (taskIntakePreview?.missing_fields.length) {
      blockers.push(`Не хватает входных полей: ${taskIntakePreview.missing_fields.join(", ")}`);
    }
    if (resultCenter?.evidence.quality.overall_status === "warning") {
      blockers.push("Качество результата требует внимания перед масштабированием.");
    }
    return blockers;
  }, [launchBlocker, resultCenter, taskIntakePreview]);
  const linkedFollowupTaskRunId = useMemo(() => {
    if (!resultCenter?.action_history.length) {
      return null;
    }
    return (
      [...resultCenter.action_history]
        .reverse()
        .find((record) => record.action_id === "create-next-task" && record.related_task_run_id)?.related_task_run_id ??
      null
    );
  }, [resultCenter]);
  const scenarioResume = resultCenter?.scenario_resume ?? null;
  const followupExecutionWorkspace = resultCenter?.followup_execution_workspace ?? null;
  const currentCycleOutcomeWorkspace = resultCenter?.current_cycle_outcome_workspace ?? null;
  const outcomeNextCycleLauncher = resultCenter?.outcome_next_cycle_launcher ?? null;
  const cycleExecutionBrief = resultCenter?.cycle_execution_brief ?? null;
  const cycleAcceptanceWorkspace = resultCenter?.cycle_acceptance_workspace ?? null;
  const cycleContinuityWorkspace = resultCenter?.cycle_continuity_workspace ?? null;
  const accumulatedBusinessAssetWorkspace = resultCenter?.accumulated_business_asset_workspace ?? null;
  const businessAssetDecisionWorkspace = resultCenter?.business_asset_decision_workspace ?? null;
  const businessAssetRouteOutcomeWorkspace = resultCenter?.business_asset_route_outcome_workspace ?? null;
  const businessAssetManualReviewWorkspace = resultCenter?.business_asset_manual_review_workspace ?? null;
  const businessAssetGAcceptancePackageWorkspace = resultCenter?.business_asset_g_acceptance_package_workspace ?? null;
  const businessAssetGReviewExecutionWorkspace = resultCenter?.business_asset_g_review_execution_workspace ?? null;
  const businessAssetGCheckHandoffWorkspace = resultCenter?.business_asset_g_check_handoff_workspace ?? null;
  const businessAssetGDecisionDraftWorkspace = resultCenter?.business_asset_g_decision_draft_workspace ?? null;
  const businessAssetGDecisionImpactWorkspace = resultCenter?.business_asset_g_decision_impact_workspace ?? null;
  const businessAssetGDecisionReadinessWorkspace = resultCenter?.business_asset_g_decision_readiness_workspace ?? null;
  const businessAssetGDecisionChecklistWorkspace = resultCenter?.business_asset_g_decision_checklist_workspace ?? null;
  const businessAssetGDecisionReviewSummaryWorkspace = resultCenter?.business_asset_g_decision_review_summary_workspace ?? null;
  const followupContinuity = resultCenter?.followup_continuity ?? null;
  const isPersistedFollowupCycleOpen = Boolean(followupContinuity?.is_followup);
  const effectiveCycleSourceTaskRunId = cycleSourceTaskRunId || followupContinuity?.source_task_run_id || "";
  const isFollowupCycleOpen = Boolean(
    (openedFollowupTaskRunId && taskRun?.id === openedFollowupTaskRunId) || isPersistedFollowupCycleOpen
  );
  const persistedCycleNumber = followupContinuity?.cycle_number ?? 1;
  const currentCycleNumber = isFollowupCycleOpen ? Math.max(cycleNumber, persistedCycleNumber, 2) : 1;
  const nextCycleNumber = currentCycleNumber + 1;
  const nextStepReviewStateLabel = linkedFollowupTaskRunId
    ? "создано"
    : nextStepReviewConfirmed
      ? "подтверждено"
      : "проверьте";
  const nextTaskPayloadForAction = outcomeNextCycleLauncher?.is_active && outcomeNextCycleLauncher.selected_route === "continue"
    ? outcomeNextCycleLauncher.launch_payload
    : nextStepPayloadForCreation;
  const userCycleSummary = useMemo<UserCycleSummaryItem[]>(
    () => [
      {
        title: "Основание",
        value: effectiveCycleSourceTaskRunId || "Первый запуск",
        detail: effectiveCycleSourceTaskRunId ? "Следующий запуск создан из принятого результата." : "Миссия идет как первый продуктовый цикл."
      },
      {
        title: "Цель цикла",
        value: productTask.goal,
        detail: productTask.expectedArtifact
      },
      {
        title: "Текущее решение",
        value:
          resultCenter?.product_status === "ready_for_acceptance"
            ? "Принять второй результат"
            : resultCenter?.product_status === "accepted"
              ? "Цикл принят"
              : resultCenter?.product_status ?? "Ожидает результата",
        detail: taskRun ? `Запуск ${taskRun.id}` : "Запуск еще не открыт"
      }
    ],
    [effectiveCycleSourceTaskRunId, productTask.expectedArtifact, productTask.goal, resultCenter, taskRun]
  );
  const confirmedNextStepItems = useMemo<ContinuityPackItem[]>(
    () => [
      {
        title: "Подтверждение",
        value: nextStepReviewSnapshot ? "Пользователь подтвердил" : nextStepReviewConfirmed ? "Подтверждено" : "Требует проверки",
        detail: nextStepPayloadForCreation.confirmed_at_label,
        status: "confirmed"
      },
      {
        title: "Что переносится",
        value: nextStepPayloadForCreation.expected_artifact,
        detail: nextStepPayloadForCreation.goal,
        status: "carried"
      },
      {
        title: "Основа",
        value: nextStepPayloadForCreation.source_label,
        detail: nextStepPayloadForCreation.source_context,
        status: "review"
      },
      {
        title: "Первое действие",
        value: nextStepPayloadForCreation.urgency,
        detail: "Это действие становится стартом следующего цикла.",
        status: "next"
      }
    ],
    [nextStepPayloadForCreation, nextStepReviewConfirmed, nextStepReviewSnapshot]
  );
  const cycleTransferItems = useMemo<ContinuityPackItem[]>(
    () => [
      {
        title: "Из результата",
        value: effectiveCycleSourceTaskRunId || resultCenter?.task_run_id || "первый запуск",
        detail: resultCenter?.artifact?.title ?? productTask.expectedArtifact,
        status: "carried"
      },
      {
        title: "В новый цикл",
        value: linkedFollowupTaskRunId ? `Связан ${linkedFollowupTaskRunId}` : `Цикл ${nextCycleNumber} ожидает создания`,
        detail: isFollowupCycleOpen ? "Новый цикл открыт в рабочем сценарии." : "После создания его можно открыть из этого экрана.",
        status: "cycle"
      },
      {
        title: "Контекст",
        value: productTask.goal,
        detail: productTask.sourceContext,
        status: "review"
      },
      {
        title: "Контроль",
        value: linkedFollowupTaskRunId ? "Преемственность сохранена" : "Нужен create-next-task",
        detail: nextStepReviewConfirmed ? "Следующий шаг подтвержден пользователем." : "Перед созданием нужен review.",
        status: "confirmed"
      }
    ],
    [
      effectiveCycleSourceTaskRunId,
      isFollowupCycleOpen,
      linkedFollowupTaskRunId,
      nextCycleNumber,
      nextStepReviewConfirmed,
      productTask.expectedArtifact,
      productTask.goal,
      productTask.sourceContext,
      resultCenter?.artifact?.title,
      resultCenter?.task_run_id
    ]
  );
  const followupContinuityReviewItems = useMemo<ContinuityPackItem[]>(
    () => [
      {
        title: "Источник",
        value: (followupContinuity?.source_task_run_id ?? effectiveCycleSourceTaskRunId) || "Не связан",
        detail: followupContinuity?.source_artifact_title ?? "Исходный результат определяется Result Center.",
        status: "carried"
      },
      {
        title: "Перенесенная цель",
        value: followupContinuity?.goal ?? productTask.goal,
        detail: followupContinuity?.expected_artifact ?? productTask.expectedArtifact,
        status: "confirmed"
      },
      {
        title: "Почему создан",
        value: followupContinuity?.source_label ?? nextStepPayloadForCreation.source_label,
        detail: followupContinuity?.source_context ?? nextStepPayloadForCreation.source_context,
        status: "review"
      },
      {
        title: "Первое действие",
        value: followupContinuity?.urgency ?? productTask.urgency,
        detail: followupContinuity?.summary ?? "Продолжить сценарий из связанного результата.",
        status: "next"
      }
    ],
    [
      effectiveCycleSourceTaskRunId,
      followupContinuity?.expected_artifact,
      followupContinuity?.goal,
      followupContinuity?.source_artifact_title,
      followupContinuity?.source_context,
      followupContinuity?.source_label,
      followupContinuity?.source_task_run_id,
      followupContinuity?.summary,
      followupContinuity?.urgency,
      nextStepPayloadForCreation.source_context,
      nextStepPayloadForCreation.source_label,
      productTask.expectedArtifact,
      productTask.goal,
      productTask.urgency
    ]
  );
  const followupLineageItems = useMemo<ContinuityPackItem[]>(() => {
    if (!followupContinuity?.is_followup || !followupContinuity.lineage.length) {
      return [];
    }
    const parentItems: ContinuityPackItem[] = followupContinuity.lineage.map((item, index) => ({
      title: `Цикл ${index + 1}`,
      value: item.artifact_title ?? item.task_run_id,
      detail: item.goal ?? item.expected_artifact ?? item.source_label ?? item.task_run_id,
      status: index === followupContinuity.lineage.length - 1 ? "confirmed" : "cycle"
    }));
    return [
      ...parentItems,
      {
        title: `Цикл ${followupContinuity.cycle_number}`,
        value: "Текущий запуск",
        detail: taskRun ? taskRun.id : followupContinuity.summary,
        status: "review"
      }
    ];
  }, [followupContinuity, taskRun]);
  const cycleResultReviewItems = useMemo<ContinuityPackItem[]>(
    () => [
      {
        title: "Проверка результата",
        value:
          resultCenter?.product_status === "accepted"
            ? "Результат принят"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Готов к решению"
              : "Формируется",
        detail: resultCenter?.next_step ?? "После выполнения появится решение по результату.",
        status: "review"
      },
      {
        title: "Связь с подтверждением",
        value: nextStepPayloadForCreation.expected_artifact,
        detail: `Основа: ${nextStepPayloadForCreation.source_label}.`,
        status: "confirmed"
      },
      {
        title: "Бизнес-смысл",
        value: selectedBusinessMission.metric,
        detail: selectedBusinessMission.outcome,
        status: "package"
      },
      {
        title: "Следующее решение",
        value:
          resultCenter?.product_status === "accepted"
            ? `Готовить цикл ${nextCycleNumber}`
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Принять или вернуть"
              : "Дождаться результата",
        detail: nextStepPayloadForCreation.urgency,
        status: "next"
      }
    ],
    [
      nextCycleNumber,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.source_label,
      nextStepPayloadForCreation.urgency,
      resultCenter?.next_step,
      resultCenter?.product_status,
      selectedBusinessMission.metric,
      selectedBusinessMission.outcome
    ]
  );
  const cycleHandoffItems = useMemo<CycleHandoffItem[]>(
    () => [
      {
        title: `Цикл ${Math.max(1, currentCycleNumber - 1)}`,
        value: cycleSourceTaskRunId ? "Принят как основание" : "Первый запуск",
        detail: cycleSourceTaskRunId || "Цепочка началась с выбранной бизнес-миссии.",
        status: "accepted"
      },
      {
        title: `Цикл ${currentCycleNumber}`,
        value:
          resultCenter?.product_status === "accepted"
            ? "Результат принят"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Нужно принять результат"
              : "Результат готовится",
        detail: taskRun ? `Текущий запуск ${taskRun.id}` : productTask.goal,
        status: "current"
      },
      {
        title: `Цикл ${nextCycleNumber}`,
        value: linkedFollowupTaskRunId ? "Следующий запуск создан" : "Следующий шаг появится после решения",
        detail: linkedFollowupTaskRunId ?? nextStepBrief.goal,
        status: "next"
      }
    ],
    [
      currentCycleNumber,
      cycleSourceTaskRunId,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      nextCycleNumber,
      productTask.goal,
      resultCenter?.product_status,
      taskRun
    ]
  );
  const businessValueChainItems = useMemo<BusinessValueChainItem[]>(
    () => [
      {
        title: "Что получено",
        value:
          resultCenter?.product_status === "accepted"
            ? "Принятый бизнес-артефакт"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Результат готов к решению"
              : "Артефакт формируется",
        detail: productTask.expectedArtifact,
        status: "outcome"
      },
      {
        title: "Эффект для бизнеса",
        value: selectedBusinessMission.metric,
        detail: selectedBusinessMission.outcome,
        status: "effect"
      },
      {
        title: "Следующий шаг",
        value:
          resultCenter?.product_status === "accepted" || linkedFollowupTaskRunId
            ? nextStepBrief.goal
            : "Принять или отправить на доработку",
        detail: linkedFollowupTaskRunId
          ? `Следующий запуск ${linkedFollowupTaskRunId}`
          : resultCenter?.next_step ?? nextStepBrief.urgency,
        status: "action"
      },
      {
        title: "Что накапливается",
        value: `Сценарий из ${currentCycleNumber} циклов`,
        detail: "Миссия, материалы, роли, результат и следующее решение складываются в повторяемый SMB-процесс.",
        status: "asset"
      }
    ],
    [
      currentCycleNumber,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      nextStepBrief.urgency,
      productTask.expectedArtifact,
      resultCenter?.next_step,
      resultCenter?.product_status,
      selectedBusinessMission.metric,
      selectedBusinessMission.outcome
    ]
  );
  const scenarioPackageSummaryItems = useMemo<ScenarioPackageSummaryItem[]>(
    () => [
      {
        title: "Пакет сценария",
        value: selectedBusinessMission.title,
        detail: selectedBusinessMission.outcome,
        status: "mission"
      },
      {
        title: "Собрано в пакете",
        value: `${activeDocumentIds.length} материалов · ${selectedWorkgroup.length} ролей`,
        detail: `${selectedRolePack.title}; результат: ${productTask.expectedArtifact}`,
        status: "assets"
      },
      {
        title: "Текущее решение",
        value:
          resultCenter?.product_status === "accepted"
            ? "Результат принят"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Нужно решение пользователя"
              : "Ожидает результата",
        detail: resultCenter?.next_step ?? "После результата появится приемка и следующий шаг.",
        status: "decision"
      },
      {
        title: "Повторяемость",
        value: `Сценарий ${currentCycleNumber}+ циклов`,
        detail: linkedFollowupTaskRunId
          ? `Следующий запуск уже связан: ${linkedFollowupTaskRunId}`
          : `Следующий шаг: ${nextStepBrief.goal}`,
        status: "repeat"
      }
    ],
    [
      activeDocumentIds.length,
      currentCycleNumber,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      productTask.expectedArtifact,
      resultCenter?.next_step,
      resultCenter?.product_status,
      selectedBusinessMission.outcome,
      selectedBusinessMission.title,
      selectedRolePack.title,
      selectedWorkgroup.length
    ]
  );
  const scenarioPackageActionItems = useMemo<ScenarioPackageActionItem[]>(
    () => [
      {
        title: "Проверить пакет",
        value: resultCenter?.artifact?.title ?? productTask.expectedArtifact,
        detail: `Сверить результат, материалы и команду перед решением по циклу ${currentCycleNumber}.`,
        href: "#business-result-detail",
        status: "review"
      },
      {
        title: "Принять решение",
        value:
          resultCenter?.product_status === "accepted"
            ? "Решение уже принято"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Нужно решение"
              : "Ждем результат",
        detail: resultCenter?.next_step ?? "После формирования результата появится действие приемки.",
        href: "#result-decision",
        status: "decide"
      },
      {
        title: "Продолжить цикл",
        value: linkedFollowupTaskRunId ? `Открыть ${linkedFollowupTaskRunId}` : `Подготовить цикл ${nextCycleNumber}`,
        detail: linkedFollowupTaskRunId
          ? "Следующий запуск уже связан с принятым результатом."
          : `Следующий шаг: ${nextStepBrief.goal}`,
        href: "#result-center",
        status: "continue"
      }
    ],
    [
      currentCycleNumber,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      nextCycleNumber,
      productTask.expectedArtifact,
      resultCenter?.artifact?.title,
      resultCenter?.next_step,
      resultCenter?.product_status
    ]
  );
  const secondCycleProgressItems = useMemo<SecondCycleProgressItem[]>(
    () => [
      {
        title: "Решение цикла",
        value:
          resultCenter?.product_status === "accepted"
            ? `Цикл ${currentCycleNumber} принят`
            : resultCenter?.product_status === "ready_for_acceptance"
              ? `Цикл ${currentCycleNumber} на приемке`
              : `Цикл ${currentCycleNumber} выполняется`,
        detail: resultCenter?.next_step ?? "После решения система покажет следующий шаг сценария.",
        status: "accepted"
      },
      {
        title: "Прогресс сценария",
        value: linkedFollowupTaskRunId
          ? `Готов переход к циклу ${nextCycleNumber}`
          : `Цикл ${currentCycleNumber} из ${nextCycleNumber}`,
        detail: "Сценарий идет от миссии к результату, решению и следующему действию.",
        status: "progress"
      },
      {
        title: "Накопленный актив",
        value: `${activeDocumentIds.length} материалов · ${selectedWorkgroup.length} ролей`,
        detail: `В пакете сохраняются миссия, команда, результат и артефакт: ${resultCenter?.artifact?.title ?? productTask.expectedArtifact}`,
        status: "asset"
      },
      {
        title: "Следующий шаг",
        value: linkedFollowupTaskRunId
          ? `Открыть ${linkedFollowupTaskRunId}`
          : resultCenter?.product_status === "accepted"
            ? `Создать цикл ${nextCycleNumber}`
            : "Принять текущий результат",
        detail: linkedFollowupTaskRunId ? nextStepBrief.goal : resultCenter?.next_step ?? nextStepBrief.urgency,
        status: "next"
      }
    ],
    [
      activeDocumentIds.length,
      currentCycleNumber,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      nextStepBrief.urgency,
      nextCycleNumber,
      productTask.expectedArtifact,
      resultCenter?.artifact?.title,
      resultCenter?.next_step,
      resultCenter?.product_status,
      selectedWorkgroup.length
    ]
  );
  const clientResultPackageItems = useMemo<ClientResultPackageItem[]>(
    () => [
      {
        title: "Краткий итог",
        value:
          resultCenter?.product_status === "accepted"
            ? "Пакет готов к передаче"
            : resultCenter?.product_status === "ready_for_acceptance"
              ? "Пакет ждет решения"
              : "Пакет собирается",
        detail: resultCenter?.artifact?.title ?? productTask.expectedArtifact,
        status: "summary"
      },
      {
        title: "Польза для бизнеса",
        value: selectedBusinessMission.metric,
        detail: selectedBusinessMission.outcome,
        status: "value"
      },
      {
        title: "Опора пакета",
        value: `${activeDocumentIds.length} материалов · ${selectedWorkgroup.length} ролей`,
        detail: `Миссия: ${selectedBusinessMission.title}. Основание: ${cycleSourceTaskRunId || "первый запуск"}.`,
        status: "proof"
      },
      {
        title: "Следующий контакт",
        value: linkedFollowupTaskRunId
          ? `Связан ${linkedFollowupTaskRunId}`
          : resultCenter?.product_status === "accepted"
            ? `Цикл ${nextCycleNumber} можно создать`
            : "Сначала принять результат",
        detail: resultCenter?.next_step ?? nextStepBrief.goal,
        status: "handoff"
      }
    ],
    [
      activeDocumentIds.length,
      cycleSourceTaskRunId,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      nextCycleNumber,
      productTask.expectedArtifact,
      resultCenter?.artifact?.title,
      resultCenter?.next_step,
      resultCenter?.product_status,
      selectedBusinessMission.metric,
      selectedBusinessMission.outcome,
      selectedBusinessMission.title,
      selectedWorkgroup.length
    ]
  );
  const artifactComposerDraft = useMemo<ArtifactComposerDraft>(() => {
    const artifactTitle = resultCenter?.artifact?.title ?? productTask.expectedArtifact;
    const proofBasis = `${activeDocumentIds.length} материалов, ${selectedWorkgroup.length} ролей, источник ${cycleSourceTaskRunId || "первый запуск"}`;
    const readySignal =
      resultCenter?.product_status === "accepted"
        ? "готов к передаче"
        : resultCenter?.product_status === "ready_for_acceptance"
          ? "ждет решения"
          : "собирается";
    const commonChecklist = [
      "Сверить смысл с миссией",
      "Проверить источники и роли",
      resultCenter?.product_status === "accepted" ? "Передать в следующий шаг" : "Принять результат"
    ];

    if (selectedBusinessMission.id === "support-knowledge") {
      return {
        title: "Черновик FAQ-пакета",
        body: `Подготовлен набор ответов для типовых обращений: что отвечает AI-команда, где нужен оператор и какие темы требуют доработки базы знаний. Статус: ${readySignal}.`,
        proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
        next: "Передать типовые ответы в поддержку и вынести спорные вопросы в ручную линию.",
        checklist: ["Ответы понятны клиенту", "Сложные случаи отмечены", ...commonChecklist]
      };
    }

    if (selectedBusinessMission.id === "lead-qualification") {
      return {
        title: "Черновик карточки лида",
        body: `Лид разложен по потребности, срочности, риску и следующему контакту. Менеджер видит, стоит ли продолжать продажу и с каким аргументом. Статус: ${readySignal}.`,
        proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
        next: "Передать менеджеру следующий контакт и причину приоритета.",
        checklist: ["Потребность названа", "Следующий контакт ясен", ...commonChecklist]
      };
    }

    if (selectedBusinessMission.id === "document-summary") {
      return {
        title: "Черновик управленческого вывода",
        body: `Документ превращен в короткий вывод: суть, риски, спорные места и решение, которое должен принять руководитель. Статус: ${readySignal}.`,
        proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
        next: "Передать руководителю вывод и список мест, требующих ручной проверки.",
        checklist: ["Суть документа выделена", "Риски названы", ...commonChecklist]
      };
    }

    if (selectedBusinessMission.id === "hr-screening") {
      return {
        title: "Черновик HR-карточки",
        body: `Кандидат представлен через fit-score, сильные стороны, риски и вопросы для следующего интервью. Статус: ${readySignal}.`,
        proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
        next: "Передать HR рекомендацию по следующему этапу и вопросы для уточнения.",
        checklist: ["Fit-score объяснен", "Вопросы к кандидату готовы", ...commonChecklist]
      };
    }

    if (selectedBusinessMission.id === "ops-report") {
      return {
        title: "Черновик операционной сводки",
        body: `Ситуация собрана в управленческий отчет: статус, факты, блокеры, ответственные и следующий шаг. Статус: ${readySignal}.`,
        proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
        next: "Передать руководителю сводку и действие, которое снимает главный блокер.",
        checklist: ["Статус ясен", "Блокер и ответственный названы", ...commonChecklist]
      };
    }

    return {
      title: "Черновик коммерческого предложения",
      body: `КП собрано вокруг проблемы клиента, решения через AI-команду, ожидаемого эффекта и следующего контакта. Статус: ${readySignal}.`,
      proof: `Основание: ${proofBasis}. Артефакт: ${artifactTitle}.`,
      next: "Передать клиенту оффер и предложить следующий короткий созвон по внедрению.",
      checklist: ["Проблема клиента названа", "Эффект и следующий контакт ясны", ...commonChecklist]
    };
  }, [
    activeDocumentIds.length,
    cycleSourceTaskRunId,
    productTask.expectedArtifact,
    resultCenter?.artifact?.title,
    resultCenter?.product_status,
    selectedBusinessMission.id,
    selectedWorkgroup.length
  ]);
  const artifactComposerGeneratedEditorValue = useMemo<ArtifactEditorDraft>(
    () => ({
      title: artifactComposerDraft.title,
      body: artifactComposerDraft.body,
      next: artifactComposerDraft.next
    }),
    [artifactComposerDraft.body, artifactComposerDraft.next, artifactComposerDraft.title]
  );
  const artifactComposerEditorValue = artifactEditorDraft ?? artifactComposerGeneratedEditorValue;
  const artifactEditorBaseline = artifactEditorSavedDraft ?? artifactComposerGeneratedEditorValue;
  const artifactEditorHasUnsavedChanges =
    artifactComposerEditorValue.title !== artifactEditorBaseline.title ||
    artifactComposerEditorValue.body !== artifactEditorBaseline.body ||
    artifactComposerEditorValue.next !== artifactEditorBaseline.next;
  const artifactEditorIsCustom =
    artifactEditorSavedDraft !== null ||
    artifactComposerEditorValue.title !== artifactComposerGeneratedEditorValue.title ||
    artifactComposerEditorValue.body !== artifactComposerGeneratedEditorValue.body ||
    artifactComposerEditorValue.next !== artifactComposerGeneratedEditorValue.next;
  const artifactEditorStatusLabel =
    artifactEditorStatus === "saved" && !artifactEditorHasUnsavedChanges
      ? "Правка сохранена локально"
      : artifactEditorHasUnsavedChanges
        ? "Есть несохраненная правка"
        : "Версия Симбиота";
  const cycleCompletionPackageItems = useMemo<ContinuityPackItem[]>(
    () => [
      {
        title: "Рабочий результат",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail: artifactComposerEditorValue.body || artifactComposerDraft.body,
        status: "package"
      },
      {
        title: "Готовность пакета",
        value: resultCenter?.product_status === "accepted" ? "Можно передавать" : "Нужно решение",
        detail: artifactComposerDraft.proof,
        status: "review"
      },
      {
        title: "Продолжение",
        value: linkedFollowupTaskRunId ? `Открыт путь к ${linkedFollowupTaskRunId}` : nextStepPayloadForCreation.goal,
        detail: nextStepPayloadForCreation.urgency,
        status: "next"
      },
      {
        title: "Что видит SMB",
        value: "Один непрерывный сценарий",
        detail: "Миссия, результат, правка, подтверждение, следующий цикл и новый пакет не выглядят разрозненными экранами.",
        status: "confirmed"
      }
    ],
    [
      artifactComposerDraft.body,
      artifactComposerDraft.proof,
      artifactComposerDraft.title,
      artifactComposerEditorValue.body,
      artifactComposerEditorValue.title,
      linkedFollowupTaskRunId,
      nextStepPayloadForCreation.goal,
      nextStepPayloadForCreation.urgency,
      resultCenter?.product_status
    ]
  );
  const resultDeliveryWorkspaceItems = useMemo<ResultDeliveryWorkspaceItem[]>(
    () => [
      {
        title: "Финальный артефакт",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail: artifactComposerEditorValue.body || artifactComposerDraft.body,
        status: "artifact"
      },
      {
        title: "Что сделать сейчас",
        value: artifactComposerEditorValue.next || artifactComposerDraft.next,
        detail:
          resultCenter?.product_status === "accepted"
            ? "Действие можно выполнять по принятому результату."
            : "Перед выполнением нужно принять результат или вернуть его на доработку.",
        status: "action"
      },
      {
        title: "Как повторить",
        value: selectedBusinessMission.title,
        detail: `${selectedRolePack.title}; материалы ${activeDocumentIds.length}; сценарий можно повторить как шаблон SMB-задачи.`,
        status: "reuse"
      },
      {
        title: "Передача человеку",
        value: resultCenter?.product_status === "accepted" ? "Готово для ручной передачи" : "Ждет решения",
        detail: `Кратко: ${selectedBusinessMission.outcome}. Следующий контакт: ${nextStepPayloadForCreation.urgency}.`,
        status: "handoff"
      }
    ],
    [
      activeDocumentIds.length,
      artifactComposerDraft.body,
      artifactComposerDraft.next,
      artifactComposerDraft.title,
      artifactComposerEditorValue.body,
      artifactComposerEditorValue.next,
      artifactComposerEditorValue.title,
      nextStepPayloadForCreation.urgency,
      resultCenter?.product_status,
      selectedBusinessMission.outcome,
      selectedBusinessMission.title,
      selectedRolePack.title
    ]
  );
  const resultDeliveryActionItems = useMemo<ResultDeliveryWorkspaceItem[]>(
    () => [
      {
        title: "Проверить смысл",
        value: selectedBusinessMission.metric,
        detail: "Сверить, что результат отвечает бизнес-цели миссии, а не только формально завершен.",
        status: "quality"
      },
      {
        title: "Зафиксировать правку",
        value: artifactEditorSavedDraft ? "Правка сохранена" : artifactEditorHasUnsavedChanges ? "Есть несохраненная правка" : "Можно оставить версию Симбиота",
        detail: artifactEditorSavedDraft
          ? "Следующий рабочий пакет использует сохраненную пользовательскую версию."
          : "При необходимости пользователь может поправить артефакт перед следующей итерацией.",
        status: "artifact"
      },
      {
        title: "Запустить повтор",
        value: linkedFollowupTaskRunId ? `Открыть ${linkedFollowupTaskRunId}` : "Создать следующий запуск",
        detail: nextStepReviewConfirmed ? "Следующий шаг подтвержден." : "Перед продолжением нужен review следующего шага.",
        status: "next"
      },
      {
        title: "Собрать handoff",
        value: "Локальный текст готов",
        detail: "Это черновик передачи внутри экрана: без внешней отправки, экспорта и интеграций.",
        status: "handoff"
      }
    ],
    [
      artifactEditorHasUnsavedChanges,
      artifactEditorSavedDraft,
      linkedFollowupTaskRunId,
      nextStepReviewConfirmed,
      selectedBusinessMission.metric
    ]
  );
  const resultDeliveryHandoffText = useMemo(
    () =>
      [
        `Итог: ${artifactComposerEditorValue.title || artifactComposerDraft.title}.`,
        `Польза: ${selectedBusinessMission.outcome}.`,
        `Основа: ${nextStepPayloadForCreation.source_label}.`,
        `Следующее действие: ${artifactComposerEditorValue.next || artifactComposerDraft.next}.`,
        `Повторение: ${selectedRolePack.title}, ${activeDocumentIds.length} материалов.`
      ].join(" "),
    [
      activeDocumentIds.length,
      artifactComposerDraft.next,
      artifactComposerDraft.title,
      artifactComposerEditorValue.next,
      artifactComposerEditorValue.title,
      nextStepPayloadForCreation.source_label,
      selectedBusinessMission.outcome,
      selectedRolePack.title
    ]
  );
  const guidedRepeatRunStatusLabel = linkedFollowupTaskRunId
    ? "запуск создан"
    : nextStepReviewConfirmed
      ? "готов к созданию"
      : "нужен review";
  const guidedRepeatRunReadinessItems = useMemo<GuidedRepeatRunWorkspaceItem[]>(
    () => [
      {
        title: "Источник повтора",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail: nextStepPayloadForCreation.source_context,
        status: "source"
      },
      {
        title: "Готовность запуска",
        value: guidedRepeatRunStatusLabel,
        detail: linkedFollowupTaskRunId
          ? `Связанный TaskRun ${linkedFollowupTaskRunId} уже создан.`
          : nextStepReviewConfirmed
            ? "Review следующего шага подтвержден; можно создавать следующий запуск через основное действие."
            : "Перед созданием повторного запуска нужно подтвердить следующий шаг.",
        status: "ready"
      },
      {
        title: "Шаблон миссии",
        value: selectedBusinessMission.title,
        detail: `${selectedScenarioPack.title}; ${selectedRolePack.title}; ${activeDocumentIds.length} материалов.`,
        status: "payload"
      },
      {
        title: "Контроль повторяемости",
        value: `Цикл ${currentCycleNumber} -> ${nextCycleNumber}`,
        detail: linkedFollowupTaskRunId
          ? "Повтор уже связан с текущим результатом и готов к открытию."
          : "Повтор использует тот же бизнес-сценарий, сохраненный артефакт и подтвержденный next-step brief.",
        status: "cycle"
      }
    ],
    [
      activeDocumentIds.length,
      artifactComposerDraft.title,
      artifactComposerEditorValue.title,
      currentCycleNumber,
      guidedRepeatRunStatusLabel,
      linkedFollowupTaskRunId,
      nextCycleNumber,
      nextStepPayloadForCreation.source_context,
      nextStepReviewConfirmed,
      selectedBusinessMission.title,
      selectedRolePack.title,
      selectedScenarioPack.title
    ]
  );
  const guidedRepeatRunPreviewItems = useMemo<GuidedRepeatRunWorkspaceItem[]>(
    () => [
      {
        title: "Новый запуск",
        value: nextStepPayloadForCreation.expected_artifact,
        detail: nextStepPayloadForCreation.goal,
        status: "payload"
      },
      {
        title: "Стартовая инструкция",
        value: nextStepPayloadForCreation.urgency,
        detail: "Это действие станет первым рабочим шагом следующего цикла.",
        status: "control"
      },
      {
        title: "Основа",
        value: nextStepPayloadForCreation.source_label,
        detail: nextStepUsesEditedArtifact
          ? "Повтор строится на сохраненной пользовательской правке."
          : "Повтор строится на версии Симбиота до пользовательской правки.",
        status: "source"
      },
      {
        title: "Передача в цикл",
        value: linkedFollowupTaskRunId ? "Открыть следующий запуск" : nextStepReviewConfirmed ? "Создать следующий запуск" : "Подтвердить следующий шаг",
        detail: linkedFollowupTaskRunId
          ? `${linkedFollowupTaskRunId} готов к открытию в основном continuation-блоке.`
          : "Внешняя отправка и экспорт не используются; повтор остается внутри пользовательского сценария.",
        status: "handoff"
      }
    ],
    [
      linkedFollowupTaskRunId,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.goal,
      nextStepPayloadForCreation.source_label,
      nextStepPayloadForCreation.urgency,
      nextStepReviewConfirmed,
      nextStepUsesEditedArtifact
    ]
  );
  const guidedRepeatRunSummaryText = useMemo(
    () =>
      [
        `Повтор: ${nextStepPayloadForCreation.expected_artifact}.`,
        `Источник: ${nextStepPayloadForCreation.source_label}.`,
        `Миссия: ${selectedBusinessMission.title}.`,
        `Роли: ${selectedRolePack.title}.`,
        `Статус: ${guidedRepeatRunStatusLabel}.`
      ].join(" "),
    [
      guidedRepeatRunStatusLabel,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.source_label,
      selectedBusinessMission.title,
      selectedRolePack.title
    ]
  );
  const repeatRunExecutionPlanItems = useMemo<RepeatRunExecutionBoardItem[]>(
    () => [
      {
        title: "Вход запуска",
        value: nextStepPayloadForCreation.expected_artifact,
        detail: `${nextStepPayloadForCreation.source_label}; ${activeDocumentIds.length} материалов; ${selectedBusinessMission.title}.`,
        status: "input"
      },
      {
        title: "AI-команда",
        value: selectedRolePack.title,
        detail: selectedRolePack.description,
        status: "team"
      },
      {
        title: "Рабочий ход",
        value: nextStepPayloadForCreation.urgency,
        detail: "Симбиот начинает следующий цикл с подтвержденного действия и сохраняет связь с результатом предыдущего цикла.",
        status: "execution"
      },
      {
        title: "Приемка результата",
        value: `Цикл ${nextCycleNumber}`,
        detail: "Новый результат снова попадет в Result Center: проверить, принять, поправить и продолжить.",
        status: "acceptance"
      }
    ],
    [
      activeDocumentIds.length,
      nextCycleNumber,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.source_label,
      nextStepPayloadForCreation.urgency,
      selectedBusinessMission.title,
      selectedRolePack.description,
      selectedRolePack.title
    ]
  );
  const repeatRunExecutionControlItems = useMemo<RepeatRunExecutionBoardItem[]>(
    () => [
      {
        title: "Готовность входа",
        value: linkedFollowupTaskRunId ? "Связанный запуск создан" : nextStepReviewConfirmed ? "Можно создать запуск" : "Нужен review",
        detail: linkedFollowupTaskRunId
          ? `${linkedFollowupTaskRunId} ожидает открытия пользователем.`
          : "Вход считается готовым после подтверждения next-step review.",
        status: "ready"
      },
      {
        title: "Что контролировать",
        value: selectedBusinessMission.metric,
        detail: "Повторный цикл должен улучшать бизнес-метрику миссии, а не просто создавать еще один текст.",
        status: "control"
      },
      {
        title: "Когда остановиться",
        value: resultCenter?.product_status === "accepted" ? "После приемки нового результата" : "После текущей приемки",
        detail: "Стоп-точка остается пользовательской: принять результат или вернуть его на доработку.",
        status: "stop"
      },
      {
        title: "Что получит пользователь",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail: "Повтор создает следующий рабочий артефакт и сохраняет цепочку решений внутри сценария.",
        status: "outcome"
      }
    ],
    [
      artifactComposerDraft.title,
      artifactComposerEditorValue.title,
      linkedFollowupTaskRunId,
      nextStepReviewConfirmed,
      resultCenter?.product_status,
      selectedBusinessMission.metric
    ]
  );
  const repeatRunExecutionSummaryText = useMemo(
    () =>
      [
        `План: ${nextStepPayloadForCreation.expected_artifact}.`,
        `Команда: ${selectedRolePack.title}.`,
        `Первое действие: ${nextStepPayloadForCreation.urgency}.`,
        `Контроль: ${selectedBusinessMission.metric}.`,
        `Статус: ${guidedRepeatRunStatusLabel}.`
      ].join(" "),
    [
      guidedRepeatRunStatusLabel,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.urgency,
      selectedBusinessMission.metric,
      selectedRolePack.title
    ]
  );
  const repeatRunAcceptanceCriteriaItems = useMemo<RepeatRunAcceptanceBoardItem[]>(
    () => [
      {
        title: "Критерий приемки",
        value: selectedBusinessMission.metric,
        detail: "Результат повторного цикла принимается, если он двигает бизнес-метрику миссии, а не просто закрывает технический шаг.",
        status: "criteria"
      },
      {
        title: "Сигнал готовности",
        value: resultCenter?.product_status === "accepted" ? "Текущий результат принят" : "Текущий результат на решении",
        detail: linkedFollowupTaskRunId
          ? "Следующий запуск создан; его результат нужно будет принять в Result Center."
          : "Перед приемкой повторного цикла нужно создать или открыть следующий запуск.",
        status: "signal"
      },
      {
        title: "Решение пользователя",
        value: "Принять / поправить / продолжить",
        detail: "Пользователь должен видеть три понятных исхода: принять результат, поправить артефакт или запустить следующий цикл.",
        status: "decision"
      },
      {
        title: "Стоп-точка",
        value: `Цикл ${nextCycleNumber}`,
        detail: "Ближайшая реальная остановка - приемка результата следующего цикла, без ухода в production или внешние интеграции.",
        status: "stop"
      }
    ],
    [linkedFollowupTaskRunId, nextCycleNumber, resultCenter?.product_status, selectedBusinessMission.metric]
  );
  const repeatRunAcceptanceOutcomeItems = useMemo<RepeatRunAcceptanceBoardItem[]>(
    () => [
      {
        title: "Накопленный актив",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail: "После приемки повторного цикла актив должен стать частью сценарного пакета и клиентского результата.",
        status: "asset"
      },
      {
        title: "Следующее решение",
        value: nextStepPayloadForCreation.expected_artifact,
        detail: nextStepPayloadForCreation.goal,
        status: "next"
      },
      {
        title: "Риск цикла",
        value: nextStepReviewConfirmed ? "Риск снижен" : "Нужен review",
        detail: nextStepReviewConfirmed
          ? "Следующий шаг подтвержден пользователем до создания запуска."
          : "Без review пользователь может не понять, почему создается следующий цикл.",
        status: "risk"
      },
      {
        title: "Готовность к проверке",
        value: linkedFollowupTaskRunId ? "Открыть запуск" : "Создать запуск",
        detail: "Приемка остается ручной пользовательской точкой внутри MVP.",
        status: "ready"
      }
    ],
    [
      artifactComposerDraft.title,
      artifactComposerEditorValue.title,
      linkedFollowupTaskRunId,
      nextStepPayloadForCreation.expected_artifact,
      nextStepPayloadForCreation.goal,
      nextStepReviewConfirmed
    ]
  );
  const repeatRunAcceptanceSummaryText = useMemo(
    () =>
      [
        `Приемка: ${selectedBusinessMission.metric}.`,
        `Актив: ${artifactComposerEditorValue.title || artifactComposerDraft.title}.`,
        `Следующее решение: ${nextStepPayloadForCreation.expected_artifact}.`,
        `Стоп: приемка цикла ${nextCycleNumber}.`
      ].join(" "),
    [
      artifactComposerDraft.title,
      artifactComposerEditorValue.title,
      nextCycleNumber,
      nextStepPayloadForCreation.expected_artifact,
      selectedBusinessMission.metric
    ]
  );
  const acceptanceDecisionRoutes = useMemo(
    () => [
      {
        id: "accept" as AcceptanceDecisionRoute,
        title: "Принять",
        badge: "результат годится",
        primary: "Зафиксировать актив",
        detail: "Результат повторного цикла считается полезным и остается базой сценарного пакета.",
        status: "accept" as const
      },
      {
        id: "revise" as AcceptanceDecisionRoute,
        title: "Поправить",
        badge: artifactEditorIsCustom ? "правка уже есть" : "нужна правка",
        primary: "Вернуться к черновику",
        detail: "Пользователь уточняет текст, следующий шаг или формулировку пользы до продолжения цикла.",
        status: "revise" as const
      },
      {
        id: "continue" as AcceptanceDecisionRoute,
        title: "Продолжить",
        badge: linkedFollowupTaskRunId ? "запуск создан" : "готовить цикл",
        primary: linkedFollowupTaskRunId ? `Открыть ${linkedFollowupTaskRunId}` : `Готовить цикл ${nextCycleNumber}`,
        detail: "Сценарий не останавливается на артефакте; пользователь ведет цепочку к следующему бизнес-результату.",
        status: "continue" as const
      }
    ],
    [artifactEditorIsCustom, linkedFollowupTaskRunId, nextCycleNumber]
  );
  const persistedAcceptanceDecisionRoutes = useMemo(
    () =>
      new Map(
        (resultCenter?.acceptance_decision.routes ?? []).map((route) => [
          route.id,
          route
        ])
      ),
    [resultCenter?.acceptance_decision.routes]
  );
  const selectedAcceptanceDecisionRoute = useMemo(
    () =>
      acceptanceDecisionRoutes.find((route) => route.id === acceptanceDecisionRoute) ?? acceptanceDecisionRoutes[0],
    [acceptanceDecisionRoute, acceptanceDecisionRoutes]
  );
  const acceptanceDecisionImpactItems = useMemo<AcceptanceDecisionRouterItem[]>(
    () => [
      {
        title: "Выбранный маршрут",
        value: selectedAcceptanceDecisionRoute.primary,
        detail: selectedAcceptanceDecisionRoute.detail,
        status: selectedAcceptanceDecisionRoute.status
      },
      {
        title: "Что станет активом",
        value: artifactComposerEditorValue.title || artifactComposerDraft.title,
        detail:
          acceptanceDecisionRoute === "revise"
            ? "Актив обновится после локальной правки черновика."
            : "Актив остается основой клиентского пакета и следующего цикла.",
        status: "asset"
      },
      {
        title: "Инструкция человеку",
        value:
          acceptanceDecisionRoute === "accept"
            ? "Можно использовать результат"
            : acceptanceDecisionRoute === "revise"
              ? "Сначала поправить черновик"
              : "Открыть следующий запуск",
        detail:
          acceptanceDecisionRoute === "continue"
            ? nextStepPayloadForCreation.urgency
            : artifactComposerEditorValue.next || artifactComposerDraft.next,
        status: "instruction"
      },
      {
        title: "Следующий цикл",
        value: linkedFollowupTaskRunId ? linkedFollowupTaskRunId : `Цикл ${nextCycleNumber}`,
        detail:
          acceptanceDecisionRoute === "continue"
            ? "Переход к следующему запуску становится главным действием."
            : "Следующий цикл остается подготовленным, но не навязывается пользователю.",
        status: "cycle"
      }
    ],
    [
      acceptanceDecisionRoute,
      artifactComposerDraft.next,
      artifactComposerDraft.title,
      artifactComposerEditorValue.next,
      artifactComposerEditorValue.title,
      linkedFollowupTaskRunId,
      nextCycleNumber,
      nextStepPayloadForCreation.urgency,
      selectedAcceptanceDecisionRoute.detail,
      selectedAcceptanceDecisionRoute.primary,
      selectedAcceptanceDecisionRoute.status
    ]
  );
  const acceptanceDecisionChecklistItems = useMemo<AcceptanceDecisionRouterItem[]>(
    () => [
      {
        title: "Review",
        value: nextStepReviewConfirmed ? "Подтвержден" : "Нужен перед продолжением",
        detail: nextStepPayloadForCreation.confirmed_at_label,
        status: "review"
      },
      {
        title: "Стоп",
        value: acceptanceDecisionRoute === "revise" ? "После правки" : `Приемка цикла ${nextCycleNumber}`,
        detail: "Ближайшая остановка остается внутри пользовательского MVP, без production и внешней отправки.",
        status: "stop"
      },
      {
        title: "Готовность",
        value:
          acceptanceDecisionRoute === "accept"
            ? "Можно зафиксировать"
            : acceptanceDecisionRoute === "revise"
              ? "Открыть редактор"
              : linkedFollowupTaskRunId
                ? "Можно открыть"
                : "Сначала создать запуск",
        detail: "Пользователь видит действие без чтения технических панелей.",
        status: "ready"
      }
    ],
    [
      acceptanceDecisionRoute,
      linkedFollowupTaskRunId,
      nextCycleNumber,
      nextStepPayloadForCreation.confirmed_at_label,
      nextStepReviewConfirmed
    ]
  );
  const acceptanceDecisionSummaryText = useMemo(
    () =>
      [
        `Маршрут: ${selectedAcceptanceDecisionRoute.title}.`,
        `Актив: ${artifactComposerEditorValue.title || artifactComposerDraft.title}.`,
        `Действие: ${selectedAcceptanceDecisionRoute.primary}.`,
        `Метрика: ${selectedBusinessMission.metric}.`
      ].join(" "),
    [
      artifactComposerDraft.title,
      artifactComposerEditorValue.title,
      selectedAcceptanceDecisionRoute.primary,
      selectedAcceptanceDecisionRoute.title,
      selectedBusinessMission.metric
    ]
  );

  async function saveAcceptanceDecisionRoute(route: AcceptanceDecisionRoute) {
    setAcceptanceDecisionRoute(route);
    if (!resultCenter) {
      setAcceptanceDecisionState("saved");
      setAcceptanceDecisionMessage("Маршрут выбран локально до создания результата.");
      return;
    }
    setAcceptanceDecisionState("saving");
    setAcceptanceDecisionMessage("");
    try {
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/acceptance-decision`,
        {
          route,
          comment: acceptanceDecisionSummaryText
        }
      );
      setResultCenter(updated);
      setAcceptanceDecisionRoute(updated.acceptance_decision.selected_route ?? route);
      setAcceptanceDecisionState("saved");
      setAcceptanceDecisionMessage(updated.acceptance_decision.summary);
    } catch (decisionError) {
      setAcceptanceDecisionState("error");
      setAcceptanceDecisionMessage(
        decisionError instanceof Error ? decisionError.message : "Acceptance decision save failed"
      );
    }
  }

  useEffect(() => {
    const persistedRoute = resultCenter?.acceptance_decision.selected_route;
    if (persistedRoute) {
      setAcceptanceDecisionRoute(persistedRoute);
      setAcceptanceDecisionState("saved");
      setAcceptanceDecisionMessage(resultCenter?.acceptance_decision.summary ?? "");
    }
  }, [resultCenter?.acceptance_decision.selected_route, resultCenter?.acceptance_decision.summary]);

  useEffect(() => {
    const workspaceState = resultCenter?.user_workspace_state;
    if (!workspaceState) {
      return;
    }
    const persistedDraft = workspaceState.artifact_draft;
    if (persistedDraft?.status === "saved" && persistedDraft.title && persistedDraft.body && persistedDraft.next) {
      const restoredDraft = {
        title: persistedDraft.title,
        body: persistedDraft.body,
        next: persistedDraft.next
      };
      setArtifactEditorDraft(restoredDraft);
      setArtifactEditorSavedDraft(restoredDraft);
      setArtifactEditorStatus("saved");
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(workspaceState.summary);
    }
    if (persistedDraft?.status === "reset") {
      setArtifactEditorDraft(artifactComposerGeneratedEditorValue);
      setArtifactEditorSavedDraft(null);
      setArtifactEditorStatus("draft");
    }
    const persistedReview = workspaceState.next_step_review;
    if (
      persistedReview?.confirmed &&
      persistedReview.goal &&
      persistedReview.expected_artifact &&
      persistedReview.source_context &&
      persistedReview.urgency &&
      persistedReview.source_label &&
      persistedReview.confirmed_at_label
    ) {
      setNextStepReviewConfirmed(true);
      setNextStepReviewSnapshot({
        goal: persistedReview.goal,
        expected_artifact: persistedReview.expected_artifact,
        source_context: persistedReview.source_context,
        urgency: persistedReview.urgency,
        source_label: persistedReview.source_label,
        confirmed_at_label: persistedReview.confirmed_at_label
      });
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(workspaceState.summary);
    }
  }, [
    artifactComposerGeneratedEditorValue,
    resultCenter?.user_workspace_state,
  ]);

  useEffect(() => {
    setArtifactEditorDraft(artifactComposerGeneratedEditorValue);
    setArtifactEditorSavedDraft(null);
    setArtifactEditorStatus("draft");
    setNextStepReviewConfirmed(false);
    setNextStepReviewSnapshot(null);
    if (!resultCenter?.acceptance_decision.selected_route) {
      setAcceptanceDecisionRoute("accept");
    }
  }, [artifactComposerGeneratedEditorValue, resultCenter?.acceptance_decision.selected_route]);

  function updateArtifactEditorField(field: keyof ArtifactEditorDraft, value: string) {
    setArtifactEditorDraft((current) => ({
      title: current?.title ?? artifactComposerGeneratedEditorValue.title,
      body: current?.body ?? artifactComposerGeneratedEditorValue.body,
      next: current?.next ?? artifactComposerGeneratedEditorValue.next,
      [field]: value
    }));
    setArtifactEditorStatus("draft");
    setNextStepReviewConfirmed(false);
    setNextStepReviewSnapshot(null);
    setAcceptanceDecisionRoute("revise");
  }

  async function saveArtifactEditorDraft() {
    const draftToSave = artifactComposerEditorValue;
    setArtifactEditorDraft(draftToSave);
    setArtifactEditorSavedDraft(draftToSave);
    setArtifactEditorStatus("saved");
    setNextStepReviewConfirmed(false);
    setNextStepReviewSnapshot(null);
    setAcceptanceDecisionRoute("accept");
    if (!resultCenter) {
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage("Правка сохранена локально до создания результата.");
      return;
    }
    setWorkspacePersistenceState("saving");
    setWorkspacePersistenceMessage("");
    try {
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/workspace/artifact-draft`,
        draftToSave
      );
      setResultCenter(updated);
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(
        updated.user_workspace_state?.artifact_draft?.summary ??
          updated.user_workspace_state?.summary ??
          "Правка сохранена."
      );
    } catch (workspaceError) {
      setWorkspacePersistenceState("error");
      setWorkspacePersistenceMessage(
        workspaceError instanceof Error ? workspaceError.message : "Artifact draft persistence failed"
      );
    }
  }

  async function resetArtifactEditorDraft() {
    setArtifactEditorDraft(artifactComposerGeneratedEditorValue);
    setArtifactEditorSavedDraft(null);
    setArtifactEditorStatus("draft");
    setNextStepReviewConfirmed(false);
    setNextStepReviewSnapshot(null);
    setAcceptanceDecisionRoute("revise");
    if (!resultCenter) {
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage("Черновик сброшен локально до создания результата.");
      return;
    }
    setWorkspacePersistenceState("saving");
    setWorkspacePersistenceMessage("");
    try {
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/workspace/artifact-draft/reset`,
        { comment: "Artifact draft reset from Product Workbench MVP." }
      );
      setResultCenter(updated);
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(
        updated.user_workspace_state?.artifact_draft?.summary ??
          updated.user_workspace_state?.summary ??
          "Черновик сброшен."
      );
    } catch (workspaceError) {
      setWorkspacePersistenceState("error");
      setWorkspacePersistenceMessage(
        workspaceError instanceof Error ? workspaceError.message : "Artifact draft reset failed"
      );
    }
  }

  async function confirmNextStepReview() {
    const reviewSnapshot = {
      ...nextStepBrief,
      source_label: nextStepSourceLabel,
      confirmed_at_label: "Подтверждено в Product Workbench"
    };
    setNextStepReviewConfirmed(true);
    setNextStepReviewSnapshot(reviewSnapshot);
    if (!resultCenter) {
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage("Review подтвержден локально до создания результата.");
      return;
    }
    setWorkspacePersistenceState("saving");
    setWorkspacePersistenceMessage("");
    try {
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/workspace/next-step-review`,
        reviewSnapshot
      );
      setResultCenter(updated);
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(
        updated.user_workspace_state?.next_step_review?.summary ??
          updated.user_workspace_state?.summary ??
          "Review подтвержден."
      );
    } catch (workspaceError) {
      setWorkspacePersistenceState("error");
      setWorkspacePersistenceMessage(
        workspaceError instanceof Error ? workspaceError.message : "Next-step review persistence failed"
      );
    }
  }

  async function confirmOutcomeNextCycleLaunchReview() {
    if (!resultCenter || !outcomeNextCycleLauncher) {
      return;
    }
    const reviewSnapshot = {
      ...outcomeNextCycleLauncher.launch_payload,
      confirmed_at_label: `Подтверждено из outcome цикла ${outcomeNextCycleLauncher.cycle_number}`
    };
    setNextStepReviewConfirmed(true);
    setNextStepReviewSnapshot(reviewSnapshot);
    setWorkspacePersistenceState("saving");
    setWorkspacePersistenceMessage("");
    try {
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/workspace/next-step-review`,
        reviewSnapshot
      );
      setResultCenter(updated);
      setWorkspacePersistenceState("saved");
      setWorkspacePersistenceMessage(updated.outcome_next_cycle_launcher.summary);
    } catch (workspaceError) {
      setWorkspacePersistenceState("error");
      setWorkspacePersistenceMessage(
        workspaceError instanceof Error ? workspaceError.message : "Outcome next-cycle launch review failed"
      );
    }
  }
  const launchReadinessItems = useMemo<LaunchReadinessItem[]>(
    () => [
      {
        title: "Миссия",
        status: productTask.goal.trim() ? "done" : "active",
        detail: selectedBusinessMission.title
      },
      {
        title: "Материалы",
        status: activeDocumentIds.length ? "done" : "active",
        detail: activeDocumentIds.length ? `${activeDocumentIds.length} готово` : "Нужен demo-источник или файл"
      },
      {
        title: "AI-команда",
        status: selectedWorkgroup.length ? "done" : "waiting",
        detail: selectedWorkgroup.length ? `${selectedWorkgroup.length} ролей: ${selectedRolePack.title}` : "Система подбирает роли"
      },
      {
        title: "Результат",
        status: productTask.expectedArtifact.trim() ? "done" : "active",
        detail: productTask.expectedArtifact || "Нужно указать ожидаемый артефакт"
      },
      {
        title: "Запуск",
        status: resultCenter || taskRun ? "done" : launchBlocker ? "waiting" : "active",
        detail: resultCenter ? resultCenter.product_status : taskRun ? `TaskRun ${taskRun.id}` : launchBlocker || "Можно запускать"
      }
    ],
    [
      activeDocumentIds.length,
      launchBlocker,
      productTask.expectedArtifact,
      productTask.goal,
      resultCenter,
      selectedBusinessMission.title,
      selectedRolePack.title,
      selectedWorkgroup.length,
      taskRun
    ]
  );
  const userMissionCommand = useMemo<UserMissionCommand>(() => {
    if (linkedFollowupTaskRunId) {
      return {
        title: `Цикл ${nextCycleNumber} создан`,
        detail: `Связанный запуск ${linkedFollowupTaskRunId} готов продолжить цепочку после текущего результата.`,
        actionLabel: `Открыть цикл ${nextCycleNumber}`,
        action: "next"
      };
    }
    if (isFollowupCycleOpen && resultCenter) {
      return {
        title: `Цикл ${currentCycleNumber} открыт`,
        detail: `${productTask.goal} Теперь проверьте результат этого цикла и примите решение.`,
        actionLabel: `Принять результат цикла ${currentCycleNumber}`,
        action: "result"
      };
    }
    if (resultCenter) {
      return {
        title: resultCenter.product_status === "accepted" ? "Результат принят" : "Результат готов к решению",
        detail: resultCenter.next_step,
        actionLabel: "Перейти к приемке",
        action: "result"
      };
    }
    if (!launchBlocker) {
      return {
        title: "Миссию можно запускать",
        detail: taskIntakePreview?.next_action ?? "Вход задачи и рабочая группа готовы для MVP-прогона.",
        actionLabel: artifact ? "Запустить заново" : "Запустить миссию",
        action: "launch"
      };
    }
    return {
      title: "Сначала подготовьте вход",
      detail: launchBlocker,
      actionLabel: "Проверить карточку",
      action: "prepare"
    };
  }, [
    artifact,
    currentCycleNumber,
    isFollowupCycleOpen,
    launchBlocker,
    linkedFollowupTaskRunId,
    nextCycleNumber,
    productTask.goal,
    resultCenter,
    taskIntakePreview
  ]);
  const productStepStates = useMemo(
    () =>
      PRODUCT_STEPS.map((step, index) => {
        if (linkedFollowupTaskRunId) {
          return { step, status: "done" as const };
        }
        if (resultCenter?.product_status === "accepted") {
          return { step, status: index <= 5 ? ("done" as const) : ("waiting" as const) };
        }
        if (resultCenter) {
          return { step, status: index < 4 ? ("done" as const) : index <= 5 ? ("active" as const) : ("waiting" as const) };
        }
        if (artifact) {
          return { step, status: index < 4 ? ("done" as const) : index === 4 ? ("active" as const) : ("waiting" as const) };
        }
        if (state === "running") {
          return { step, status: index < 2 ? ("done" as const) : index === 2 ? ("active" as const) : ("waiting" as const) };
        }
        if (!launchBlocker) {
          return { step, status: index < 2 ? ("done" as const) : index === 2 ? ("active" as const) : ("waiting" as const) };
        }
        return { step, status: index === 0 ? ("active" as const) : ("waiting" as const) };
      }),
    [artifact, launchBlocker, linkedFollowupTaskRunId, resultCenter, state]
  );
  const campaignMap = useMemo<CampaignMapItem[]>(
    () => [
      {
        title: "Вход миссии",
        status: taskIntakeState === "ready" ? "done" : "active",
        detail: taskIntakePreview ? `${taskIntakePreview.readiness_score}% готовности` : "Ожидает проверки входа"
      },
      {
        title: "Команда",
        status: selectedWorkgroup.length ? "done" : "waiting",
        detail: selectedWorkgroup.length ? `${selectedWorkgroup.length} ролей назначено` : "Рабочая группа будет подобрана"
      },
      {
        title: "Исполнение",
        status: state === "running" ? "active" : taskRun ? "done" : "waiting",
        detail: taskRun ? `TaskRun ${taskRun.id}` : "Запуск еще не выполнен"
      },
      {
        title: "Приемка",
        status: resultCenter?.product_status === "accepted" ? "done" : resultCenter ? "active" : "waiting",
        detail: resultCenter?.product_status ?? "Result Center еще не открыт"
      },
      {
        title: "Следующий переход",
        status: linkedFollowupTaskRunId ? "done" : campaignBlockers.length ? "blocked" : resultCenter ? "active" : "waiting",
        detail: linkedFollowupTaskRunId ?? (resultCenter ? nextStepBrief.goal : "Появится после результата")
      }
    ],
    [
      campaignBlockers.length,
      linkedFollowupTaskRunId,
      nextStepBrief.goal,
      resultCenter,
      selectedWorkgroup.length,
      state,
      taskIntakePreview,
      taskIntakeState,
      taskRun
    ]
  );
  const currentMaturityIndex = useMemo(() => {
    if (linkedFollowupTaskRunId) {
      return 4;
    }
    if (resultCenter?.product_status === "accepted") {
      return 3;
    }
    if (resultCenter && (resultCenter.artifact ?? artifact)) {
      return 2;
    }
    if (taskIntakeState === "ready" && selectedWorkgroup.length) {
      return 1;
    }
    return 0;
  }, [artifact, linkedFollowupTaskRunId, resultCenter, selectedWorkgroup.length, taskIntakeState]);
  const maturityBlocker =
    currentMaturityIndex >= 4
      ? "Сценарий готов к упаковке в повторяемый пакет."
      : currentMaturityIndex === 3
        ? "Для масштабирования нужен повторяемый пакет сценария и ролей."
        : currentMaturityIndex === 2
          ? "Для монетизации нужно принять результат и оформить следующий шаг."
          : currentMaturityIndex === 1
            ? "Для управляемости нужно запустить TaskRun и получить проверяемый результат."
            : "Для структурирования нужно заполнить вход задачи и подобрать рабочую группу.";
  const executionProfile = useMemo<ExecutionProfile>(() => {
    const normalized = productTask.urgency.toLowerCase();
    if (normalized.includes("gate") || normalized.includes("руч") || normalized.includes("g ")) {
      return EXECUTION_PROFILES[1];
    }
    if (
      normalized.includes("SAFE_THROW") ||
      normalized.includes("g3") ||
      normalized.includes("product") ||
      linkedFollowupTaskRunId ||
      resultCenter
    ) {
      return EXECUTION_PROFILES[2];
    }
    return EXECUTION_PROFILES[0];
  }, [linkedFollowupTaskRunId, productTask.urgency, resultCenter]);
  const resultDecisionCards = useMemo<ResultDecisionCard[]>(() => {
    const actions = resultCenter?.actions ?? [];
    const byId = (id: ResultDecisionCard["id"]) => actions.find((action) => action.id === id) ?? null;
    return [
      {
        id: "accept-result",
        title: "Принять результат",
        description: "Зафиксировать, что артефакт решает миссию и может стать опорой следующего шага.",
        action: byId("accept-result"),
        tone: "accept"
      },
      {
        id: "return-to-revision",
        title: "Вернуть на доработку",
        description: "Отправить результат рабочей группе, если качество, источники или смысл требуют исправления.",
        action: byId("return-to-revision"),
        tone: "revision"
      },
      {
        id: "create-next-task",
        title: "Создать следующую задачу",
        description: "Продолжить цепочку миссии и открыть следующий управляемый TaskRun.",
        action: byId("create-next-task"),
        tone: "next"
      }
    ];
  }, [resultCenter]);
  const createNextTaskAction = resultDecisionCards.find((card) => card.id === "create-next-task")?.action ?? null;
  const userContinuationSteps = useMemo<UserContinuationStep[]>(() => {
    const resultAccepted = resultCenter?.product_status === "accepted" || Boolean(linkedFollowupTaskRunId);
    return [
      {
        title: isFollowupCycleOpen ? `Принять результат цикла ${currentCycleNumber}` : "Принять результат",
        status: resultAccepted ? "done" : resultCenter ? "active" : "waiting",
        detail: resultAccepted ? "Решение зафиксировано" : resultCenter ? "Выберите решение ниже" : "Появится после запуска"
      },
      {
        title: isFollowupCycleOpen ? `Создать цикл ${nextCycleNumber}` : "Создать следующую миссию",
        status: linkedFollowupTaskRunId ? "done" : createNextTaskAction?.status === "available" ? "active" : "waiting",
        detail: linkedFollowupTaskRunId ?? nextStepBrief.goal
      },
      {
        title: isFollowupCycleOpen ? `Открыть цикл ${nextCycleNumber}` : "Открыть следующий запуск",
        status: linkedFollowupTaskRunId ? "active" : "waiting",
        detail: linkedFollowupTaskRunId ? "Готово к продолжению" : "Кнопка появится после создания"
      }
    ];
  }, [
    createNextTaskAction?.status,
    currentCycleNumber,
    isFollowupCycleOpen,
    linkedFollowupTaskRunId,
    nextStepBrief.goal,
    nextCycleNumber,
    resultCenter
  ]);
  const nextCycleOpeningItems = useMemo<NextCycleOpeningItem[]>(() => {
    const sourceRunId = cycleSourceTaskRunId || resultCenter?.task_run_id || taskRun?.id || "Текущий результат";
    const targetRunId = linkedFollowupTaskRunId ?? "Появится после создания";
    const openingAction = linkedFollowupTaskRunId
      ? isFollowupCycleOpen
        ? `Цикл ${currentCycleNumber} открыт`
        : `Открыть цикл ${nextCycleNumber}`
      : resultCenter?.product_status === "accepted"
        ? "Создать следующий запуск"
        : "Сначала принять результат";
    return [
      {
        title: "Основание",
        status: "source",
        value: sourceRunId,
        detail: cycleSourceTaskRunId
          ? "Новый цикл продолжает принятый результат."
          : resultCenter
            ? "Следующий цикл будет создан из текущего результата."
            : "Основание появится после первого результата."
      },
      {
        title: "Новый цикл",
        status: "target",
        value: targetRunId,
        detail: nextStepBrief.goal
      },
      {
        title: "Следующее действие",
        status: "action",
        value: openingAction,
        detail: nextStepBrief.expected_artifact
      }
    ];
  }, [
    currentCycleNumber,
    cycleSourceTaskRunId,
    isFollowupCycleOpen,
    linkedFollowupTaskRunId,
    nextStepBrief.expected_artifact,
    nextStepBrief.goal,
    nextCycleNumber,
    resultCenter,
    taskRun
  ]);
  const artifactForPassport = artifact ?? resultCenter?.artifact;
  const latestArtifactVersion = useMemo(() => {
    if (!artifactForPassport || !artifactVersions.length) {
      return null;
    }
    return (
      [...artifactVersions]
        .reverse()
        .find((version) => version.version === artifactForPassport.version) ?? artifactVersions[artifactVersions.length - 1]
    );
  }, [artifactForPassport, artifactVersions]);
  const artifactFingerprint = latestArtifactVersion?.content_hash
    ? latestArtifactVersion.content_hash.slice(0, 12)
    : artifactForPassport?.id.slice(0, 12) ?? "ожидает";
  const artifactAcceptanceStatus =
    resultCenter?.product_status === "accepted"
      ? "Принят"
      : resultCenter?.product_status === "needs_revision"
        ? "На доработке"
        : resultCenter?.product_status === "ready_for_acceptance"
          ? "Готов к приемке"
          : "Ожидает";
  const artifactQualityStatus =
    resultCenter?.evidence.quality.overall_status === "passed" ? "Проверки пройдены" : "Требует внимания";
  const artifactSourceStatus =
    resultCenter?.evidence.rag.source_coverage === "passed" ? "Источники подтверждены" : "Источники требуют проверки";
  const evidenceJournal = useMemo<EvidenceJournalItem[]>(() => {
    if (!resultCenter) {
      return [];
    }
    const completedStages = resultCenter.timeline.filter((stage) => stage.status === "completed").length;
    const lastAction =
      resultCenter.action_history.length > 0
        ? resultCenter.action_history[resultCenter.action_history.length - 1]
        : null;
    const qualityPassed = resultCenter.evidence.quality.overall_status === "passed";
    const sourcesPassed = resultCenter.evidence.rag.source_coverage === "passed";
    return [
      {
        title: "Задача принята в работу",
        status: "done",
        description: "Симбиот получил цель, ожидаемый артефакт и контекст для выполнения.",
        detail: taskIntakePreview ? `${taskIntakePreview.readiness_score}% готовности входа` : "Входные данные зафиксированы"
      },
      {
        title: "Рабочая группа определена",
        status: selectedWorkgroup.length ? "done" : "waiting",
        description: "Роли подобраны под задачу и связаны с будущим результатом.",
        detail: selectedWorkgroup.length ? `${selectedWorkgroup.length} роли в работе` : "Ожидает подбора ролей"
      },
      {
        title: "Исполнение завершено",
        status: completedStages > 0 ? "done" : "waiting",
        description: "Задача прошла управляемые этапы выполнения до создания результата.",
        detail: `${completedStages}/${resultCenter.timeline.length} этапов завершено`
      },
      {
        title: "Качество и источники проверены",
        status: qualityPassed && sourcesPassed ? "done" : "attention",
        description: "Система проверила качество результата и наличие подтверждающих источников.",
        detail: `${artifactQualityStatus}; ${artifactSourceStatus}`
      },
      {
        title: "Версия результата зафиксирована",
        status: latestArtifactVersion ? "done" : "attention",
        description: "У артефакта есть версия и контрольный отпечаток для последующей проверки.",
        detail: latestArtifactVersion ? `${latestArtifactVersion.version} · ${artifactFingerprint}` : "Ожидает фиксации версии"
      },
      {
        title: "Решение пользователя",
        status: lastAction ? "done" : "waiting",
        description: "Приемка, возврат на доработку или создание следующей задачи фиксируются в истории.",
        detail: lastAction ? `${lastAction.action_id} · ${lastAction.created_at}` : "Решение еще не принято"
      }
    ];
  }, [
    artifactFingerprint,
    artifactQualityStatus,
    artifactSourceStatus,
    latestArtifactVersion,
    resultCenter,
    selectedWorkgroup.length,
    taskIntakePreview
  ]);
  const completedEvidenceCount = evidenceJournal.filter((item) => item.status === "done").length;
  const evidenceTotalCount = evidenceJournal.length;
  const availableResultActions = resultDecisionCards.filter((card) => card.action?.status === "available").length;
  const primaryResultAction =
    resultCenter?.product_status === "accepted"
      ? "Создать или открыть следующую задачу"
      : resultCenter?.product_status === "needs_revision"
        ? "Исправить результат и повторить приемку"
        : "Проверить результат и принять решение";
  const resultOutcomeCards = [
    {
      label: "Состояние",
      value: artifactAcceptanceStatus,
      detail: resultCenter?.product_status === "accepted" ? "Можно переходить к следующей миссии" : "Нужно решение пользователя"
    },
    {
      label: "Проверка",
      value: artifactQualityStatus,
      detail: artifactSourceStatus
    },
    {
      label: "Следующее действие",
      value: primaryResultAction,
      detail: `${availableResultActions} доступных действия`
    }
  ];
  const resultAcceptanceBridge = useMemo<ResultAcceptanceBridgeItem[]>(() => {
    if (!resultCenter) {
      return [];
    }
    const qualityReady = resultCenter.evidence.quality.overall_status === "passed";
    const sourcesReady = resultCenter.evidence.rag.source_coverage === "passed";
    const nextCycleState = linkedFollowupTaskRunId
      ? `Следующий запуск создан: ${linkedFollowupTaskRunId}`
      : resultCenter.product_status === "accepted"
        ? "Можно создать следующий цикл"
        : "Сначала примите текущий результат";
    return [
      {
        title: "Что получилось",
        status: "ready",
        value: artifactForPassport?.title ?? "Результат миссии",
        detail: artifactForPassport?.content ?? resultCenter.next_step
      },
      {
        title: "Почему можно принять",
        status: qualityReady && sourcesReady ? "ready" : "attention",
        value: qualityReady && sourcesReady ? "Проверки и источники готовы" : "Нужно внимание к проверкам",
        detail: `${artifactQualityStatus}; ${artifactSourceStatus}; evidence ${completedEvidenceCount}/${evidenceTotalCount || 0}`
      },
      {
        title: "Что дальше",
        status: "next",
        value: nextCycleState,
        detail: nextStepBrief.goal
      }
    ];
  }, [
    artifactForPassport?.content,
    artifactForPassport?.title,
    artifactQualityStatus,
    artifactSourceStatus,
    completedEvidenceCount,
    evidenceTotalCount,
    linkedFollowupTaskRunId,
    nextStepBrief.goal,
    resultCenter
  ]);
  const roleSelectionAlgorithm = useMemo<RoleSelectionStep[]>(() => {
    const requirements = taskIntakePreview?.requirements ?? [];
    return [
      {
        title: "Задача и ожидаемый результат",
        status: taskIntakePreview?.missing_fields.length ? "attention" : taskIntakePreview ? "ready" : "waiting",
        detail: taskIntakePreview?.missing_fields.length
          ? `Не хватает: ${taskIntakePreview.missing_fields.join(", ")}`
          : nextStepBrief.expected_artifact
      },
      ...requirements.map((requirement) => ({
        title: requirement.title,
        status: requirement.satisfied ? "ready" as const : requirement.required ? "attention" as const : "waiting" as const,
        detail: requirement.satisfied
          ? `Закрывает: ${requirement.matched_role_ids.join(", ")}`
          : requirement.missing_reason ?? "Роль пока не назначена"
      }))
    ];
  }, [nextStepBrief.expected_artifact, taskIntakePreview]);
  const qualityCheckpoints = useMemo<QualityCheckpoint[]>(() => {
    if (!resultCenter) {
      return [
        {
          title: "Результат",
          status: "waiting",
          detail: "Контрольные точки появятся после запуска миссии.",
          action: "Запустить миссию"
        }
      ];
    }
    const gates = resultCenter.acceptance_checklist.length
      ? resultCenter.acceptance_checklist
      : resultCenter.gates;
    return gates.slice(0, 4).map((gate) => ({
      title: gate.title,
      status: gate.status === "not_run" ? "waiting" : gate.status,
      detail: gate.reason,
      action: gate.action ?? (gate.status === "passed" ? "Можно принимать как доказательство" : "Нужно проверить перед приемкой")
    }));
  }, [resultCenter]);
  const toolLoadout = useMemo<ToolLoadoutItem[]>(
    () => [
      {
        title: "Роли",
        status: selectedWorkgroup.length ? "ready" : "waiting",
        detail: selectedRolePack.roles.join(" · ")
      },
      {
        title: "Источники",
        status: artifactForPassport?.sources.length ? "ready" : "partial",
        detail: artifactForPassport?.sources.length ? `${artifactForPassport.sources.length} источника` : "Будут подключены после запуска"
      },
      {
        title: "Проверка качества",
        status: qualityCheckpoints.some((checkpoint) => checkpoint.status === "passed") ? "ready" : "partial",
        detail: `${qualityCheckpoints.filter((checkpoint) => checkpoint.status === "passed").length}/${qualityCheckpoints.length} точек пройдено`
      },
      {
        title: "Доказательства",
        status: evidenceJournal.some((item) => item.status === "done") ? "ready" : "waiting",
        detail: evidenceJournal.length ? `${evidenceJournal.filter((item) => item.status === "done").length}/${evidenceJournal.length} событий` : "Ожидает результата"
      }
    ],
    [artifactForPassport, evidenceJournal, qualityCheckpoints, selectedRolePack.roles, selectedWorkgroup.length]
  );
  const realWorldLinks = useMemo<RealWorldLinkItem[]>(
    () => [
      {
        title: "Рабочий артефакт",
        status: artifactForPassport ? "available" : "pending",
        detail: artifactForPassport
          ? `${artifactForPassport.title} · artifact_id ${artifactForPassport.id}`
          : "Появится после запуска миссии"
      },
      {
        title: "Решение по результату",
        status: resultCenter ? "available" : "pending",
        detail: resultCenter ? "Кнопки приемки находятся в блоке справа от результата" : "Ожидает результата"
      },
      {
        title: "Следующая задача",
        status: linkedFollowupTaskRunId ? "available" : "pending",
        detail: linkedFollowupTaskRunId ?? "Будет создана после действия пользователя"
      }
    ],
    [artifactForPassport, linkedFollowupTaskRunId, resultCenter]
  );

  useEffect(() => {
    setApiBase(resolveApiBase());
  }, []);

  function evidenceReviewWorkbenchPath() {
    const params = new URLSearchParams({ limit: "100" });
    if (evidenceReviewStatusFilter !== "all") params.set("status", evidenceReviewStatusFilter);
    if (evidenceReviewSlaFilter !== "all") params.set("sla_status", evidenceReviewSlaFilter);
    if (evidenceReviewSeverityFilter !== "all") params.set("severity", evidenceReviewSeverityFilter);
    if (evidenceReviewOwnerFilter.trim()) params.set("owner_role", evidenceReviewOwnerFilter.trim());
    if (evidenceReviewSourceFilter.trim()) params.set("source_query", evidenceReviewSourceFilter.trim());
    return `/api/task-runs/queue/evidence-review?${params.toString()}`;
  }

  async function loadEvidenceReviewWorkbench() {
    const evidenceReview = await getJson<QueueEvidenceReviewStatus>(evidenceReviewWorkbenchPath());
    setQueueEvidenceReview(evidenceReview);
    setQueueMessage(
      `Evidence review workbench: ${evidenceReview.items.length} записей в срезе; status ${evidenceReview.status}; overdue ${evidenceReview.overdue}; oldest ${evidenceReview.oldest_open_age_seconds}s`
    );
  }

  async function loadEvidenceReviewWorkbenchDirect(path: string, messagePrefix: string) {
    const evidenceReview = await getJson<QueueEvidenceReviewStatus>(path);
    setQueueEvidenceReview(evidenceReview);
    setQueueMessage(`${messagePrefix}: ${evidenceReview.items.length} записей; pending ${evidenceReview.pending}; rework ${evidenceReview.rework}; overdue ${evidenceReview.overdue}`);
  }

  async function resetEvidenceReviewWorkbench() {
    setEvidenceReviewStatusFilter("all");
    setEvidenceReviewSlaFilter("all");
    setEvidenceReviewSeverityFilter("all");
    setEvidenceReviewOwnerFilter("");
    setEvidenceReviewSourceFilter("");
    const evidenceReview = await getJson<QueueEvidenceReviewStatus>("/api/task-runs/queue/evidence-review?limit=100");
    setQueueEvidenceReview(evidenceReview);
    setQueueMessage(`Evidence review workbench сброшен: ${evidenceReview.items.length} записей, overdue ${evidenceReview.overdue}`);
  }

  async function loadEvidenceReviewPackage() {
    setQueueMessage("Собираю внутренний evidence package для QA/admin...");
    try {
      const packageData = await getJson<QueueEvidenceReviewPackage>("/api/task-runs/queue/evidence-review/package");
      setEvidenceReviewPackage(packageData);
      setQueueMessage(
        `Evidence package собран: ${packageData.id}; hash ${packageData.package_hash.slice(0, 12)}; internal only`
      );
    } catch (packageError) {
      setQueueMessage(packageError instanceof Error ? packageError.message : "Evidence package build failed");
    }
  }

  async function saveEvidenceReviewPackageArchive() {
    setQueueMessage("Сохраняю evidence package в локальную историю...");
    try {
      const entry = await postJson<QueueEvidenceReviewPackageArchiveEntry>(
        "/api/task-runs/queue/evidence-review/package/archive",
        {},
        ADMIN_HEADERS
      );
      const archive = await getJson<QueueEvidenceReviewPackageArchiveStatus>("/api/task-runs/queue/evidence-review/package/archive?limit=8");
      setEvidenceReviewPackageArchive(archive);
      setQueueMessage(`Evidence package сохранен в историю: ${entry.id}; status ${entry.status}; hash ${entry.package_hash.slice(0, 12)}`);
    } catch (archiveError) {
      setQueueMessage(archiveError instanceof Error ? archiveError.message : "Evidence package archive failed");
    }
  }

  async function loadEvidenceReviewPackageArchive() {
    setQueueMessage("Загружаю историю evidence packages...");
    try {
      const archive = await getJson<QueueEvidenceReviewPackageArchiveStatus>("/api/task-runs/queue/evidence-review/package/archive?limit=8");
      setEvidenceReviewPackageArchive(archive);
      setQueueMessage(`История evidence packages: ${archive.entries_total} записей; latest ${archive.latest_entry_id ?? "none"}`);
    } catch (archiveError) {
      setQueueMessage(archiveError instanceof Error ? archiveError.message : "Evidence package archive load failed");
    }
  }

  async function loadEvidenceAcceptanceChecklist() {
    setQueueMessage("Проверяю чек-лист внутренней приемки evidence...");
    try {
      const checklist = await getJson<QueueEvidenceAcceptanceChecklistStatus>("/api/task-runs/queue/evidence-review/acceptance-checklist");
      setEvidenceAcceptanceChecklist(checklist);
      setQueueMessage(
        `Чек-лист приемки: ${checklist.status}; ready ${String(checklist.ready_for_internal_acceptance)}; blockers ${
          checklist.items.filter((item) => item.status === "failed").length
        }`
      );
    } catch (checklistError) {
      setQueueMessage(checklistError instanceof Error ? checklistError.message : "Evidence acceptance checklist failed");
    }
  }

  async function loadEvidenceAcceptanceSummary() {
    setQueueMessage("Собираю краткую сводку приемки evidence...");
    try {
      const summary = await getJson<QueueEvidenceAcceptanceSummaryStatus>("/api/task-runs/queue/evidence-review/acceptance-summary");
      setEvidenceAcceptanceSummary(summary);
      setQueueMessage(
        `Сводка приемки: ${summary.status}; blockers ${summary.blockers_total}; first action ${summary.primary_action_label ?? "none"}`
      );
    } catch (summaryError) {
      setQueueMessage(summaryError instanceof Error ? summaryError.message : "Evidence acceptance summary failed");
    }
  }

  async function loadEvidenceAcceptanceWorklist() {
    setQueueMessage("Собираю рабочий список blockers/warnings...");
    try {
      const worklist = await getJson<QueueEvidenceAcceptanceBlockerWorklistStatus>("/api/task-runs/queue/evidence-review/acceptance-worklist");
      setEvidenceAcceptanceWorklist(worklist);
      setQueueMessage(
        `Worklist приемки: ${worklist.actionable_total} действий; blockers ${worklist.blockers_total}; first ${worklist.first_action_label ?? "none"}`
      );
    } catch (worklistError) {
      setQueueMessage(worklistError instanceof Error ? worklistError.message : "Evidence acceptance worklist failed");
    }
  }

  async function loadEvidenceAcceptanceCenter() {
    setQueueMessage("Собираю единый центр приемки evidence...");
    try {
      const center = await getJson<QueueEvidenceAcceptanceCenterStatus>("/api/task-runs/queue/evidence-review/acceptance-center");
      setEvidenceAcceptanceCenter(center);
      setEvidenceAcceptanceChecklist(center.checklist);
      setEvidenceAcceptanceSummary(center.acceptance_summary);
      setEvidenceAcceptanceWorklist(center.worklist);
      setEvidenceAcceptanceBatchPlan(center.batch_plan);
      setEvidenceAcceptanceBatchGroupClosure(center.first_group_closure ?? null);
      if (center.first_group_closure) {
        setQueueEvidenceReview(center.first_group_closure.review_status);
      }
      setQueueMessage(
        `Центр приемки: ${center.status}; actions ${center.worklist_actions_total}; groups ${center.batch_groups_total}; next ${center.next_review_id ?? "none"}`
      );
    } catch (centerError) {
      setQueueMessage(centerError instanceof Error ? centerError.message : "Evidence acceptance center failed");
    }
  }

  async function loadEvidenceAcceptanceBatchPlan() {
    setQueueMessage("Собираю план группового разбора blockers/warnings...");
    try {
      const batchPlan = await getJson<QueueEvidenceAcceptanceBatchPlanStatus>("/api/task-runs/queue/evidence-review/acceptance-batch-plan");
      setEvidenceAcceptanceBatchPlan(batchPlan);
      setQueueMessage(
        `План разбора: ${batchPlan.groups_total} групп; blockers ${batchPlan.blockers_total}; first ${batchPlan.first_action_label ?? "none"}`
      );
    } catch (batchPlanError) {
      setQueueMessage(batchPlanError instanceof Error ? batchPlanError.message : "Evidence acceptance batch plan failed");
    }
  }

  async function runEvidenceAcceptanceAction(item: QueueEvidenceAcceptanceChecklistItem) {
    if (item.action_kind === "none") {
      setQueueMessage(`${item.title}: действие не требуется; ${item.reason}`);
      return;
    }
    if (item.action_kind === "refresh_package" || item.action_kind === "review_package_gates") {
      await loadEvidenceReviewPackage();
      await loadEvidenceAcceptanceChecklist();
      setQueueMessage(`${item.action_label}: пакет и чек-лист обновлены`);
      return;
    }
    if (item.action_kind === "save_archive") {
      await saveEvidenceReviewPackageArchive();
      await loadEvidenceAcceptanceChecklist();
      setQueueMessage(`${item.action_label}: пакет сохранен, чек-лист обновлен`);
      return;
    }
    if (item.action_kind === "filter_pending") {
      setEvidenceReviewStatusFilter("pending");
      setEvidenceReviewSlaFilter("all");
      setEvidenceReviewSeverityFilter("all");
      setEvidenceReviewOwnerFilter("");
      setEvidenceReviewSourceFilter("");
      await loadEvidenceReviewWorkbenchDirect("/api/task-runs/queue/evidence-review?limit=100&status=pending", item.action_label);
      return;
    }
    if (item.action_kind === "filter_rework") {
      setEvidenceReviewStatusFilter("rework");
      setEvidenceReviewSlaFilter("all");
      setEvidenceReviewSeverityFilter("all");
      setEvidenceReviewOwnerFilter("");
      setEvidenceReviewSourceFilter("");
      await loadEvidenceReviewWorkbenchDirect("/api/task-runs/queue/evidence-review?limit=100&status=rework", item.action_label);
      return;
    }
    if (item.action_kind === "filter_overdue") {
      setEvidenceReviewStatusFilter("all");
      setEvidenceReviewSlaFilter("overdue");
      setEvidenceReviewSeverityFilter("all");
      setEvidenceReviewOwnerFilter("");
      setEvidenceReviewSourceFilter("");
      await loadEvidenceReviewWorkbenchDirect("/api/task-runs/queue/evidence-review?limit=100&sla_status=overdue", item.action_label);
      return;
    }
    if (item.action_kind === "review_decision_trail") {
      setEvidenceReviewStatusFilter("all");
      setEvidenceReviewSlaFilter("all");
      setEvidenceReviewSeverityFilter("all");
      setEvidenceReviewOwnerFilter(item.owner_role);
      setEvidenceReviewSourceFilter("");
      await loadEvidenceReviewWorkbenchDirect(`/api/task-runs/queue/evidence-review?limit=100&owner_role=${encodeURIComponent(item.owner_role)}`, item.action_label);
    }
  }

  async function runEvidenceAcceptanceBatchGroup(group: QueueEvidenceAcceptanceBatchGroup) {
    const session = await postJson<QueueEvidenceAcceptanceBatchActionResponse>("/api/task-runs/queue/evidence-review/acceptance-batch-action", {
      group_id: group.id,
      action_kind: group.action_kind,
      action_label: group.action_label,
      action_target: group.action_target ?? null,
      item_ids: group.item_ids,
      owner_roles: group.owner_roles,
      reason: `Admin opened batch action ${group.action_label} for ${group.items_total} acceptance blocker(s).`
    });
    setEvidenceAcceptanceBatchAction(session);
    setQueueEvidenceReview(session.review_status);
    setQueueAdminActionAudit(await getJson<QueueAdminActionAuditStatus>("/api/task-runs/queue/admin-action-audit"));
    setQueueMessage(`${session.action_label}: ${session.message}; audit ${session.audit_event.id}`);
    await loadEvidenceAcceptanceBatchGroupClosure(session.batch_group_id);
    if (session.status !== "completed") {
      await runEvidenceAcceptanceAction({
        id: group.item_ids[0] ?? group.id,
        title: group.title,
        status: group.status === "critical" ? "failed" : "warning",
        owner_role: group.owner_roles[0] ?? "qa-evidence",
        reason: group.reason,
        action: group.next_action,
        action_label: group.action_label,
        action_kind: group.action_kind as QueueEvidenceAcceptanceChecklistItem["action_kind"],
        action_target: group.action_target ?? null,
        evidence_ref: group.id,
      });
    }
    await loadEvidenceAcceptanceBatchPlan();
  }

  async function loadEvidenceAcceptanceBatchGroupClosure(groupId?: string) {
    const targetGroupId =
      groupId ?? evidenceAcceptanceBatchAction?.batch_group_id ?? evidenceAcceptanceBatchItemDecision?.batch_group_id;
    if (!targetGroupId) {
      setQueueMessage("Статус закрытия batch-группы: нет активной группы.");
      return;
    }
    setQueueMessage(`Проверяем закрытие batch-группы ${targetGroupId}...`);
    try {
      const closure = await getJson<QueueEvidenceAcceptanceBatchGroupClosureStatus>(
        `/api/task-runs/queue/evidence-review/acceptance-batch-groups/${encodeURIComponent(targetGroupId)}/closure`
      );
      setEvidenceAcceptanceBatchGroupClosure(closure);
      setQueueEvidenceReview(closure.review_status);
      setQueueMessage(
        `Batch-группа ${closure.status}: open ${closure.open_items}; next ${closure.next_review_id ?? "none"}`
      );
    } catch (closureError) {
      setQueueMessage(closureError instanceof Error ? closureError.message : "Evidence acceptance batch group closure failed");
    }
  }

  async function runEvidenceAcceptanceSummaryPrimaryAction(summary: QueueEvidenceAcceptanceSummaryStatus) {
    if (!summary.primary_blocker_id || !summary.primary_action_kind || !summary.primary_action_label) {
      setQueueMessage("Сводка приемки: первого действия нет, evidence готов или требуется ручная сверка.");
      return;
    }
    await runEvidenceAcceptanceAction({
      id: summary.primary_blocker_id,
      title: summary.primary_blocker_title ?? summary.primary_blocker_id,
      status: summary.primary_blocker_status ?? "warning",
      owner_role: summary.primary_owner_role ?? "qa-evidence",
      reason: summary.primary_reason ?? summary.summary,
      action: summary.next_action,
      action_label: summary.primary_action_label,
      action_kind: summary.primary_action_kind,
      action_target: summary.primary_action_target ?? null,
      evidence_ref: summary.package_hash,
    });
    await loadEvidenceAcceptanceSummary();
  }

  async function refreshQueueRuntime(messagePrefix?: string) {
    const [
      status,
      observability,
      policy,
      scheduler,
      adminAlerts,
      adminRecoveryPlan,
      commandCenter,
      incidents,
      timeline,
      notifications,
      routing,
      policyAudit,
      runbook,
      actionAudit,
      manualTriage,
      evidenceReview,
      deadLetters
    ] = await Promise.all([
      getJson<TaskRunQueueStatus>("/api/task-runs/queue/status"),
      getJson<WorkerObservabilityStatus>("/api/task-runs/queue/observability"),
      getJson<RetryPolicyStatus>("/api/task-runs/queue/retry-policy"),
      getJson<WorkerSchedulerStatus>("/api/task-runs/queue/scheduler/status"),
      getJson<QueueAdminAlertCenterStatus>("/api/task-runs/queue/admin-alerts"),
      getJson<QueueAdminRecoveryPlanStatus>("/api/task-runs/queue/admin-recovery-plan"),
      getJson<QueueAdminCommandCenterStatus>("/api/task-runs/queue/admin-command-center"),
      getJson<IncidentLifecycleStatus>("/api/task-runs/queue/incidents"),
      getJson<AdminIncidentTimelineStatus>("/api/task-runs/queue/incidents/timeline"),
      getJson<NotificationDeliveryStatus>("/api/task-runs/queue/notifications/status"),
      getJson<NotificationRoutingStatus>("/api/task-runs/queue/notifications/routing"),
      getJson<NotificationPolicyAuditStatus>("/api/task-runs/queue/notifications/policy-audit"),
      getJson<QueueOperationsRunbookStatus>("/api/task-runs/queue/operations-runbook"),
      getJson<QueueAdminActionAuditStatus>("/api/task-runs/queue/admin-action-audit"),
      getJson<QueueManualTriageStatus>("/api/task-runs/queue/manual-triage"),
      getJson<QueueEvidenceReviewStatus>("/api/task-runs/queue/evidence-review?limit=100"),
      getJson<DeadLetterQueueStatus>("/api/task-runs/queue/dead-letters")
    ]);
    setQueueStatus(status);
    setWorkerObservability(observability);
    setRetryPolicy(policy);
    setWorkerScheduler(scheduler);
    setQueueAdminAlerts(adminAlerts);
    setQueueAdminRecoveryPlan(adminRecoveryPlan);
    setQueueAdminCommandCenter(commandCenter);
    setIncidentLifecycle(incidents);
    setIncidentTimeline(timeline);
    setNotificationDelivery(notifications);
    setNotificationRouting(routing);
    setNotificationPolicyAudit(policyAudit);
    setQueueRunbook(runbook);
    setQueueAdminActionAudit(actionAudit);
    setQueueManualTriage(manualTriage);
    setQueueEvidenceReview(evidenceReview);
    setDeadLetterQueue(deadLetters);
    setQueueMessage(
      messagePrefix ??
        `${status.total} задач в конвейере; command center ${commandCenter.status}/${commandCenter.operator_mode}; alert center ${adminAlerts.status}; recovery ${adminRecoveryPlan.status}/${adminRecoveryPlan.steps_needing_attention}; runbook ${runbook.status}/${runbook.steps_needing_attention}; manual triage ${manualTriage.status}/${manualTriage.open}; evidence review ${evidenceReview.status}/${evidenceReview.pending}; admin action audit ${actionAudit.status}/${actionAudit.events_total}; incidents ${incidents.status}/${incidents.open}; timeline ${timeline.events_total}; notifications ${notifications.status}/${notifications.delivered}; policy audit ${policyAudit.status}; scheduler ${scheduler.status}; DLQ open ${deadLetters.open}; здоровье worker: ${observability.health}`
    );
    return { status, observability, policy, scheduler, adminAlerts, adminRecoveryPlan, commandCenter, incidents, timeline, notifications, routing, policyAudit, runbook, actionAudit, manualTriage, evidenceReview, deadLetters };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadQueueStatus() {
      try {
        const refreshed = await Promise.all([
          getJson<TaskRunQueueStatus>("/api/task-runs/queue/status"),
          getJson<WorkerObservabilityStatus>("/api/task-runs/queue/observability"),
          getJson<RetryPolicyStatus>("/api/task-runs/queue/retry-policy"),
          getJson<WorkerSchedulerStatus>("/api/task-runs/queue/scheduler/status"),
          getJson<QueueAdminAlertCenterStatus>("/api/task-runs/queue/admin-alerts"),
          getJson<QueueAdminRecoveryPlanStatus>("/api/task-runs/queue/admin-recovery-plan"),
          getJson<QueueAdminCommandCenterStatus>("/api/task-runs/queue/admin-command-center"),
          getJson<IncidentLifecycleStatus>("/api/task-runs/queue/incidents"),
          getJson<AdminIncidentTimelineStatus>("/api/task-runs/queue/incidents/timeline"),
          getJson<NotificationDeliveryStatus>("/api/task-runs/queue/notifications/status"),
          getJson<NotificationRoutingStatus>("/api/task-runs/queue/notifications/routing"),
          getJson<NotificationPolicyAuditStatus>("/api/task-runs/queue/notifications/policy-audit"),
          getJson<QueueOperationsRunbookStatus>("/api/task-runs/queue/operations-runbook"),
          getJson<QueueAdminActionAuditStatus>("/api/task-runs/queue/admin-action-audit"),
          getJson<QueueManualTriageStatus>("/api/task-runs/queue/manual-triage"),
          getJson<QueueEvidenceReviewStatus>("/api/task-runs/queue/evidence-review?limit=100"),
          getJson<DeadLetterQueueStatus>("/api/task-runs/queue/dead-letters")
        ]);
        if (!cancelled) {
          const [
            status,
            observability,
            policy,
            scheduler,
            adminAlerts,
            adminRecoveryPlan,
            commandCenter,
            incidents,
            timeline,
            notifications,
            routing,
            policyAudit,
            runbook,
            actionAudit,
            manualTriage,
            evidenceReview,
            deadLetters
          ] = refreshed;
          setQueueStatus(status);
          setWorkerObservability(observability);
          setRetryPolicy(policy);
          setWorkerScheduler(scheduler);
          setQueueAdminAlerts(adminAlerts);
          setQueueAdminRecoveryPlan(adminRecoveryPlan);
          setQueueAdminCommandCenter(commandCenter);
          setIncidentLifecycle(incidents);
          setIncidentTimeline(timeline);
          setNotificationDelivery(notifications);
          setNotificationRouting(routing);
          setNotificationPolicyAudit(policyAudit);
          setQueueRunbook(runbook);
          setQueueAdminActionAudit(actionAudit);
          setQueueManualTriage(manualTriage);
          setQueueEvidenceReview(evidenceReview);
          setDeadLetterQueue(deadLetters);
          setQueueMessage(
            `${status.total} задач в конвейере; command center ${commandCenter.status}/${commandCenter.operator_mode}; alert center ${adminAlerts.status}; recovery ${adminRecoveryPlan.status}/${adminRecoveryPlan.steps_needing_attention}; runbook ${runbook.status}/${runbook.steps_needing_attention}; manual triage ${manualTriage.status}/${manualTriage.open}; evidence review ${evidenceReview.status}/${evidenceReview.pending}; admin action audit ${actionAudit.status}/${actionAudit.events_total}; incidents ${incidents.status}/${incidents.open}; timeline ${timeline.events_total}; notifications ${notifications.status}/${notifications.delivered}; policy audit ${policyAudit.status}; scheduler ${scheduler.status}; DLQ open ${deadLetters.open}; здоровье worker: ${observability.health}`
          );
        }
      } catch (statusError) {
        if (!cancelled) {
          setQueueMessage(statusError instanceof Error ? statusError.message : "Queue status unavailable");
        }
      }
    }

    loadQueueStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!rolePackOverride && selectedRolePackId !== recommendedRolePackId) {
      setSelectedRolePackId(recommendedRolePackId);
      setSelectedRoleIds(recommendedRolePack.runtimeRoleIds);
    }
  }, [recommendedRolePack.runtimeRoleIds, recommendedRolePackId, rolePackOverride, selectedRolePackId]);

  useEffect(() => {
    if (!selectedRuntimeRole) {
      return;
    }
    if (selectedRuntimeRole.runtime_role !== selectedRoleId) {
      setSelectedRoleId(selectedRuntimeRole.runtime_role);
    }
    setRoleDraft({
      department: selectedRuntimeRole.department,
      access_level: selectedRuntimeRole.access_level,
      status: selectedRuntimeRole.status,
      permissions: [...selectedRuntimeRole.permissions].sort()
    });
  }, [selectedRuntimeRole, selectedRoleId]);

  useEffect(() => {
    async function loadCatalog() {
      try {
        const [
          catalog,
          providerRegistry,
          gates,
          storage,
          vector,
          uploadRuntimeStatus,
          ocrWorkerStatus,
          embeddingProviderStatus,
          dataProtection,
          session,
          identityProviderStatus,
          keycloakBootstrapStatus,
          keycloakProductionStatus,
          policies,
          policyStore,
          policyAuditEvents,
          policyAuditChain,
          roleDirectoryState,
          roleDirectoryCoverageState,
          roleAdminState,
          roleAuditChain,
          roleDirectoryData,
          policyDirectoryState,
          auditRetentionStatus,
          auditPersistenceStatus,
          evidenceAccessStatus,
          evidenceDecision,
          evidenceAccessChain,
          auditExportPackage,
          uploadPolicy,
          sourceIntakeSummary
        ] = await Promise.all([
          getJson<ProcessCard[]>("/api/processes"),
          optionalJson<LlmProviderConfig[]>("/api/admin/llm-providers", []),
          optionalJson<QualityGateDefinition[]>("/api/quality/gates", []),
          optionalJson<StorageStatus | null>("/api/documents/storage-status", null),
          optionalJson<VectorIndexStatus | null>("/api/rag/vector-status", null),
          optionalJson<UploadRuntimeStatus | null>("/api/documents/upload-runtime-status", null),
          optionalJson<OcrWorkerStatus | null>("/api/documents/ocr-worker-status", null),
          optionalJson<EmbeddingProviderStatus | null>("/api/rag/embedding-status", null),
          optionalJson<DataProtectionStatus | null>("/api/data-protection/status", null),
          optionalJson<SecuritySession | null>("/api/security/session-check", null),
          optionalJson<IdentityProviderStatus | null>("/api/security/identity-provider/status", null),
          optionalJson<KeycloakBootstrapStatus | null>("/api/security/identity-provider/keycloak-bootstrap", null),
          optionalJson<KeycloakProductionReadinessStatus | null>("/api/security/identity-provider/production-readiness", null),
          optionalJson<AccessPolicy[]>("/api/security/access-policies", []),
          optionalJson<AccessPolicyStoreStatus | null>("/api/security/access-policy-store-status", null),
          optionalJson<AccessPolicyAuditEvent[]>("/api/security/access-policy-audit", []),
          optionalJson<AccessPolicyAuditVerification | null>("/api/security/access-policy-audit/verify", null),
          optionalJson<RoleDirectoryStatus | null>("/api/security/role-directory/status", null),
          optionalJson<RoleDirectoryCoverage | null>("/api/security/role-directory/coverage", null),
          optionalJson<RoleDirectoryAdminStatus | null>("/api/security/role-directory/admin-status", null),
          optionalJson<RoleDirectoryAuditVerification | null>("/api/security/role-directory/audit/verify", null),
          optionalJson<RoleDirectory | null>("/api/security/role-directory", null),
          optionalJson<AccessPolicyDirectoryValidation | null>("/api/security/access-policy-directory-validation", null),
          optionalJson<AuditRetentionStatus | null>("/api/audit-events/retention-status", null),
          optionalJson<AuditPersistenceStatus | null>("/api/audit-events/persistence-status", null),
          optionalJson<EvidenceAccessModelStatus | null>("/api/audit-events/access-model-status", null),
          optionalJson<EvidenceAccessDecision | null>(
            "/api/audit-events/access-check?action=download_internal_package&resource=audit_export_package"
            ,
            null
          ),
          optionalJson<EvidenceAccessAuditVerification | null>("/api/audit-events/access-audit/verify", null),
          optionalJson<AuditExportPackage | null>("/api/audit-events/export-package", null),
          fetch(`${resolveApiBase()}/api/documents/upload-policy/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
            body: JSON.stringify({
              name: "demo_dd_scan.pdf",
              type: "pdf",
              size_bytes: 1870000,
              content_type: "application/pdf",
              access_scope: "tenant:demo"
            })
          }).then((response) => {
            if (!response.ok) {
              throw new Error(`/api/documents/upload-policy/check: ${response.status}`);
            }
            return response.json() as Promise<FilePolicyEvidence>;
          }).catch(() => null),
          optionalJson<SourceIntakeSummary | null>("/api/documents/source-intake", null)
        ]);
        setProcesses(catalog);
        setProviders(providerRegistry);
        setGateCatalog(gates);
        setStorageStatus(storage);
        setVectorStatus(vector);
        setUploadRuntime(uploadRuntimeStatus);
        setOcrWorker(ocrWorkerStatus);
        setEmbeddingStatus(embeddingProviderStatus);
        setDataProtectionStatus(dataProtection);
        setSecuritySession(session);
        setIdentityProvider(identityProviderStatus);
        setKeycloakBootstrap(keycloakBootstrapStatus);
        setKeycloakProduction(keycloakProductionStatus);
        setAccessPolicies(policies);
        setPolicyStoreStatus(policyStore);
        setPolicyAudit(policyAuditEvents);
        setPolicyAuditVerification(policyAuditChain);
        setRoleDirectoryStatus(roleDirectoryState);
        setRoleDirectoryCoverage(roleDirectoryCoverageState);
        setRoleAdminStatus(roleAdminState);
        setRoleAuditVerification(roleAuditChain);
        setRoleDirectory(roleDirectoryData);
        setPolicyDirectoryValidation(policyDirectoryState);
        setAuditRetention(auditRetentionStatus);
        setAuditPersistence(auditPersistenceStatus);
        setEvidenceAccess(evidenceAccessStatus);
        setEvidenceAccessDecision(evidenceDecision);
        setEvidenceAccessAudit(evidenceAccessChain);
        setAuditExport(auditExportPackage);
        setFilePolicy(uploadPolicy);
        setSourceIntake(sourceIntakeSummary);
        setSourceIntakeState(sourceIntakeSummary ? "ready" : "error");
        setSelectedProcessId(catalog[0]?.id ?? "");
        setState("ready");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Catalog loading failed");
        setState("error");
      }
    }

    loadCatalog();
  }, []);

  useEffect(() => {
    if (!selectedProcess) {
      setTaskIntakePreview(null);
      setTaskIntakeState("waiting");
      return;
    }

    let cancelled = false;

    async function loadTaskIntakePreview() {
      setTaskIntakeState("checking");
      try {
        const preview = await postJson<TaskIntakePreview>("/api/task-runs/intake-preview", {
          process_id: selectedProcess.id,
          goal: productTask.goal,
          expected_artifact: productTask.expectedArtifact,
          source_context: `${productTask.sourceContext}. Пакет ролей: ${selectedRolePack.title}.`,
          urgency: productTask.urgency,
          document_ids: activeDocumentIds,
          selected_role_ids: selectedRoleIds
        });
        if (!cancelled) {
          setTaskIntakePreview(preview);
          setTaskIntakeState(preview.status === "ready" ? "ready" : "needs_input");
        }
      } catch {
        if (!cancelled) {
          setTaskIntakePreview(null);
          setTaskIntakeState("error");
        }
      }
    }

    loadTaskIntakePreview();
    return () => {
      cancelled = true;
    };
  }, [activeDocumentIds, productTask, selectedProcess, selectedRoleIds, selectedRolePack]);

  async function refreshRoleAdminLayer() {
    const [roleDirectoryState, roleDirectoryCoverageState, roleAdminState, roleAuditChain, roleDirectoryData] =
      await Promise.all([
        getJson<RoleDirectoryStatus>("/api/security/role-directory/status"),
        getJson<RoleDirectoryCoverage>("/api/security/role-directory/coverage"),
        getJson<RoleDirectoryAdminStatus>("/api/security/role-directory/admin-status"),
        getJson<RoleDirectoryAuditVerification>("/api/security/role-directory/audit/verify"),
        getJson<RoleDirectory>("/api/security/role-directory")
      ]);
    setRoleDirectoryStatus(roleDirectoryState);
    setRoleDirectoryCoverage(roleDirectoryCoverageState);
    setRoleAdminStatus(roleAdminState);
    setRoleAuditVerification(roleAuditChain);
    setRoleDirectory(roleDirectoryData);
  }

  function updateRoleDraft(values: Partial<RoleEditorDraft>) {
    setRoleDraft((current) => (current ? { ...current, ...values } : current));
  }

  function toggleDraftPermission(permission: string) {
    setRoleDraft((current) => {
      if (!current) {
        return current;
      }
      const permissionSet = new Set(current.permissions);
      if (permissionSet.has(permission)) {
        permissionSet.delete(permission);
      } else {
        permissionSet.add(permission);
      }
      return { ...current, permissions: [...permissionSet].sort() };
    });
  }

  function updateProductTask(values: Partial<ProductTaskBrief>) {
    setProductTask((current) => ({ ...current, ...values }));
  }

  function applyBusinessMission(mission: BusinessMissionTemplate) {
    const rolePack = ROLE_PACKS.find((pack) => pack.id === mission.rolePackId) ?? ROLE_PACKS[0];
    setSelectedBusinessMissionId(mission.id);
    setSelectedScenarioPackId(mission.scenarioPackId);
    setSelectedRolePackId(rolePack.id);
    setSelectedRoleIds(rolePack.runtimeRoleIds);
    setRolePackOverride(true);
    setProductTask(mission.task);
    setTaskRun(null);
    setArtifact(null);
    setArtifactVersions([]);
    setResultCenter(null);
    setOpenedFollowupTaskRunId("");
    setCycleSourceTaskRunId("");
    setCycleNumber(1);
    setScenarioRestoreMessage("");
  }

  function restoreScenarioFromTaskRunPayload(loadedRun: TaskRun, loadedArtifact: Artifact | null) {
    const formData = loadedRun.form_data ?? {};
    const restoredMission = missionFromTaskRunPayload(formData);
    const hasScenarioPayload = Boolean(
      restoredMission ||
        formDataText(formData, "goal") ||
        formDataText(formData, "expected_artifact") ||
        formDataText(formData, "source_context")
    );
    if (!hasScenarioPayload) {
      setScenarioRestoreMessage("");
      return;
    }
    const restoredScenarioPackId = formDataText(formData, "scenario_pack_id") ?? restoredMission?.scenarioPackId;
    const restoredRolePackId = formDataText(formData, "role_pack_id") ?? restoredMission?.rolePackId;
    const restoredScenarioPack = SCENARIO_PACKS.find((pack) => pack.id === restoredScenarioPackId);
    const restoredRolePack = ROLE_PACKS.find((pack) => pack.id === restoredRolePackId);
    const restoredRoleIds = formDataStringList(formData, "selected_workgroup");
    const restoredTask: ProductTaskBrief = {
      goal: formDataText(formData, "goal") ?? restoredMission?.task.goal ?? "Продолжить восстановленный TaskRun",
      expectedArtifact:
        formDataText(formData, "expected_artifact") ??
        restoredMission?.task.expectedArtifact ??
        loadedArtifact?.title ??
        "Восстановленный управляемый артефакт",
      sourceContext:
        formDataText(formData, "source_context") ??
        restoredMission?.task.sourceContext ??
        "Контекст восстановлен из сохраненного TaskRun.",
      urgency: formDataText(formData, "urgency") ?? restoredMission?.task.urgency ?? "Продолжить восстановленный сценарий"
    };

    if (restoredMission) {
      setSelectedBusinessMissionId(restoredMission.id);
    }
    if (restoredScenarioPack) {
      setSelectedScenarioPackId(restoredScenarioPack.id);
    }
    if (restoredRolePack) {
      setSelectedRolePackId(restoredRolePack.id);
      setRolePackOverride(true);
    }
    if (restoredRoleIds.length) {
      setSelectedRoleIds(restoredRoleIds);
    } else if (restoredRolePack) {
      setSelectedRoleIds(restoredRolePack.runtimeRoleIds);
    }
    setProductTask(restoredTask);
    setScenarioRestoreMessage(
      restoredMission
        ? `${loadedRun.id}: восстановлена миссия "${restoredMission.title}" из TaskRun payload`
        : `${loadedRun.id}: восстановлены цель и артефакт из TaskRun payload`
    );
  }

  function applyRolePack(pack: RolePack) {
    setSelectedRolePackId(pack.id);
    setSelectedRoleIds(pack.runtimeRoleIds);
    setRolePackOverride(pack.id !== recommendedRolePackId);
  }

  function toggleSelectedRole(roleId: string) {
    setRolePackOverride(true);
    setSelectedRoleIds((current) =>
      current.includes(roleId) ? current.filter((item) => item !== roleId) : [...current, roleId]
    );
  }

  async function refreshSourceIntake() {
    const summary = await getJson<SourceIntakeSummary>("/api/documents/source-intake");
    setSourceIntake(summary);
    setSourceIntakeState("ready");
    setSourceIntakeMessage(summary.next_action);
  }

  async function registerSourceLink() {
    const trimmedLink = sourceLink.trim();
    if (!trimmedLink) {
      setSourceIntakeState("error");
      setSourceIntakeMessage("Укажите ссылку или file:// путь к документу.");
      return;
    }
    setSourceIntakeState("saving");
    setSourceIntakeMessage("Регистрирую ссылку как материал миссии...");
    try {
      await postJson<SourceIntakeItem>("/api/documents/source-intake/links", {
        url: trimmedLink,
        title: trimmedLink,
        note: productTask.goal,
        access_scope: "tenant:demo"
      });
      updateProductTask({
        sourceContext: `${selectedBusinessMission.title}: demo-источник doc-demo-001 + ссылка ${trimmedLink}`
      });
      setSourceLink("");
      await refreshSourceIntake();
      setSourceIntakeMessage("Ссылка зарегистрирована как материал выбранной миссии.");
    } catch (linkError) {
      setSourceIntakeState("error");
      setSourceIntakeMessage(linkError instanceof Error ? linkError.message : "Не удалось зарегистрировать ссылку.");
    }
  }

  async function uploadMissionFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setSourceIntakeState("saving");
    setSourceIntakeMessage(`Загружаю файлов: ${files.length}`);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("access_scope", "tenant:demo");
        await postForm<FileUploadEvidence>("/api/documents/upload", formData);
      }
      updateProductTask({
        sourceContext: `${selectedBusinessMission.title}: demo-источник doc-demo-001 + пользовательские материалы (${files.length})`
      });
      await refreshSourceIntake();
      setSourceIntakeMessage("Файлы приняты как материалы выбранной миссии. Статус готовности показан ниже.");
    } catch (uploadError) {
      setSourceIntakeState("error");
      setSourceIntakeMessage(uploadError instanceof Error ? uploadError.message : "Не удалось загрузить файл.");
    }
  }

  function applyScenarioPack(pack: ScenarioPack) {
    setSelectedScenarioPackId(pack.id);
    setRolePackOverride(false);
    setSelectedRolePackId(recommendedRolePackId);
    setSelectedRoleIds(recommendedRolePack.runtimeRoleIds);
    setProductTask({
      goal: pack.goal,
      expectedArtifact: pack.expectedArtifact,
      sourceContext: pack.sourceContext,
      urgency: pack.urgency
    });
  }

  async function saveRoleOverride() {
    if (!selectedRuntimeRole || !roleDraft) {
      return;
    }
    setRoleEditorState("saving");
    setRoleEditorMessage("");
    try {
      const updated = await patchJson<RuntimeRole>(
        `/api/security/role-directory/roles/${encodeURIComponent(selectedRuntimeRole.runtime_role)}`,
        roleDraft,
        ADMIN_HEADERS
      );
      await refreshRoleAdminLayer();
      setSelectedRoleId(updated.runtime_role);
      setRoleEditorState("saved");
      setRoleEditorMessage(`${updated.runtime_role}: override saved and audited`);
    } catch (saveError) {
      setRoleEditorState("error");
      setRoleEditorMessage(saveError instanceof Error ? saveError.message : "Role override failed");
    }
  }

  async function runMvpPath() {
    if (!selectedProcess) {
      return;
    }

    setState("running");
    setError("");
    setOpenedFollowupTaskRunId("");
    setCycleSourceTaskRunId("");
    setCycleNumber(1);
    setTaskRun(null);
    setArtifact(null);
    setArtifactVersions([]);
    setAuditEvents([]);
    setAuditRetention(null);
    setAuditPersistence(null);
    setAuditExport(null);
    setEvidenceAccess(null);
    setEvidenceAccessDecision(null);
    setEvidenceAccessAudit(null);
    setRuntimeEvidence(null);
    setResultCenter(null);
    setResultActionState("idle");
    setResultActionMessage("");
    setRollbackState("idle");
    setRollbackMessage("");
    setVersionCompare(null);
    setVersionCompareState("idle");
    setVersionCompareMessage("");
    setCompareActionState("idle");
    setCompareActionMessage("");
    setPendingRestoreVersion(null);
    setRestoreReason("");
    setArtifactExportDraft(null);
    setArtifactEvidencePackage(null);
    setArtifactPackageMessage("");
    setPiiEvidence(null);
    setApproval(null);
    setBlockedExport(null);
    setApprovedExport(null);
    setScenarioRestoreMessage("");

    try {
      const createResponse = await fetch(`${resolveApiBase()}/api/task-runs/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          process_id: selectedProcess.id,
          profile_id: taskIntakePreview?.recommended_profile_id ?? "demo-tenant-working",
          max_attempts: 2,
          timeout_seconds: 30,
          auto_process: true,
          form_data: {
            business_mission_id: selectedBusinessMission.id,
            scenario_pack_id: selectedScenarioPack.id,
            role_pack_id: selectedRolePack.id,
            client_name: "REA demo",
            need: productTask.goal,
            product: "Symbiot Runtime",
            deadline: productTask.urgency,
            expected_artifact: productTask.expectedArtifact,
            source_context: `${productTask.sourceContext}. Пакет сценария: ${selectedScenarioPack.title}. Пакет ролей: ${selectedRolePack.title}.`,
            selected_workgroup: taskIntakePreview?.workgroup.map((role) => role.runtime_role) ?? []
          },
          document_ids: activeDocumentIds
        })
      });

      if (!createResponse.ok) {
        const detail = await createResponse.text();
        throw new Error(`/api/task-runs/queue: ${createResponse.status} ${detail}`);
      }

      const queueResponse = (await createResponse.json()) as TaskRunQueueResponse;
      const createdRun = queueResponse.task_run;
      setTaskRun(createdRun);
      setReloadTaskRunId(createdRun.id);
      setReloadState("loaded");
      await refreshQueueRuntime(`${queueResponse.queue_item.id}: ${queueResponse.queue_item.status}; TaskRun ${createdRun.id}`);
      setReloadMessage(`${createdRun.id}: создан через очередь и готов к повторному открытию`);

      if (createdRun.artifact_id) {
        const createdArtifact = await getJson<Artifact>(`/api/artifacts/${createdRun.artifact_id}`);
        setArtifact(createdArtifact);
        const createdArtifactVersions = await getJson<ArtifactVersionRecord[]>(`/api/artifacts/${createdRun.artifact_id}/versions`);
        setArtifactVersions(createdArtifactVersions);
      }

      const evidence = await getJson<RuntimeEvidence>(`/api/runtime/evidence/${createdRun.id}`);
      const result = await getJson<TaskRunResultCenter>(`/api/task-runs/${createdRun.id}/result-center`);
      const audit = await getJson<AuditEvent[]>("/api/audit-events");
      const retention = await getJson<AuditRetentionStatus>("/api/audit-events/retention-status");
      const persistence = await getJson<AuditPersistenceStatus>("/api/audit-events/persistence-status");
      const evidenceAccessStatus = await getJson<EvidenceAccessModelStatus>("/api/audit-events/access-model-status");
      const evidenceDecision = await getJson<EvidenceAccessDecision>(
        "/api/audit-events/access-check?action=download_internal_package&resource=audit_export_package"
      );
      const evidenceAccessChain = await getJson<EvidenceAccessAuditVerification>("/api/audit-events/access-audit/verify");
      const auditPackage = await getJson<AuditExportPackage>("/api/audit-events/export-package");
      const pii = await fetch(`${resolveApiBase()}/api/data-protection/pii/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          artifact_id: createdRun.artifact_id,
          access_scope: "tenant:demo",
          purpose: "external_export",
          text:
            "Клиент: Иван Петров, телефон +7 916 123-45-67, email ivan.petrov@example.ru, паспорт 4510 123456. Подготовить КП для внешней отправки."
        })
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`/api/data-protection/pii/classify: ${response.status}`);
        }
        return response.json() as Promise<PiiClassificationEvidence>;
      });
      const blocked = await fetch(`${resolveApiBase()}/api/data-protection/exports/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          artifact_id: createdRun.artifact_id,
          classification_id: pii.id,
          channel: "external_share",
          requester: "demo-user"
        })
      }).then((response) => response.json() as Promise<ExportDecision>);
      const approvalRequest = await fetch(`${resolveApiBase()}/api/data-protection/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          artifact_id: createdRun.artifact_id,
          classification_id: pii.id,
          requester: "demo-user",
          reviewer: "Dmitry",
          purpose: "external_export"
        })
      }).then((response) => response.json() as Promise<HumanApprovalRecord>);
      const approved = await fetch(`${resolveApiBase()}/api/data-protection/approvals/${approvalRequest.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          reviewer: "Dmitry",
          decision_comment: "Approved for controlled demo export after PII redaction."
        })
      }).then((response) => response.json() as Promise<HumanApprovalRecord>);
      const allowed = await fetch(`${resolveApiBase()}/api/data-protection/exports/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          artifact_id: createdRun.artifact_id,
          classification_id: pii.id,
          approval_id: approved.id,
          channel: "external_share",
          requester: "demo-user"
        })
      }).then((response) => response.json() as Promise<ExportDecision>);
      const protectionStatus = await getJson<DataProtectionStatus>("/api/data-protection/status");
      setRuntimeEvidence(evidence);
      setResultCenter(result);
      setAuditEvents(audit);
      setAuditRetention(retention);
      setAuditPersistence(persistence);
      setEvidenceAccess(evidenceAccessStatus);
      setEvidenceAccessDecision(evidenceDecision);
      setEvidenceAccessAudit(evidenceAccessChain);
      setAuditExport(auditPackage);
      setPiiEvidence(pii);
      setBlockedExport(blocked);
      setApproval(approved);
      setApprovedExport(allowed);
      setDataProtectionStatus(protectionStatus);
      setState("complete");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "MVP path failed");
      setState("error");
    }
  }

  async function applyQueueAction(queueId: string, action: "cancel" | "retry") {
    setQueueMessage(`${action === "cancel" ? "Отменяем" : "Повторяем"} ${queueId}...`);
    try {
      const response = await fetch(`${resolveApiBase()}/api/task-runs/queue/${queueId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          actor: "demo-user",
          reason: action === "cancel" ? "User requested cancellation from Product Workbench." : "User requested retry from Product Workbench.",
          auto_process: action === "retry"
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`/api/task-runs/queue/${queueId}/${action}: ${response.status} ${detail}`);
      }
      const refreshed = await refreshQueueRuntime();
      setQueueMessage(
        `${queueId}: ${action === "cancel" ? "отмена зафиксирована" : "повтор запущен"}; alerts ${refreshed.adminAlerts.status}; DLQ open ${refreshed.deadLetters.open}; scheduler ${refreshed.scheduler.status}; здоровье ${refreshed.observability.health}`
      );
    } catch (queueError) {
      setQueueMessage(queueError instanceof Error ? queueError.message : "Queue action failed");
    }
  }

  async function applyDeadLetterAction(deadLetterId: string, action: "acknowledge" | "resolve") {
    setQueueMessage(`${action === "acknowledge" ? "Берем в разбор" : "Закрываем"} ${deadLetterId}...`);
    try {
      const response = await fetch(`${resolveApiBase()}/api/task-runs/queue/dead-letters/${deadLetterId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({
          actor: "demo-user",
          reason:
            action === "acknowledge"
              ? "Admin acknowledged dead-letter item from Product Workbench."
              : "Admin resolved dead-letter item from Product Workbench."
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`/api/task-runs/queue/dead-letters/${deadLetterId}/${action}: ${response.status} ${detail}`);
      }
      const refreshed = await refreshQueueRuntime();
      setQueueMessage(`${deadLetterId}: ${action === "acknowledge" ? "разбор подтвержден" : "закрыто"}; alerts ${refreshed.adminAlerts.status}; DLQ open ${refreshed.deadLetters.open}; scheduler ${refreshed.scheduler.status}`);
    } catch (queueError) {
      setQueueMessage(queueError instanceof Error ? queueError.message : "Dead-letter action failed");
    }
  }

  async function applySchedulerAction(action: "start" | "stop" | "tick") {
    const label = action === "start" ? "Запускаем автопланировщик" : action === "stop" ? "Останавливаем автопланировщик" : "Выполняем один тик";
    setQueueMessage(`${label}...`);
    try {
      const response = await fetch(`${resolveApiBase()}/api/task-runs/queue/scheduler/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ADMIN_HEADERS },
        body: JSON.stringify({
          actor: "runtime-admin-ui",
          interval_seconds: 0.5,
          reason: `Product Workbench scheduler ${action}.`
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`/api/task-runs/queue/scheduler/${action}: ${response.status} ${detail}`);
      }
      const scheduler = (await response.json()) as WorkerSchedulerStatus;
      await refreshQueueRuntime(
        `Scheduler ${scheduler.status}; running ${String(scheduler.running)}; processed ${scheduler.processed_total}; errors ${scheduler.error_total}`
      );
    } catch (schedulerError) {
      setQueueMessage(schedulerError instanceof Error ? schedulerError.message : "Scheduler action failed");
    }
  }

  async function dispatchNotificationDelivery() {
    setQueueMessage("Формируем local-log delivery по активным инцидентам...");
    try {
      const response = await fetch(`${resolveApiBase()}/api/task-runs/queue/notifications/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ADMIN_HEADERS },
        body: JSON.stringify({
          actor: "runtime-admin-ui",
          reason: "Product Workbench local-log notification dispatch."
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`/api/task-runs/queue/notifications/dispatch: ${response.status} ${detail}`);
      }
      const delivery = (await response.json()) as NotificationDeliveryStatus;
      await refreshQueueRuntime(
        `Notification delivery ${delivery.status}; delivered ${delivery.delivered}; active incidents ${delivery.active_incidents}; external channels not configured`
      );
    } catch (deliveryError) {
      setQueueMessage(deliveryError instanceof Error ? deliveryError.message : "Notification delivery failed");
    }
  }

  async function executeRunbookAction(step: QueueRunbookStep) {
    setQueueMessage(`${step.action_label ?? "Выполняем runbook action"}: ${step.title}...`);
    try {
      const response = await postJson<QueueRunbookActionResponse>(
        `/api/task-runs/queue/operations-runbook/actions/${step.id}`,
        {
          actor: "runtime-admin-ui",
          interval_seconds: 0.5,
          reason: `Product Workbench guided runbook action: ${step.id}.`
        },
        ADMIN_HEADERS
      );
      setQueueRunbook(response.runbook);
      await refreshQueueRuntime(
        `${response.message}; status ${response.status}; executed ${String(response.executed)}; runbook ${response.runbook.status}/${response.runbook.steps_needing_attention}`
      );
    } catch (runbookError) {
      setQueueMessage(runbookError instanceof Error ? runbookError.message : "Runbook action failed");
    }
  }

  async function applyRecoveryStep(step: QueueRecoveryStep) {
    if (step.action_kind === "guided_action" && step.related_runbook_step_id && queueRunbook) {
      const runbookStep = queueRunbook.steps.find((item) => item.id === step.related_runbook_step_id);
      if (runbookStep) {
        await executeRunbookAction(runbookStep);
        return;
      }
    }
    setQueueMessage(`${step.action_label}: ${step.expected_result}`);
  }

  async function openManualTriageFromCommand(action: QueueAdminCommandCenterAction) {
    setQueueMessage(`Открываем ручной разбор: ${action.label}...`);
    try {
      const item = await postJson<QueueManualTriageItem>(
        "/api/task-runs/queue/manual-triage",
        {
          source_action_id: action.id,
          title: action.label,
          owner_role: action.owner_role,
          severity: action.action_kind === "review_only" ? "warning" : "info",
          reason: action.reason,
          evidence_ref: action.evidence_source,
          related_runbook_step_id: action.endpoint?.includes("/operations-runbook") ? action.endpoint.split("/").pop() : null
        },
        ADMIN_HEADERS
      );
      await refreshQueueRuntime(`Manual triage открыт: ${item.id}; ${item.title}`);
    } catch (manualTriageError) {
      setQueueMessage(manualTriageError instanceof Error ? manualTriageError.message : "Manual triage creation failed");
    }
  }

  async function applyCommandCenterAction(action: QueueAdminCommandCenterAction) {
    if (action.action_kind === "guided_action" && action.endpoint?.includes("/operations-runbook/actions/") && queueRunbook) {
      const stepId = action.endpoint.split("/").pop();
      const runbookStep = queueRunbook.steps.find((item) => item.id === stepId);
      if (runbookStep) {
        await executeRunbookAction(runbookStep);
        return;
      }
    }
    if (action.action_kind === "review_only") {
      await openManualTriageFromCommand(action);
      return;
    }
    setQueueMessage(`${action.label}: ${action.reason}`);
  }

  async function assignManualTriage(item: QueueManualTriageItem) {
    setQueueMessage(`Берем в работу ручной разбор ${item.id}...`);
    try {
      const assigned = await postJson<QueueManualTriageItem>(
        `/api/task-runs/queue/manual-triage/${item.id}/assign`,
        {
          actor: "runtime-admin-ui",
          reason: `Product Workbench assigned manual triage case ${item.id}.`
        },
        ADMIN_HEADERS
      );
      await refreshQueueRuntime(`Manual triage в работе: ${assigned.id}; владелец ${assigned.owner_role}`);
    } catch (manualTriageError) {
      setQueueMessage(manualTriageError instanceof Error ? manualTriageError.message : "Manual triage assign failed");
    }
  }

  async function resolveManualTriage(item: QueueManualTriageItem) {
    setQueueMessage(`Закрываем ручной разбор ${item.id}...`);
    try {
      const resolved = await postJson<QueueManualTriageItem>(
        `/api/task-runs/queue/manual-triage/${item.id}/resolve`,
        {
          actor: "runtime-admin-ui",
          reason: `Product Workbench resolved manual triage case ${item.id}.`,
          resolution: "Administrator reviewed evidence and closed the manual triage case from Product Workbench."
        },
        ADMIN_HEADERS
      );
      await refreshQueueRuntime(`Manual triage закрыт: ${resolved.id}; ${resolved.resolution ?? "resolution recorded"}`);
    } catch (manualTriageError) {
      setQueueMessage(manualTriageError instanceof Error ? manualTriageError.message : "Manual triage resolve failed");
    }
  }

  async function decideEvidenceReview(item: QueueEvidenceReviewItem, decision: "approve" | "rework") {
    if (evidenceAcceptanceBatchAction?.review_status.items.some((reviewItem) => reviewItem.id === item.id)) {
      setQueueMessage(`${decision === "approve" ? "Принимаем" : "Возвращаем"} batch evidence ${item.id}...`);
      try {
        const decided = await postJson<QueueEvidenceAcceptanceBatchItemDecisionResponse>(
          "/api/task-runs/queue/evidence-review/acceptance-batch-item-decision",
          {
            batch_group_id: evidenceAcceptanceBatchAction.batch_group_id,
            review_id: item.id,
            decision,
            actor: "qa-evidence-ui",
            reason: `Product Workbench batch ${decision} evidence review ${item.id}.`,
            review_note: evidenceReviewDecisionNote.trim()
              || (decision === "approve"
                ? "QA/admin accepted batch evidence item from Product Workbench."
                : "QA/admin returned batch evidence item for rework from Product Workbench.")
          },
          ADMIN_HEADERS
        );
        setEvidenceAcceptanceBatchItemDecision(decided);
        setQueueEvidenceReview(decided.review_status);
        setQueueAdminActionAudit(await getJson<QueueAdminActionAuditStatus>("/api/task-runs/queue/admin-action-audit"));
        setEvidenceReviewDecisionNote("");
        setQueueMessage(`${decided.decision}: ${decided.review_id}; audit ${decided.audit_event.id}`);
        await loadEvidenceAcceptanceBatchGroupClosure(decided.batch_group_id);
      } catch (batchDecisionError) {
        setQueueMessage(batchDecisionError instanceof Error ? batchDecisionError.message : "Batch item decision failed");
      }
      return;
    }
    const endpoint = `/api/task-runs/queue/evidence-review/${item.id}/${decision}`;
    setQueueMessage(`${decision === "approve" ? "Принимаем" : "Возвращаем"} evidence ${item.id}...`);
    try {
      const reviewed = await postJson<QueueEvidenceReviewItem>(
        endpoint,
        {
          actor: "qa-evidence-ui",
          reason: `Product Workbench ${decision} evidence review ${item.id}.`,
          review_note: evidenceReviewDecisionNote.trim()
            || (decision === "approve"
              ? "QA/admin accepted evidence from Product Workbench."
              : "QA/admin returned evidence for rework from Product Workbench.")
        },
        ADMIN_HEADERS
      );
      setEvidenceReviewDecisionNote("");
      await refreshQueueRuntime(`Evidence review ${reviewed.status}: ${reviewed.id}; ${reviewed.review_note ?? "decision recorded"}`);
    } catch (evidenceReviewError) {
      setQueueMessage(evidenceReviewError instanceof Error ? evidenceReviewError.message : "Evidence review decision failed");
    }
  }

  function prepareArtifactRestore(version: ArtifactVersionRecord) {
    setPendingRestoreVersion(version);
    setRestoreReason(`Restore ${version.version} after user review.`);
    setRollbackState("idle");
    setRollbackMessage(`Подготовлен откат к ${version.version}. Подтвердите действие ниже.`);
  }

  async function rollbackArtifactToVersion(version: ArtifactVersionRecord, reason: string) {
    const currentArtifact = artifactForPassport;
    if (!currentArtifact) {
      setRollbackState("error");
      setRollbackMessage("Нет текущего артефакта для отката.");
      return;
    }

    setRollbackState("saving");
    setRollbackMessage("");
    try {
      const rollback = await postJson<ArtifactRollbackResult>(
        `/api/artifacts/${currentArtifact.id}/versions/${version.id}/rollback`,
        {
          actor: "demo-user",
          reason: reason || `Result Center rollback to ${version.version}`
        }
      );
      const refreshedVersions = await getJson<ArtifactVersionRecord[]>(`/api/artifacts/${rollback.artifact.id}/versions`);
      setArtifact(rollback.artifact);
      setArtifactVersions(refreshedVersions);
      setResultCenter((current) => (current ? { ...current, artifact: rollback.artifact } : current));
      setAuditEvents((current) => [...current, rollback.audit_event]);
      setVersionCompare(null);
      setVersionCompareState("idle");
      setVersionCompareMessage("");
      setPendingRestoreVersion(null);
      setRestoreReason("");
      setRollbackState("saved");
      setRollbackMessage(
        `Откат выполнен: ${rollback.restored_from.version} восстановлена как ${rollback.created_version.version}; audit ${rollback.audit_event.id}`
      );
    } catch (rollbackError) {
      setRollbackState("error");
      setRollbackMessage(rollbackError instanceof Error ? rollbackError.message : "Artifact rollback failed");
    }
  }

  async function compareArtifactVersion(version: ArtifactVersionRecord, diffOffset = 0) {
    const currentArtifact = artifactForPassport;
    if (!currentArtifact) {
      setVersionCompareState("error");
      setVersionCompareMessage("Нет текущего артефакта для сравнения.");
      return;
    }

    setVersionCompareState("loading");
    setVersionCompareMessage("");
    setArtifactDiffJob(null);
    try {
      const job = await postJson<ArtifactDiffJobRecord>(
        `/api/artifacts/${currentArtifact.id}/versions/${version.id}/diff-jobs`,
        { actor: "demo-user", max_diff_lines: 120, diff_offset: diffOffset }
      );
      if (!job.compare_result) {
        throw new Error(job.error ?? "Diff job finished without compare result.");
      }
      setArtifactDiffJob(job);
      setVersionCompare(job.compare_result);
      setVersionCompareState("loaded");
      setCompareActionState("idle");
      setCompareActionMessage("");
      setVersionCompareMessage(`Diff job ${job.id}: ${job.compare_result.summary}`);
    } catch (compareError) {
      setArtifactDiffJob(null);
      setVersionCompare(null);
      setVersionCompareState("error");
      setVersionCompareMessage(compareError instanceof Error ? compareError.message : "Artifact version compare failed");
    }
  }

  async function applyCompareAction(actionId: ArtifactCompareActionRecord["action_id"]) {
    if (!artifactDiffJob || !versionCompare) {
      setCompareActionState("error");
      setCompareActionMessage("Сначала выполните сравнение версии.");
      return;
    }
    setCompareActionState("saving");
    setCompareActionMessage("");
    try {
      const action = await postJson<ArtifactCompareActionRecord>(
        `/api/artifacts/diff-jobs/${artifactDiffJob.id}/actions/${actionId}`,
        {
          actor: "demo-user",
          comment: `${actionId}: ${versionCompare.base_version.version} compared with ${versionCompare.target_version.version}`
        }
      );
      if (actionId === "prepare-restore") {
        setPendingRestoreVersion(versionCompare.base_version);
        setRestoreReason(`Restore ${versionCompare.base_version.version} after compare action ${action.id}.`);
      }
      setCompareActionState("saved");
      setCompareActionMessage(`Решение по сравнению записано: ${action.action_id} / ${action.id}`);
    } catch (actionError) {
      setCompareActionState("error");
      setCompareActionMessage(actionError instanceof Error ? actionError.message : "Compare action failed");
    }
  }

  async function loadArtifactPackages() {
    const currentArtifact = artifactForPassport;
    if (!currentArtifact) {
      setArtifactPackageMessage("Нет артефакта для выгрузки.");
      return;
    }
    setArtifactPackageMessage("Собираю экспорт и evidence package...");
    try {
      const [draft, evidencePackage] = await Promise.all([
        getJson<ArtifactExportDraft>(`/api/artifacts/${currentArtifact.id}/export-draft`),
        getJson<ArtifactEvidencePackage>(`/api/artifacts/${currentArtifact.id}/evidence-package`)
      ]);
      setArtifactExportDraft(draft);
      setArtifactEvidencePackage(evidencePackage);
      setArtifactPackageMessage(`Готово: ${draft.filename}, evidence ${evidencePackage.package_hash.slice(0, 12)}`);
    } catch (packageError) {
      setArtifactPackageMessage(packageError instanceof Error ? packageError.message : "Artifact package failed");
    }
  }

  async function applyResultAction(action: ResultAction) {
    if (!resultCenter || action.status !== "available") {
      return;
    }

    if (action.id === "create-next-task" && !nextStepReviewReadyForCreation) {
      setResultActionState("error");
      setResultActionMessage("Проверьте и подтвердите следующий шаг перед созданием новой задачи.");
      return;
    }

    setResultActionState("saving");
    setResultActionMessage("");
    try {
      const actionPayload =
        action.id === "create-next-task"
          ? {
              comment: `${action.title}: confirmed next task brief captured ${nextTaskPayloadForAction.source_label} from Product Workbench MVP.`,
              followup_goal: nextTaskPayloadForAction.goal,
              followup_expected_artifact: nextTaskPayloadForAction.expected_artifact,
              followup_source_context: nextTaskPayloadForAction.source_context,
              followup_urgency: nextTaskPayloadForAction.urgency
            }
          : {
              comment: `${action.title}: action captured from Product Workbench MVP.`
            };
      const updated = await postJson<TaskRunResultCenter>(
        `/api/task-runs/${resultCenter.task_run_id}/result-actions/${action.id}`,
        actionPayload
      );
      setResultCenter(updated);
      const linkedTaskRun = updated.action_history.find((record) => record.related_task_run_id)?.related_task_run_id;
      if (linkedTaskRun) {
        setReloadTaskRunId(linkedTaskRun);
        setReloadMessage(`${linkedTaskRun}: следующая задача создана и подставлена для открытия`);
      }
      setResultActionState("saved");
      setResultActionMessage(`${action.title}: действие сохранено в audit/evidence`);
    } catch (actionError) {
      setResultActionState("error");
      setResultActionMessage(actionError instanceof Error ? actionError.message : "Result action failed");
    }
  }

  async function loadTaskRunById(taskRunId: string, successMessage?: string) {
    setReloadState("loading");
    setReloadMessage("");
    try {
      const loadedRun = await getJson<TaskRun>(`/api/task-runs/${taskRunId}`);
      const loadedResult = await getJson<TaskRunResultCenter>(`/api/task-runs/${taskRunId}/result-center`);
      const loadedArtifact = loadedRun.artifact_id ? await getJson<Artifact>(`/api/artifacts/${loadedRun.artifact_id}`) : null;
      const loadedArtifactVersions = loadedRun.artifact_id
        ? await getJson<ArtifactVersionRecord[]>(`/api/artifacts/${loadedRun.artifact_id}/versions`)
        : [];
      setTaskRun(loadedRun);
      setResultCenter(loadedResult);
      setArtifact(loadedArtifact);
      setArtifactVersions(loadedArtifactVersions);
      restoreScenarioFromTaskRunPayload(loadedRun, loadedArtifact);
      if (loadedResult.followup_continuity.is_followup) {
        const continuity = loadedResult.followup_continuity;
        setOpenedFollowupTaskRunId(loadedRun.id);
        setCycleSourceTaskRunId(continuity.source_task_run_id ?? "");
        setCycleNumber((current) => Math.max(current, continuity.cycle_number ?? 2, 2));
        if (continuity.goal || continuity.expected_artifact || continuity.source_context || continuity.urgency) {
          setProductTask({
            goal: continuity.goal ?? "Продолжить связанный результат",
            expectedArtifact: continuity.expected_artifact ?? loadedArtifact?.title ?? "Следующий управляемый артефакт",
            sourceContext: continuity.source_context ?? continuity.summary,
            urgency: continuity.urgency ?? "Проверить результат связанного цикла"
          });
        }
      }
      setVersionCompare(null);
      setVersionCompareState("idle");
      setVersionCompareMessage("");
      setReloadState("loaded");
      setReloadMessage(successMessage ?? `${taskRunId}: результат восстановлен`);
    } catch (loadError) {
      setReloadState("error");
      setReloadMessage(loadError instanceof Error ? loadError.message : "TaskRun reload failed");
    }
  }

  async function loadExistingTaskRun() {
    const taskRunId = reloadTaskRunId.trim();
    if (!taskRunId) {
      setReloadState("error");
      setReloadMessage("Укажите TaskRun ID.");
      return;
    }

    setOpenedFollowupTaskRunId("");
    setCycleSourceTaskRunId("");
    setCycleNumber(1);
    await loadTaskRunById(taskRunId);
  }

  async function openLinkedFollowupTaskRun() {
    if (!linkedFollowupTaskRunId || reloadState === "loading") {
      return;
    }

    const sourceTaskRunId = resultCenter?.task_run_id ?? taskRun?.id ?? "";
    const targetCycleNumber = isFollowupCycleOpen ? cycleNumber + 1 : 2;
    setOpenedFollowupTaskRunId(linkedFollowupTaskRunId);
    setCycleSourceTaskRunId(sourceTaskRunId);
    setCycleNumber(targetCycleNumber);
    setProductTask({
      goal: nextStepPayloadForCreation.goal,
      expectedArtifact: nextStepPayloadForCreation.expected_artifact,
      sourceContext: nextStepPayloadForCreation.source_context,
      urgency: nextStepPayloadForCreation.urgency
    });
    setReloadTaskRunId(linkedFollowupTaskRunId);
    await loadTaskRunById(linkedFollowupTaskRunId, `${linkedFollowupTaskRunId}: следующий запуск открыт`);
  }

  async function applyScenarioResumePrimaryAction() {
    if (!scenarioResume || reloadState === "loading" || resultActionState === "saving") {
      return;
    }

    if (scenarioResume.primary_action === "open-followup") {
      const targetTaskRunId = scenarioResume.primary_action_target_task_run_id || linkedFollowupTaskRunId;
      if (!targetTaskRunId) {
        return;
      }
      if (targetTaskRunId === linkedFollowupTaskRunId) {
        await openLinkedFollowupTaskRun();
        return;
      }
      setReloadTaskRunId(targetTaskRunId);
      await loadTaskRunById(targetTaskRunId, `${targetTaskRunId}: следующий запуск открыт`);
      return;
    }

    if (scenarioResume.primary_action === "confirm-next-step") {
      await confirmNextStepReview();
      return;
    }

    if (scenarioResume.primary_action === "create-next-task" && createNextTaskAction?.status === "available") {
      await applyResultAction(createNextTaskAction);
      return;
    }

    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyFollowupExecutionPrimaryAction() {
    if (!followupExecutionWorkspace) {
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyCurrentCycleOutcomePrimaryAction() {
    if (!currentCycleOutcomeWorkspace) {
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyOutcomeNextCycleLauncherPrimaryAction() {
    if (!outcomeNextCycleLauncher) {
      return;
    }
    if (outcomeNextCycleLauncher.primary_action === "open-next-cycle" && outcomeNextCycleLauncher.linked_task_run_id) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: цикл ${outcomeNextCycleLauncher.target_cycle_number} открыт`
      );
      return;
    }
    if (outcomeNextCycleLauncher.primary_action === "create-next-cycle" && createNextTaskAction?.status === "available") {
      await applyResultAction(createNextTaskAction);
      return;
    }
    if (outcomeNextCycleLauncher.primary_action === "confirm-next-cycle") {
      await confirmOutcomeNextCycleLaunchReview();
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyCycleExecutionBriefPrimaryAction() {
    if (!cycleExecutionBrief) {
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyCycleAcceptanceWorkspacePrimaryAction() {
    if (!cycleAcceptanceWorkspace) {
      return;
    }
    if (cycleAcceptanceWorkspace.primary_action === "open-next-cycle" && linkedFollowupTaskRunId) {
      await loadTaskRunById(linkedFollowupTaskRunId, `${linkedFollowupTaskRunId}: следующий цикл открыт`);
      return;
    }
    if (cycleAcceptanceWorkspace.primary_action === "continue-next-cycle" && createNextTaskAction?.status === "available") {
      await applyResultAction(createNextTaskAction);
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyCycleContinuityWorkspacePrimaryAction() {
    if (!cycleContinuityWorkspace) {
      return;
    }
    if (
      cycleContinuityWorkspace.primary_action === "continue-chain" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: цикл ${outcomeNextCycleLauncher.target_cycle_number} открыт`
      );
      return;
    }
    if (cycleContinuityWorkspace.primary_action === "accept-cycle-result") {
      document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    document.getElementById("user-cycle-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyAccumulatedBusinessAssetPrimaryAction() {
    if (!accumulatedBusinessAssetWorkspace) {
      return;
    }
    if (
      accumulatedBusinessAssetWorkspace.primary_action === "continue-asset-chain" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл актива открыт`
      );
      return;
    }
    if (accumulatedBusinessAssetWorkspace.primary_action === "accept-current-asset") {
      document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    document.getElementById("user-cycle-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetDecisionPrimaryAction() {
    if (!businessAssetDecisionWorkspace) {
      return;
    }
    if (
      businessAssetDecisionWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл бизнес-актива открыт`
      );
      return;
    }
    if (
      businessAssetDecisionWorkspace.primary_action === "continue-asset" &&
      createNextTaskAction?.status === "available"
    ) {
      await applyResultAction(createNextTaskAction);
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetRouteOutcomePrimaryAction() {
    if (!businessAssetRouteOutcomeWorkspace) {
      return;
    }
    if (
      businessAssetRouteOutcomeWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после решения открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetManualReviewPrimaryAction() {
    if (!businessAssetManualReviewWorkspace) {
      return;
    }
    if (
      businessAssetManualReviewWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после ручной проверки открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGAcceptancePackagePrimaryAction() {
    if (!businessAssetGAcceptancePackageWorkspace) {
      return;
    }
    if (
      businessAssetGAcceptancePackageWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после G-package открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGReviewExecutionPrimaryAction() {
    if (!businessAssetGReviewExecutionWorkspace) {
      return;
    }
    if (
      businessAssetGReviewExecutionWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после G-проверки открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGCheckHandoffPrimaryAction() {
    if (!businessAssetGCheckHandoffWorkspace) {
      return;
    }
    if (
      businessAssetGCheckHandoffWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после handoff открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGDecisionDraftPrimaryAction() {
    if (!businessAssetGDecisionDraftWorkspace) {
      return;
    }
    if (
      businessAssetGDecisionDraftWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после draft G-решения открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGDecisionImpactPrimaryAction() {
    if (!businessAssetGDecisionImpactWorkspace) {
      return;
    }
    if (
      businessAssetGDecisionImpactWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после impact G-решения открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGDecisionReadinessPrimaryAction() {
    if (!businessAssetGDecisionReadinessWorkspace) {
      return;
    }
    if (
      businessAssetGDecisionReadinessWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после readiness G-проверки открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGDecisionChecklistPrimaryAction() {
    if (!businessAssetGDecisionChecklistWorkspace) {
      return;
    }
    if (
      businessAssetGDecisionChecklistWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после checklist G-проверки открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyBusinessAssetGDecisionReviewSummaryPrimaryAction() {
    if (!businessAssetGDecisionReviewSummaryWorkspace) {
      return;
    }
    if (
      businessAssetGDecisionReviewSummaryWorkspace.primary_action === "open-next-cycle" &&
      outcomeNextCycleLauncher?.linked_task_run_id
    ) {
      await loadTaskRunById(
        outcomeNextCycleLauncher.linked_task_run_id,
        `${outcomeNextCycleLauncher.linked_task_run_id}: следующий цикл после summary G-проверки открыт`
      );
      return;
    }
    document.getElementById("result-decision")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const vaultTabs = [
    { id: "mission" as const, title: "Миссия.md", detail: selectedBusinessMission.title },
    { id: "result" as const, title: "Result Center", detail: resultCenter ? artifactAcceptanceStatus : "ожидает запуска" },
    { id: "evidence" as const, title: "Evidence", detail: evidenceTotalCount ? `${completedEvidenceCount}/${evidenceTotalCount}` : "нет proof" },
    { id: "updates" as const, title: "Core Updates", detail: coreUpdateStatus }
  ];
  const missionPreviewLines = missionNoteDraft
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  const vaultBacklinks = [
    "CJM боевого прототипа",
    selectedScenarioPack.title,
    selectedRolePack.title,
    resultCenter ? "Result Center / принято к проверке" : "Runtime launch / ожидает запуска",
    `${activeDocumentIds.length} материалов миссии`
  ];
  const vaultOutgoingLinks = [
    "Материалы миссии",
    "AI-команда",
    "Evidence",
    "Result Center",
    "Следующий цикл"
  ];
  const vaultOutline = ["Бизнес-миссия", "Цель", "Ожидаемый результат", "Регламент", "Evidence", "Следующий шаг"];
  const vaultSearchMatches = [
    selectedBusinessMission.title,
    selectedScenarioPack.title,
    productTask.goal,
    productTask.expectedArtifact,
    nextStepBrief.goal
  ].filter((item) => item.toLowerCase().includes(vaultSearchQuery.trim().toLowerCase()));

  return (
    <main className={viewMode === "user" ? "user-page" : "operator-page"}>
      <section className="topbar">
        <div>
          <p className="eyebrow">VIK / SYM</p>
          <h1>SYM-SaaS Vault</h1>
          <p className="topbar-subtitle">
            Интерфейсная модель Obsidian: vault, notes, panes, graph, backlinks, command palette.
          </p>
        </div>
        <div className="status-group">
          <span className={`status status-${state}`}>{state === "complete" ? "результат готов" : state === "running" ? "в работе" : state === "ready" ? "готов к запуску" : state}</span>
          <span className={`status status-${taskIntakeState === "error" ? "error" : taskIntakeState === "ready" ? "complete" : ""}`}>
            вход {taskIntakePreview?.readiness_score ?? 0}%
          </span>
          <span className="status">готовность {productFitScore}%</span>
          <span className="status">{resultCenter?.product_status === "accepted" ? "принято" : resultCenter?.product_status === "ready_for_acceptance" ? "на приемке" : "результат ожидает"}</span>
          <span className="status status-technical">API {apiBase}</span>
        </div>
      </section>

      <section className="view-mode-panel" aria-label="Режим просмотра">
        <div>
          <p className="eyebrow">Режим просмотра</p>
          <h2>{activeViewMode.title}</h2>
          <p>{activeViewMode.description}</p>
        </div>
        <div className="view-mode-switch" role="group" aria-label="Выбор режима интерфейса">
          {VIEW_MODES.map((mode) => (
            <button
              className={`view-mode-button ${viewMode === mode.id ? "is-active" : ""}`}
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              type="button"
            >
              <strong>{mode.title}</strong>
              <small>{mode.description}</small>
            </button>
          ))}
        </div>
        <div className="visibility-summary" aria-label="Что видно в выбранном режиме">
          <strong>В этом режиме видно</strong>
          <div>
            {visibilitySummary.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <section className="alert">
          <strong>Ошибка сценария</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section className={`obsidian-vault-shell is-${activeVaultView}`} aria-label="Рабочее пространство Симбиота">
        <section className="obsidian-app-chrome" aria-label="Панель приложения">
          <div className="app-chrome-left">
            <strong>SYM-SaaS Vault</strong>
            <span>локальный боевой прототип</span>
          </div>
          <div className="app-command-bar" role="search">
            <span>Ctrl+P</span>
            <input
              aria-label="Поиск по vault"
              onChange={(event) => setVaultSearchQuery(event.target.value)}
              placeholder="Command palette / Quick switcher..."
              type="search"
              value={vaultSearchQuery}
            />
            <button className="button-secondary" onClick={() => setActiveVaultView("search")} type="button">
              Найти
            </button>
          </div>
          <div className="app-chrome-actions">
            <span className={`status status-${state}`}>{state === "complete" ? "runtime ok" : state}</span>
            <button
              className="button-secondary"
              onClick={() => {
                setActiveVaultView("updates");
                setActiveVaultTab("updates");
                setCoreUpdateStatus(`Локально обновлено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
              }}
              type="button"
            >
              Обновить ядро
            </button>
          </div>
        </section>

        <aside className="vault-ribbon" aria-label="Быстрые разделы">
          {[
            { id: "files", label: "Files", icon: "▤", title: "Файлы" },
            { id: "search", label: "Search", icon: "⌕", title: "Поиск" },
            { id: "graph", label: "Graph", icon: "⌬", title: "Граф" },
            { id: "evidence", label: "EV", icon: "✓", title: "Evidence" },
            { id: "updates", label: "Sync", icon: "↻", title: "Обновления" }
          ].map(({ id, label, icon, title }) => (
            <button
              aria-label={title}
              aria-pressed={activeVaultView === id}
              className={`ribbon-button ${activeVaultView === id ? "is-active" : ""}`}
              key={id}
              onClick={() => setActiveVaultView(id as "files" | "search" | "graph" | "evidence" | "updates")}
              title={title}
              type="button"
            >
              <span className="ribbon-icon">{icon}</span>
              <span className="ribbon-label">{label}</span>
            </button>
          ))}
        </aside>

        <aside className="vault-sidebar" aria-label="Vault проекта">
          <div className="vault-title">
            <span>File explorer</span>
            <strong>SYM-SaaS</strong>
          </div>
          <label className="vault-search">
            <span>Быстрый фильтр</span>
            <input
              onChange={(event) => setVaultSearchQuery(event.target.value)}
              placeholder="mission, evidence, update"
              type="search"
              value={vaultSearchQuery}
            />
          </label>
          <div className="vault-create-row" aria-label="Создание объектов vault">
            <button aria-label="Создать папку проекта" onClick={() => setActiveVaultView("files")} title="Создать папку проекта" type="button">
              +
            </button>
            <button
              aria-label="Создать миссию"
              onClick={() => {
                setActiveVaultTab("mission");
                setMissionNoteDraft((value) =>
                  value.includes("## Новая миссия")
                    ? value
                    : `${value}\n\n## Новая миссия\n- Опишите бизнес-результат.\n- Добавьте материалы.\n- Запустите автоном.`
                );
              }}
              title="Создать миссию"
              type="button"
            >
              ✦
            </button>
            <button
              aria-label="Создать заметку"
              onClick={() => {
                setActiveVaultTab("mission");
                setMissionNoteDraft((value) => `${value}\n\n## Заметка\n- `);
              }}
              title="Создать заметку"
              type="button"
            >
              ✎
            </button>
          </div>
          {activeVaultView === "search" && vaultSearchQuery.trim() ? (
            <div className="vault-search-results" aria-label="Результаты поиска">
              <strong>Найдено в рабочем контексте</strong>
              {vaultSearchMatches.length ? (
                vaultSearchMatches.map((item) => <small key={item}>{item}</small>)
              ) : (
                <small>Совпадений нет в текущем локальном контексте.</small>
              )}
            </div>
          ) : null}
          <nav className="vault-tree" aria-label="File explorer проекта">
            <a className="vault-node is-folder is-project" href="#mission-note">
              <span>▾</span>
              <strong>01_Проекты</strong>
              <small>folder</small>
            </a>
            <a className="vault-node is-child is-folder" href="#mission-note">
              <span>▾</span>
              <strong>SYM-SaaS</strong>
              <small>product vault folder</small>
            </a>
            <a className="vault-node is-child" href="#mission-note">
              <span>md</span>
              <strong>00_Ядро_Симбиота.md</strong>
              <small>rules · roles · protocols</small>
            </a>
            <a className="vault-node is-child is-folder" href="#mission-note">
              <span>▾</span>
              <strong>01_Миссии</strong>
              <small>mission folder</small>
            </a>
            <a className="vault-node is-child is-mission" href="#mission-note">
              <span>md</span>
              <strong>{selectedBusinessMission.title}.md</strong>
              <small>active mission note</small>
            </a>
            <a className="vault-node is-child" href="#source-attachments">
              <span>md</span>
              <strong>Материалы миссии.md</strong>
              <small>{activeDocumentIds.length} linked source</small>
            </a>
            <a className="vault-node is-child" href="#result-center">
              <span>md</span>
              <strong>Result Center.md</strong>
              <small>{resultCenter ? artifactAcceptanceStatus : "not created"}</small>
            </a>
            <a className="vault-node is-child" href="#mission-note">
              <span>cv</span>
              <strong>Mission Graph.canvas</strong>
              <small>local graph</small>
            </a>
          </nav>
          <div className="vault-update">
            <strong>Обновление ядра</strong>
            <small>{coreUpdateStatus}</small>
            <button
              className="button-secondary"
              onClick={() => {
                setCoreUpdateStatus(`Локально обновлено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
              }}
              type="button"
            >
              Обновить комплект
            </button>
            <small>Production-доставка обновлений: YELLOW</small>
          </div>
          <div className="vault-commands">
            <strong>Команды vault</strong>
            <button className="button-secondary" onClick={() => setActiveVaultTab("mission")} type="button">
              Открыть миссию
            </button>
            <button className="button-secondary" onClick={() => setActiveVaultTab("evidence")} type="button">
              Проверить evidence
            </button>
            <button className="button-secondary" onClick={() => setActiveVaultView("graph")} type="button">
              Показать граф
            </button>
          </div>
        </aside>

        <div className="vault-center">
          <nav className="vault-workbench-tabs" aria-label="Открытые документы">
            {vaultTabs.map((tab) => (
              <button
                className={`vault-tab ${activeVaultTab === tab.id ? "is-active" : ""}`}
                key={tab.id}
                onClick={() => setActiveVaultTab(tab.id)}
                type="button"
              >
                <strong>{tab.title}</strong>
                <small>{tab.detail}</small>
              </button>
            ))}
          </nav>

          <section className="vault-note-banner" id="mission-note" aria-label="Сценарная заметка бизнес-миссии">
            <div>
              <p className="eyebrow">Сценарная заметка</p>
              <h2>{selectedBusinessMission.title}</h2>
              <p>{selectedBusinessMission.outcome}</p>
            </div>
            <div className="vault-note-meta">
              <span>{selectedScenarioPack.title}</span>
              <span>{selectedRolePack.title}</span>
              <span>{taskIntakePreview?.readiness_score ?? 0}% вход</span>
            </div>
          </section>

          <section className="vault-note-workbench" aria-label="Рабочая заметка миссии">
            <div className="vault-note-editor">
              <div className="vault-note-editor-head">
                <div>
                  <p className="eyebrow">Markdown-сценарий</p>
                  <h3>{vaultTabs.find((tab) => tab.id === activeVaultTab)?.title}</h3>
                </div>
                <div className="editor-mode-switch" aria-label="Режим редактора">
                  <button className="is-active" type="button">Editing</button>
                  <button type="button">Reading</button>
                </div>
                <span>{missionNoteDraft.length} символов</span>
              </div>
              <textarea
                aria-label="Текст сценарной заметки"
                onChange={(event) => setMissionNoteDraft(event.target.value)}
                value={missionNoteDraft}
              />
            </div>
            <aside className="vault-note-preview" aria-label="Preview и свойства">
              <div className="vault-properties">
                <strong>Properties</strong>
                <span>mission: {selectedBusinessMission.title}</span>
                <span>scenario: {selectedScenarioPack.title}</span>
                <span>roles: {selectedWorkgroup.length}</span>
                <span>runtime: {state}</span>
              </div>
              <div className="vault-preview-list">
                <strong>Preview</strong>
                {missionPreviewLines.map((line) => (
                  <p className={line.startsWith("#") ? "is-heading" : ""} key={line}>
                    {line.replace(/^#+\s?/, "")}
                  </p>
                ))}
              </div>
            </aside>
          </section>

          <section className="vault-function-dock" aria-label="Функции миссии">
            <button
              aria-label="Создать миссию"
              onClick={() => {
                setActiveVaultTab("mission");
                setMissionNoteDraft((value) =>
                  value.includes("## Новая миссия")
                    ? value
                    : `${value}\n\n## Новая миссия\n- Опишите бизнес-результат.\n- Добавьте материалы.\n- Запустите автоном.`
                );
              }}
              title="Создать миссию"
              type="button"
            >
              +
            </button>
            <label aria-label="Прикрепить материал" title="Прикрепить материал">
              ⇧
              <input
                type="file"
                onChange={(event) => {
                  void uploadMissionFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button aria-label="Запустить автоном" disabled={Boolean(launchBlocker)} onClick={runMvpPath} title="Запустить автоном" type="button">
              ▶
            </button>
            <button aria-label="Открыть результат" onClick={() => setActiveVaultTab("result")} title="Открыть результат" type="button">
              ▣
            </button>
            <button
              aria-label="Проверить evidence"
              onClick={() => {
                setActiveVaultTab("evidence");
                setActiveVaultView("evidence");
              }}
              title="Проверить evidence"
              type="button"
            >
              ✓
            </button>
            <button aria-label="Открыть граф" onClick={() => setActiveVaultView("graph")} title="Открыть граф" type="button">
              ⌬
            </button>
            <button
              aria-label="Обновить комплект ядра"
              onClick={() => {
                setActiveVaultView("updates");
                setActiveVaultTab("updates");
                setCoreUpdateStatus(`Локально обновлено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
              }}
              title="Обновить комплект ядра"
              type="button"
            >
              ↻
            </button>
          </section>

      <section className="product-shell vault-functional-legacy">
        <div className="product-main panel">
          <div className="panel-header">
            <p className="eyebrow">Главная миссия</p>
            <h2>Симбиот берет бизнес-миссию в работу и возвращает проверяемый результат</h2>
            <p>
              Это первый продуктовый слой поверх Runtime: пользователь видит не технический запуск, а понятный маршрут
              от миссии к артефакту, проверкам качества и следующему действию.
            </p>
          </div>

          <div className="product-flow" aria-label="Product-Fit scenario">
            {productStepStates.map(({ step, status }, index) => (
              <div className={`product-step is-${status}`} key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>

          {resultCenter && !isFollowupCycleOpen ? (
            <section className="artifact-composer-preview" aria-label="Черновик результата">
              <div className="artifact-composer-preview-head">
                <div>
                  <p className="eyebrow">Черновик результата</p>
                  <h3>{artifactComposerEditorValue.title || artifactComposerDraft.title}</h3>
                </div>
                <span className={`artifact-composer-status ${artifactEditorIsCustom ? "is-custom" : ""}`}>
                  {artifactEditorStatusLabel}
                </span>
              </div>
              <div className="artifact-composer-body">
                <div className="artifact-editor-fields">
                  <label className="artifact-editor-field">
                    <span>Название артефакта</span>
                    <input
                      data-testid="artifact-editor-title"
                      onChange={(event) => updateArtifactEditorField("title", event.target.value)}
                      type="text"
                      value={artifactComposerEditorValue.title}
                    />
                  </label>
                  <label className="artifact-editor-field">
                    <span>Текст результата</span>
                    <textarea
                      data-testid="artifact-editor-body"
                      onChange={(event) => updateArtifactEditorField("body", event.target.value)}
                      rows={5}
                      value={artifactComposerEditorValue.body}
                    />
                  </label>
                  <label className="artifact-editor-field">
                    <span>Следующее действие</span>
                    <textarea
                      data-testid="artifact-editor-next"
                      onChange={(event) => updateArtifactEditorField("next", event.target.value)}
                      rows={2}
                      value={artifactComposerEditorValue.next}
                    />
                  </label>
                </div>
                <div className="artifact-composer-proof">
                  <strong>Основание</strong>
                  <span>{artifactComposerDraft.proof}</span>
                </div>
                <div className="artifact-composer-next">
                  <strong>Следующее действие</strong>
                  <span>{artifactComposerEditorValue.next}</span>
                </div>
              </div>
              <div className="artifact-editor-actions">
                <button
                  className="secondary-action"
                  data-testid="artifact-editor-save"
                  disabled={!artifactEditorHasUnsavedChanges || workspacePersistenceState === "saving"}
                  onClick={saveArtifactEditorDraft}
                  type="button"
                >
                  Сохранить правку
                </button>
                <button
                  className="button-secondary"
                  data-testid="artifact-editor-reset"
                  disabled={!artifactEditorIsCustom || workspacePersistenceState === "saving"}
                  onClick={resetArtifactEditorDraft}
                  type="button"
                >
                  Сбросить к версии Симбиота
                </button>
                {artifactEditorSavedDraft ? (
                  <small className="artifact-editor-save-note">
                    Локальная рабочая версия сохранена в этом экране; внешняя отправка не выполнялась.
                  </small>
                ) : null}
                {workspacePersistenceMessage ? (
                  <small className={`workspace-persistence-note is-${workspacePersistenceState}`}>
                    {workspacePersistenceMessage}
                  </small>
                ) : null}
              </div>
              <div className={`edited-artifact-next-step ${nextStepUsesEditedArtifact ? "is-edited" : ""}`}>
                <strong>{nextStepUsesEditedArtifact ? "Следующий шаг пойдет по вашей правке" : "Следующий шаг пока идет по версии Симбиота"}</strong>
                <span>{nextStepBrief.goal}</span>
                <small>{nextStepBrief.urgency}</small>
              </div>
              <div className="artifact-composer-checklist">
                {artifactComposerDraft.checklist.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </section>
          ) : null}

          {isFollowupCycleOpen ? (
            <section className="user-cycle-panel" id="user-cycle-panel" aria-label="Текущий цикл миссии">
              <div className="user-cycle-head">
                <div>
                  <p className="eyebrow">Цикл {currentCycleNumber}</p>
                  <h2>Этот запуск продолжает принятую цепочку</h2>
                </div>
                <span>открыт</span>
              </div>
              <div className="user-cycle-trail" aria-label="Петля миссий">
                <span>Цикл {currentCycleNumber - 1} принят</span>
                <strong>Цикл {currentCycleNumber} сейчас</strong>
                <span>Цикл {nextCycleNumber} следующий</span>
              </div>
              {cycleContinuityWorkspace?.is_active ? (
                <section className="cycle-continuity-workspace" aria-label="Самостоятельная рабочая зона цикла">
                  <div className="cycle-continuity-head">
                    <div>
                      <p className="eyebrow">Цикл {cycleContinuityWorkspace.cycle_number}</p>
                      <h3>{cycleContinuityWorkspace.title}</h3>
                      <p>{cycleContinuityWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyCycleContinuityWorkspacePrimaryAction} type="button">
                      {cycleContinuityWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="cycle-continuity-grid">
                    {cycleContinuityWorkspace.items.map((item) => (
                      <article className={`cycle-continuity-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {accumulatedBusinessAssetWorkspace?.is_active ? (
                <section className="business-asset-workspace" aria-label="Накопленный бизнес-актив">
                  <div className="business-asset-head">
                    <div>
                      <p className="eyebrow">{accumulatedBusinessAssetWorkspace.accumulated_cycles} цикла в активе</p>
                      <h3>{accumulatedBusinessAssetWorkspace.title}</h3>
                      <p>{accumulatedBusinessAssetWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyAccumulatedBusinessAssetPrimaryAction} type="button">
                      {accumulatedBusinessAssetWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-grid">
                    {accumulatedBusinessAssetWorkspace.items.map((item) => (
                      <article className={`business-asset-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetDecisionWorkspace?.is_active ? (
                <section className="business-asset-decision-workspace" aria-label="Решение по накопленному бизнес-активу">
                  <div className="business-asset-decision-head">
                    <div>
                      <p className="eyebrow">Решение по активу · цикл {businessAssetDecisionWorkspace.cycle_number}</p>
                      <h3>{businessAssetDecisionWorkspace.title}</h3>
                      <p>{businessAssetDecisionWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetDecisionPrimaryAction} type="button">
                      {businessAssetDecisionWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-decision-grid">
                    {businessAssetDecisionWorkspace.items.map((item) => (
                      <article className={`business-asset-decision-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetRouteOutcomeWorkspace?.is_active ? (
                <section className="business-asset-route-outcome-workspace" aria-label="Итог решения по бизнес-активу">
                  <div className="business-asset-route-outcome-head">
                    <div>
                      <p className="eyebrow">Итог маршрута · {businessAssetRouteOutcomeWorkspace.selected_route ?? "ожидает решения"}</p>
                      <h3>{businessAssetRouteOutcomeWorkspace.title}</h3>
                      <p>{businessAssetRouteOutcomeWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetRouteOutcomePrimaryAction} type="button">
                      {businessAssetRouteOutcomeWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-route-outcome-grid">
                    {businessAssetRouteOutcomeWorkspace.items.map((item) => (
                      <article className={`business-asset-route-outcome-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetManualReviewWorkspace?.is_active ? (
                <section className="business-asset-manual-review-workspace" aria-label="Ручная проверка бизнес-актива">
                  <div className="business-asset-manual-review-head">
                    <div>
                      <p className="eyebrow">G-проверка · {businessAssetManualReviewWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetManualReviewWorkspace.title}</h3>
                      <p>{businessAssetManualReviewWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetManualReviewPrimaryAction} type="button">
                      {businessAssetManualReviewWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-manual-review-grid">
                    {businessAssetManualReviewWorkspace.items.map((item) => (
                      <article className={`business-asset-manual-review-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGAcceptancePackageWorkspace?.is_active ? (
                <section className="business-asset-g-package-workspace" aria-label="G-package приемки бизнес-актива">
                  <div className="business-asset-g-package-head">
                    <div>
                      <p className="eyebrow">G-package · {businessAssetGAcceptancePackageWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGAcceptancePackageWorkspace.title}</h3>
                      <p>{businessAssetGAcceptancePackageWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGAcceptancePackagePrimaryAction} type="button">
                      {businessAssetGAcceptancePackageWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-package-grid">
                    {businessAssetGAcceptancePackageWorkspace.items.map((item) => (
                      <article className={`business-asset-g-package-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGReviewExecutionWorkspace?.is_active ? (
                <section className="business-asset-g-review-workspace" aria-label="Прохождение G-проверки бизнес-актива">
                  <div className="business-asset-g-review-head">
                    <div>
                      <p className="eyebrow">G-проверка · {businessAssetGReviewExecutionWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGReviewExecutionWorkspace.title}</h3>
                      <p>{businessAssetGReviewExecutionWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGReviewExecutionPrimaryAction} type="button">
                      {businessAssetGReviewExecutionWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-review-grid">
                    {businessAssetGReviewExecutionWorkspace.items.map((item) => (
                      <article className={`business-asset-g-review-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGCheckHandoffWorkspace?.is_active ? (
                <section className="business-asset-g-handoff-workspace" aria-label="Handoff ручной G-проверки">
                  <div className="business-asset-g-handoff-head">
                    <div>
                      <p className="eyebrow">G-handoff · {businessAssetGCheckHandoffWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGCheckHandoffWorkspace.title}</h3>
                      <p>{businessAssetGCheckHandoffWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGCheckHandoffPrimaryAction} type="button">
                      {businessAssetGCheckHandoffWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-handoff-grid">
                    {businessAssetGCheckHandoffWorkspace.items.map((item) => (
                      <article className={`business-asset-g-handoff-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGDecisionDraftWorkspace?.is_active ? (
                <section className="business-asset-g-decision-draft-workspace" aria-label="Draft ручного G-решения">
                  <div className="business-asset-g-decision-draft-head">
                    <div>
                      <p className="eyebrow">G-decision draft · {businessAssetGDecisionDraftWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGDecisionDraftWorkspace.title}</h3>
                      <p>{businessAssetGDecisionDraftWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGDecisionDraftPrimaryAction} type="button">
                      {businessAssetGDecisionDraftWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-decision-draft-grid">
                    {businessAssetGDecisionDraftWorkspace.options.map((option) => (
                      <article className={`business-asset-g-decision-draft-option is-${option.status}`} key={option.id}>
                        <span>{option.title}</span>
                        <strong>{option.value}</strong>
                        <small>{option.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGDecisionImpactWorkspace?.is_active ? (
                <section className="business-asset-g-decision-impact-workspace" aria-label="Последствия G-решения">
                  <div className="business-asset-g-decision-impact-head">
                    <div>
                      <p className="eyebrow">G-decision impact · {businessAssetGDecisionImpactWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGDecisionImpactWorkspace.title}</h3>
                      <p>{businessAssetGDecisionImpactWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGDecisionImpactPrimaryAction} type="button">
                      {businessAssetGDecisionImpactWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-decision-impact-grid">
                    {businessAssetGDecisionImpactWorkspace.items.map((item) => (
                      <article className={`business-asset-g-decision-impact-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGDecisionReadinessWorkspace?.is_active ? (
                <section className="business-asset-g-decision-readiness-workspace" aria-label="Готовность к ручной G-проверке">
                  <div className="business-asset-g-decision-readiness-head">
                    <div>
                      <p className="eyebrow">G-readiness · {businessAssetGDecisionReadinessWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGDecisionReadinessWorkspace.title}</h3>
                      <p>{businessAssetGDecisionReadinessWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGDecisionReadinessPrimaryAction} type="button">
                      {businessAssetGDecisionReadinessWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-decision-readiness-grid">
                    {businessAssetGDecisionReadinessWorkspace.items.map((item) => (
                      <article className={`business-asset-g-decision-readiness-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGDecisionChecklistWorkspace?.is_active ? (
                <section className="business-asset-g-decision-checklist-workspace" aria-label="Чек-лист ручной G-проверки">
                  <div className="business-asset-g-decision-checklist-head">
                    <div>
                      <p className="eyebrow">G-checklist · {businessAssetGDecisionChecklistWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGDecisionChecklistWorkspace.title}</h3>
                      <p>{businessAssetGDecisionChecklistWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGDecisionChecklistPrimaryAction} type="button">
                      {businessAssetGDecisionChecklistWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-decision-checklist-grid">
                    {businessAssetGDecisionChecklistWorkspace.checklist.map((item) => (
                      <article className={`business-asset-g-decision-checklist-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {businessAssetGDecisionReviewSummaryWorkspace?.is_active ? (
                <section className="business-asset-g-decision-review-summary-workspace" aria-label="Сводка ручной G-проверки">
                  <div className="business-asset-g-decision-review-summary-head">
                    <div>
                      <p className="eyebrow">G-review summary · {businessAssetGDecisionReviewSummaryWorkspace.selected_route ?? "маршрут не выбран"}</p>
                      <h3>{businessAssetGDecisionReviewSummaryWorkspace.title}</h3>
                      <p>{businessAssetGDecisionReviewSummaryWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyBusinessAssetGDecisionReviewSummaryPrimaryAction} type="button">
                      {businessAssetGDecisionReviewSummaryWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="business-asset-g-decision-review-summary-grid">
                    {businessAssetGDecisionReviewSummaryWorkspace.review_items.map((item) => (
                      <article className={`business-asset-g-decision-review-summary-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {cycleExecutionBrief?.is_active ? (
                <section className="cycle-execution-brief" aria-label="Рабочая сводка текущего цикла">
                  <div className="cycle-execution-brief-head">
                    <div>
                      <p className="eyebrow">Рабочая сводка цикла {cycleExecutionBrief.cycle_number}</p>
                      <h3>{cycleExecutionBrief.inherited_outcome}</h3>
                      <p>{cycleExecutionBrief.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyCycleExecutionBriefPrimaryAction} type="button">
                      {cycleExecutionBrief.primary_action_label}
                    </button>
                  </div>
                  <div className="cycle-execution-brief-grid">
                    {cycleExecutionBrief.items.map((item) => (
                      <article className={`cycle-execution-brief-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {cycleAcceptanceWorkspace?.is_active ? (
                <section className="cycle-acceptance-workspace" aria-label="Приемка результата текущего цикла">
                  <div className="cycle-acceptance-head">
                    <div>
                      <p className="eyebrow">Приемка цикла {cycleAcceptanceWorkspace.cycle_number}</p>
                      <h3>{cycleAcceptanceWorkspace.result_title}</h3>
                      <p>{cycleAcceptanceWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyCycleAcceptanceWorkspacePrimaryAction} type="button">
                      {cycleAcceptanceWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="cycle-acceptance-grid">
                    {cycleAcceptanceWorkspace.acceptance_items.map((item) => (
                      <article className={`cycle-acceptance-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                  <div className="cycle-acceptance-routes" aria-label="Маршруты приемки текущего цикла">
                    {cycleAcceptanceWorkspace.decision_items.map((item) => (
                      <article className={`cycle-acceptance-route is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {followupExecutionWorkspace?.is_active ? (
                <section className="followup-execution-workspace" aria-label="Рабочая зона текущего follow-up">
                  <div className="followup-execution-head">
                    <div>
                      <p className="eyebrow">Рабочий цикл</p>
                      <h3>{followupExecutionWorkspace.title}</h3>
                      <p>{followupExecutionWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyFollowupExecutionPrimaryAction} type="button">
                      {followupExecutionWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="followup-execution-grid">
                    {followupExecutionWorkspace.items.map((item) => (
                      <article className={`followup-execution-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                  {followupExecutionWorkspace.inherited_workgroup.length ? (
                    <div className="followup-execution-team" aria-label="Команда текущего цикла">
                      {followupExecutionWorkspace.inherited_workgroup.map((role) => (
                        <span key={role}>{role}</span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
              {currentCycleOutcomeWorkspace?.is_active ? (
                <section className="current-cycle-outcome-workspace" aria-label="Решение текущего цикла">
                  <div className="current-cycle-outcome-head">
                    <div>
                      <p className="eyebrow">Итог цикла {currentCycleOutcomeWorkspace.cycle_number}</p>
                      <h3>{currentCycleOutcomeWorkspace.artifact_title ?? "Результат текущего цикла"}</h3>
                      <p>{currentCycleOutcomeWorkspace.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyCurrentCycleOutcomePrimaryAction} type="button">
                      {currentCycleOutcomeWorkspace.primary_action_label}
                    </button>
                  </div>
                  <div className="current-cycle-outcome-grid">
                    {currentCycleOutcomeWorkspace.items.map((item) => (
                      <article className={`current-cycle-outcome-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                  <div className="current-cycle-route-strip" aria-label="Маршруты решения текущего цикла">
                    {currentCycleOutcomeWorkspace.route_items.map((item) => (
                      <article className={`current-cycle-route-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {outcomeNextCycleLauncher?.is_active ? (
                <section className="outcome-next-cycle-launcher" aria-label="Запуск следующего цикла из outcome">
                  <div className="outcome-next-cycle-head">
                    <div>
                      <p className="eyebrow">Запуск цикла {outcomeNextCycleLauncher.target_cycle_number}</p>
                      <h3>{outcomeNextCycleLauncher.launch_payload.expected_artifact}</h3>
                      <p>{outcomeNextCycleLauncher.summary}</p>
                    </div>
                    <button className="primary-action" onClick={applyOutcomeNextCycleLauncherPrimaryAction} type="button">
                      {outcomeNextCycleLauncher.primary_action_label}
                    </button>
                  </div>
                  <div className="outcome-next-cycle-grid">
                    {outcomeNextCycleLauncher.items.map((item) => (
                      <article className={`outcome-next-cycle-item is-${item.status}`} key={item.id}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                  <div className="outcome-next-cycle-payload" aria-label="Пусковой пакет следующего цикла">
                    <strong>{outcomeNextCycleLauncher.launch_payload.goal}</strong>
                    <span>{outcomeNextCycleLauncher.launch_payload.source_context}</span>
                    <small>{outcomeNextCycleLauncher.launch_payload.urgency}</small>
                  </div>
                </section>
              ) : null}
              {followupContinuity?.is_followup ? (
                <section className="continuity-pack followup-continuity-review" aria-label="Преемственность follow-up">
                  <div className="continuity-pack-head">
                    <p className="eyebrow">Преемственность follow-up</p>
                    <h3>Почему открыт именно этот следующий запуск</h3>
                  </div>
                  <div className="continuity-pack-grid">
                    {followupContinuityReviewItems.map((item) => (
                      <article className={`continuity-pack-item is-${item.status}`} key={item.title}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {followupLineageItems.length ? (
                <section className="continuity-pack followup-lineage-review" aria-label="Цепочка follow-up">
                  <div className="continuity-pack-head">
                    <p className="eyebrow">Цепочка циклов</p>
                    <h3>Как пользователь дошел до текущего запуска</h3>
                  </div>
                  <div className="continuity-pack-grid">
                    {followupLineageItems.map((item) => (
                      <article className={`continuity-pack-item is-${item.status}`} key={`${item.title}-${item.value}`}>
                        <span>{item.title}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="cycle-handoff-strip" aria-label="Передача между циклами">
                {cycleHandoffItems.map((item) => (
                  <article className={`cycle-handoff-item is-${item.status}`} key={item.title}>
                    <span>{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>
              <section className="continuity-pack" aria-label="Подтвержденная основа следующего шага">
                <div className="continuity-pack-head">
                  <p className="eyebrow">Подтвержденная основа</p>
                  <h3>Что пользователь перенес в следующий цикл</h3>
                </div>
                <div className="continuity-pack-grid">
                  {confirmedNextStepItems.map((item) => (
                    <article className={`continuity-pack-item is-${item.status}`} key={item.title}>
                      <span>{item.title}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </article>
                  ))}
                </div>
              </section>
              <section className="continuity-pack" aria-label="Перенос между циклами">
                <div className="continuity-pack-head">
                  <p className="eyebrow">Перенос в цикл</p>
                  <h3>Как принятый результат стал новым запуском</h3>
                </div>
                <div className="continuity-pack-grid">
                  {cycleTransferItems.map((item) => (
                    <article className={`continuity-pack-item is-${item.status}`} key={item.title}>
                      <span>{item.title}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </article>
                  ))}
                </div>
              </section>
              <section className="business-value-chain" aria-label="Бизнес-ценность цепочки">
                <div className="business-value-chain-head">
                  <p className="eyebrow">Бизнес-ценность цепочки</p>
                  <h3>Что получает пользователь, если продолжает цикл</h3>
                </div>
                <div className="business-value-chain-grid">
                  {businessValueChainItems.map((item) => (
                    <article className={`business-value-chain-item is-${item.status}`} key={item.title}>
                      <span>{item.title}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </article>
                  ))}
                </div>
              </section>
              <section className="scenario-package-summary" aria-label="Сценарный пакет">
                <div className="scenario-package-summary-head">
                  <p className="eyebrow">Сценарный пакет</p>
                  <h3>Накопленный результат цикла</h3>
                </div>
            <div className="scenario-package-summary-grid">
              {scenarioPackageSummaryItems.map((item) => (
                <article className={`scenario-package-summary-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="scenario-package-action-strip" aria-label="Что сделать со сценарным пакетом">
              {scenarioPackageActionItems.map((item) => (
                <a className={`scenario-package-action is-${item.status}`} href={item.href} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </a>
              ))}
            </div>
          </section>
          <section className="second-cycle-progress" aria-label="Прогресс второго цикла">
            <div className="second-cycle-progress-head">
              <p className="eyebrow">Прогресс сценария</p>
              <h3>Что изменилось после решения</h3>
            </div>
            <div className="second-cycle-progress-grid">
              {secondCycleProgressItems.map((item) => (
                <article className={`second-cycle-progress-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="continuity-pack" aria-label="Review результата цикла">
            <div className="continuity-pack-head">
              <p className="eyebrow">Review результата цикла</p>
              <h3>Как проверить, что новый результат вырос из подтвержденного шага</h3>
            </div>
            <div className="continuity-pack-grid">
              {cycleResultReviewItems.map((item) => (
                <article className={`continuity-pack-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="client-result-package" aria-label="Клиентский пакет результата">
            <div className="client-result-package-head">
              <p className="eyebrow">Клиентский пакет</p>
              <h3>Что можно показать после цикла</h3>
            </div>
            <div className="client-result-package-grid">
              {clientResultPackageItems.map((item) => (
                <article className={`client-result-package-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="continuity-pack" aria-label="Пакет завершения цикла">
            <div className="continuity-pack-head">
              <p className="eyebrow">Пакет завершения</p>
              <h3>Что остается пользователю после полного прохода</h3>
            </div>
            <div className="continuity-pack-grid">
              {cycleCompletionPackageItems.map((item) => (
                <article className={`continuity-pack-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="result-delivery-workspace" aria-label="Рабочее пространство результата">
            <div className="result-delivery-workspace-head">
              <div>
                <p className="eyebrow">Рабочее пространство результата</p>
                <h3>Что пользователь может забрать из цикла</h3>
              </div>
              <span>{resultCenter?.product_status === "accepted" ? "готово" : "на решении"}</span>
            </div>
            <div className="result-delivery-grid">
              {resultDeliveryWorkspaceItems.map((item) => (
                <article className={`result-delivery-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="result-delivery-actions" aria-label="Действия после результата">
              {resultDeliveryActionItems.map((item) => (
                <article className={`result-delivery-action is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="result-delivery-handoff" aria-label="Локальный handoff результата">
              <strong>Handoff без внешней отправки</strong>
              <p>{resultDeliveryHandoffText}</p>
            </div>
          </section>
          <section className="guided-repeat-run-workspace" aria-label="Рабочее пространство повторного запуска">
            <div className="guided-repeat-run-head">
              <div>
                <p className="eyebrow">Повторный запуск</p>
                <h3>Как превратить результат в следующий рабочий цикл</h3>
              </div>
              <span>{guidedRepeatRunStatusLabel}</span>
            </div>
            <div className="guided-repeat-run-grid">
              {guidedRepeatRunReadinessItems.map((item) => (
                <article className={`guided-repeat-run-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="guided-repeat-run-preview" aria-label="Preview повторного запуска">
              {guidedRepeatRunPreviewItems.map((item) => (
                <article className={`guided-repeat-run-preview-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="guided-repeat-run-summary" aria-label="Локальный preview повторного запуска">
              <strong>Preview без внешней отправки</strong>
              <p>{guidedRepeatRunSummaryText}</p>
            </div>
          </section>
          <section className="repeat-run-execution-board" aria-label="План выполнения повторного запуска">
            <div className="repeat-run-execution-head">
              <div>
                <p className="eyebrow">План выполнения</p>
                <h3>Как пройдет следующий рабочий цикл</h3>
              </div>
              <span>{linkedFollowupTaskRunId ? "можно открыть" : nextStepReviewConfirmed ? "можно создать" : "нужен review"}</span>
            </div>
            <div className="repeat-run-execution-grid">
              {repeatRunExecutionPlanItems.map((item) => (
                <article className={`repeat-run-execution-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="repeat-run-execution-controls" aria-label="Контроль выполнения повторного запуска">
              {repeatRunExecutionControlItems.map((item) => (
                <article className={`repeat-run-execution-control is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="repeat-run-execution-summary" aria-label="Локальный план выполнения">
              <strong>План без внешней отправки</strong>
              <p>{repeatRunExecutionSummaryText}</p>
            </div>
          </section>
          <section className="repeat-run-acceptance-board" aria-label="Приемка повторного цикла">
            <div className="repeat-run-acceptance-head">
              <div>
                <p className="eyebrow">Приемка повторного цикла</p>
                <h3>Как понять, что следующий цикл дал полезный результат</h3>
              </div>
              <span>{linkedFollowupTaskRunId ? "готово к проверке" : nextStepReviewConfirmed ? "ожидает запуска" : "нужен review"}</span>
            </div>
            <div className="repeat-run-acceptance-grid">
              {repeatRunAcceptanceCriteriaItems.map((item) => (
                <article className={`repeat-run-acceptance-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="repeat-run-acceptance-outcomes" aria-label="Исходы приемки повторного цикла">
              {repeatRunAcceptanceOutcomeItems.map((item) => (
                <article className={`repeat-run-acceptance-outcome is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="repeat-run-acceptance-summary" aria-label="Локальный план приемки">
              <strong>Acceptance без внешней отправки</strong>
              <p>{repeatRunAcceptanceSummaryText}</p>
            </div>
          </section>
          <section className="acceptance-decision-router" aria-label="Маршрут решения после приемки">
            <div className="acceptance-decision-head">
              <div>
                <p className="eyebrow">Решение после приемки</p>
                <h3>Что делать с результатом повторного цикла</h3>
              </div>
              <span>{selectedAcceptanceDecisionRoute.badge}</span>
            </div>
            <div className="acceptance-decision-options" aria-label="Варианты решения по результату">
              {acceptanceDecisionRoutes.map((route) => {
                const persistedRoute = persistedAcceptanceDecisionRoutes.get(route.id);
                const routeAvailability = persistedRoute?.availability ?? "available";
                return (
                  <button
                    aria-pressed={acceptanceDecisionRoute === route.id}
                    className={`acceptance-decision-option is-${route.status} ${
                      acceptanceDecisionRoute === route.id ? "is-selected" : ""
                    }`}
                    disabled={acceptanceDecisionState === "saving" || routeAvailability === "blocked"}
                    key={route.id}
                    onClick={() => saveAcceptanceDecisionRoute(route.id)}
                    type="button"
                  >
                    <span>{route.title}</span>
                    <strong>{route.primary}</strong>
                    <small>{route.detail}</small>
                    <small>
                      {routeAvailability === "selected"
                        ? "сохранено"
                        : routeAvailability === "blocked"
                          ? "пока недоступно"
                          : "можно выбрать"}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="acceptance-decision-impact" aria-label="Последствия выбранного решения">
              {acceptanceDecisionImpactItems.map((item) => (
                <article className={`acceptance-decision-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="acceptance-decision-checklist" aria-label="Проверка готовности маршрута">
              {acceptanceDecisionChecklistItems.map((item) => (
                <article className={`acceptance-decision-check is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
            <div className="acceptance-decision-summary" aria-label="Локальная фиксация решения">
              <strong>Фиксация решения без внешней отправки</strong>
              <p>{resultCenter?.acceptance_decision.summary ?? acceptanceDecisionSummaryText}</p>
              {acceptanceDecisionMessage ? (
                <small className={`acceptance-decision-persistence is-${acceptanceDecisionState}`}>
                  {acceptanceDecisionMessage}
                </small>
              ) : null}
            </div>
          </section>
          <section className="artifact-composer-preview" aria-label="Черновик результата">
            <div className="artifact-composer-preview-head">
              <div>
                <p className="eyebrow">Черновик результата</p>
                <h3>{artifactComposerEditorValue.title || artifactComposerDraft.title}</h3>
              </div>
              <span className={`artifact-composer-status ${artifactEditorIsCustom ? "is-custom" : ""}`}>
                {artifactEditorStatusLabel}
              </span>
            </div>
            <div className="artifact-composer-body">
              <div className="artifact-editor-fields">
                <label className="artifact-editor-field">
                  <span>Название артефакта</span>
                  <input
                    data-testid="artifact-editor-title"
                    onChange={(event) => updateArtifactEditorField("title", event.target.value)}
                    type="text"
                    value={artifactComposerEditorValue.title}
                  />
                </label>
                <label className="artifact-editor-field">
                  <span>Текст результата</span>
                  <textarea
                    data-testid="artifact-editor-body"
                    onChange={(event) => updateArtifactEditorField("body", event.target.value)}
                    rows={5}
                    value={artifactComposerEditorValue.body}
                  />
                </label>
                <label className="artifact-editor-field">
                  <span>Следующее действие</span>
                  <textarea
                    data-testid="artifact-editor-next"
                    onChange={(event) => updateArtifactEditorField("next", event.target.value)}
                    rows={2}
                    value={artifactComposerEditorValue.next}
                  />
                </label>
              </div>
              <div className="artifact-composer-proof">
                <strong>Основание</strong>
                <span>{artifactComposerDraft.proof}</span>
              </div>
              <div className="artifact-composer-next">
                <strong>Следующее действие</strong>
                <span>{artifactComposerEditorValue.next}</span>
              </div>
            </div>
            <div className="artifact-editor-actions">
              <button
                className="secondary-action"
                data-testid="artifact-editor-save"
                disabled={!artifactEditorHasUnsavedChanges || workspacePersistenceState === "saving"}
                onClick={saveArtifactEditorDraft}
                type="button"
              >
                Сохранить правку
              </button>
              <button
                className="button-secondary"
                data-testid="artifact-editor-reset"
                disabled={!artifactEditorIsCustom || workspacePersistenceState === "saving"}
                onClick={resetArtifactEditorDraft}
                type="button"
              >
                Сбросить к версии Симбиота
              </button>
              {artifactEditorSavedDraft ? (
                <small className="artifact-editor-save-note">
                  Локальная рабочая версия сохранена в этом экране; внешняя отправка не выполнялась.
                </small>
              ) : null}
              {workspacePersistenceMessage ? (
                <small className={`workspace-persistence-note is-${workspacePersistenceState}`}>
                  {workspacePersistenceMessage}
                </small>
              ) : null}
            </div>
            <div className={`edited-artifact-next-step ${nextStepUsesEditedArtifact ? "is-edited" : ""}`}>
              <strong>{nextStepUsesEditedArtifact ? "Следующий шаг пойдет по вашей правке" : "Следующий шаг пока идет по версии Симбиота"}</strong>
              <span>{nextStepBrief.goal}</span>
              <small>{nextStepBrief.urgency}</small>
            </div>
            <div className="artifact-composer-checklist">
              {artifactComposerDraft.checklist.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
          <div className="user-cycle-grid">
            {userCycleSummary.map((item) => (
              <article key={item.title}>
                <span>{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className={`user-action-board is-${userMissionCommand.action}`} aria-label="Следующее действие миссии">
            <div>
              <p className="eyebrow">Сейчас</p>
              <h2>{userMissionCommand.title}</h2>
              <p>{userMissionCommand.detail}</p>
            </div>
            {userMissionCommand.action === "result" || userMissionCommand.action === "next" ? (
              <a className="primary-action action-link" href="#result-decision">
                {userMissionCommand.actionLabel}
              </a>
            ) : (
              <button
                className="primary-action"
                disabled={Boolean(launchBlocker)}
                onClick={runMvpPath}
                type="button"
              >
                {userMissionCommand.actionLabel}
              </button>
            )}
            <div className="user-action-facts">
              <span>Источник: {activeDocumentIds.length ? `${activeDocumentIds.length} готово` : "demo"}</span>
              <span>Команда: {selectedWorkgroup.length ? `${selectedWorkgroup.length} ролей` : "подбор"}</span>
              <span>Результат: {resultCenter ? resultCenter.product_status : "ожидает"}</span>
            </div>
            {scenarioRestoreMessage ? (
              <div className="scenario-restore-strip" aria-label="Восстановление сценария">
                <strong>Сценарий восстановлен</strong>
                <span>{scenarioRestoreMessage}</span>
              </div>
            ) : null}
            {scenarioResume?.is_resumable ? (
              <section className="scenario-resume-control" aria-label="Продолжить с места остановки">
                <div className="scenario-resume-head">
                  <div>
                    <p className="eyebrow">Продолжить</p>
                    <h3>С места остановки</h3>
                    <p>{scenarioResume.summary}</p>
                  </div>
                  <button
                    className="primary-action"
                    disabled={reloadState === "loading" || resultActionState === "saving"}
                    onClick={applyScenarioResumePrimaryAction}
                    type="button"
                  >
                    {scenarioResume.primary_action_label}
                  </button>
                </div>
                <div className="scenario-resume-steps">
                  {scenarioResume.steps.map((step) => (
                    <article className={`scenario-resume-step is-${step.status}`} key={step.id}>
                      <span>{step.status === "done" ? "Готово" : step.status === "active" ? "Сейчас" : "Ждет"}</span>
                      <strong>{step.title}</strong>
                      <small>{step.detail}</small>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="launch-readiness-strip" aria-label="Готовность миссии к запуску">
              {launchReadinessItems.map((item) => (
                <article className={`launch-readiness-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.status === "done" ? "Готово" : item.status === "active" ? "Сейчас" : "Ожидает"}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="mission-progress" aria-label="Ход выполнения миссии">
            {missionProgress.map((item) => (
              <article className={`mission-progress-item is-${item.status}`} key={item.title}>
                <span>{item.title}</span>
                <strong>{item.status === "done" ? "Готово" : item.status === "active" ? "Сейчас" : "Ожидает"}</strong>
                <p>{item.detail}</p>
              </article>
            ))}
          </section>

          <section className="campaign-map" aria-label="Карта кампании">
            <div className="campaign-map-header">
              <div>
                <p className="eyebrow">Карта кампании</p>
                <h2>{linkedFollowupTaskRunId ? "Следующий переход создан" : resultCenter ? "Кампания на этапе приемки" : "Кампания готовится"}</h2>
              </div>
              <span>{campaignBlockers.length ? `${campaignBlockers.length} блокер` : "маршрут открыт"}</span>
            </div>
            <div className="campaign-map-track">
              {campaignMap.map((item, index) => (
                <article className={`campaign-map-item is-${item.status}`} key={item.title}>
                  <span>{index + 1}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
            {campaignBlockers.length ? (
              <div className="campaign-blockers">
                {campaignBlockers.map((blocker) => (
                  <small key={blocker}>{blocker}</small>
                ))}
              </div>
            ) : null}
          </section>

          <section className="business-mission-catalog" aria-label="Каталог бизнес-миссий">
            <div className="business-mission-header">
              <div>
                <p className="eyebrow">Каталог бизнес-миссий</p>
                <h2>{selectedBusinessMission.title}</h2>
                <p>{selectedBusinessMission.outcome}</p>
              </div>
              <span>{selectedBusinessMission.category}</span>
            </div>
            <div className="business-mission-grid">
              {BUSINESS_MISSIONS.map((mission) => (
                <button
                  className={`business-mission-card ${selectedBusinessMissionId === mission.id ? "is-selected" : ""}`}
                  key={mission.id}
                  onClick={() => applyBusinessMission(mission)}
                  type="button"
                >
                  <span>{mission.category}</span>
                  <strong>{mission.title}</strong>
                  <p>{mission.outcome}</p>
                  <small>{mission.metric}</small>
                </button>
              ))}
            </div>
            <div className="business-mission-outcome">
              <div>
                <span>Подходит</span>
                <strong>{selectedBusinessMission.goodFor}</strong>
              </div>
              <div>
                <span>Метрика пользы</span>
                <strong>{selectedBusinessMission.metric}</strong>
              </div>
              <div>
                <span>AI-команда</span>
                <strong>{selectedRolePack.title}</strong>
              </div>
            </div>
          </section>

          <section className="mission-brief" aria-label="Паспорт бизнес-миссии">
            <div className="mission-header">
              <div>
                <p className="eyebrow">Паспорт миссии</p>
                <h2>{selectedBusinessMission.title}</h2>
              </div>
              <span className={`mission-status ${taskIntakeState === "ready" ? "is-ready" : ""}`}>
                вход {taskIntakePreview?.readiness_score ?? 0}%
              </span>
            </div>
            <div className="task-intake task-intake-inline">
              <div className="task-card-header">
                <div>
                  <p className="eyebrow">Карточка задачи</p>
                  <h3>Что должен сделать Симбиот</h3>
                </div>
                <button className="secondary-action" onClick={() => setShowWorkspacePanel((value) => !value)} type="button">
                  {showWorkspacePanel ? "Скрыть настройки" : "Показать настройки"}
                </button>
              </div>
              <label className="field">
                <span>Задача, которую проверяем в MVP Demo</span>
                <textarea
                  value={productTask.goal}
                  onChange={(event) => updateProductTask({ goal: event.target.value })}
                  rows={3}
                />
              </label>
              <div className="task-grid">
                <label className="field">
                  <span>Ожидаемый бизнес-результат</span>
                  <input
                    value={productTask.expectedArtifact}
                    onChange={(event) => updateProductTask({ expectedArtifact: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Demo-источник</span>
                  <input readOnly value="doc-demo-001 / без клиентских данных" />
                </label>
                <label className="field">
                  <span>Режим выполнения</span>
                  <input
                    value={productTask.urgency}
                    onChange={(event) => updateProductTask({ urgency: event.target.value })}
                  />
                </label>
              </div>
              <section className="source-attachment-panel" aria-label="Материалы миссии">
                <div className="source-attachment-header">
                  <div>
                    <p className="eyebrow">Материалы для миссии</p>
                    <h3>{selectedBusinessMission.title}</h3>
                  </div>
                  <span>{activeDocumentIds.length} готово</span>
                </div>
                <div className="source-mission-summary" aria-label="Связь материалов с результатом">
                  <div>
                    <span>Основание</span>
                    <strong>{missionMaterialSummary.evidence}</strong>
                  </div>
                  <div>
                    <span>AI-команда</span>
                    <strong>{missionMaterialSummary.route}</strong>
                  </div>
                  <div>
                    <span>Результат</span>
                    <strong>{missionMaterialSummary.result}</strong>
                  </div>
                </div>
                <p className="source-intake-message">
                  {sourceIntakeState === "loading"
                    ? "Загружаю реестр источников..."
                    : sourceIntakeMessage || sourceIntake?.next_action || "Оставьте demo-источник или добавьте материалы, на которых должна основываться миссия."}
                </p>
                <div className="source-card-grid">
                  <article className="source-card is-active">
                    <strong>Demo-источник</strong>
                    <small>doc-demo-001 · базовый контекст для безопасного MVP без клиентских данных.</small>
                  </article>
                  <label className="source-card">
                    <strong>Файл</strong>
                    <small>Добавьте документ, из которого AI-команда должна собрать результат.</small>
                    <input
                      type="file"
                      onChange={(event) => {
                        void uploadMissionFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label className="source-card">
                    <strong>Группа файлов</strong>
                    <small>Несколько документов связываются с текущей бизнес-миссией.</small>
                    <input
                      type="file"
                      multiple
                      onChange={(event) => {
                        void uploadMissionFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label className="source-card source-link-card">
                    <strong>Ссылка</strong>
                    <input
                      placeholder="https://... или путь к документу"
                      value={sourceLink}
                      onChange={(event) => setSourceLink(event.target.value)}
                    />
                    <button type="button" className="button-secondary" onClick={() => void registerSourceLink()}>
                      Зарегистрировать
                    </button>
                  </label>
                </div>
                <div className="source-registry-list">
                  {(sourceIntake?.items ?? []).slice(0, 8).map((item) => (
                    <article className={`source-registry-item is-${item.status}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {item.kind} · {item.reference}
                          {item.document_id ? ` · RAG ${item.document_id}` : ""}
                        </small>
                      </div>
                      <span>{item.status}</span>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            <div className="mission-grid">
              {missionCards.map((card) => (
                <article className="mission-card" key={card.title}>
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                  <p>{card.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="maturity-ladder" aria-label="Лестница зрелости">
            <div className="maturity-header">
              <div>
                <p className="eyebrow">Зрелость сценария</p>
                <h2>{MATURITY_LEVELS[currentMaturityIndex].title}</h2>
              </div>
              <span>{currentMaturityIndex + 1}/{MATURITY_LEVELS.length}</span>
            </div>
            <div className="maturity-track">
              {MATURITY_LEVELS.map((level, index) => (
                <article
                  className={`maturity-step ${index < currentMaturityIndex ? "is-done" : index === currentMaturityIndex ? "is-current" : "is-waiting"}`}
                  key={level.id}
                >
                  <strong>{level.title}</strong>
                  <p>{level.description}</p>
                </article>
              ))}
            </div>
            <small>{maturityBlocker}</small>
          </section>

          <section className="execution-profile-card" aria-label="Профиль выполнения">
            <div>
              <p className="eyebrow">Профиль выполнения</p>
              <h2>{executionProfile.title}</h2>
              <p>{executionProfile.description}</p>
            </div>
            <strong>{executionProfile.mode}</strong>
            <small>{executionProfile.next}</small>
          </section>

          <section className="user-team-strip" aria-label="Команда миссии">
            <div>
              <p className="eyebrow">Команда миссии</p>
              <h2>{selectedRolePack.title}</h2>
              <p>{taskIntakePreview?.workgroup_decision ?? selectedRolePack.description}</p>
            </div>
            <div className="user-team-list">
              {selectedWorkgroup.slice(0, 5).map((role) => (
                <span key={role.runtime_role}>{role.display_name}</span>
              ))}
            </div>
            <button className="secondary-action" onClick={() => setShowWorkspacePanel((value) => !value)} type="button">
              {showWorkspacePanel ? "Скрыть настройку" : "Настроить команду"}
            </button>
          </section>

          {showWorkspacePanel || showManagerLayer ? (
          <section className="pack-panel" aria-label="Пакеты сценариев и ролей">
            <article>
              <div className="pack-panel-header">
                <p className="eyebrow">Рекомендованный сценарий</p>
                <h2>{selectedScenarioPack.title}</h2>
                <small>Выберите тип миссии. От него зависит задача, ожидаемый результат и маршрут выполнения.</small>
              </div>
              <div className="pack-list">
                {SCENARIO_PACKS.map((pack) => (
                  <button
                    className={`pack-card ${selectedScenarioPackId === pack.id ? "is-selected" : ""}`}
                    key={pack.id}
                    onClick={() => applyScenarioPack(pack)}
                    type="button"
                  >
                    <strong>{pack.title}</strong>
                    <small>{pack.description}</small>
                  </button>
                ))}
              </div>
            </article>
            <article>
              <div className="pack-panel-header">
                <p className="eyebrow">Рекомендованная рабочая группа</p>
                <h2>{selectedRolePack.title}</h2>
                <small>
                  Рекомендация системы: {recommendedRolePack.title}. {taskIntakePreview?.workgroup_decision ?? "Engine проверяет состав по capability."}
                </small>
              </div>
              <div className="recommendation-box">
                <strong>Почему сейчас рекомендуется эта группа</strong>
                <small>Текст задачи и ожидаемый результат указывают на контур: {recommendedRolePack.title}.</small>
                <small>{recommendedRolePack.description}</small>
                {taskIntakePreview?.missing_required_capabilities.length ? (
                  <small>Не хватает: {taskIntakePreview.missing_required_capabilities.join(", ")}.</small>
                ) : (
                  <small>Обязательные capability закрыты: запуск, домен, качество, риски, фиксация и evidence.</small>
                )}
              </div>
              <div className="pack-list">
                {ROLE_PACKS.map((pack) => (
                  <button
                    className={`pack-card ${selectedRolePackId === pack.id ? "is-selected" : ""} ${recommendedRolePackId === pack.id ? "is-recommended" : ""}`}
                    key={pack.id}
                    onClick={() => applyRolePack(pack)}
                    type="button"
                  >
                    <strong>{pack.title}</strong>
                    {recommendedRolePackId === pack.id ? <span>рекомендовано</span> : null}
                    <small>{pack.roles.join(" · ")}</small>
                    <small>{pack.description}</small>
                  </button>
                ))}
              </div>
              <div className="role-fit-panel">
                {roleSelectionAlgorithm.map((step) => (
                  <div className={`role-fit-item role-fit-${step.status}`} key={step.title}>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </div>
                ))}
              </div>
              <div className="requirement-grid">
                {(taskIntakePreview?.requirements ?? []).map((requirement) => (
                  <div className={`requirement-item ${requirement.satisfied ? "is-ready" : "is-missing"}`} key={requirement.id}>
                    <strong>{requirement.title}</strong>
                    <small>{requirement.required ? "обязательно" : "дополнительно"}</small>
                    <small>
                      {requirement.satisfied
                        ? `Закрыто: ${requirement.matched_role_ids.join(", ")}`
                        : requirement.missing_reason}
                    </small>
                  </div>
                ))}
              </div>
              <details className="role-editor-drawer">
                <summary>Изменить состав рабочей группы</summary>
                <div className="role-toggle-grid">
                  {roleCandidateIds.map((roleId) => {
                    const role = roleDirectory?.roles.find((item) => item.runtime_role === roleId);
                    const checked = selectedRoleIds.includes(roleId);
                    return (
                      <button
                        className={`role-toggle ${checked ? "is-selected" : ""}`}
                        key={roleId}
                        onClick={() => toggleSelectedRole(roleId)}
                        type="button"
                      >
                        <strong>{role?.display_name ?? roleId}</strong>
                        <small>{roleId}</small>
                        {taskIntakePreview?.recommended_role_ids.includes(roleId) ? <span>рекомендуется</span> : null}
                      </button>
                    );
                  })}
                </div>
                {taskIntakePreview?.override_active ? (
                  <small className="muted">Ручной состав активен. Backend проверяет, закрыты ли обязательные capability.</small>
                ) : (
                  <small className="muted">Состав идет по рекомендации системы и будет меняться вместе с задачей.</small>
                )}
              </details>
              <div className="recommendation-box">
                <strong>Как читать состав группы</strong>
                {taskIntakePreview?.selection_basis.slice(0, 3).map((basis) => (
                  <small key={basis}>{basis}</small>
                ))}
                {!taskIntakePreview ? <small>После проверки входа система покажет основание выбора ролей.</small> : null}
              </div>
            </article>
          </section>
          ) : null}

          {showWorkspacePanel ? (
          <section className="loadout-reality-panel" aria-label="Инструменты и реальные действия">
            <article>
              <div className="pack-panel-header">
                <p className="eyebrow">Что подключено к миссии</p>
                <h2>Роли, источники, качество, доказательства</h2>
              </div>
              <div className="loadout-list">
                {toolLoadout.map((item) => (
                  <div className={`loadout-item is-${item.status}`} key={item.title}>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
            </article>
            <article>
              <div className="pack-panel-header">
                <p className="eyebrow">Реальная работа</p>
                <h2>Связь с результатом</h2>
              </div>
              <div className="loadout-list">
                {realWorldLinks.map((item) => (
                  <div className={`real-link-item is-${item.status}`} key={item.title}>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>
          ) : null}

          <div className="workbench-actions">
            <button
              className="primary-action product-action"
              disabled={Boolean(launchBlocker)}
              onClick={runMvpPath}
              type="button"
            >
              {state === "running" ? "Симбиот выполняет миссию..." : artifact ? "Запустить заново" : "Запустить миссию"}
            </button>
            <div className="acceptance-note">
              <strong>{launchBlocker ? "Нужно уточнить вход" : "Готовность к запуску"}</strong>
              <span>{launchBlocker || taskIntakePreview?.next_action || "Система проверяет полноту задачи и состав команды."}</span>
              {taskRun ? <code>ID запуска TaskRun: {taskRun.id}</code> : null}
            </div>
          </div>
        </div>

        <aside className="panel product-side">
          <details className="help-drawer">
            <summary>Как работать с экраном</summary>
            <div className="stack">
              {[
                ["1", "Проверьте задачу", "В паспорте миссии должна быть понятная бизнес-задача и ожидаемый результат."],
                ["2", "Проверьте команду", "Рабочая группа должна быть рекомендована и объяснена системой."],
                ["3", "Запустите миссию", "После запуска должен появиться ID запуска TaskRun."],
                ["4", "Примите результат", "В Центре результата проверьте бизнес-результат, источник, ID и действие."]
              ].map(([number, title, detail]) => (
                <div className="simple-step-card" key={title}>
                  <span>{number}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </aside>
      </section>

        </div>

        {activeVaultView !== "files" && activeVaultView !== "search" ? (
        <aside className={`vault-graph-panel ${activeVaultView === "graph" ? "is-graph-window" : "is-side-drawer"}`} aria-label="Граф связей и статусы">
          <div className="vault-side-head">
            <div>
              <p className="eyebrow">{activeVaultView}</p>
              <h3>{activeVaultView === "graph" ? "Graph view" : activeVaultView === "updates" ? "Core sync" : "Evidence"}</h3>
            </div>
            <button aria-label="Закрыть панель" className="button-secondary vault-panel-close" onClick={() => setActiveVaultView("files")} title="Закрыть" type="button">
              ×
            </button>
          </div>
          {activeVaultView === "graph" ? (
          <div className="vault-graph-map">
            <p className="eyebrow">Граф</p>
            <div className="vault-graph-canvas" aria-label="Визуальный граф связей">
              <span className="graph-edge edge-project-mission" />
              <span className="graph-edge edge-mission-runtime" />
              <span className="graph-edge edge-runtime-result" />
              <span className="graph-edge edge-materials-result" />
              <button className="graph-node node-project" type="button">Project</button>
              <button className="graph-node node-mission is-primary" type="button">Mission</button>
              <button className="graph-node node-runtime" type="button">Autonom</button>
              <button className="graph-node node-materials" type="button">Materials</button>
              <button className="graph-node node-result" type="button">Result</button>
            </div>
            <div className="graph-line">
              <span>Проект</span>
              <i />
              <span>Миссия</span>
              <i />
              <span>Автоном</span>
            </div>
            <div className="graph-line">
              <span>Материалы</span>
              <i />
              <span>Результат</span>
              <i />
              <span>Next step</span>
            </div>
          </div>
          ) : null}
          {activeVaultView === "graph" ? (
          <>
          <div className="vault-backlinks">
            <strong>Backlinks</strong>
            {vaultBacklinks.map((item) => (
              <a href="#mission-note" key={item}>{item}</a>
            ))}
          </div>
          <div className="vault-outgoing">
            <strong>Outgoing links</strong>
            {vaultOutgoingLinks.map((item) => (
              <a href="#mission-note" key={item}>[[{item}]]</a>
            ))}
          </div>
          <div className="vault-outline">
            <strong>Outline</strong>
            {vaultOutline.map((item) => (
              <button key={item} onClick={() => document.getElementById("mission-note")?.scrollIntoView({ behavior: "smooth" })} type="button">
                {item}
              </button>
            ))}
          </div>
          </>
          ) : null}
          {activeVaultView === "evidence" ? (
          <div className="vault-status-list">
            <div>
              <strong>CJM</strong>
              <span className="pill pill-passed">accepted</span>
            </div>
            <div>
              <strong>Runtime UX</strong>
              <span className="pill pill-warning">YELLOW/RED</span>
            </div>
            <div>
              <strong>Evidence</strong>
              <span className="pill pill-warning">{evidenceTotalCount ? `${completedEvidenceCount}/${evidenceTotalCount}` : "ожидает"}</span>
            </div>
            <div>
              <strong>Release</strong>
              <span className="pill pill-warning">not ready</span>
            </div>
          </div>
          ) : null}
          {activeVaultView === "updates" || activeVaultView === "evidence" ? (
          <div className="vault-next-step">
            <strong>{activeVaultView === "updates" ? "Core update" : "Next step"}</strong>
            <p>{activeVaultView === "updates" ? coreUpdateStatus : resultCenter?.next_step ?? nextStepBrief.goal}</p>
            <a href={resultCenter ? "#result-decision" : "#mission-note"}>{resultCenter ? "Принять решение" : "Запустить миссию"}</a>
          </div>
          ) : null}
        </aside>
        ) : null}
        <div className="vault-status-bar" aria-label="Статус рабочего пространства">
          <span>Vault: SYM-SaaS</span>
          <span>Gate: Design Concept + Runtime/QA Evidence</span>
          <span>RYG: YELLOW</span>
          <span>Readiness: 13205 / 14075 = 93.8%</span>
          <span>{coreUpdateStatus}</span>
        </div>
      </section>

      {showManagerLayer ? (
      <section className="panel controller-panel" aria-label="Панель контроля готовности продукта">
        <div className="controller-header">
          <div>
            <p className="eyebrow">Панель контроля</p>
            <h2>10 частей продукта</h2>
            <p>
              Здесь видно не абстрактные проценты разработки, а какие части Симбиота уже собраны и что мешает
              считать их готовыми для клиента.
            </p>
          </div>
          <strong className="controller-total">Общая строгая готовность: 9.1%</strong>
        </div>
        <div className="controller-grid">
          {PRODUCT_CONTROL_BLOCKS.map((block) => (
            <article className="controller-card" key={block.title}>
              <div className="controller-card-head">
                <strong>{block.title}</strong>
                <span>{block.progress}%</span>
              </div>
              <div className="controller-progress" aria-label={`${block.title}: ${block.progress}%`}>
                <span style={{ width: `${block.progress}%` }} />
              </div>
              <p>{block.summary}</p>
              <small>{block.next}</small>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      {showManagerLayer ? (
      <section className="product-shell product-shell-compact">
        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Тип работы</p>
            <h2>{selectedProcess?.name ?? "Процесс загружается"}</h2>
            {selectedProcess ? <p>{selectedProcess.description}</p> : null}
          </div>
          {selectedProcess ? (
            <div className="meta-grid">
              <div>
                <span>Выход</span>
                <strong>{selectedProcess.expected_output}</strong>
              </div>
              <div>
                <span>Входы</span>
                <strong>{selectedProcess.required_inputs.join(", ")}</strong>
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">AI-команда миссии</p>
            <h2>
              {selectedWorkgroup.length
                ? `${selectedWorkgroup.length} участников · готовность входа ${taskIntakePreview?.readiness_score ?? 0}%`
                : "Команда подбирается"}
            </h2>
            {taskIntakePreview ? (
              <p>{taskIntakePreview.selection_basis.slice(0, 2).join("; ")}.</p>
            ) : (
              <p>Симбиот подберет роли после проверки миссии и контекста.</p>
            )}
          </div>
          <div className="team-summary">
            <div>
              <span>Исполнитель</span>
              <strong>{selectedWorkgroup[0]?.display_name ?? "Ожидает подбора"}</strong>
            </div>
            <div>
              <span>Контроль</span>
              <strong>{selectedWorkgroup.find((role) => role.runtime_role.includes("qa"))?.display_name ?? "QA будет назначен системой"}</strong>
            </div>
          </div>
          <div className="role-preview-list">
            {selectedWorkgroup.map((role) => (
              <div className="role-preview" key={role.runtime_role}>
                <strong>{role.display_name}</strong>
                <small>{role.runtime_role} · {role.access_level}</small>
                <span>Роль в миссии</span>
                <small>{role.responsibility}</small>
                <span>Почему подключен</span>
                <small>{role.selection_reason}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Короткий результат</p>
            <h2>{artifact?.title ?? "Результат еще не создан"}</h2>
            {artifact ? <p>{artifact.content}</p> : <p>После запуска здесь появится результат, источники и статус качества.</p>}
          </div>
          {artifact ? (
            <div className="stack">
              <small className="muted">Версия: {artifact.version} · Источники: {artifact.sources.join(", ")}</small>
              {artifactVersions.length ? (
                <div className="result-row">
                  <strong>История результата</strong>
                  {artifactVersions.map((version) => (
                    <small key={version.id}>
                      {version.version} · {version.source} · {version.content_hash.slice(0, 12)}
                    </small>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      </section>
      ) : null}

      {queueStatus ? (
        <section className="queue-monitor-strip" aria-label="Надежное выполнение задач">
          <article>
            <p className="eyebrow">Конвейер выполнения</p>
            <h2>{workerObservability ? `Worker: ${workerObservability.health}` : "Очередь задач работает"}</h2>
            <p>{queueMessage || "TaskRun сохраняется до выполнения, проходит через worker и не теряется при закрытии вкладки."}</p>
            {queueAdminCommandCenter ? (
              <div className={`admin-command-center admin-command-center-${queueAdminCommandCenter.status}`}>
                <div className="admin-command-head">
                  <div>
                    <strong>Центр управления очередью</strong>
                    <small>{queueAdminCommandCenter.summary}</small>
                  </div>
                  <span>{queueAdminCommandCenter.operator_mode}</span>
                </div>
                <div className="admin-command-primary">
                  <span>{queueAdminCommandCenter.status}</span>
                  <strong>{queueAdminCommandCenter.headline}</strong>
                  <small>
                    источников {queueAdminCommandCenter.sources_total} · действий {queueAdminCommandCenter.actions_total} · блокеров {queueAdminCommandCenter.blockers_total}
                  </small>
                </div>
                <div className="admin-command-actions">
                  {queueAdminCommandCenter.actions.slice(0, 3).map((action) => (
                    <button
                      disabled={!action.enabled && action.action_kind !== "review_only"}
                      key={action.id}
                      type="button"
                      onClick={() => applyCommandCenterAction(action)}
                    >
                      <strong>{action.label}</strong>
                      <small>
                        {action.owner_role} · {action.action_kind}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="admin-command-sources">
                  {queueAdminCommandCenter.sources.slice(0, 9).map((source) => (
                    <div className={`admin-command-source admin-command-source-${source.status}`} key={source.id}>
                      <strong>{source.title}</strong>
                      <small>{source.summary}</small>
                      <small>evidence: {source.evidence_source}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {viewMode !== "user" && queueAdminActionAudit ? (
              <div className={`admin-action-audit admin-action-audit-${queueAdminActionAudit.status}`}>
                <div className="admin-command-head">
                  <div>
                    <strong>Журнал действий администратора</strong>
                    <small>{queueAdminActionAudit.summary}</small>
                  </div>
                  <span>{queueAdminActionAudit.chain_valid ? "chain valid" : "chain failed"}</span>
                </div>
                <div className="admin-action-audit-metrics">
                  <span>событий {queueAdminActionAudit.events_total}</span>
                  <span>head {queueAdminActionAudit.head_hash.slice(0, 12)}</span>
                  <span>latest {queueAdminActionAudit.latest_event_id ?? "none"}</span>
                </div>
                {queueAdminActionAudit.events.slice(0, 4).map((event) => (
                  <div className="admin-action-audit-event" key={event.id}>
                    <strong>{event.action_id}</strong>
                    <small>
                      {event.actor} · {event.action_kind} · {event.executed ? "executed" : "not executed"}
                    </small>
                    <small>
                      {event.status_before} {"->"} {event.status_after}
                    </small>
                    <small>{event.reason}</small>
                  </div>
                ))}
              </div>
            ) : null}
            {viewMode !== "user" && queueManualTriage ? (
              <div className={`manual-triage-panel manual-triage-panel-${queueManualTriage.status}`}>
                <div className="admin-command-head">
                  <div>
                    <strong>Ручной разбор администратора</strong>
                    <small>{queueManualTriage.summary}</small>
                  </div>
                  <span>{queueManualTriage.status}</span>
                </div>
                <div className="admin-action-audit-metrics">
                  <span>open {queueManualTriage.open}</span>
                  <span>assigned {queueManualTriage.assigned}</span>
                  <span>resolved {queueManualTriage.resolved}</span>
                </div>
                {queueManualTriage.items.slice(0, 4).map((item) => (
                  <div className={`manual-triage-item manual-triage-item-${item.status}`} key={item.id}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.id} · {item.severity} · {item.status} · владелец {item.owner_role}
                    </small>
                    <small>{item.reason}</small>
                    <small>evidence: {item.evidence_ref}</small>
                    {item.resolution ? <small>решение: {item.resolution}</small> : null}
                    <div className="manual-triage-actions">
                      {item.status === "open" ? (
                        <button type="button" onClick={() => assignManualTriage(item)}>
                          Взять в работу
                        </button>
                      ) : null}
                      {item.status !== "resolved" ? (
                        <button type="button" onClick={() => resolveManualTriage(item)}>
                          Закрыть
                        </button>
                      ) : (
                        <span>закрыто</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {viewMode !== "user" && queueEvidenceReview ? (
              <div className={`manual-triage-panel manual-triage-panel-${queueEvidenceReview.status}`}>
                <div className="admin-command-head">
                  <div>
                    <strong>Проверка evidence</strong>
                    <small>{queueEvidenceReview.summary}</small>
                  </div>
                  <span>{queueEvidenceReview.status}</span>
                </div>
                <div className="admin-action-audit-metrics">
                  <span>pending {queueEvidenceReview.pending}</span>
                  <span>rework {queueEvidenceReview.rework}</span>
                  <span>approved {queueEvidenceReview.approved}</span>
                  <span>overdue {queueEvidenceReview.overdue}</span>
                  <span>oldest {queueEvidenceReview.oldest_open_age_seconds}s</span>
                </div>
                {queueEvidenceReview.next_due_at ? <small>следующий дедлайн SLA: {queueEvidenceReview.next_due_at}</small> : null}
                <div className="evidence-review-workbench">
                  <div className="evidence-review-workbench-head">
                    <strong>Evidence Review Workbench</strong>
                    <small>Сначала разбирайте overdue, rework и critical.</small>
                  </div>
                  <div className="evidence-review-filters">
                    <label>
                      Статус
                      <select value={evidenceReviewStatusFilter} onChange={(event) => setEvidenceReviewStatusFilter(event.target.value as EvidenceReviewFilterValue)}>
                        <option value="all">Все</option>
                        <option value="pending">Pending</option>
                        <option value="rework">Rework</option>
                        <option value="approved">Approved</option>
                      </select>
                    </label>
                    <label>
                      SLA
                      <select value={evidenceReviewSlaFilter} onChange={(event) => setEvidenceReviewSlaFilter(event.target.value as EvidenceReviewSlaFilterValue)}>
                        <option value="all">Все</option>
                        <option value="overdue">Overdue</option>
                        <option value="within_sla">Within SLA</option>
                        <option value="not_applicable">Not applicable</option>
                      </select>
                    </label>
                    <label>
                      Риск
                      <select value={evidenceReviewSeverityFilter} onChange={(event) => setEvidenceReviewSeverityFilter(event.target.value as EvidenceReviewSeverityFilterValue)}>
                        <option value="all">Все</option>
                        <option value="critical">Critical</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                      </select>
                    </label>
                    <label>
                      Владелец
                      <input value={evidenceReviewOwnerFilter} onChange={(event) => setEvidenceReviewOwnerFilter(event.target.value)} placeholder="qa-evidence" />
                    </label>
                    <label>
                      Источник
                      <input value={evidenceReviewSourceFilter} onChange={(event) => setEvidenceReviewSourceFilter(event.target.value)} placeholder="source/evidence/title" />
                    </label>
                  </div>
                  <div className="manual-triage-actions">
                    <button type="button" onClick={loadEvidenceAcceptanceCenter}>
                      Центр приемки
                    </button>
                    <button type="button" onClick={loadEvidenceReviewWorkbench}>
                      Применить фильтр
                    </button>
                    <button type="button" onClick={resetEvidenceReviewWorkbench}>
                      Сбросить
                    </button>
                    <button type="button" onClick={loadEvidenceReviewPackage}>
                      Собрать пакет приемки
                    </button>
                    <button type="button" onClick={saveEvidenceReviewPackageArchive}>
                      Сохранить в историю
                    </button>
                    <button type="button" onClick={loadEvidenceReviewPackageArchive}>
                      История пакетов
                    </button>
                    <button type="button" onClick={loadEvidenceAcceptanceChecklist}>
                      Чек-лист приемки
                    </button>
                    <button type="button" onClick={loadEvidenceAcceptanceSummary}>
                      Сводка приемки
                    </button>
                    <button type="button" onClick={loadEvidenceAcceptanceWorklist}>
                      Список блокеров
                    </button>
                    <button type="button" onClick={loadEvidenceAcceptanceBatchPlan}>
                      План разбора
                    </button>
                  </div>
                  {queueEvidenceReview.items[0] ? (
                    <small>
                      Первый к разбору: {queueEvidenceReview.items[0].id} · {queueEvidenceReview.items[0].status} · SLA {queueEvidenceReview.items[0].sla_status}
                    </small>
                  ) : (
                    <small>В выбранном срезе нет review-кейсов.</small>
                  )}
                  <label className="evidence-review-decision-note">
                    Комментарий решения QA/admin
                    <textarea
                      value={evidenceReviewDecisionNote}
                      onChange={(event) => setEvidenceReviewDecisionNote(event.target.value)}
                      placeholder="Коротко: почему принимаем evidence или что именно вернуть на доработку"
                    />
                  </label>
                  {evidenceAcceptanceCenter ? (
                    <div className={`evidence-acceptance-center evidence-acceptance-center-${evidenceAcceptanceCenter.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Центр приемки evidence</strong>
                        <span>{evidenceAcceptanceCenter.ready_for_internal_acceptance ? "ready" : evidenceAcceptanceCenter.status}</span>
                      </div>
                      <strong>{evidenceAcceptanceCenter.headline}</strong>
                      <small>{evidenceAcceptanceCenter.summary}</small>
                      <div className="evidence-acceptance-center-metrics">
                        <span>actions {evidenceAcceptanceCenter.worklist_actions_total}</span>
                        <span>groups {evidenceAcceptanceCenter.batch_groups_total}</span>
                        <span>blockers {evidenceAcceptanceCenter.blockers_total}</span>
                        <span>warnings {evidenceAcceptanceCenter.warnings_total}</span>
                      </div>
                      <small>
                        Главное действие: {evidenceAcceptanceCenter.primary_action_label ?? "нет"} · первая группа {evidenceAcceptanceCenter.first_group_id ?? "нет"}
                      </small>
                      <small>
                        Следующий item: {evidenceAcceptanceCenter.next_review_id ?? "нет"} · технических панелей объединено: {evidenceAcceptanceCenter.technical_panels_replaced}
                      </small>
                    </div>
                  ) : null}
                  {evidenceReviewPackage ? (
                    <div className="evidence-review-package">
                      <div className="evidence-review-workbench-head">
                        <strong>Пакет внутренней приемки</strong>
                        <span>{evidenceReviewPackage.acceptance_summary.ready_for_internal_acceptance ? "ready" : "blocked"}</span>
                      </div>
                      <small>{evidenceReviewPackage.id}</small>
                      <small>
                        hash {evidenceReviewPackage.package_hash.slice(0, 12)} · scope {evidenceReviewPackage.export_scope} · external {String(evidenceReviewPackage.external_export_allowed)}
                      </small>
                      <small>
                        pending {evidenceReviewPackage.acceptance_summary.pending} · rework {evidenceReviewPackage.acceptance_summary.rework} · overdue {evidenceReviewPackage.acceptance_summary.overdue}
                      </small>
                      {evidenceReviewPackage.acceptance_summary.blocking_reason ? <small>{evidenceReviewPackage.acceptance_summary.blocking_reason}</small> : null}
                      <small>decision events {evidenceReviewPackage.decision_events.length} · open blockers {evidenceReviewPackage.open_items.length}</small>
                    </div>
                  ) : null}
                  {evidenceAcceptanceSummary ? (
                    <div className={`evidence-acceptance-summary evidence-acceptance-summary-${evidenceAcceptanceSummary.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Сводка приемки evidence</strong>
                        <span>{evidenceAcceptanceSummary.ready_for_internal_acceptance ? "ready" : evidenceAcceptanceSummary.status}</span>
                      </div>
                      <strong>{evidenceAcceptanceSummary.headline}</strong>
                      <small>{evidenceAcceptanceSummary.summary}</small>
                      <div className="evidence-acceptance-summary-grid">
                        <span>blockers {evidenceAcceptanceSummary.blockers_total}</span>
                        <span>warnings {evidenceAcceptanceSummary.warnings_total}</span>
                        <span>passed {evidenceAcceptanceSummary.passed_total}/{evidenceAcceptanceSummary.checklist_items_total}</span>
                      </div>
                      <small>
                        package {evidenceAcceptanceSummary.package_id} · hash {evidenceAcceptanceSummary.package_hash.slice(0, 12)}
                      </small>
                      {evidenceAcceptanceSummary.primary_blocker_id ? (
                        <div className="evidence-acceptance-summary-primary">
                          <strong>{evidenceAcceptanceSummary.primary_blocker_title}</strong>
                          <small>проверяет: {evidenceAcceptanceSummary.primary_owner_role}</small>
                          <small>{evidenceAcceptanceSummary.primary_reason}</small>
                          <small>следующее действие: {evidenceAcceptanceSummary.next_action}</small>
                          <button
                            className="evidence-acceptance-action"
                            type="button"
                            onClick={() => {
                              void runEvidenceAcceptanceSummaryPrimaryAction(evidenceAcceptanceSummary);
                            }}
                          >
                            {evidenceAcceptanceSummary.primary_action_label}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {evidenceAcceptanceWorklist ? (
                    <div className={`evidence-acceptance-worklist evidence-acceptance-worklist-${evidenceAcceptanceWorklist.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Список блокеров приемки</strong>
                        <span>{evidenceAcceptanceWorklist.actionable_total}</span>
                      </div>
                      <small>{evidenceAcceptanceWorklist.summary}</small>
                      <small>
                        blockers {evidenceAcceptanceWorklist.blockers_total} · warnings {evidenceAcceptanceWorklist.warnings_total} · hash {evidenceAcceptanceWorklist.package_hash.slice(0, 12)}
                      </small>
                      {evidenceAcceptanceWorklist.items.slice(0, 6).map((item) => (
                        <div className={`evidence-acceptance-worklist-item evidence-acceptance-worklist-item-${item.status}`} key={item.id}>
                          <span>{item.status}</span>
                          <strong>{item.title}</strong>
                          <small>проверяет: {item.owner_role}</small>
                          <small>{item.reason}</small>
                          <button
                            className="evidence-acceptance-action"
                            type="button"
                            onClick={() => {
                              void runEvidenceAcceptanceAction(item);
                            }}
                          >
                            {item.action_label}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {evidenceAcceptanceBatchPlan ? (
                    <div className={`evidence-acceptance-batch-plan evidence-acceptance-batch-plan-${evidenceAcceptanceBatchPlan.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>План разбора блокеров</strong>
                        <span>{evidenceAcceptanceBatchPlan.groups_total}</span>
                      </div>
                      <small>{evidenceAcceptanceBatchPlan.summary}</small>
                      <small>
                        blockers {evidenceAcceptanceBatchPlan.blockers_total} · warnings {evidenceAcceptanceBatchPlan.warnings_total} · hash {evidenceAcceptanceBatchPlan.package_hash.slice(0, 12)}
                      </small>
                      {evidenceAcceptanceBatchPlan.groups.slice(0, 6).map((group) => (
                        <div className={`evidence-acceptance-batch-group evidence-acceptance-batch-group-${group.status}`} key={group.id}>
                          <span>{group.status}</span>
                          <strong>{group.title}</strong>
                          <small>элементов: {group.items_total} · роли: {group.owner_roles.join(", ")}</small>
                          <small>{group.reason}</small>
                          <small>{group.next_action}</small>
                          <button
                            className="evidence-acceptance-action"
                            type="button"
                            onClick={() => {
                              void runEvidenceAcceptanceBatchGroup(group);
                            }}
                          >
                            {group.action_label}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {evidenceAcceptanceBatchAction ? (
                    <div className={`evidence-acceptance-batch-session evidence-acceptance-batch-session-${evidenceAcceptanceBatchAction.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Batch-сессия разбора</strong>
                        <span>{evidenceAcceptanceBatchAction.status}</span>
                      </div>
                      <small>{evidenceAcceptanceBatchAction.message}</small>
                      <small>
                        группа {evidenceAcceptanceBatchAction.batch_group_id} · элементов {evidenceAcceptanceBatchAction.items_total} · review {evidenceAcceptanceBatchAction.review_status.items.length}/{evidenceAcceptanceBatchAction.review_status.total}
                      </small>
                      <small>
                        audit {evidenceAcceptanceBatchAction.audit_event.id} · hash {evidenceAcceptanceBatchAction.audit_event.event_hash.slice(0, 12)}
                      </small>
                      <button
                        className="evidence-acceptance-action"
                        type="button"
                        onClick={() => {
                          void loadEvidenceAcceptanceBatchGroupClosure(evidenceAcceptanceBatchAction.batch_group_id);
                        }}
                      >
                        Проверить закрытие группы
                      </button>
                    </div>
                  ) : null}
                  {evidenceAcceptanceBatchItemDecision ? (
                    <div className={`evidence-acceptance-batch-item-decision evidence-acceptance-batch-item-decision-${evidenceAcceptanceBatchItemDecision.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Решение по item batch-сессии</strong>
                        <span>{evidenceAcceptanceBatchItemDecision.decision}</span>
                      </div>
                      <small>{evidenceAcceptanceBatchItemDecision.message}</small>
                      <small>
                        group {evidenceAcceptanceBatchItemDecision.batch_group_id} · review {evidenceAcceptanceBatchItemDecision.review_id}
                      </small>
                      <small>
                        audit {evidenceAcceptanceBatchItemDecision.audit_event.id} · hash {evidenceAcceptanceBatchItemDecision.audit_event.event_hash.slice(0, 12)}
                      </small>
                    </div>
                  ) : null}
                  {evidenceAcceptanceBatchGroupClosure ? (
                    <div className={`evidence-acceptance-batch-closure evidence-acceptance-batch-closure-${evidenceAcceptanceBatchGroupClosure.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Статус закрытия batch-группы</strong>
                        <span>{evidenceAcceptanceBatchGroupClosure.status}</span>
                      </div>
                      <small>{evidenceAcceptanceBatchGroupClosure.summary}</small>
                      <small>
                        group {evidenceAcceptanceBatchGroupClosure.batch_group_id} · open {evidenceAcceptanceBatchGroupClosure.open_items} · closed {evidenceAcceptanceBatchGroupClosure.closed_items}
                      </small>
                      <small>
                        pending {evidenceAcceptanceBatchGroupClosure.pending_items} · rework {evidenceAcceptanceBatchGroupClosure.rework_items} · approved {evidenceAcceptanceBatchGroupClosure.approved_items}
                      </small>
                      <small>
                        next {evidenceAcceptanceBatchGroupClosure.next_review_id ?? "none"} · action {evidenceAcceptanceBatchGroupClosure.next_action_label ?? "none"}
                      </small>
                    </div>
                  ) : null}
                  {evidenceAcceptanceChecklist ? (
                    <div className={`evidence-acceptance-checklist evidence-acceptance-checklist-${evidenceAcceptanceChecklist.status}`}>
                      <div className="evidence-review-workbench-head">
                        <strong>Чек-лист приемки evidence</strong>
                        <span>{evidenceAcceptanceChecklist.ready_for_internal_acceptance ? "ready" : evidenceAcceptanceChecklist.status}</span>
                      </div>
                      <small>{evidenceAcceptanceChecklist.summary}</small>
                      <small>
                        package {evidenceAcceptanceChecklist.package_id} · hash {evidenceAcceptanceChecklist.package_hash.slice(0, 12)} · archive {evidenceAcceptanceChecklist.archive_entries_total}
                      </small>
                      {evidenceAcceptanceChecklist.items.map((item) => (
                        <div className={`evidence-acceptance-checklist-item evidence-acceptance-checklist-item-${item.status}`} key={item.id}>
                          <span>{item.status}</span>
                          <strong>{item.title}</strong>
                          <small>проверяет: {item.owner_role}</small>
                          <small>{item.reason}</small>
                          <small>действие: {item.action}</small>
                          {item.evidence_ref ? <small>evidence: {item.evidence_ref}</small> : null}
                          {item.action_target ? <small>target: {item.action_target}</small> : null}
                          <button
                            className="evidence-acceptance-action"
                            type="button"
                            onClick={() => {
                              void runEvidenceAcceptanceAction(item);
                            }}
                          >
                            {item.action_label}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {evidenceReviewPackageArchive ? (
                    <div className="evidence-review-package-history">
                      <div className="evidence-review-workbench-head">
                        <strong>История пакетов приемки</strong>
                        <span>{evidenceReviewPackageArchive.entries_total}</span>
                      </div>
                      <small>{evidenceReviewPackageArchive.storage}</small>
                      {evidenceReviewPackageArchive.entries.slice(0, 5).map((entry) => (
                        <div className="admin-action-audit-event" key={entry.id}>
                          <span>{entry.status} · {entry.package_hash.slice(0, 12)}</span>
                          <small>{entry.archived_at} · {entry.actor}</small>
                          <small>pending {entry.pending} · rework {entry.rework} · overdue {entry.overdue} · blockers {entry.open_items_total}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {queueEvidenceReview.items.slice(0, 8).map((item) => (
                  <div className={`manual-triage-item manual-triage-item-${item.status}`} key={item.id}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.id} · {item.severity} · {item.status} · SLA {item.sla_status} · возраст {item.age_seconds}s
                    </small>
                    <small>{item.reason}</small>
                    {item.response_due_at ? <small>дедлайн реакции: {item.response_due_at}</small> : null}
                    <small>evidence: {item.evidence_ref}</small>
                    <small>проверяет: {item.owner_role}</small>
                    {item.related_manual_triage_id ? <small>manual triage: {item.related_manual_triage_id}</small> : null}
                    <small>качество решения: {item.decision_quality}</small>
                    <small>{item.decision_summary}</small>
                    <small>следующее действие: {item.next_action}</small>
                    {item.review_note ? <small>решение: {item.review_note}</small> : null}
                    <div className="manual-triage-actions">
                      {item.status !== "approved" ? (
                        <>
                          <button type="button" onClick={() => decideEvidenceReview(item, "approve")}>
                            Принять evidence
                          </button>
                          <button type="button" onClick={() => decideEvidenceReview(item, "rework")}>
                            Вернуть на доработку
                          </button>
                        </>
                      ) : (
                        <span>{item.status === "approved" ? "принято" : "на доработке"}</span>
                      )}
                    </div>
                  </div>
                ))}
                {queueEvidenceReview.decision_events.length ? (
                  <div className="evidence-review-decision-trail">
                    <strong>История решений evidence</strong>
                    {queueEvidenceReview.decision_events.slice(0, 5).map((event) => (
                      <div className="admin-action-audit-event" key={event.id}>
                        <span>{event.status_before} {"->"} {event.status_after}</span>
                        <small>{event.actor} · {event.created_at}</small>
                        <small>{event.reason}</small>
                        <small>hash: {event.event_hash.slice(0, 12)} · evidence: {event.evidence_ref}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {queueAdminAlerts ? (
              <div className={`admin-alert-center admin-alert-center-${queueAdminAlerts.status}`}>
                <div className="admin-alert-head">
                  <div>
                    <strong>Центр сигналов администратора</strong>
                    <small>{queueAdminAlerts.summary}</small>
                  </div>
                  <span>{queueAdminAlerts.status}</span>
                </div>
                <div className="admin-alert-counts">
                  <small>критично {queueAdminAlerts.critical_alerts}</small>
                  <small>предупреждений {queueAdminAlerts.warning_alerts}</small>
                  <small>открыто {queueAdminAlerts.open_alerts}</small>
                </div>
                {queueAdminAlerts.alerts.slice(0, 3).map((alert) => (
                  <div className={`admin-alert-item admin-alert-item-${alert.severity}`} key={alert.id}>
                    <strong>{alert.title}</strong>
                    <small>{alert.message}</small>
                    <div className="admin-alert-sla">
                      <span>Владелец: {alert.owner_role}</span>
                      <span>SLA: {alert.response_minutes ? `${alert.response_minutes} мин` : "не требуется"}</span>
                      <span>{alert.sla_status}</span>
                    </div>
                    {alert.response_due_at ? <small>Дедлайн реакции: {alert.response_due_at}</small> : null}
                    {alert.escalation_target ? <small>Эскалация: {alert.escalation_target}</small> : null}
                    <small>{alert.recommended_action}</small>
                    {alert.notification_draft ? <small>Черновик уведомления: {alert.notification_draft}</small> : null}
                  </div>
                ))}
                <div className="admin-alert-actions">
                  {queueAdminAlerts.actions.slice(0, 4).map((action) => (
                    <button
                      disabled={!action.enabled}
                      key={action.id}
                      type="button"
                      onClick={() => {
                        if (action.id === "start-scheduler") {
                          applySchedulerAction("start");
                        } else if (action.id === "stop-scheduler") {
                          applySchedulerAction("stop");
                        } else if (action.id === "manual-tick") {
                          applySchedulerAction("tick");
                        } else {
                          setQueueMessage(action.description);
                        }
                      }}
                    >
                      {action.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {queueAdminRecoveryPlan ? (
              <div className={`admin-recovery-plan admin-recovery-plan-${queueAdminRecoveryPlan.status}`}>
                <div className="admin-alert-head">
                  <div>
                    <strong>План восстановления администратора</strong>
                    <small>{queueAdminRecoveryPlan.summary}</small>
                  </div>
                  <span>{queueAdminRecoveryPlan.recommended_mode}</span>
                </div>
                <div className="admin-alert-counts">
                  <small>шагов {queueAdminRecoveryPlan.steps_total}</small>
                  <small>требуют внимания {queueAdminRecoveryPlan.steps_needing_attention}</small>
                  <small>блокируют {queueAdminRecoveryPlan.blocked_steps}</small>
                </div>
                <div className="admin-recovery-steps">
                  {queueAdminRecoveryPlan.plan.slice(0, 4).map((step) => (
                    <div className={`admin-recovery-step admin-recovery-step-${step.status}`} key={step.id}>
                      <div>
                        <strong>
                          {step.priority}. {step.title}
                        </strong>
                        <small>{step.condition}</small>
                      </div>
                      <small>
                        владелец {step.owner_role} · {step.action_kind} · evidence {step.evidence_source}
                      </small>
                      <small>ожидаемый результат: {step.expected_result}</small>
                      <button
                        disabled={step.action_kind === "monitor_only"}
                        type="button"
                        onClick={() => applyRecoveryStep(step)}
                      >
                        {step.action_label}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {incidentLifecycle ? (
              <div className={`incident-lifecycle incident-lifecycle-${incidentLifecycle.status}`}>
                <div className="incident-lifecycle-head">
                  <div>
                    <strong>Жизненный цикл инцидентов</strong>
                    <small>{incidentLifecycle.summary}</small>
                  </div>
                  <span>{incidentLifecycle.status}</span>
                </div>
                <div className="incident-lifecycle-counts">
                  <small>открыто {incidentLifecycle.open}</small>
                  <small>в работе {incidentLifecycle.acknowledged}</small>
                  <small>закрыто {incidentLifecycle.resolved}</small>
                  <small>SLA просрочено {incidentLifecycle.overdue}</small>
                </div>
                {incidentLifecycle.incidents.slice(0, 3).map((incident) => (
                  <div className={`incident-item incident-item-${incident.status}`} key={incident.id}>
                    <div>
                      <span>{incident.severity}</span>
                      <strong>{incident.title}</strong>
                      <small>{incident.current_step}</small>
                      <small>
                        Владелец: {incident.owner_role} · SLA: {incident.sla_status} · возраст {incident.age_seconds}s
                      </small>
                      {incident.response_due_at ? <small>Дедлайн: {incident.response_due_at}</small> : null}
                      {incident.escalation_target ? <small>Эскалация: {incident.escalation_target}</small> : null}
                      <small>Следующее действие: {incident.next_action}</small>
                    </div>
                    <div className="queue-actions">
                      {incident.status === "open" && incident.id.startsWith("incident-dlq-") ? (
                        <button type="button" onClick={() => applyDeadLetterAction(incident.id.replace("incident-dlq-", ""), "acknowledge")}>
                          {incident.action_label}
                        </button>
                      ) : null}
                      {incident.status === "acknowledged" && incident.related_queue_id ? (
                        <button type="button" onClick={() => applyQueueAction(incident.related_queue_id!, "retry")}>
                          Повторить
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {notificationDelivery ? (
              <div className={`notification-delivery notification-delivery-${notificationDelivery.status}`}>
                <div className="notification-delivery-head">
                  <div>
                    <strong>Каналы уведомлений</strong>
                    <small>{notificationDelivery.summary}</small>
                  </div>
                  <span>{notificationDelivery.status}</span>
                </div>
                <div className="notification-delivery-counts">
                  <small>активных инцидентов {notificationDelivery.active_incidents}</small>
                  <small>доставлено {notificationDelivery.delivered}</small>
                  <small>в очереди {notificationDelivery.queued}</small>
                  <small>ошибок {notificationDelivery.failed}</small>
                </div>
                <div className="notification-channels">
                  {notificationDelivery.channels.map((channel) => (
                    <div className={`notification-channel ${channel.enabled ? "notification-channel-enabled" : "notification-channel-disabled"}`} key={channel.id}>
                      <strong>{channel.name}</strong>
                      <small>
                        {channel.channel_type} · {channel.delivery_mode}
                      </small>
                      <small>{channel.target_ref}</small>
                    </div>
                  ))}
                </div>
                {notificationDelivery.items.slice(0, 3).map((item) => (
                  <div className={`notification-item notification-item-${item.status}`} key={item.id}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.channel_id} · {item.status} · владелец {item.owner_role}
                    </small>
                    <small>{item.message}</small>
                    <small>evidence: {item.evidence_ref ?? item.incident_id}</small>
                  </div>
                ))}
                <div className="queue-actions">
                  <button type="button" onClick={dispatchNotificationDelivery}>
                    Сформировать local-log delivery
                  </button>
                </div>
              </div>
            ) : null}
            {notificationRouting ? (
              <div className={`notification-routing notification-routing-${notificationRouting.status}`}>
                <div className="notification-delivery-head">
                  <div>
                    <strong>Маршрутизация уведомлений</strong>
                    <small>{notificationRouting.summary}</small>
                  </div>
                  <span>{notificationRouting.status}</span>
                </div>
                <div className="notification-delivery-counts">
                  <small>маршрутов {notificationRouting.routes_total}</small>
                  <small>активно {notificationRouting.active_routes}</small>
                  <small>external blocked {notificationRouting.external_routes_blocked}</small>
                </div>
                <div className="notification-routes">
                  {notificationRouting.routes.slice(0, 4).map((route) => (
                    <div className={`notification-route notification-route-${route.severity}`} key={route.id}>
                      <strong>{route.id}</strong>
                      <small>
                        {route.severity} · {route.source} · {route.enabled ? "enabled" : "disabled"}
                      </small>
                      <small>
                        owner {route.owner_role} · channels {route.channel_ids.join(", ")}
                      </small>
                      <small>
                        SLA {route.response_minutes ? `${route.response_minutes} мин` : "нет"} · {route.delivery_mode}
                      </small>
                      {route.escalation_target ? <small>эскалация: {route.escalation_target}</small> : null}
                      <small>{route.reason}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {notificationPolicyAudit ? (
              <div className={`notification-policy-audit notification-policy-audit-${notificationPolicyAudit.status}`}>
                <div className="notification-delivery-head">
                  <div>
                    <strong>Аудит политики уведомлений</strong>
                    <small>{notificationPolicyAudit.summary}</small>
                  </div>
                  <span>{notificationPolicyAudit.status}</span>
                </div>
                <div className="notification-delivery-counts">
                  <small>проверок {notificationPolicyAudit.checks_total}</small>
                  <small>passed {notificationPolicyAudit.passed}</small>
                  <small>warnings {notificationPolicyAudit.warnings}</small>
                  <small>failed {notificationPolicyAudit.failed}</small>
                  <small>external delivery {notificationPolicyAudit.external_delivery_allowed ? "allowed" : "blocked"}</small>
                  <small>production gate {notificationPolicyAudit.production_gate_required ? "required" : "not required"}</small>
                </div>
                <div className="notification-policy-items">
                  {notificationPolicyAudit.items.slice(0, 7).map((item) => (
                    <div className={`notification-policy-item notification-policy-item-${item.status}`} key={item.id}>
                      <strong>{item.title}</strong>
                      <small>
                        {item.policy_area} · {item.status} · владелец {item.owner_role}
                      </small>
                      <small>правило: {item.rule}</small>
                      <small>evidence: {item.evidence_source}</small>
                      {item.remediation ? <small>что сделать: {item.remediation}</small> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {incidentTimeline ? (
              <div className={`incident-timeline incident-timeline-${incidentTimeline.status}`}>
                <div className="notification-delivery-head">
                  <div>
                    <strong>Лента инцидента</strong>
                    <small>{incidentTimeline.summary}</small>
                  </div>
                  <span>{incidentTimeline.status}</span>
                </div>
                <div className="notification-delivery-counts">
                  <small>событий {incidentTimeline.events_total}</small>
                  <small>незакрыто {incidentTimeline.unresolved_events}</small>
                </div>
                <div className="incident-timeline-list">
                  {incidentTimeline.timeline.slice(-6).map((event) => (
                    <div className={`incident-timeline-event incident-timeline-event-${event.status}`} key={event.id}>
                      <strong>{event.title}</strong>
                      <small>
                        {event.event_type} · {event.actor} · {new Date(event.timestamp).toLocaleString()}
                      </small>
                      <small>{event.source}</small>
                      {event.related_queue_id ? <small>queue: {event.related_queue_id}</small> : null}
                      {event.related_task_run_id ? <small>TaskRun: {event.related_task_run_id}</small> : null}
                      <small>evidence: {event.evidence_ref ?? event.id}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {queueRunbook ? (
              <div className={`queue-runbook queue-runbook-${queueRunbook.status}`}>
                <div className="notification-delivery-head">
                  <div>
                    <strong>Операционный регламент очереди</strong>
                    <small>{queueRunbook.summary}</small>
                  </div>
                  <span>{queueRunbook.status}</span>
                </div>
                <div className="notification-delivery-counts">
                  <small>шагов {queueRunbook.steps_total}</small>
                  <small>готово {queueRunbook.steps_ready}</small>
                  <small>внимание {queueRunbook.steps_needing_attention}</small>
                  <small>стоп {queueRunbook.emergency_stop_required ? "да" : "нет"}</small>
                </div>
                <div className={`queue-runbook-primary queue-runbook-primary-${queueRunbook.response_mode}`}>
                  <span>{queueRunbook.response_mode}</span>
                  <strong>{queueRunbook.primary_action}</strong>
                  <small>
                    приоритет: {queueRunbook.priority_step_ids.length ? queueRunbook.priority_step_ids.join(", ") : "только мониторинг"}
                  </small>
                </div>
                <div className="queue-runbook-steps">
                  {queueRunbook.steps
                    .slice()
                    .sort((left, right) => {
                      const leftPriority = queueRunbook.priority_step_ids.indexOf(left.id);
                      const rightPriority = queueRunbook.priority_step_ids.indexOf(right.id);
                      if (leftPriority >= 0 && rightPriority >= 0) return leftPriority - rightPriority;
                      if (leftPriority >= 0) return -1;
                      if (rightPriority >= 0) return 1;
                      return 0;
                    })
                    .slice(0, 5)
                    .map((step) => (
                    <div className={`queue-runbook-step queue-runbook-step-${step.status}`} key={step.id}>
                      <strong>{step.title}</strong>
                      <small>
                        {step.severity} · владелец {step.owner_role} · {step.status}
                      </small>
                      <small>триггер: {step.trigger}</small>
                      <small>действие: {step.action}</small>
                      <small>evidence: {step.evidence_source}</small>
                      <small>
                        режим: {step.action_kind} · {step.executable ? "доступно действие" : "ручной разбор"}
                      </small>
                      <div className="queue-runbook-step-actions">
                        {step.executable ? (
                          <button type="button" onClick={() => executeRunbookAction(step)}>
                            {step.action_label ?? "Выполнить"}
                          </button>
                        ) : (
                          <span>{step.action_label ?? "Только проверить"}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {workerObservability ? (
              <div className={`worker-health worker-health-${workerObservability.health}`}>
                <strong>{workerObservability.summary}</strong>
                <small>
                  событий {workerObservability.recent_events_total} · проблем {workerObservability.totals.attention ?? 0} ·
                  pending age {workerObservability.oldest_pending_age_seconds}s
                </small>
              </div>
            ) : null}
            {retryPolicy ? (
              <div className="retry-policy-card">
                <strong>Правило повторов</strong>
                <small>
                  {retryPolicy.policy_version} · попыток {retryPolicy.max_attempts} · задержка{" "}
                  {retryPolicy.base_delay_seconds}-{retryPolicy.max_delay_seconds}s · x{retryPolicy.backoff_multiplier}
                </small>
                <small>Финальный статус: {retryPolicy.terminal_status}; ручной повтор {retryPolicy.manual_override_allowed ? "разрешен" : "закрыт"}.</small>
              </div>
            ) : null}
            {workerScheduler ? (
              <div className={`scheduler-card scheduler-card-${workerScheduler.status}`}>
                <strong>Автопланировщик очереди</strong>
                <small>
                  {workerScheduler.scheduler} · интервал {workerScheduler.interval_seconds}s · обработано {workerScheduler.processed_total} · ошибок {workerScheduler.error_total}
                </small>
                <small>
                  heartbeat {workerScheduler.heartbeat_at ?? "нет"} · последний тик {workerScheduler.last_tick_at ?? "нет"}
                </small>
                {workerScheduler.last_error ? <small>последняя ошибка: {workerScheduler.last_error}</small> : null}
                <div className="queue-actions">
                  <button type="button" onClick={() => applySchedulerAction("start")}>
                    Запустить
                  </button>
                  <button type="button" onClick={() => applySchedulerAction("stop")}>
                    Остановить
                  </button>
                  <button type="button" onClick={() => applySchedulerAction("tick")}>
                    Один тик
                  </button>
                </div>
              </div>
            ) : null}
            {deadLetterQueue ? (
              <div className={`dead-letter-summary ${deadLetterQueue.open ? "dead-letter-summary-open" : ""}`}>
                <strong>Ручной разбор</strong>
                <small>
                  открыто {deadLetterQueue.open} · в разборе {deadLetterQueue.acknowledged} · закрыто {deadLetterQueue.resolved}
                </small>
                <small>
                  Сюда попадают задачи, которые исчерпали автоматические повторы и требуют решения администратора.
                </small>
              </div>
            ) : null}
          </article>
          <div className="queue-metrics">
            <div>
              <span>В очереди</span>
              <strong>{queueStatus.queued + queueStatus.retrying}</strong>
            </div>
            <div>
              <span>В работе</span>
              <strong>{queueStatus.running}</strong>
            </div>
            <div>
              <span>Готово</span>
              <strong>{queueStatus.completed}</strong>
            </div>
            <div>
              <span>Ошибки</span>
              <strong>{queueStatus.failed}</strong>
            </div>
            <div>
              <span>Отменено</span>
              <strong>{queueStatus.cancelled}</strong>
            </div>
            <div>
              <span>Ручной разбор</span>
              <strong>{deadLetterQueue?.open ?? 0}</strong>
            </div>
            <div>
              <span>Автозапуск</span>
              <strong>{workerScheduler?.running ? "on" : "off"}</strong>
            </div>
          </div>
          <div className="queue-latest">
            {deadLetterQueue && deadLetterQueue.items.length ? (
              <div className="dead-letter-panel">
                <strong>Dead Letter Queue</strong>
                {deadLetterQueue.items.slice(0, 3).map((item) => (
                  <div className={`dead-letter-item dead-letter-${item.status}`} key={item.id}>
                    <div>
                      <span>{item.status}</span>
                      <strong>{item.task_run_id}</strong>
                      <small>{item.reason}</small>
                      <small>attempt {item.attempts}/{item.max_attempts} · {item.queue_id}</small>
                    </div>
                    <div className="queue-actions">
                      {item.status === "open" ? (
                        <button type="button" onClick={() => applyDeadLetterAction(item.id, "acknowledge")}>
                          Взять в разбор
                        </button>
                      ) : null}
                      {item.status !== "resolved" ? (
                        <>
                          <button type="button" onClick={() => applyQueueAction(item.queue_id, "retry")}>
                            Повторить
                          </button>
                          <button type="button" onClick={() => applyDeadLetterAction(item.id, "resolve")}>
                            Закрыть
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {queueStatus.items.slice(0, 3).map((item) => (
              <div className={`queue-item queue-${item.status}`} key={item.id}>
                <strong>{item.task_run_id}</strong>
                <span>{item.status}</span>
                <small>attempt {item.attempts}/{item.max_attempts}</small>
                <div className="queue-actions">
                  {["queued", "retrying", "running"].includes(item.status) ? (
                    <button type="button" onClick={() => applyQueueAction(item.id, "cancel")}>
                      Отменить
                    </button>
                  ) : null}
                  {["failed", "cancelled"].includes(item.status) ? (
                    <button type="button" onClick={() => applyQueueAction(item.id, "retry")}>
                      Повторить
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {queueStatus.events.slice(0, 4).map((event) => (
              <div className="queue-event" key={event.id}>
                <strong>{event.event_type}</strong>
                <span>{`${event.status_before ?? "new"} -> ${event.status_after}`}</span>
                <small>{event.task_run_id} · {event.actor}</small>
              </div>
            ))}
            {workerObservability ? (
              <div className="worker-recommendations">
                <strong>Что делать дальше</strong>
                {workerObservability.recommendations.slice(0, 3).map((recommendation) => (
                  <small key={recommendation}>{recommendation}</small>
                ))}
                {workerObservability.attention_items.slice(0, 2).map((item) => (
                  <div className={`worker-attention worker-attention-${item.severity}`} key={item.queue_id}>
                    <span>{item.title}</span>
                    <small>{item.task_run_id} · {item.status} · {item.age_seconds}s</small>
                    <small>{item.recommendation}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!resultCenter ? (
        <section className="empty-result-preview" aria-label="Ожидаемый результат миссии">
          <article>
            <p className="eyebrow">После запуска миссии</p>
            <h2>Здесь появится результат, приемка и следующая задача</h2>
            <p>
              Сначала Симбиот сформирует бизнес-результат, затем покажет паспорт артефакта, доказательства,
              решение пользователя и переход к следующей миссии.
            </p>
          </article>
          <div className="empty-result-steps">
            <span>1. Запустить миссию</span>
            <span>2. Проверить результат</span>
            <span>3. Принять решение</span>
          </div>
        </section>
      ) : null}

      {resultCenter ? (
        <section className="simple-result-shell" id="result-center">
          <article className="panel simple-result-main">
            <div className="panel-header">
              <p className="eyebrow">Центр результата</p>
              <h2>{artifactForPassport?.title ?? "Результат готов"}</h2>
              <p>
                Здесь проверяется бизнес-результат миссии. Ниже видны сам вывод, паспорт артефакта, источник,
                контрольный отпечаток и решение пользователя.
              </p>
            </div>
            <section className="business-decision-hero" id="business-result" aria-label="Итог миссии и решение">
              <div>
                <p className="eyebrow">Итог миссии</p>
                <h3>{artifactForPassport?.title ?? "Результат готов"}</h3>
                <p>{artifactForPassport?.content ?? resultCenter.next_step}</p>
              </div>
              <aside className="result-decision-snapshot" aria-label="Что сделать с результатом">
                <span>Следующее решение</span>
                <strong>{primaryResultAction}</strong>
                <small>{resultCenter.next_step}</small>
                <a href="#result-decision">Принять решение</a>
              </aside>
            </section>
            <nav className="result-center-nav" aria-label="Навигация по результату">
              <a href="#business-result">Результат</a>
              <a href="#artifact-passport">Паспорт</a>
              <a href="#artifact-versions">Версии</a>
              <a href="#result-decision">Приемка</a>
            </nav>
            <section className="result-outcome-strip" aria-label="Сводка результата">
              {resultOutcomeCards.map((card) => (
                <article className="result-outcome-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.detail}</small>
                </article>
              ))}
            </section>
            <section className="acceptance-focus-bar" aria-label="Фокус приемки">
              <div>
                <strong>{primaryResultAction}</strong>
                <small>
                  Evidence {completedEvidenceCount}/{evidenceTotalCount || 0} · версия {artifactForPassport?.version ?? "ожидает"} ·
                  {taskRun ? ` TaskRun ${taskRun.id}` : " TaskRun ожидает"}
                </small>
              </div>
              <a href="#result-decision">Перейти к решению</a>
            </section>
            <section className="result-acceptance-bridge" aria-label="Мост приемки результата">
              {resultAcceptanceBridge.map((item) => (
                <article className={`result-acceptance-item is-${item.status}`} key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </section>
            <section className="business-result-card" id="business-result-detail" aria-label="Бизнес-результат">
              <p className="eyebrow">Бизнес-результат</p>
              <h3>{artifactForPassport?.title ?? "Результат еще не создан"}</h3>
              <p>{artifactForPassport?.content ?? resultCenter.next_step}</p>
              {taskRun ? <small>ID запуска TaskRun: {taskRun.id}</small> : null}
            </section>
            <section className="artifact-passport-compact" aria-label="Короткий паспорт результата">
              <div>
                <span>ID артефакта</span>
                <strong>{artifactForPassport?.id ?? taskRun?.artifact_id ?? "ожидает"}</strong>
              </div>
              <div>
                <span>Hash</span>
                <strong>{artifactFingerprint}</strong>
              </div>
              <div>
                <span>Источник</span>
                <strong>{artifactForPassport?.sources.length ? artifactForPassport.sources.join(", ") : "doc-demo-001"}</strong>
              </div>
            </section>
            <details className="artifact-passport compact-passport" id="artifact-passport" aria-label="Паспорт результата">
              <summary>Паспорт результата</summary>
              <div className="artifact-passport-header">
                <div>
                  <h3>{artifactAcceptanceStatus}</h3>
                </div>
                <span>{artifactForPassport?.version ?? "v1"}</span>
              </div>
              <div className="artifact-passport-grid">
                <div>
                  <span>Что создано</span>
                  <strong>{artifactForPassport?.title ?? "Артефакт формируется"}</strong>
                </div>
                <div>
                  <span>ID артефакта</span>
                  <strong>{artifactForPassport?.id ?? taskRun?.artifact_id ?? "ожидает"}</strong>
                </div>
                <div>
                  <span>Контрольный отпечаток</span>
                  <strong>{artifactFingerprint}</strong>
                </div>
                <div>
                  <span>Источник</span>
                  <strong>{artifactForPassport?.sources.length ? artifactForPassport.sources.join(", ") : "doc-demo-001"}</strong>
                </div>
                <div>
                  <span>Проверка</span>
                  <strong>{artifactQualityStatus}</strong>
                </div>
              </div>
              <div className="artifact-passport-footer">
                <small>{artifactSourceStatus}</small>
                {latestArtifactVersion ? (
                  <small>
                    Зафиксировано: {latestArtifactVersion.source} · {latestArtifactVersion.created_at}
                  </small>
                ) : (
                  <small>Версия будет зафиксирована после создания результата.</small>
                )}
              </div>
            </details>
            <details className="version-drawer" id="artifact-versions" aria-label="Версии результата">
              <summary>Версии результата и откат</summary>
              <div className="version-timeline-summary">
                <strong>{artifactVersions.length ? `${artifactVersions.length} версий результата` : "История версий пока пустая"}</strong>
                <small>Текущая версия: {artifactForPassport?.version ?? "ожидает"}; откат создает новую версию и не удаляет историю.</small>
              </div>
              <div className="version-list">
                {artifactVersions.length ? (
                  artifactVersions.map((version) => {
                    const isCurrentVersion = version.version === artifactForPassport?.version;
                    return (
                      <article className={`version-item ${isCurrentVersion ? "is-current-version" : ""}`} key={version.id}>
                        <div className="version-item-head">
                          <strong>{version.version} · {version.title}</strong>
                          {isCurrentVersion ? <span>текущая</span> : <span>архив</span>}
                        </div>
                        <small>{version.created_at}</small>
                        <small>hash {version.content_hash.slice(0, 12)}</small>
                        <div className="version-actions">
                          <button
                            disabled={versionCompareState === "loading" || isCurrentVersion}
                            type="button"
                            onClick={() => compareArtifactVersion(version)}
                          >
                            {isCurrentVersion ? "Это текущая" : "Сравнить"}
                          </button>
                          <button
                            disabled={rollbackState === "saving" || isCurrentVersion}
                            type="button"
                            onClick={() => prepareArtifactRestore(version)}
                          >
                            {isCurrentVersion ? "Текущая версия" : "Подготовить откат"}
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <article className="version-item">
                    <strong>Версия появится после создания результата</strong>
                    <small>Откат будет доступен после фиксации первой версии артефакта.</small>
                  </article>
                )}
              </div>
              {versionCompare ? (
                <article className="version-compare-card" aria-label="Сравнение версий">
                  <div>
                    <p className="eyebrow">Сравнение версий</p>
                    <h3>{versionCompare.base_version.version} / {versionCompare.target_version.version}</h3>
                    <p>{versionCompare.summary}</p>
                  </div>
                  <div className="version-compare-metrics">
                    {artifactDiffJob ? <span>Job ID: {artifactDiffJob.id}</span> : null}
                    <span>{versionCompare.semantic_change ? "Есть смысловые изменения" : "Смысл не изменился"}</span>
                    <span>Текст: {versionCompare.content_delta_words >= 0 ? "+" : ""}{versionCompare.content_delta_words} слов</span>
                    <span>{versionCompare.content_delta_chars >= 0 ? "+" : ""}{versionCompare.content_delta_chars} знаков</span>
                    <span>Строки: +{versionCompare.added_lines} / -{versionCompare.removed_lines}</span>
                    <span>Показано: {versionCompare.content_diff.length}/{versionCompare.content_diff_total}</span>
                  </div>
                  <div className="version-compare-diffs">
                    {versionCompare.diffs.map((diff) => (
                      <div className={`version-diff is-${diff.status}`} key={diff.field}>
                        <strong>{diff.field}</strong>
                        <small>{diff.status === "changed" ? "изменено" : "без изменений"} · {diff.summary}</small>
                      </div>
                    ))}
                  </div>
                  <div className="content-diff-box" aria-label="Построчное сравнение текста">
                    <strong>Что изменилось в тексте</strong>
                    {versionCompare.content_diff_truncated ? (
                      <small className="diff-truncation-note">
                        Показаны первые {versionCompare.content_diff_limit} строк diff. Полный объем: {versionCompare.content_diff_total} строк.
                      </small>
                    ) : null}
                    {versionCompare.content_diff.length ? (
                      versionCompare.content_diff.map((line, index) => (
                        <div className={`content-diff-line is-${line.type}`} key={`${line.type}-${index}`}>
                          <span>{line.type === "added" ? "+" : line.type === "removed" ? "-" : "="}</span>
                          <small>{line.base_line ?? line.target_line ?? index + 1}</small>
                          <p>{line.text || "пустая строка"}</p>
                        </div>
                      ))
                    ) : (
                      <small>Текстовые строки совпадают.</small>
                    )}
                  </div>
                  <div className="compare-action-grid" aria-label="Действия по сравнению версий">
                    <button type="button" onClick={() => applyCompareAction("accept-comparison")}>
                      Сравнение принято
                    </button>
                    <button type="button" onClick={() => applyCompareAction("send-to-revision")}>
                      Нужна доработка
                    </button>
                    <button type="button" onClick={() => applyCompareAction("prepare-restore")}>
                      Подготовить откат
                    </button>
                  </div>
                  <div className="compare-page-actions">
                    <button
                      disabled={versionCompareState === "loading" || versionCompare.content_diff_offset <= 0}
                      type="button"
                      onClick={() =>
                        compareArtifactVersion(
                          versionCompare.base_version,
                          Math.max(0, versionCompare.content_diff_offset - versionCompare.content_diff_limit)
                        )
                      }
                    >
                      Предыдущая страница
                    </button>
                    <button
                      disabled={versionCompareState === "loading" || versionCompare.content_diff_next_offset == null}
                      type="button"
                      onClick={() => compareArtifactVersion(versionCompare.base_version, versionCompare.content_diff_next_offset ?? 0)}
                    >
                      Следующая страница
                    </button>
                  </div>
                </article>
              ) : null}
              {pendingRestoreVersion ? (
                <article className="restore-confirm-card" aria-label="Подтверждение восстановления версии">
                  <strong>Подтверждение отката к {pendingRestoreVersion.version}</strong>
                  <p>История не удаляется: система создаст новую текущую версию на базе выбранной.</p>
                  <label className="field">
                    <span>Причина восстановления</span>
                    <input value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} />
                  </label>
                  <div className="compare-action-grid">
                    <button
                      disabled={rollbackState === "saving"}
                      type="button"
                      onClick={() => rollbackArtifactToVersion(pendingRestoreVersion, restoreReason)}
                    >
                      Подтвердить откат
                    </button>
                    <button type="button" onClick={() => setPendingRestoreVersion(null)}>
                      Отменить
                    </button>
                  </div>
                </article>
              ) : null}
              <details className="support-drawer" aria-label="Экспорт и evidence package">
                <summary>Экспорт и evidence package</summary>
                <div className="artifact-package-actions">
                  <button type="button" onClick={loadArtifactPackages}>Собрать пакет артефакта</button>
                  {artifactPackageMessage ? <small>{artifactPackageMessage}</small> : null}
                </div>
                {artifactExportDraft ? (
                  <div className="result-row result-row-highlight">
                    <strong>Экспортный черновик</strong>
                    <small>{artifactExportDraft.filename}</small>
                    <small>hash {artifactExportDraft.content_hash.slice(0, 12)}</small>
                  </div>
                ) : null}
                {artifactEvidencePackage ? (
                  <div className="result-row result-row-highlight">
                    <strong>Evidence package</strong>
                    <small>versions {artifactEvidencePackage.versions.length} · diff jobs {artifactEvidencePackage.diff_jobs.length} · actions {artifactEvidencePackage.compare_actions.length}</small>
                    <small>hash {artifactEvidencePackage.package_hash.slice(0, 12)}</small>
                  </div>
                ) : null}
              </details>
              {versionCompareMessage ? <small className={`action-message action-${versionCompareState}`}>{versionCompareMessage}</small> : null}
              {compareActionMessage ? <small className={`action-message action-${compareActionState}`}>{compareActionMessage}</small> : null}
              {rollbackMessage ? <small className={`action-message action-${rollbackState}`}>{rollbackMessage}</small> : null}
            </details>
            <details className="evidence-journal support-drawer" aria-label="Журнал доказательств">
              <summary>Показать доказательства</summary>
              <div className="artifact-passport-header">
                <div>
                  <p className="eyebrow">Журнал доказательств</p>
                  <h3>Почему результат можно проверять</h3>
                </div>
                <span>{evidenceJournal.filter((item) => item.status === "done").length}/{evidenceJournal.length}</span>
              </div>
              <div className="evidence-journal-list">
                {evidenceJournal.map((item) => (
                  <div className={`evidence-journal-item evidence-journal-${item.status}`} key={item.title}>
                    <span />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                      <small>{item.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </details>
            <details className="quality-checkpoints support-drawer" aria-label="Контрольные точки качества">
              <summary>Показать контроль качества</summary>
              <div className="artifact-passport-header">
                <div>
                  <p className="eyebrow">Контроль качества</p>
                  <h3>Точки приемки результата</h3>
                </div>
                <span>{qualityCheckpoints.filter((checkpoint) => checkpoint.status === "passed").length}/{qualityCheckpoints.length}</span>
              </div>
              <div className="quality-checkpoint-list">
                {qualityCheckpoints.map((checkpoint) => (
                  <article className={`quality-checkpoint is-${checkpoint.status}`} key={checkpoint.title}>
                    <strong>{checkpoint.title}</strong>
                    <p>{checkpoint.detail}</p>
                    <small>{checkpoint.action}</small>
                  </article>
                ))}
              </div>
            </details>
            <div className="simple-result-status">
              <div>
                <span>ID запуска</span>
                <strong>{taskRun?.id ?? "ожидает"}</strong>
              </div>
              <div>
                <span>Качество</span>
                <strong>{artifactQualityStatus}</strong>
              </div>
              <div>
                <span>Источники</span>
                <strong>{artifactSourceStatus}</strong>
              </div>
              <div>
                <span>Версия</span>
                <strong>{artifactForPassport?.version ?? "v1"}</strong>
              </div>
            </div>
            {showManagerLayer && taskRun ? <small className="muted">Номер результата: {taskRun.id}</small> : null}
          </article>

          <aside className="panel simple-next-step" id="result-decision">
            <div className="panel-header">
              <p className="eyebrow">Приемка результата</p>
              <h2>Выберите решение по миссии</h2>
              <p>{resultCenter.next_step}</p>
            </div>
            <section className="next-mission-card" aria-label="Следующая миссия">
              <div>
                <p className="eyebrow">Следующая миссия</p>
                <h3>{linkedFollowupTaskRunId ? "Следующая задача создана" : "Готова к запуску"}</h3>
              </div>
              <p>{nextStepBrief.goal}</p>
              <div className="next-mission-grid">
                <div>
                  <span>Выход</span>
                  <strong>{nextStepBrief.expected_artifact}</strong>
                </div>
                <div>
                  <span>Основа</span>
                  <strong>{nextStepSourceLabel}</strong>
                </div>
              </div>
              {linkedFollowupTaskRunId ? <small>Создана: {linkedFollowupTaskRunId}</small> : null}
            </section>
            <section className={`user-continuation-panel ${linkedFollowupTaskRunId ? "is-ready" : ""}`} aria-label="Продолжение сценария">
              <div className="user-continuation-header">
                <div>
                  <p className="eyebrow">Продолжение сценария</p>
                  <h3>
                    {linkedFollowupTaskRunId
                      ? "Следующая миссия готова"
                      : resultCenter.product_status === "accepted"
                        ? "Осталось создать следующий запуск"
                        : "Сначала примите результат"}
                  </h3>
                </div>
                <span>{linkedFollowupTaskRunId ? "готово" : createNextTaskAction?.status === "available" ? "доступно" : "ожидает"}</span>
              </div>
              <div className="continuation-steps">
                {userContinuationSteps.map((step, index) => (
                  <article className={`continuation-step is-${step.status}`} key={step.title}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <small>{step.detail}</small>
                    </div>
                  </article>
                ))}
              </div>
              <section
                className={`next-step-review-card ${nextStepReviewConfirmed || linkedFollowupTaskRunId ? "is-confirmed" : ""}`}
                aria-label="Проверка следующего шага"
              >
                <div className="next-step-review-head">
                  <div>
                    <p className="eyebrow">Проверка перед продолжением</p>
                    <h4>{linkedFollowupTaskRunId ? "Следующий шаг уже создан" : "Проверьте, что пойдет дальше"}</h4>
                  </div>
                  <span>{nextStepReviewStateLabel}</span>
                </div>
                <div className="next-step-review-grid">
                  {nextStepReviewItems.map((item) => (
                    <article className="next-step-review-item" key={item.title}>
                      <span>{item.title}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </article>
                  ))}
                </div>
                {!linkedFollowupTaskRunId ? (
                  <button
                    className="secondary-action next-step-review-button"
                    disabled={nextStepReviewConfirmed || workspacePersistenceState === "saving"}
                    onClick={confirmNextStepReview}
                    type="button"
                  >
                    {nextStepReviewConfirmed ? "Следующий шаг подтвержден" : "Подтвердить следующий шаг"}
                  </button>
                ) : null}
              </section>
              <section className="next-cycle-opening-card" aria-label="Открытие следующего цикла">
                <div className="next-cycle-opening-head">
                  <div>
                    <p className="eyebrow">Открытие следующего цикла</p>
                    <h4>{linkedFollowupTaskRunId ? "Новый запуск уже связан с результатом" : "Следующий запуск готовится из результата"}</h4>
                  </div>
                  <span>{isFollowupCycleOpen ? "открыт" : linkedFollowupTaskRunId ? "создан" : "план"}</span>
                </div>
                <div className="next-cycle-opening-grid">
                  {nextCycleOpeningItems.map((item) => (
                    <article className={`next-cycle-opening-item is-${item.status}`} key={item.title}>
                      <span>{item.title}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </article>
                  ))}
                </div>
              </section>
              <div className="continuation-action-row">
                <div>
                  <strong>{nextStepBrief.expected_artifact}</strong>
                  <small>{nextStepBrief.urgency}</small>
                </div>
                {linkedFollowupTaskRunId ? (
                  <button
                    className="primary-action continuation-open-button"
                    disabled={reloadState === "loading"}
                    onClick={openLinkedFollowupTaskRun}
                    type="button"
                  >
                    {reloadState === "loading" ? "Открываю" : "Открыть следующий запуск"}
                  </button>
                ) : (
                  <small className="muted">Нажмите «Создать следующую задачу» после принятия результата.</small>
                )}
              </div>
            </section>
            {showManagerLayer ? (
              <section className="role-algorithm-card" aria-label="Алгоритм подбора ролей">
                <p className="eyebrow">Алгоритм подбора ролей</p>
                <div className="role-algorithm-list">
                  {roleSelectionAlgorithm.map((step) => (
                    <div className={`role-algorithm-step role-algorithm-${step.status}`} key={step.title}>
                      <span />
                      <div>
                        <strong>{step.title}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="decision-grid">
              {resultDecisionCards.map((card) => (
                <button
                  className={`decision-card decision-${card.tone}`}
                  disabled={
                    !card.action ||
                    card.action.status !== "available" ||
                    resultActionState === "saving" ||
                    (card.id === "create-next-task" && !nextStepReviewReadyForCreation)
                  }
                  key={card.id}
                  onClick={() => {
                    if (card.action) {
                      applyResultAction(card.action);
                    }
                  }}
                  type="button"
                >
                  <strong>{card.title}</strong>
                  <span>
                    {card.action?.status === "available"
                      ? card.id === "create-next-task" && !nextStepReviewReadyForCreation
                        ? "нужно подтверждение"
                        : "можно нажать"
                      : card.action?.status === "completed"
                        ? "уже выполнено"
                        : "пока недоступно"}
                  </span>
                  <small>{card.description}</small>
                </button>
              ))}
            </div>
            <small className="muted">Решение сохранится в истории результата и изменит его статус.</small>
            {resultActionMessage ? <small>{resultActionMessage}</small> : null}
          </aside>
        </section>
      ) : null}

      {resultCenter && showManagerLayer ? (
      <section className="result-center-shell">
        <article className="panel result-center-main">
          <div className="panel-header">
            <p className="eyebrow">Центр управления результатом</p>
            <h2>{resultCenter?.product_status === "accepted" ? "Результат принят" : resultCenter?.product_status === "ready_for_acceptance" ? "Результат готов к приемке" : resultCenter?.product_status ?? "Ожидает запуска"}</h2>
            <p>{resultCenter?.next_step ?? "После запуска здесь появится результат, проверки, доказательства и действия пользователя."}</p>
          </div>
          <div className="result-row">
            <strong>Открыть сохраненный результат</strong>
            <small>Вставьте технический ID, чтобы восстановить ход работы, результат и доказательства.</small>
            <label className="field">
              <span>Технический ID результата</span>
              <input
                placeholder="run-..."
                value={reloadTaskRunId}
                onChange={(event) => setReloadTaskRunId(event.target.value)}
              />
            </label>
            <button
              className="primary-action"
              disabled={reloadState === "loading"}
              onClick={loadExistingTaskRun}
              type="button"
            >
              {reloadState === "loading" ? "Загружается" : "Открыть результат"}
            </button>
            {reloadMessage ? <small>{reloadMessage}</small> : null}
          </div>
          {taskRun ? (
            <div className="result-row result-row-highlight">
              <strong>Текущая работа</strong>
              <code>{taskRun.id}</code>
              <small>Артефакт: {taskRun.artifact_id ?? "нет"}</small>
            </div>
          ) : null}
          <div className="result-center-grid">
            <div className="result-block">
              <strong>Ход работы</strong>
              <div className="timeline">
                {(resultCenter?.timeline ?? taskRun?.stages ?? []).map((stage) => (
                  <div className="timeline-row" key={stage.id}>
                    <span className={`dot dot-${stage.status}`} />
                    <div>
                      <strong>{stage.title}</strong>
                      <small>{stage.status}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="result-block">
              <strong>Проверка результата</strong>
              <div className="stack">
                {(resultCenter?.acceptance_checklist ?? []).map((gate) => (
                  <div className="result-row" key={gate.id}>
                    <strong>{gate.title}</strong>
                    <span className={`pill pill-${gate.status}`}>{gate.status}</span>
                    <p>{gate.reason}</p>
                    {gate.action ? <small>{gate.action}</small> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="result-block">
              <strong>Доказательства</strong>
              <div className="artifact">
                <p>
                  Качество {resultCenter?.evidence.quality.overall_status ?? runtimeEvidence?.quality.overall_status ?? "waiting"} ·
                  источники {resultCenter?.evidence.rag.source_coverage ?? runtimeEvidence?.rag.source_coverage ?? "waiting"}
                </p>
                <small>
                  Audit events: {(resultCenter?.evidence.audit_event_ids ?? runtimeEvidence?.audit_event_ids ?? []).join(", ") || "none"}
                </small>
              </div>
              {resultCenter?.artifact ? (
                <div className="result-row result-row-highlight">
                  <strong>{resultCenter.artifact.title}</strong>
                  <small>version {resultCenter.artifact.version}</small>
                  <p>{resultCenter.artifact.content}</p>
                </div>
              ) : null}
              <div className="stack">
                {(resultCenter?.gates ?? runtimeEvidence?.quality.gates ?? []).map((gate) => (
                  <div className="result-row" key={gate.id}>
                    <strong>{gate.title}</strong>
                    <span className={`pill pill-${gate.status}`}>{gate.status}</span>
                    <p>{gate.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </article>

        <aside className="panel result-actions">
          <div className="panel-header">
            <p className="eyebrow">Действия пользователя</p>
            <h2>{resultCenter?.actions.filter((action) => action.status === "available").length ?? 0} доступно</h2>
          </div>
          <div className="stack">
            <div className="result-row">
              <strong>Следующая задача</strong>
              <small>Этот бриф будет использован, если пользователь создаст следующий шаг.</small>
              <label className="field">
                <span>Цель</span>
                <textarea
                  rows={3}
                  value={followupBrief.goal}
                  onChange={(event) => setFollowupBrief((brief) => ({ ...brief, goal: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Артефакт</span>
                <textarea
                  rows={2}
                  value={followupBrief.expected_artifact}
                  onChange={(event) => setFollowupBrief((brief) => ({ ...brief, expected_artifact: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Контекст</span>
                <textarea
                  rows={2}
                  value={followupBrief.source_context}
                  onChange={(event) => setFollowupBrief((brief) => ({ ...brief, source_context: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Срочность</span>
                <input
                  value={followupBrief.urgency}
                  onChange={(event) => setFollowupBrief((brief) => ({ ...brief, urgency: event.target.value }))}
                />
              </label>
            </div>
            {(resultCenter?.actions ?? []).map((action) => (
              <button
                className="result-action-button"
                disabled={action.status !== "available" || resultActionState === "saving"}
                key={action.id}
                onClick={() => applyResultAction(action)}
                type="button"
              >
                <strong>{action.title}</strong>
                <span className={`pill pill-${action.status === "available" || action.status === "completed" ? "passed" : "warning"}`}>{action.status}</span>
                <small>{action.description}</small>
              </button>
            ))}
            {resultActionMessage ? (
              <div className="result-row">
                <strong>Действие сохранено</strong>
                <span className={`pill pill-${resultActionState === "error" ? "failed" : "passed"}`}>{resultActionState}</span>
                <p>{resultActionMessage}</p>
              </div>
            ) : null}
            {(resultCenter?.action_history ?? []).map((record) => (
              <div className="audit-row" key={record.id}>
                <strong>{record.action_id}</strong>
                <small>{record.actor} · {record.created_at}</small>
                {record.related_task_run_id ? <small>linked TaskRun: {record.related_task_run_id}</small> : null}
                {record.comment ? <small>{record.comment}</small> : null}
              </div>
            ))}
          </div>
        </aside>
      </section>
      ) : null}

      {showAdminLayer ? (
      <section className="product-shell product-shell-compact">
        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Task Intake Gates</p>
            <h2>{taskIntakePreview?.status ?? "Ожидает"}</h2>
            {taskIntakePreview?.missing_fields.length ? (
              <p>Не заполнено: {taskIntakePreview.missing_fields.join(", ")}</p>
            ) : (
              <p>Вход задачи проверен до запуска TaskRun.</p>
            )}
          </div>
          <div className="stack">
            {(taskIntakePreview?.gates ?? []).map((gate) => (
              <div className="result-row" key={gate.id}>
                <strong>{gate.title}</strong>
                <span className={`pill pill-${gate.status}`}>{gate.status}</span>
                <p>{gate.reason}</p>
                {gate.action ? <small>{gate.action}</small> : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Основание выбора</p>
            <h2>Почему эта группа</h2>
          </div>
          <div className="stack">
            {(taskIntakePreview?.selection_basis ?? []).map((basis) => (
              <div className="result-row" key={basis}>
                <strong>{basis}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Профиль запуска</p>
            <h2>{taskIntakePreview?.recommended_profile_id ?? "Ожидает preview"}</h2>
            <p>TaskRun будет запущен только после готового intake preview.</p>
          </div>
        </article>
      </section>
      ) : null}

      {showAdminLayer ? (
      <section className="workspace advanced-workspace">
        <aside className="panel panel-sidebar">
          <div className="panel-header">
            <p className="eyebrow">Advanced</p>
            <h2>Каталог процессов</h2>
          </div>

          {processes.map((process) => (
            <button
              className={`process-button ${process.id === selectedProcess?.id ? "is-active" : ""}`}
              key={process.id}
              onClick={() => setSelectedProcessId(process.id)}
              type="button"
            >
              <span>{process.name}</span>
              <small>{process.category} · v{process.version}</small>
            </button>
          ))}
        </aside>

        <section className="panel panel-main">
          {selectedProcess ? (
            <>
              <div className="panel-header">
                <p className="eyebrow">Process Evidence</p>
                <h2>{selectedProcess.name}</h2>
                <p>{selectedProcess.description}</p>
              </div>

              <div className="meta-grid">
                <div>
                  <span>Выход</span>
                  <strong>{selectedProcess.expected_output}</strong>
                </div>
                <div>
                  <span>Входы</span>
                  <strong>{selectedProcess.required_inputs.join(", ")}</strong>
                </div>
              </div>

              <p className="muted">
                Запуск сценария выполняется только через главный Product Workbench выше, после готового Task Intake Preview.
              </p>
            </>
          ) : (
            <div className="empty-state">{state === "loading" ? "Загрузка каталога..." : "Процессы не найдены"}</div>
          )}
        </section>
      </section>
      ) : null}

      {error && showManagerLayer ? <section className="alert">Ошибка: {error}</section> : null}

      {showQaLayer ? (
      <section className="runtime-grid">
        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">TaskRun</p>
            <h2>{taskRun?.id ?? "Ожидает запуска"}</h2>
          </div>
          <div className="timeline">
            {(taskRun?.stages ?? []).map((stage) => (
              <div className="timeline-row" key={stage.id}>
                <span className={`dot dot-${stage.status}`} />
                <div>
                  <strong>{stage.title}</strong>
                  <small>{stage.status}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Quality Gates</p>
            <h2>{runtimeEvidence?.quality.overall_status ?? `${taskRun?.gates.length ?? 0} проверок`}</h2>
            {runtimeEvidence ? <p>{runtimeEvidence.quality.evidence_summary}</p> : null}
          </div>
          <div className="stack">
            {(runtimeEvidence?.quality.gates ?? taskRun?.gates ?? []).map((gate) => (
              <div className="result-row" key={gate.id}>
                <strong>{gate.title}</strong>
                <span className={`pill pill-${gate.status}`}>{gate.status}</span>
                <p>{gate.reason}</p>
                {gate.action ? <small>{gate.action}</small> : null}
              </div>
            ))}
            <div className="catalog-note">{gateCatalog.length} gates in catalog</div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Artifact</p>
            <h2>{artifact?.title ?? "Не создан"}</h2>
          </div>
          {artifact ? (
            <div className="artifact">
              <p>{artifact.content}</p>
              <small>Sources: {artifact.sources.join(", ")}</small>
            </div>
          ) : (
            <p className="muted">Артефакт появится после запуска MVP path.</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">RAG</p>
            <h2>{runtimeEvidence?.rag.source_coverage ?? "Ожидает"}</h2>
            {storageStatus ? (
              <p>
                {storageStatus.type} · docs {storageStatus.documents} · chunks {storageStatus.chunks} · vectors{" "}
                {storageStatus.vectors} · ready {String(storageStatus.vector_index_ready)}
              </p>
            ) : null}
            {vectorStatus ? (
              <p>
                {vectorStatus.mode} · dim {vectorStatus.dimension} · {vectorStatus.vectors_total}/
                {vectorStatus.chunks_total} indexed · live {String(vectorStatus.pgvector_connected)}
              </p>
            ) : null}
            {embeddingStatus ? (
              <p>
                {embeddingStatus.provider} · pgvector {String(embeddingStatus.pgvector_target)} · fallback{" "}
                {String(embeddingStatus.fallback_used)}
              </p>
            ) : null}
          </div>
          <div className="stack">
            {embeddingStatus ? (
              <div className="result-row">
                <strong>Embedding provider</strong>
                <span className={`pill pill-${embeddingStatus.configured ? "passed" : "warning"}`}>
                  {embeddingStatus.configured ? "configured" : "fallback"}
                </span>
                <p>{embeddingStatus.model} · dim {embeddingStatus.dimension}</p>
                <small>{embeddingStatus.pgvector_migration_path}</small>
              </div>
            ) : null}
            {vectorStatus ? (
              <div className="result-row">
                <strong>pgvector live memory</strong>
                <span className={`pill pill-${vectorStatus.pgvector_ready ? "passed" : "warning"}`}>
                  {vectorStatus.pgvector_ready ? "live" : "fallback"}
                </span>
                <p>
                  connected {String(vectorStatus.pgvector_connected)} · tables{" "}
                  {String(vectorStatus.pgvector_tables_ready)} · vectors {vectorStatus.pgvector_vectors_total}
                </p>
                {vectorStatus.fallback_reason ? <small>{vectorStatus.fallback_reason}</small> : null}
              </div>
            ) : null}
            {(runtimeEvidence?.rag.chunks ?? []).map((chunk) => (
              <div className="result-row" key={chunk.id}>
                <strong>{chunk.title}</strong>
                <span className="pill pill-passed">score {chunk.score}</span>
                <p>{chunk.text}</p>
                <small>{chunk.document_id} · {chunk.access_scope}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">LLM Gateway</p>
            <h2>{runtimeEvidence?.llm.response_status ?? "Ожидает"}</h2>
          </div>
          {runtimeEvidence ? (
            <div className="artifact">
              <p>{runtimeEvidence.llm.provider_id} · {runtimeEvidence.llm.model}</p>
              <small>
                template {runtimeEvidence.llm.prompt_template_version} · secrets redacted:{" "}
                {String(runtimeEvidence.llm.secrets_redacted)}
              </small>
            </div>
          ) : (
            <p className="muted">Evidence появится после запуска MVP path.</p>
          )}
          <div className="provider-list">
            {providers.map((provider) => (
              <div className="provider-row" key={provider.id}>
                <strong>{provider.id}</strong>
                <span className={`pill pill-${provider.status === "enabled" ? "passed" : "warning"}`}>
                  {provider.status}
                </span>
                <small>{provider.provider_type} · priority {provider.fallback_priority}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Audit</p>
            <h2>{auditEvents.length} событий</h2>
            {auditRetention ? (
              <p>
                retention {auditRetention.mode} · chain{" "}
                {auditRetention.chain_valid ? "valid" : "invalid"} · external export{" "}
                {auditRetention.external_export_allowed ? "allowed" : "blocked"}
              </p>
            ) : null}
            {auditPersistence ? (
              <p>
                storage {auditPersistence.storage} · persistent {String(auditPersistence.persistent)} · retention{" "}
                {auditPersistence.retention_schedule_status}
              </p>
            ) : null}
            {evidenceAccess ? (
              <p>
                evidence access {evidenceAccess.mode} · external export{" "}
                {evidenceAccess.external_export_allowed ? "allowed" : "blocked"}
              </p>
            ) : null}
          </div>
          <div className="stack">
            {evidenceAccess ? (
              <div className="result-row">
                <strong>Evidence access model · {evidenceAccess.policy_version}</strong>
                <span className={`pill pill-${evidenceAccess.audit_chain_valid ? "passed" : "failed"}`}>
                  {evidenceAccess.audit_chain_valid ? "valid" : "failed"}
                </span>
                <p>
                  package roles {evidenceAccess.package_roles.join(", ")} · audit decisions{" "}
                  {evidenceAccess.audit_events_total}
                </p>
                <small>
                  {evidenceAccess.storage} · head {evidenceAccess.audit_head_hash.slice(0, 12)}
                </small>
              </div>
            ) : null}
            {evidenceAccessDecision ? (
              <div className="result-row">
                <strong>Current evidence decision · {evidenceAccessDecision.action}</strong>
                <span className={`pill pill-${evidenceAccessDecision.allowed ? "passed" : "failed"}`}>
                  {evidenceAccessDecision.status}
                </span>
                <p>
                  {evidenceAccessDecision.role} · package {String(evidenceAccessDecision.package_access_allowed)} ·
                  external {String(evidenceAccessDecision.external_export_allowed)}
                </p>
                <small>{evidenceAccessDecision.reason}</small>
              </div>
            ) : null}
            {evidenceAccessAudit ? (
              <div className="result-row">
                <strong>Evidence access audit · {evidenceAccessAudit.mode}</strong>
                <span className={`pill pill-${evidenceAccessAudit.valid ? "passed" : "failed"}`}>
                  {evidenceAccessAudit.valid ? "valid" : "failed"}
                </span>
                <p>events {evidenceAccessAudit.events_total}</p>
                <small>head {evidenceAccessAudit.head_hash.slice(0, 12)}</small>
              </div>
            ) : null}
            {auditPersistence ? (
              <div className="result-row">
                <strong>Persistent audit store · {auditPersistence.sync_mode}</strong>
                <span className={`pill pill-${auditPersistence.chain_valid ? "passed" : "failed"}`}>
                  {auditPersistence.chain_valid ? "valid" : "failed"}
                </span>
                <p>
                  events {auditPersistence.events_total} · head {auditPersistence.head_hash.slice(0, 12)}
                </p>
                <small>{auditPersistence.db_path}</small>
              </div>
            ) : null}
            {auditExport ? (
              <div className="result-row">
                <strong>Internal evidence export · {auditExport.id}</strong>
                <span className={`pill pill-${auditExport.external_export_allowed ? "warning" : "passed"}`}>
                  {auditExport.export_scope}
                </span>
                <p>
                  events {auditExport.events_total} · package hash {auditExport.package_hash.slice(0, 12)}
                </p>
                <small>{auditExport.redaction_policy}</small>
              </div>
            ) : null}
            {auditRetention ? (
              <div className="result-row">
                <strong>Retention stop condition</strong>
                <span className={`pill pill-${auditRetention.chain_valid ? "passed" : "failed"}`}>
                  {auditRetention.chain_valid ? "valid" : "failed"}
                </span>
                <p>{auditRetention.stop_condition}</p>
                <small>head {auditRetention.head_hash.slice(0, 12)}</small>
              </div>
            ) : null}
            {auditEvents.map((event) => (
              <div className="audit-row" key={event.id}>
                <strong>{event.action}</strong>
                <small>{event.actor} · {event.target}</small>
                <code>{JSON.stringify(event.redacted_payload)}</code>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Upload/OCR Policy</p>
            <h2>{filePolicy?.status ?? "Ожидает"}</h2>
            {filePolicy ? (
              <p>
                allowed {String(filePolicy.allowed)} · OCR {String(filePolicy.ocr_required)} · scan{" "}
                {String(filePolicy.scan_required)}
              </p>
            ) : null}
            {uploadRuntime ? (
              <p>
                uploads {uploadRuntime.uploads_total} · ocr jobs {uploadRuntime.ocr_jobs_total} · ready{" "}
                {String(uploadRuntime.ready)}
              </p>
            ) : null}
            {ocrWorker ? (
              <p>
                worker {String(ocrWorker.ready)} · queued {ocrWorker.queued_jobs} · completed{" "}
                {ocrWorker.completed_jobs}
              </p>
            ) : null}
          </div>
          <div className="stack">
            {ocrWorker ? (
              <div className="result-row">
                <strong>OCR execution worker</strong>
                <span className={`pill pill-${ocrWorker.ready ? "passed" : "warning"}`}>
                  {ocrWorker.ready ? "ready" : "warning"}
                </span>
                <p>{ocrWorker.worker} · python {ocrWorker.python_command}</p>
                <small>{ocrWorker.pipeline_path}</small>
              </div>
            ) : null}
            {uploadRuntime ? (
              <div className="result-row">
                <strong>Runtime upload layer</strong>
                <span className={`pill pill-${uploadRuntime.ready ? "passed" : "warning"}`}>
                  {uploadRuntime.ready ? "ready" : "warning"}
                </span>
                <p>{uploadRuntime.scanner_adapter} · {uploadRuntime.ocr_dispatcher}</p>
                <small>{uploadRuntime.ocr_pipeline_path}</small>
              </div>
            ) : null}
            {(filePolicy?.checks ?? []).map((check) => (
              <div className="result-row" key={check.id}>
                <strong>{check.title}</strong>
                <span className={`pill pill-${check.status}`}>{check.status}</span>
                <p>{check.reason}</p>
                {check.action ? <small>{check.action}</small> : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Data Protection</p>
            <h2>{piiEvidence ? `${piiEvidence.risk_level} risk` : dataProtectionStatus?.classifier ?? "Ожидает"}</h2>
            {dataProtectionStatus ? <p>{dataProtectionStatus.client_data_condition}</p> : null}
          </div>
          <div className="stack">
            {piiEvidence ? (
              <div className="result-row">
                <strong>PII classifier</strong>
                <span className={`pill pill-${piiEvidence.pii_detected ? "warning" : "passed"}`}>
                  {piiEvidence.findings.length} findings
                </span>
                <p>{piiEvidence.findings.map((finding) => `${finding.label}: ${finding.evidence_preview}`).join("; ")}</p>
                <small>{piiEvidence.redacted_text}</small>
              </div>
            ) : null}
            {blockedExport ? (
              <div className="result-row">
                <strong>Export before approval</strong>
                <span className={`pill pill-${blockedExport.status === "blocked" ? "warning" : "passed"}`}>
                  {blockedExport.status}
                </span>
                <p>{blockedExport.reason}</p>
              </div>
            ) : null}
            {approval ? (
              <div className="result-row">
                <strong>Human approval</strong>
                <span className={`pill pill-${approval.status === "approved" ? "passed" : "warning"}`}>
                  {approval.status}
                </span>
                <p>{approval.reviewer}</p>
                {approval.decision_comment ? <small>{approval.decision_comment}</small> : null}
              </div>
            ) : null}
            {approvedExport ? (
              <div className="result-row">
                <strong>Export after approval</strong>
                <span className={`pill pill-${approvedExport.status === "allowed" ? "passed" : "warning"}`}>
                  {approvedExport.status}
                </span>
                <p>{approvedExport.reason}</p>
                {approvedExport.redacted_content ? <small>{approvedExport.redacted_content}</small> : null}
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Security Session</p>
            <h2>{securitySession?.authenticated ? "authenticated" : "Ожидает"}</h2>
            {securitySession ? <p>{securitySession.actor} · {securitySession.tenant_id}</p> : null}
          </div>
          <div className="stack">
            {securitySession ? (
              <div className="result-row">
                <strong>Tenant guard</strong>
                <span className="pill pill-passed">passed</span>
                <p>
                  {securitySession.role} · {securitySession.department} · {securitySession.access_level}
                </p>
                <small>
                  auth source {securitySession.auth_source} · credentials are never displayed.
                </small>
              </div>
            ) : null}
            {identityProvider ? (
              <div className="result-row">
                <strong>Identity provider · {identityProvider.target_protocol}</strong>
                <span
                  className={`pill pill-${
                    identityProvider.production_sso_ready
                      ? "passed"
                      : identityProvider.verified_jwt_validation_ready
                        ? "warning"
                        : "warning"
                  }`}
                >
                  {identityProvider.production_sso_ready
                    ? "production ready"
                    : identityProvider.verified_jwt_validation_ready
                      ? "jwt verified"
                      : "demo mode"}
                </span>
                <p>
                  provider {identityProvider.provider} · mode {identityProvider.mode} · jwks {identityProvider.jwks_source} · claims{" "}
                  {identityProvider.required_claims.join(", ")}
                </p>
                <small>{identityProvider.stop_condition}</small>
                <div className="compact-list">
                  {Object.entries(identityProvider.configured_fields).map(([field, configured]) => (
                    <span className={`mini-flag mini-flag-${configured ? "passed" : "warning"}`} key={field}>
                      {field}: {configured ? "yes" : "no"}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {keycloakBootstrap ? (
              <div className="result-row">
                <strong>Keycloak bootstrap · {keycloakBootstrap.realm}</strong>
                <span className={`pill pill-${keycloakBootstrap.bootstrap_package_ready ? "passed" : "warning"}`}>
                  {keycloakBootstrap.bootstrap_package_ready ? "package ready" : "needs work"}
                </span>
                <p>
                  client {keycloakBootstrap.client_id} · roles {keycloakBootstrap.roles_found.length}/
                  {keycloakBootstrap.roles_expected.length} · claims {keycloakBootstrap.claims_found.length}/
                  {keycloakBootstrap.claims_expected.length}
                </p>
                <small>
                  production endpoint {keycloakBootstrap.production_endpoint_ready ? "ready" : "open"} ·{" "}
                  {keycloakBootstrap.stop_condition}
                </small>
              </div>
            ) : null}
            {keycloakProduction ? (
              <div className="result-row">
                <strong>Production HTTPS Keycloak</strong>
                <span className={`pill pill-${keycloakProduction.production_endpoint_ready ? "passed" : "warning"}`}>
                  {keycloakProduction.production_endpoint_ready ? "production ready" : "open"}
                </span>
                <p>
                  env {keycloakProduction.required_env_ready ? "ready" : "open"} · jwks{" "}
                  {keycloakProduction.live_jwks_ready ? "live" : "not live"} · keys{" "}
                  {keycloakProduction.jwks_live.keys_total}
                </p>
                <small>{keycloakProduction.stop_condition}</small>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <p className="eyebrow">Access Policy</p>
            <h2>{policyStoreStatus?.persistent ? "Persistent" : accessPolicies.length ? "RBAC/ABAC" : "Ожидает"}</h2>
            <p>Политики доступа к процессам по роли, tenant и атрибутам.</p>
            {policyStoreStatus ? (
              <p>
                {policyStoreStatus.storage} · policies {policyStoreStatus.policies_total} · audit{" "}
                {policyStoreStatus.audit_events_total} · chain{" "}
                {policyStoreStatus.audit_chain_valid ? "valid" : "invalid"}
              </p>
            ) : null}
          </div>
          <div className="stack">
            {roleDirectoryStatus ? (
              <div className="result-row">
                <strong>Role directory · {roleDirectoryStatus.version}</strong>
                <span className={`pill pill-${roleDirectoryStatus.coverage_ready ? "passed" : "warning"}`}>
                  {roleDirectoryStatus.coverage_ready ? "coverage ready" : "coverage check"}
                </span>
                <p>
                  roles {roleDirectoryStatus.active_roles_total}/{roleDirectoryStatus.roles_total} · refs{" "}
                  {roleDirectoryStatus.symbiot_refs_total} · permission groups{" "}
                  {roleDirectoryStatus.permission_groups_total}
                </p>
                <small>
                  missing required:{" "}
                  {roleDirectoryStatus.missing_required_permissions.length
                    ? roleDirectoryStatus.missing_required_permissions.join(", ")
                    : "none"}
                </small>
              </div>
            ) : null}
            {roleDirectoryCoverage ? (
              <div className="result-row">
                <strong>Role permission coverage</strong>
                <span className={`pill pill-${roleDirectoryCoverage.coverage_ready ? "passed" : "failed"}`}>
                  {roleDirectoryCoverage.coverage_ready ? "passed" : "failed"}
                </span>
                <p>
                  departments {roleDirectoryCoverage.departments.length} · roles without permissions{" "}
                  {roleDirectoryCoverage.roles_without_permissions.length}
                </p>
                <small>
                  evidence.package: {(roleDirectoryCoverage.permission_summary["evidence.package"] ?? []).length} ·
                  policy.manage: {(roleDirectoryCoverage.permission_summary["policy.manage"] ?? []).length} ·
                  rag.admin: {(roleDirectoryCoverage.permission_summary["rag.admin"] ?? []).length}
                </small>
              </div>
            ) : null}
            {roleAdminStatus ? (
              <div className="result-row">
                <strong>Role admin workflow · {roleAdminStatus.mode}</strong>
                <span className={`pill pill-${roleAdminStatus.admin_workflow_ready ? "passed" : "failed"}`}>
                  {roleAdminStatus.admin_workflow_ready ? "ready" : "blocked"}
                </span>
                <p>
                  overrides {roleAdminStatus.overrides_total} · audit {roleAdminStatus.audit_events_total} · chain{" "}
                  {roleAdminStatus.audit_chain_valid ? "valid" : "invalid"}
                </p>
                <small>{roleAdminStatus.blocked_operations.join(", ")}</small>
              </div>
            ) : null}
            {roleAuditVerification ? (
              <div className="result-row">
                <strong>Role directory audit · {roleAuditVerification.mode}</strong>
                <span className={`pill pill-${roleAuditVerification.valid ? "passed" : "failed"}`}>
                  {roleAuditVerification.valid ? "valid" : "failed"}
                </span>
                <p>
                  events {roleAuditVerification.events_total} · head {roleAuditVerification.head_hash.slice(0, 12)}
                </p>
                <small>
                  checked {roleAuditVerification.checked_at}
                  {roleAuditVerification.failed_event_id ? ` · failed ${roleAuditVerification.failed_event_id}` : ""}
                </small>
              </div>
            ) : null}
            {roleDirectory && selectedRuntimeRole && roleDraft ? (
              <div className="result-row role-editor">
                <strong>Controlled role editor</strong>
                <span className={`pill pill-${roleEditorState === "error" ? "failed" : roleEditorState === "saved" ? "passed" : "warning"}`}>
                  {roleEditorState}
                </span>
                <div className="form-grid">
                  <label className="field">
                    <span>Role</span>
                    <select value={selectedRuntimeRole.runtime_role} onChange={(event) => setSelectedRoleId(event.target.value)}>
                      {roleDirectory.roles.map((role) => (
                        <option key={role.runtime_role} value={role.runtime_role}>
                          {role.runtime_role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Access</span>
                    <select
                      value={roleDraft.access_level}
                      onChange={(event) => updateRoleDraft({ access_level: event.target.value })}
                    >
                      {ACCESS_LEVEL_OPTIONS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select value={roleDraft.status} onChange={(event) => updateRoleDraft({ status: event.target.value })}>
                      {ROLE_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="permission-grid">
                  {permissionEntries.map(([permission, description]) => (
                    <label className="permission-toggle" key={permission} title={description}>
                      <input
                        checked={roleDraft.permissions.includes(permission)}
                        onChange={() => toggleDraftPermission(permission)}
                        type="checkbox"
                      />
                      <span>{permission}</span>
                    </label>
                  ))}
                </div>
                <button className="primary-action" disabled={roleEditorState === "saving"} onClick={saveRoleOverride}>
                  Save override
                </button>
                {roleEditorMessage ? <small>{roleEditorMessage}</small> : null}
              </div>
            ) : null}
            {policyDirectoryValidation ? (
              <div className="result-row">
                <strong>Policy directory validation</strong>
                <span className={`pill pill-${policyDirectoryValidation.valid ? "passed" : "failed"}`}>
                  {policyDirectoryValidation.valid ? "valid" : "failed"}
                </span>
                <p>
                  policies {policyDirectoryValidation.policies_total} · invalid{" "}
                  {policyDirectoryValidation.invalid_policies_total}
                </p>
                <small>unknown runtime roles are rejected on policy update</small>
              </div>
            ) : null}
            {policyAuditVerification ? (
              <div className="result-row">
                <strong>Audit integrity · {policyAuditVerification.mode}</strong>
                <span className={`pill pill-${policyAuditVerification.valid ? "passed" : "failed"}`}>
                  {policyAuditVerification.valid ? "valid" : "failed"}
                </span>
                <p>
                  events {policyAuditVerification.events_total} · head{" "}
                  {policyAuditVerification.head_hash.slice(0, 12)}
                </p>
                <small>
                  checked {policyAuditVerification.checked_at}
                  {policyAuditVerification.failed_event_id
                    ? ` · failed ${policyAuditVerification.failed_event_id}`
                    : ""}
                </small>
              </div>
            ) : null}
            {roleDirectory?.roles.slice(0, 4).map((role) => (
              <div className="audit-row" key={role.runtime_role}>
                <strong>{role.runtime_role} · {role.display_name}</strong>
                <small>{role.symbiot_role_ref}</small>
                <small>
                  {role.department} · {role.access_level} · {role.status}
                  {role.alias_of ? ` · alias of ${role.alias_of}` : ""}
                </small>
                <small>{role.permissions.slice(0, 5).join(", ")}</small>
              </div>
            ))}
            {accessPolicies.map((policy) => (
              <div className="result-row" key={policy.process_id}>
                <strong>{policy.process_id}</strong>
                <span className={`pill pill-${policy.status === "active" ? "passed" : "warning"}`}>
                  {policy.status}
                </span>
                <p>view: {policy.view_roles.join(", ")} · execute: {policy.execute_roles.join(", ")}</p>
                <small>
                  {policy.tenant_id} · departments {policy.allowed_departments.join(", ")} · min{" "}
                  {policy.min_access_level} · {policy.policy_version}
                </small>
              </div>
            ))}
            {policyAudit.slice(0, 3).map((event) => (
              <div className="audit-row" key={event.id}>
                <strong>{event.action} · {event.process_id}</strong>
                <small>{event.actor} · {event.role} · {event.created_at}</small>
                <small>hash {event.event_hash.slice(0, 12)} · prev {event.previous_hash.slice(0, 12)}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
      ) : null}
    </main>
  );
}
