"use strict";

const crypto = require("crypto");

const ALLOWED_CHANNELS = new Set([
  "telegram",
  "desktop",
  "email",
  "bitrix24",
  "file_watcher",
  "obsidian",
  "whatsapp",
  "webhook",
]);

function stableId(prefix, value) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${hash}`;
}

function requireText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function normalizeDispatchEvent(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("event envelope is required");
  }

  const tenantId = requireText(envelope.tenant_id, "tenant_id");
  const workspaceId = requireText(envelope.workspace_id, "workspace_id");
  const channel = requireText(envelope.channel, "channel");
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }

  const sender = envelope.sender || {};
  const senderId = requireText(sender.id, "sender.id");
  const payload = envelope.payload || {};
  const text = requireText(payload.text, "payload.text");
  const receivedAt = envelope.received_at || new Date().toISOString();

  const normalized = {
    id: stableId("dispatch_evt", {
      tenantId,
      workspaceId,
      channel,
      senderId,
      receivedAt,
      text,
    }),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    channel,
    sender: {
      id: senderId,
      display_name: sender.display_name || senderId,
    },
    received_at: receivedAt,
    status: "action_proposed",
    payload: {
      text,
      subject: payload.subject || null,
      raw_ref: payload.raw_ref || null,
    },
    attachments: Array.isArray(envelope.attachments)
      ? envelope.attachments.map((item, index) => ({
          id: item.id || stableId("attachment", { index, item }),
          file_ref: item.file_ref || null,
          hash: item.hash || null,
          mime: item.mime || "application/octet-stream",
          visibility_layer: item.visibility_layer || "source",
        }))
      : [],
    risk_flags: Array.isArray(envelope.risk_flags) ? envelope.risk_flags : [],
    llm: {
      status: "OFF_MOCK",
      model_calls: 0,
    },
    metadata: envelope.metadata || {},
  };

  return normalized;
}

function createDecisionCard(dispatchEvent) {
  return {
    id: stableId("decision_card", dispatchEvent.id),
    event_id: dispatchEvent.id,
    title: `Incoming ${dispatchEvent.channel} event`,
    source: {
      channel: dispatchEvent.channel,
      sender: dispatchEvent.sender,
      received_at: dispatchEvent.received_at,
    },
    summary: dispatchEvent.payload.text,
    suggested_action: "create_mission_draft",
    confidence: "mock_not_scored",
    llm_status: dispatchEvent.llm.status,
    allowed_decisions: ["accept", "correct", "clarify", "defer", "archive"],
    human_gate_required: true,
    runtime_started: false,
    mission_contract: null,
    obsidian_writes: [],
  };
}

function dispatchEvent(envelope) {
  const event = normalizeDispatchEvent(envelope);
  const decisionCard = createDecisionCard(event);

  return {
    dispatch_event: event,
    decision_card: decisionCard,
    runtime: {
      started: false,
      blocked_reason: "HUMAN_GATE_REQUIRED",
    },
  };
}

module.exports = {
  dispatchEvent,
  normalizeDispatchEvent,
  createDecisionCard,
};
