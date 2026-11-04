"use strict";

const assert = require("assert");
const { dispatchEvent } = require("../01_CONNECTOR_SERVICE/mock_dispatch_event");

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

const result = dispatchEvent(sampleEnvelope);

assert.strictEqual(result.dispatch_event.channel, "telegram");
assert.strictEqual(result.dispatch_event.sender.id, "tg_1001");
assert.strictEqual(result.dispatch_event.status, "action_proposed");
assert.strictEqual(result.dispatch_event.llm.status, "OFF_MOCK");
assert.strictEqual(result.dispatch_event.llm.model_calls, 0);

assert.strictEqual(result.decision_card.event_id, result.dispatch_event.id);
assert.strictEqual(result.decision_card.human_gate_required, true);
assert.strictEqual(result.decision_card.runtime_started, false);
assert.strictEqual(result.decision_card.mission_contract, null);
assert.deepStrictEqual(result.decision_card.obsidian_writes, []);

assert.strictEqual(result.runtime.started, false);
assert.strictEqual(result.runtime.blocked_reason, "HUMAN_GATE_REQUIRED");

console.log(
  JSON.stringify(
    {
      status: "PASS",
      proof: "mock dispatch_event creates decision card and blocks runtime before Human Gate",
      dispatch_event_id: result.dispatch_event.id,
      decision_card_id: result.decision_card.id,
      runtime_started: result.runtime.started,
      blocked_reason: result.runtime.blocked_reason,
      obsidian_writes: result.decision_card.obsidian_writes.length,
      model_calls: result.dispatch_event.llm.model_calls,
    },
    null,
    2
  )
);
