"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inboxRoot = path.join(root, "01_CONNECTOR_SERVICE", "local_inbox");
const processedRoot = path.join(inboxRoot, "processed");

function envPresent(name) {
  return Boolean(process.env[name]);
}

function getAdapterStatus() {
  return {
    telegram: {
      mode: envPresent("DISPATCHER_TELEGRAM_BOT_TOKEN")
        ? "polling_ready"
        : "local_update_endpoint",
      token_present: envPresent("DISPATCHER_TELEGRAM_BOT_TOKEN"),
      webhook_used: false,
    },
    email: {
      mode:
        envPresent("EMAIL_IMAP_HOST") &&
        envPresent("EMAIL_IMAP_USER") &&
        envPresent("EMAIL_IMAP_PASSWORD")
          ? "imap_polling_ready"
          : "local_spool",
      imap_present:
        envPresent("EMAIL_IMAP_HOST") &&
        envPresent("EMAIL_IMAP_USER") &&
        envPresent("EMAIL_IMAP_PASSWORD"),
      spool_dir: getEmailSpoolDir(),
    },
    whatsapp: {
      mode: "local_update_endpoint",
      webhook_used: false,
      token_present: envPresent("DISPATCHER_WHATSAPP_TOKEN"),
    },
    webhook: {
      mode: "local_endpoint",
      url: "/api/webhook/event",
    },
    folder: {
      mode: "local_spool",
      spool_dir: getFileSpoolDir(),
    },
    bitrix24: {
      mode: "local_event_endpoint",
      webhook_present: envPresent("DISPATCHER_BITRIX24_WEBHOOK_URL"),
    },
  };
}

function getEmailSpoolDir() {
  return process.env.DISPATCHER_EMAIL_SPOOL_DIR || path.join(inboxRoot, "email");
}

function getFileSpoolDir() {
  return process.env.DISPATCHER_FILE_SPOOL_DIR || path.join(inboxRoot, "files");
}

function normalizeTelegramUpdate(update) {
  const message = update && (update.message || update.edited_message);
  if (!message || typeof message.text !== "string" || !message.text.trim()) {
    throw new Error("telegram message text is required");
  }

  const chat = message.chat || {};
  const from = message.from || {};
  const senderId = String(from.id || chat.id || "telegram_unknown");
  const displayName =
    [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    from.username ||
    chat.title ||
    senderId;

  return {
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo",
    channel: "telegram",
    sender: {
      id: `tg_${senderId}`,
      display_name: displayName,
    },
    received_at: new Date((message.date || 0) * 1000 || Date.now()).toISOString(),
    payload: {
      text: message.text,
      raw_ref: update.update_id ? `telegram_update_${update.update_id}` : null,
    },
    attachments: [],
    risk_flags: [],
    metadata: {
      adapter: "telegram_local_update",
      chat_id: chat.id || null,
      message_id: message.message_id || null,
    },
  };
}

function normalizeEmailMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("email message is required");
  }

  const text = message.text || message.body || message.snippet;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("email text is required");
  }

  const from = message.from || {};
  const senderId = from.email || message.from_email || "email_unknown";

  return {
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo",
    channel: "email",
    sender: {
      id: senderId,
      display_name: from.name || senderId,
    },
    received_at: message.received_at || new Date().toISOString(),
    payload: {
      subject: message.subject || "Email trigger",
      text,
      raw_ref: message.id || message.message_id || null,
    },
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    risk_flags: Array.isArray(message.risk_flags) ? message.risk_flags : [],
    metadata: {
      adapter: "email_local_spool",
      source_file: message.source_file || null,
    },
  };
}

