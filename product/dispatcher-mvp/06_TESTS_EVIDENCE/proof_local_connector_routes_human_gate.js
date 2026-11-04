"use strict";

const assert = require("assert");
const {
  createLocalConnector,
} = require("../01_CONNECTOR_SERVICE/local_connector_routes");

const connector = createLocalConnector();

const sampleEnvelope = {
  tenant_id: "tenant_demo",
  workspace_id: "workspace_demo",
  channel: "telegram",
  sender: {
    id: "tg_1001",
    display_name: "Demo Sender",
  },
  received_at: "2026-08-02T10:00:00.000Z",
  payload: {
    text: "Проверь договор и собери пакет документов",
  },
  attachments: [],
  risk_flags: [],
};

const postEvent = connector.request(
  "POST",
  "/dispatch/events",
  sampleEnvelope
);

assert.strictEqual(postEvent.statusCode, 201);
assert.strictEqual(postEvent.body.runtime.started, false);
assert.strictEqual(
  postEvent.body.runtime.blocked_reason,
  "HUMAN_GATE_REQUIRED"
);
assert.strictEqual(postEvent.body.dispatch_event.llm.status, "OFF_MOCK");
assert.strictEqual(postEvent.body.dispatch_event.llm.model_calls, 0);
assert.strictEqual(postEvent.body.decision_card.human_gate_required, true);
assert.strictEqual(postEvent.body.decision_card.runtime_started, false);
assert.strictEqual(postEvent.body.decision_card.mission_contract, null);
assert.deepStrictEqual(postEvent.body.decision_card.obsidian_writes, []);

const eventId = postEvent.body.dispatch_event.id;
const decisionCardId = postEvent.body.decision_card.id;

const inbox = connector.request("GET", "/dispatch/inbox");
assert.strictEqual(inbox.statusCode, 200);
assert.strictEqual(inbox.body.count, 1);
assert.strictEqual(inbox.body.items[0].id, decisionCardId);

const cardBeforeDecision = connector.request(
  "GET",
  `/dispatch/events/${eventId}/card`
);
assert.strictEqual(cardBeforeDecision.statusCode, 200);
assert.strictEqual(cardBeforeDecision.body.decision_card.id, decisionCardId);
assert.strictEqual(cardBeforeDecision.body.mission_contract_draft, null);

const acceptDecision = connector.request(
  "POST",
  `/dispatch/events/${eventId}/decision`,
  {
    decision: "accept",
    decided_by: "human_demo",
    note: "Demo acceptance for local proof only",
    decided_at: "2026-08-02T10:06:00.000Z",
  }
);

assert.strictEqual(acceptDecision.statusCode, 200);
assert.strictEqual(acceptDecision.body.runtime.started, false);
assert.strictEqual(
  acceptDecision.body.runtime.blocked_reason,
  "MISSION_CONTRACT_DRAFT_ONLY"
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.status,
  "draft_created_after_human_gate"
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.permissions.runtime_allowed,
  false
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.permissions.obsidian_write_allowed,
  false
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.permissions.supabase_live_allowed,
  false
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.permissions.external_webhook_allowed,
  false
);
assert.deepStrictEqual(
  acceptDecision.body.mission_contract_draft.obsidian_writes,
  []
);
assert.strictEqual(
  acceptDecision.body.mission_contract_draft.llm.model_calls,
  0
);
assert.strictEqual(connector.state.events.size, 1);
assert.strictEqual(connector.state.decisionCards.size, 1);
assert.strictEqual(connector.state.missionContractDrafts.size, 1);
assert.strictEqual(connector.state.auditLog.length, 2);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      proof:
        "local connector routes create decision card and Human Gate creates mission contract draft without runtime or Obsidian writes",
      routes: {
        post_event: true,
        get_inbox: true,
        get_card: true,
        post_decision_accept: true,
      },
      dispatch_event_id: eventId,
      decision_card_id: decisionCardId,
      mission_contract_draft_id:
        acceptDecision.body.mission_contract_draft.id,
      runtime_started: acceptDecision.body.runtime.started,
      blocked_reason: acceptDecision.body.runtime.blocked_reason,
      obsidian_writes:
        acceptDecision.body.mission_contract_draft.obsidian_writes.length,
      model_calls: acceptDecision.body.mission_contract_draft.llm.model_calls,
      audit_records: connector.state.auditLog.length,
      production_touched: false,
      secrets_touched: false,
      supabase_live_touched: false,
      external_webhook_touched: false,
      real_personal_data_used: false,
      readiness_changed: false,
      d1_tst_001_closed: false,
    },
    null,
    2
  )
);
