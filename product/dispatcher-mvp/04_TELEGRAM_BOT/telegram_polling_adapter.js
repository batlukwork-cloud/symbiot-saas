"use strict";

const dispatcherUrl =
  process.env.DISPATCHER_LOCAL_URL || "http://127.0.0.1:8788";
const token = process.env.DISPATCHER_TELEGRAM_BOT_TOKEN;
const pollTimeoutSeconds = Number(process.env.DISPATCHER_TELEGRAM_POLL_TIMEOUT || 20);

function requireToken() {
  if (!token) {
    throw new Error("DISPATCHER_TELEGRAM_BOT_TOKEN is required");
  }
}

async function telegramApi(method, payload) {
  requireToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`telegram ${method} failed: ${result.description}`);
  }
  return result.result;
}

async function postUpdateToDispatcher(update) {
  const response = await fetch(`${dispatcherUrl}/api/telegram/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`dispatcher telegram update failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function acknowledge(update, dispatchResult) {
  const chatId = update.message && update.message.chat && update.message.chat.id;
  if (!chatId) {
    return;
  }

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: [
      "Событие принято Диспетчерской.",
      `Карточка: ${dispatchResult.decision_card.id}`,
      `Открыть: ${dispatcherUrl}/`,
    ].join("\n"),
  });
}

async function pollOnce(offset) {
  const updates = await telegramApi("getUpdates", {
    offset,
    timeout: pollTimeoutSeconds,
    allowed_updates: ["message", "edited_message"],
  });

  let nextOffset = offset;
  for (const update of updates) {
    nextOffset = update.update_id + 1;
    if (!update.message && !update.edited_message) {
      continue;
    }
    const dispatchResult = await postUpdateToDispatcher(update);
    await acknowledge(update, dispatchResult);
  }

  return nextOffset;
}

async function runPolling() {
  requireToken();
  let offset = Number(process.env.DISPATCHER_TELEGRAM_OFFSET || 0);
  console.log("Telegram polling adapter started.");
  console.log(`Dispatcher: ${dispatcherUrl}`);

  while (true) {
    try {
      offset = await pollOnce(offset);
    } catch (error) {
      console.error(error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

if (require.main === module) {
  runPolling().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  pollOnce,
  postUpdateToDispatcher,
};