function normalizeWhatsAppUpdate(update) {
  const value =
    update &&
    update.entry &&
    update.entry[0] &&
    update.entry[0].changes &&
    update.entry[0].changes[0] &&
    update.entry[0].changes[0].value;
  const message = value && value.messages && value.messages[0];
  const contact = value && value.contacts && value.contacts[0];
  const text = message && message.text && message.text.body;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("whatsapp text message is required");
  }

  const senderId = message.from || "whatsapp_unknown";
  return {
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo",
    channel: "whatsapp",
    sender: {
      id: `wa_${senderId}`,
      display_name:
        (contact && contact.profile && contact.profile.name) || senderId,
    },
    received_at: message.timestamp
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    payload: {
      text,
      raw_ref: message.id || null,
    },
    attachments: [],
    risk_flags: [],
    metadata: {
      adapter: "whatsapp_local_update",
      message_type: message.type || "text",
    },
  };
}

function normalizeWebhookTrigger(trigger) {
  const text = trigger && (trigger.text || trigger.payload_text || trigger.body);
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("webhook text is required");
  }

  return {
    tenant_id: trigger.tenant_id || "tenant_demo",
    workspace_id: trigger.workspace_id || "workspace_demo",
    channel: "webhook",
    sender: {
      id: trigger.sender_id || "webhook_sender",
      display_name: trigger.sender_name || "Webhook Sender",
    },
    received_at: trigger.received_at || new Date().toISOString(),
    payload: {
      subject: trigger.subject || "Webhook trigger",
      text,
      raw_ref: trigger.id || null,
    },
    attachments: Array.isArray(trigger.attachments) ? trigger.attachments : [],
    risk_flags: Array.isArray(trigger.risk_flags) ? trigger.risk_flags : [],
    metadata: {
      adapter: "generic_webhook_local",
      source: trigger.source || "generic",
    },
  };
}

function normalizeBitrix24Event(event) {
  const fields =
    (event && event.data && (event.data.FIELDS || event.data.fields)) || {};
  const text =
    event.text ||
    fields.DESCRIPTION ||
    fields.TITLE ||
    event.event ||
    "Bitrix24 event";

  return {
    tenant_id: "tenant_demo",
    workspace_id: "workspace_demo",
    channel: "bitrix24",
    sender: {
      id: String(fields.CREATED_BY || event.user_id || "bitrix24_user"),
      display_name: event.user_name || "Bitrix24 User",
    },
    received_at: event.received_at || new Date().toISOString(),
    payload: {
      subject: fields.TITLE || event.event || "Bitrix24 trigger",
      text,
      raw_ref: fields.ID ? `bitrix24_${fields.ID}` : event.event || null,
    },
    attachments: [],
    risk_flags: [],
    metadata: {
      adapter: "bitrix24_local_event",
      event: event.event || null,
    },
  };
}

function ensureSpool() {
  fs.mkdirSync(getEmailSpoolDir(), { recursive: true });
  fs.mkdirSync(getFileSpoolDir(), { recursive: true });
  fs.mkdirSync(processedRoot, { recursive: true });
}

function writeEmailTrigger(message, fileName = "email_trigger_demo.json") {
  ensureSpool();
  const filePath = nextAvailablePath(path.join(getEmailSpoolDir(), fileName));
  fs.writeFileSync(filePath, `${JSON.stringify(message, null, 2)}\n`, "utf8");
  return filePath;
}

