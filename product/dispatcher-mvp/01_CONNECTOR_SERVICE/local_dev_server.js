"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createLocalConnector } = require("./local_connector_routes");
const {
  getAdapterStatus,
  makeDemoBitrix24Event,
  makeDemoEmailMessage,
  makeDemoWebhookTrigger,
  makeDemoWhatsAppUpdate,
  normalizeBitrix24Event,
  normalizeWebhookTrigger,
  normalizeTelegramUpdate,
  normalizeWhatsAppUpdate,
  pollEmailSpool,
  pollFileSpool,
  writeEmailTrigger,
  writeFileTrigger,
} = require("./adapter_manager");
const {
  writeConfirmedMissionArtifacts,
} = require("../05_OBSIDIAN_BRIDGE/local_obsidian_bridge");

const root = path.resolve(__dirname, "..");
const uiRoot = path.join(root, "03_DESKTOP_UI");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

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

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("invalid json body"));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(response, requestPath) {
  const relativePath =
    requestPath === "/" ? "dispatcher_mock_ui.html" : requestPath.slice(1);
  const filePath = path.resolve(uiRoot, relativePath);

  if (!filePath.startsWith(uiRoot)) {
    sendText(response, 403, "forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(response, 404, "not found");
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function createLocalDevServer() {
  const connector = createLocalConnector();
  let seededEventId = null;
  const sourceRuntime = {
    telegram: {
      token: process.env.DISPATCHER_TELEGRAM_BOT_TOKEN || null,
      connected: Boolean(process.env.DISPATCHER_TELEGRAM_BOT_TOKEN),
      bot: null,
      last_check: null,
    },
    email: {
      connected: true,
      mode: "local_spool",
      last_check: null,
    },
    whatsapp: {
      connected: true,
      mode: "local_update_endpoint",
      last_check: null,
    },
    webhook: {
      connected: true,
      mode: "local_endpoint",
      last_check: null,
    },
    folder: {
      connected: true,
      mode: "local_spool",
      last_check: null,
    },
    bitrix24: {
      connected: true,
      mode: "local_event_endpoint",
      last_check: null,
    },
  };

  function createEventFromEnvelope(envelope) {
    const created = connector.request("POST", "/dispatch/events", envelope);
    return created;
  }

  function publicSourceStatus() {
    const adapters = getAdapterStatus();
    return {
      telegram: {
        ...adapters.telegram,
        connected: sourceRuntime.telegram.connected,
        bot: sourceRuntime.telegram.bot,
        token_in_memory: Boolean(sourceRuntime.telegram.token),
        last_check: sourceRuntime.telegram.last_check,
      },
      email: {
        ...adapters.email,
        connected: sourceRuntime.email.connected,
        last_check: sourceRuntime.email.last_check,
      },
      whatsapp: {
        ...adapters.whatsapp,
        connected: sourceRuntime.whatsapp.connected,
        last_check: sourceRuntime.whatsapp.last_check,
      },
      webhook: {
        ...adapters.webhook,
        connected: sourceRuntime.webhook.connected,
        last_check: sourceRuntime.webhook.last_check,
      },
      folder: {
        ...adapters.folder,
        connected: sourceRuntime.folder.connected,
        last_check: sourceRuntime.folder.last_check,
      },
      bitrix24: {
        ...adapters.bitrix24,
        connected: sourceRuntime.bitrix24.connected,
        last_check: sourceRuntime.bitrix24.last_check,
      },
    };
  }

  async function checkTelegramToken(token) {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.description || "Telegram getMe failed");
    }
    return {
      id: result.result.id,
      username: result.result.username || null,
      first_name: result.result.first_name || null,
    };
  }

  async function completeChainForEvent(eventId) {
    connector.request("POST", `/dispatch/events/${eventId}/decision`, {
      decision: "accept",
      decided_by: "human_demo",
      note: "Sources screen chain test",
      decided_at: "2026-08-02T10:30:00.000Z",
    });
    const result = connector.request(
      "POST",
      `/dispatch/events/${eventId}/mission/start`,
      {
        approved: true,
        approved_by: "human_demo",
        approved_at: "2026-08-02T10:31:00.000Z",
      }
    );
    if (result.statusCode !== 200) {
      return result;
    }
    const bridgeResult = writeConfirmedMissionArtifacts({
      event: connector.state.events.get(eventId),
      decisionCard: connector.state.decisionCards.get(eventId),
      missionContractDraft: connector.state.missionContractDrafts.get(eventId),
      missionRun: result.body.mission_run,
    });
    return {
      statusCode: 200,
      body: {
        ...result.body,
        obsidian_bridge: bridgeResult,
      },
    };
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          local_only: true,
          adapters: getAdapterStatus(),
          production_touched: false,
          external_webhook_touched: false,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/adapters/status") {
        sendJson(response, 200, getAdapterStatus());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/sources/status") {
        sendJson(response, 200, publicSourceStatus());
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sources/telegram/connect"
      ) {
        const body = await readBody(request);
        if (!body.token || typeof body.token !== "string") {
          sendJson(response, 400, { error: "telegram_token_required" });
          return;
        }

        const bot = await checkTelegramToken(body.token);
        sourceRuntime.telegram.token = body.token;
        sourceRuntime.telegram.connected = true;
        sourceRuntime.telegram.bot = bot;
        sourceRuntime.telegram.last_check = "ok";
        sendJson(response, 200, {
          connected: true,
          bot,
          secret_stored_in_files: false,
        });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sources/telegram/test"
      ) {
        const token = sourceRuntime.telegram.token;
        if (!token) {
          sendJson(response, 409, {
            connected: false,
            error: "telegram_token_not_connected",
          });
          return;
        }
        const bot = await checkTelegramToken(token);
        sourceRuntime.telegram.bot = bot;
        sourceRuntime.telegram.last_check = "ok";
        sendJson(response, 200, { connected: true, bot });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sources/email/connect"
      ) {
        sourceRuntime.email.connected = true;
        sourceRuntime.email.mode = "local_spool";
        sourceRuntime.email.last_check = "ok";
        sendJson(response, 200, {
          connected: true,
          mode: "local_spool",
          spool_dir: getAdapterStatus().email.spool_dir,
        });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sources/email/test"
      ) {
        const filePath = writeEmailTrigger(makeDemoEmailMessage());
        sourceRuntime.email.last_check = "ok";
        sendJson(response, 200, {
          connected: true,
          file_path: filePath,
          secret_stored_in_files: false,
        });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sources/full-chain-test"
      ) {
        const body = await readBody(request);
        let created;
        if (body.source === "telegram") {
          const update = {
            update_id: Date.now(),
            message: {
              message_id: Date.now(),
              date: Math.floor(Date.now() / 1000),
              chat: { id: 1001, type: "private" },
              from: {
                id: 1001,
                first_name: "Demo",
                last_name: "Sender",
                username: "demo_sender",
              },
              text: "Проверь договор и собери пакет документов",
            },
          };
          created = createEventFromEnvelope(normalizeTelegramUpdate(update));
        } else if (body.source === "email") {
          const filePath = writeEmailTrigger(
            makeDemoEmailMessage(),
            `email_sources_screen_${Date.now()}.json`
          );
          const envelopes = pollEmailSpool();
          const envelope = envelopes.find(
            (item) => item.metadata.source_file === filePath
          ) || envelopes[envelopes.length - 1];
          created = createEventFromEnvelope(envelope);
        } else if (body.source === "whatsapp") {
          created = createEventFromEnvelope(
            normalizeWhatsAppUpdate(makeDemoWhatsAppUpdate())
          );
          sourceRuntime.whatsapp.last_check = "ok";
        } else if (body.source === "webhook") {
          created = createEventFromEnvelope(
            normalizeWebhookTrigger(makeDemoWebhookTrigger())
          );
          sourceRuntime.webhook.last_check = "ok";
        } else if (body.source === "folder") {
          const filePath = writeFileTrigger(
            "Прими файл из локальной папки и собери результат миссии",
            `folder_sources_screen_${Date.now()}.txt`
          );
          const envelopes = pollFileSpool();
          const envelope = envelopes.find(
            (item) => item.metadata.source_file === filePath
          ) || envelopes[envelopes.length - 1];
          created = createEventFromEnvelope(envelope);
          sourceRuntime.folder.last_check = "ok";
        } else if (body.source === "bitrix24") {
          created = createEventFromEnvelope(
            normalizeBitrix24Event(makeDemoBitrix24Event())
          );
          sourceRuntime.bitrix24.last_check = "ok";
        } else {
          sendJson(response, 400, { error: "unsupported_source" });
          return;
        }

        const completed = await completeChainForEvent(
          created.body.dispatch_event.id
        );
        sendJson(response, completed.statusCode, {
          source: body.source,
          dispatch_event: created.body.dispatch_event,
          decision_card: created.body.decision_card,
          ...completed.body,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/whatsapp/update") {
        const body = await readBody(request);
        const envelope = normalizeWhatsAppUpdate(body);
        sourceRuntime.whatsapp.last_check = "ok";
        const created = createEventFromEnvelope(envelope);
        sendJson(response, created.statusCode, created.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/webhook/event") {
        const body = await readBody(request);
        const envelope = normalizeWebhookTrigger(body);
        sourceRuntime.webhook.last_check = "ok";
        const created = createEventFromEnvelope(envelope);
        sendJson(response, created.statusCode, created.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/bitrix24/event") {
        const body = await readBody(request);
        const envelope = normalizeBitrix24Event(body);
        sourceRuntime.bitrix24.last_check = "ok";
        const created = createEventFromEnvelope(envelope);
        sendJson(response, created.statusCode, created.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/folder/demo") {
        const filePath = writeFileTrigger(
          "Прими файл из локальной папки и собери результат миссии",
          `folder_trigger_${Date.now()}.txt`
        );
        sendJson(response, 201, {
          status: "created",
          file_path: filePath,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/folder/poll") {
        const envelopes = pollFileSpool();
        sourceRuntime.folder.last_check = "ok";
        const results = envelopes.map((envelope) =>
          createEventFromEnvelope(envelope)
        );
        sendJson(response, 200, {
          polled: envelopes.length,
          items: results.map((result) => result.body),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/demo/seed") {
        if (!seededEventId) {
          const created = createEventFromEnvelope(sampleEnvelope);
          seededEventId = created.body.dispatch_event.id;
          sendJson(response, created.statusCode, created.body);
          return;
        }

        const card = connector.request(
          "GET",
          `/dispatch/events/${seededEventId}/card`
        );
        sendJson(response, 200, {
          dispatch_event: connector.state.events.get(seededEventId),
          decision_card: card.body.decision_card,
          mission_contract_draft: card.body.mission_contract_draft,
          runtime: {
            started: false,
            blocked_reason: card.body.mission_contract_draft
              ? "MISSION_CONTRACT_DRAFT_ONLY"
              : "HUMAN_GATE_REQUIRED",
          },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/telegram/update") {
        const body = await readBody(request);
        const envelope = normalizeTelegramUpdate(body);
        const created = createEventFromEnvelope(envelope);
        sendJson(response, created.statusCode, created.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/email/demo") {
        const filePath = writeEmailTrigger(makeDemoEmailMessage());
        sendJson(response, 201, {
          status: "created",
          file_path: filePath,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/email/poll") {
        const envelopes = pollEmailSpool();
        const results = envelopes.map((envelope) =>
          createEventFromEnvelope(envelope)
        );
        sendJson(response, 200, {
          polled: envelopes.length,
          items: results.map((result) => result.body),
        });
        return;
      }

      const missionStartMatch = url.pathname.match(
        /^\/dispatch\/events\/([^/]+)\/mission\/start$/
      );
      if (request.method === "POST" && missionStartMatch) {
        const eventId = missionStartMatch[1];
        const body = await readBody(request);
        const result = connector.request(request.method, url.pathname, body);
        if (result.statusCode !== 200) {
          sendJson(response, result.statusCode, result.body);
          return;
        }

        const bridgeResult = writeConfirmedMissionArtifacts({
          event: connector.state.events.get(eventId),
          decisionCard: connector.state.decisionCards.get(eventId),
          missionContractDraft:
            connector.state.missionContractDrafts.get(eventId),
          missionRun: result.body.mission_run,
        });
        sendJson(response, 200, {
          ...result.body,
          obsidian_bridge: bridgeResult,
        });
        return;
      }

      if (url.pathname.startsWith("/dispatch/")) {
        const body = request.method === "POST" ? await readBody(request) : {};
        const result = connector.request(request.method, url.pathname, body);
        sendJson(response, result.statusCode, result.body);
        return;
      }

      if (request.method === "GET") {
        serveStatic(response, url.pathname);
        return;
      }

      sendText(response, 405, "method not allowed");
    } catch (error) {
      sendJson(response, 500, {
        error: "local_dev_server_error",
        message: error.message,
      });
    }
  }

  return {
    connector,
    server: http.createServer(handleRequest),
  };
}

function startLocalDevServer(options = {}) {
  const { server, connector } = createLocalDevServer();
  const host = "127.0.0.1";
  const port =
    options.port === undefined
      ? Number(process.env.DISPATCHER_LOCAL_PORT) || 8788
      : options.port;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        server,
        connector,
        url: `http://${address.address}:${address.port}/`,
      });
    });
  });
}

if (require.main === module) {
  startLocalDevServer()
    .then(({ url }) => {
      console.log(`Dispatcher MVP local dev server: ${url}`);
      console.log("Local only: no production, secrets, Supabase live or external webhook.");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createLocalDevServer,
  startLocalDevServer,
};
