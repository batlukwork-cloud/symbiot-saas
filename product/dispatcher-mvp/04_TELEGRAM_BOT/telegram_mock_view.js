"use strict";

const { createLocalConnector } = require("../01_CONNECTOR_SERVICE/local_connector_routes");

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

function buildKeyboard(eventId) {
  return [
    [
      {
        text: "Подтвердить черновик",
        callback_data: `dispatch:accept:${eventId}`,
      },
    ],
    [
      { text: "Скорректировать", callback_data: `dispatch:correct:${eventId}` },
      { text: "Уточнить", callback_data: `dispatch:clarify:${eventId}` },
    ],
    [
      { text: "Отложить", callback_data: `dispatch:defer:${eventId}` },
      { text: "В архив", callback_data: `dispatch:archive:${eventId}` },
    ],
  ];
}

function renderInboxMessage(card) {
  return {
    chat_id: "local_mock_chat",
    parse_mode: "HTML",
    text: [
      "<b>Диспетчерская Симбиота</b>",
      "",
      `Источник: ${card.source.channel} / ${card.source.sender.display_name}`,
      `Событие: ${card.summary}`,
      "Статус: ждет Human Gate",
      "LLM: OFF_MOCK",
      "Runtime: остановлен",
    ].join("\n"),
    reply_markup: {
      inline_keyboard: buildKeyboard(card.event_id),
    },
  };
}

function renderDraftMessage(draft) {
  return {
    chat_id: "local_mock_chat",
    parse_mode: "HTML",
    text: [
      "<b>Черновик mission contract создан</b>",
      "",
      `ID: ${draft.id}`,
      `Цель: ${draft.goal}`,
      "Runtime: остановлен",
      "Obsidian write: no",
      "Webhook: no",
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Открыть в Desktop",
            callback_data: `dispatch:open:${draft.event_id}`,
          },
        ],
      ],
    },
  };
}

function createTelegramMockSession() {
  const connector = createLocalConnector();
  const postEvent = connector.request("POST", "/dispatch/events", sampleEnvelope);
  const card = postEvent.body.decision_card;

  return {
    connector,
    event_id: card.event_id,
    inbox_message: renderInboxMessage(card),
    acceptHumanGate() {
      const decision = connector.request(
        "POST",
        `/dispatch/events/${card.event_id}/decision`,
        {
          decision: "accept",
          decided_by: "human_demo",
          note: "Demo acceptance for local proof only",
          decided_at: "2026-08-02T10:06:00.000Z",
        }
      );

      return {
        decision,
        draft_message: renderDraftMessage(decision.body.mission_contract_draft),
      };
    },
  };
}

module.exports = {
  buildKeyboard,
  renderInboxMessage,
  renderDraftMessage,
  createTelegramMockSession,
};