function nextAvailablePath(basePath) {
  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  const parsed = path.parse(basePath);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}_${String(index).padStart(3, "0")}${parsed.ext}`
    );
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("cannot allocate unique spool file path");
}

function pollEmailSpool() {
  ensureSpool();
  const files = fs
    .readdirSync(getEmailSpoolDir())
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .sort();

  const envelopes = [];
  for (const file of files) {
    const filePath = path.join(getEmailSpoolDir(), file);
    const raw = fs.readFileSync(filePath, "utf8");
    const message = JSON.parse(raw);
    message.source_file = filePath;
    envelopes.push(normalizeEmailMessage(message));

    const processedPath = nextAvailablePath(path.join(processedRoot, file));
    fs.renameSync(filePath, processedPath);
  }

  return envelopes;
}

function writeFileTrigger(content, fileName = "file_trigger_demo.txt") {
  ensureSpool();
  const filePath = nextAvailablePath(path.join(getFileSpoolDir(), fileName));
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function pollFileSpool() {
  ensureSpool();
  const files = fs
    .readdirSync(getFileSpoolDir())
    .filter((file) => file.toLowerCase().endsWith(".txt") || file.toLowerCase().endsWith(".json"))
    .sort();

  const envelopes = [];
  for (const file of files) {
    const filePath = path.join(getFileSpoolDir(), file);
    const raw = fs.readFileSync(filePath, "utf8");
    let text = raw;
    let subject = file;
    if (file.toLowerCase().endsWith(".json")) {
      const parsed = JSON.parse(raw);
      text = parsed.text || parsed.body || raw;
      subject = parsed.subject || file;
    }
    envelopes.push({
      tenant_id: "tenant_demo",
      workspace_id: "workspace_demo",
      channel: "file_watcher",
      sender: {
        id: "local_file_spool",
        display_name: "Local File Spool",
      },
      received_at: new Date().toISOString(),
      payload: {
        subject,
        text,
        raw_ref: filePath,
      },
      attachments: [
        {
          id: `file_${file}`,
          file_ref: filePath,
          hash: null,
          mime: file.toLowerCase().endsWith(".json")
            ? "application/json"
            : "text/plain",
          visibility_layer: "source",
        },
      ],
      risk_flags: [],
      metadata: {
        adapter: "file_watcher_local_spool",
        source_file: filePath,
      },
    });

    fs.renameSync(filePath, nextAvailablePath(path.join(processedRoot, file)));
  }

  return envelopes;
}

function makeDemoWhatsAppUpdate() {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [
                {
                  profile: { name: "Demo WhatsApp Client" },
                  wa_id: "79000000000",
                },
              ],
              messages: [
                {
                  from: "79000000000",
                  id: "wamid.demo001",
                  timestamp: "1785666300",
                  type: "text",
                  text: {
                    body: "Проверь договор из WhatsApp и собери пакет документов",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeDemoWebhookTrigger() {
  return {
    id: "webhook_demo_1001",
    source: "demo_webhook",
    sender_id: "webhook_demo_sender",
    sender_name: "Webhook Demo",
    subject: "Webhook task",
    text: "Прими webhook-событие и собери результат миссии",
  };
}

function makeDemoBitrix24Event() {
  return {
    event: "ONTASKADD",
    user_id: "42",
    user_name: "Bitrix24 Demo User",
    data: {
      FIELDS: {
        ID: "1001",
        TITLE: "Проверить договор из Bitrix24",
        DESCRIPTION: "Создать миссию из задачи Bitrix24 и собрать результат",
        CREATED_BY: "42",
      },
    },
  };
}

function makeDemoEmailMessage() {
  return {
    id: "email_demo_1001",
    from: {
      email: "client@example.local",
      name: "Demo Client",
    },
    received_at: "2026-08-02T10:15:00.000Z",
    subject: "Новая задача для Симбиота",
    text: "Проверь входящий договор, подготовь маршрут миссии и собери результат.",
    attachments: [],
    risk_flags: [],
  };
}

function makeDemoTelegramUpdate() {
  return {
    update_id: 1001,
    message: {
      message_id: 501,
      date: 1785666000,
      chat: {
        id: 1001,
        type: "private",
      },
      from: {
        id: 1001,
        first_name: "Demo",
        last_name: "Sender",
        username: "demo_sender",
      },
      text: "Проверь договор и собери пакет документов",
    },
  };
}

module.exports = {
  getAdapterStatus,
  normalizeTelegramUpdate,
  normalizeEmailMessage,
  normalizeWhatsAppUpdate,
  normalizeWebhookTrigger,
  normalizeBitrix24Event,
  pollEmailSpool,
  pollFileSpool,
  writeEmailTrigger,
  writeFileTrigger,
  makeDemoEmailMessage,
  makeDemoTelegramUpdate,
  makeDemoWhatsAppUpdate,
  makeDemoWebhookTrigger,
  makeDemoBitrix24Event,
};
