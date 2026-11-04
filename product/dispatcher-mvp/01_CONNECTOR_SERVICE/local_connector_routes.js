"use strict";

const crypto = require("crypto");
const { dispatchEvent } = require("./mock_dispatch_event");

const ALLOWED_DECISIONS = new Set([
  "accept",
  "correct",
  "clarify",
  "defer",
  "archive",
]);

function stableId(prefix, value) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${hash}`;
}

function makeState() {
  return {
    events: new Map(),
    decisionCards: new Map(),
    missionContractDrafts: new Map(),
    missionRuns: new Map(),
    auditLog: [],
  };
}

function json(statusCode, body) {
  return { statusCode, body };
}

function getEventOr404(state, eventId) {
  const event = state.events.get(eventId);
  if (!event) {
    return null;
  }
  return event;
}

function audit(state, action, details) {
  state.auditLog.push({
    id: stableId("audit", { index: state.auditLog.length, action, details }),
    action,
    details,
    created_at: "2026-08-02T10:05:00.000Z",
  });
}

function createMissionContractDraft(event, decision) {
  return {
    id: stableId("mission_contract_draft", {
      event_id: event.id,
      decision,
    }),
    event_id: event.id,
    status: "draft_created_after_human_gate",
    goal: event.payload.text,
    source: {
      channel: event.channel,
      sender: event.sender,
      received_at: event.received_at,
      attachments: event.attachments,
    },
    proposed_roles: [
      "dispatcher_controller_mock",
      "mission_methodologist_mock",
      "quality_controller_mock",
    ],
    proposed_budget: {
      mode: "not_allocated_mock",
      money_limit: null,
      time_limit: null,
    },
    permissions: {
      runtime_allowed: false,
      obsidian_write_allowed: false,
      external_webhook_allowed: false,
      supabase_live_allowed: false,
    },
    acceptance_checklist: [
      "human accepted creation of mission contract draft",
      "runtime remains blocked",
      "confirmed Obsidian write is not requested in this proof",
      "no production systems are touched",
    ],
    evidence_policy: {
      required_before_runtime: true,
      current_proof: "local_connector_routes_human_gate",
    },
    runtime_started: false,
    obsidian_writes: [],
    llm: {
      status: event.llm.status,
      model_calls: event.llm.model_calls,
    },
  };
}

function postDispatchEvent(state, envelope) {
  const result = dispatchEvent(envelope);

  state.events.set(result.dispatch_event.id, result.dispatch_event);
  state.decisionCards.set(result.dispatch_event.id, result.decision_card);
  audit(state, "dispatch_event_received", {
    event_id: result.dispatch_event.id,
    decision_card_id: result.decision_card.id,
    runtime_started: result.runtime.started,
  });

  return json(201, result);
}

function getDispatchInbox(state) {
  return json(200, {
    items: Array.from(state.decisionCards.values()),
    count: state.decisionCards.size,
  });
}

function getDecisionCard(state, eventId) {
  if (!getEventOr404(state, eventId)) {
    return json(404, { error: "dispatch_event_not_found" });
  }

  return json(200, {
    decision_card: state.decisionCards.get(eventId),
    mission_contract_draft:
      state.missionContractDrafts.get(eventId) || null,
  });
}

function postHumanDecision(state, eventId, body) {
  const event = getEventOr404(state, eventId);
  if (!event) {
    return json(404, { error: "dispatch_event_not_found" });
  }

  const decision = body && body.decision;
  if (!ALLOWED_DECISIONS.has(decision)) {
    return json(400, { error: "unsupported_human_decision" });
  }

  const decisionRecord = {
    id: stableId("human_decision", {
      event_id: eventId,
      decision,
      decided_by: body.decided_by || "human_demo",
    }),
    event_id: eventId,
    decision,
    decided_by: body.decided_by || "human_demo",
    note: body.note || null,
    decided_at: body.decided_at || "2026-08-02T10:06:00.000Z",
  };

  let missionContractDraft = state.missionContractDrafts.get(eventId) || null;
  if (decision === "accept") {
    missionContractDraft = createMissionContractDraft(event, decisionRecord);
    state.missionContractDrafts.set(eventId, missionContractDraft);
  }

  const card = state.decisionCards.get(eventId);
  card.human_decision = decisionRecord;
  card.mission_contract =
    decision === "accept" ? missionContractDraft : null;
  card.runtime_started = false;

  audit(state, "human_gate_decision_recorded", {
    event_id: eventId,
    decision,
    mission_contract_draft_id: missionContractDraft
      ? missionContractDraft.id
      : null,
    runtime_started: false,
    obsidian_writes: 0,
  });

  return json(200, {
    decision_card: card,
    human_decision: decisionRecord,
    mission_contract_draft: missionContractDraft,
    runtime: {
      started: false,
      blocked_reason: "MISSION_CONTRACT_DRAFT_ONLY",
    },
    obsidian_writes: [],
  });
}

function startLocalMission(state, eventId, body) {
  const event = getEventOr404(state, eventId);
  if (!event) {
    return json(404, { error: "dispatch_event_not_found" });
  }

  const missionContractDraft = state.missionContractDrafts.get(eventId);
  if (!missionContractDraft) {
    return json(409, { error: "mission_contract_draft_required" });
  }

  if (!body || body.approved !== true) {
    return json(403, { error: "human_launch_approval_required" });
  }

  const missionRun = {
    id: stableId("mission_run", {
      event_id: eventId,
      draft_id: missionContractDraft.id,
      approved_by: body.approved_by || "human_demo",
    }),
    event_id: eventId,
    mission_contract_draft_id: missionContractDraft.id,
    status: "completed_local_sandbox",
    approved_by: body.approved_by || "human_demo",
    approved_at: body.approved_at || "2026-08-02T10:10:00.000Z",
    runtime: {
      started: true,
      scope: "local_sandbox_only",
      completed: true,
    },
    result: {
      title: "Локальный результат миссии",
      summary:
        "Диспетчерская приняла событие, получила Human Gate, создала контракт и выполнила безопасную локальную миссию в sandbox-контуре.",
      next_human_check:
        "Дмитрий проверяет, что артефакты созданы, а production и реальные данные не затронуты.",
    },
    llm: {
      status: "OFF_MOCK",
      model_calls: 0,
    },
    safety: {
      production_touched: false,
      secrets_touched: false,
      supabase_live_touched: false,
      external_webhook_touched: false,
      real_personal_data_used: false,
      d1_tst_001_closed: false,
      readiness_changed: false,
    },
  };

  state.missionRuns.set(eventId, missionRun);
  const card = state.decisionCards.get(eventId);
  card.runtime_started = true;
  card.local_mission_run = missionRun;

  audit(state, "local_mission_run_completed", {
    event_id: eventId,
    mission_run_id: missionRun.id,
    runtime_started: true,
    runtime_scope: missionRun.runtime.scope,
  });

  return json(200, {
    mission_run: missionRun,
    runtime: missionRun.runtime,
  });
}

function handleLocalRoute(state, method, path, body) {
  if (method === "POST" && path === "/dispatch/events") {
    return postDispatchEvent(state, body);
  }

  if (method === "GET" && path === "/dispatch/inbox") {
    return getDispatchInbox(state);
  }

  const cardMatch = path.match(/^\/dispatch\/events\/([^/]+)\/card$/);
  if (method === "GET" && cardMatch) {
    return getDecisionCard(state, cardMatch[1]);
  }

  const decisionMatch = path.match(/^\/dispatch\/events\/([^/]+)\/decision$/);
  if (method === "POST" && decisionMatch) {
    return postHumanDecision(state, decisionMatch[1], body || {});
  }

  const missionStartMatch = path.match(
    /^\/dispatch\/events\/([^/]+)\/mission\/start$/
  );
  if (method === "POST" && missionStartMatch) {
    return startLocalMission(state, missionStartMatch[1], body || {});
  }

  return json(404, { error: "local_route_not_found" });
}

function createLocalConnector() {
  const state = makeState();
  return {
    state,
    request(method, path, body) {
      return handleLocalRoute(state, method, path, body);
    },
  };
}

module.exports = {
  createLocalConnector,
  handleLocalRoute,
  makeState,
  createMissionContractDraft,
  startLocalMission,
};
