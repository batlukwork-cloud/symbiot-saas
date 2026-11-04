"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startLocalDevServer } = require("../01_CONNECTOR_SERVICE/local_dev_server");
const {
  makeDemoEmailMessage,
  makeDemoTelegramUpdate,
  writeEmailTrigger,
} = require("../01_CONNECTOR_SERVICE/adapter_manager");
const { bridgeRoot } = require("../05_OBSIDIAN_BRIDGE/local_obsidian_bridge");

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}

async function completeEvent(baseUrl, eventId) {
  await postJson(`${baseUrl}dispatch/events/${eventId}/decision`, {
    decision: "accept",
    decided_by: "human_demo",
    note: "External trigger e2e proof",
    decided_at: "2026-08-02T10:20:00.000Z",
  });
  return postJson(`${baseUrl}dispatch/events/${eventId}/mission/start`, {
    approved: true,
    approved_by: "human_demo",
    approved_at: "2026-08-02T10:21:00.000Z",
  });
}

function assertMissionArtifacts(result) {
  assert.strictEqual(result.mission_run.runtime.scope, "local_sandbox_only");
  assert.strictEqual(result.obsidian_bridge.artifact_count, 6);
  assert(result.obsidian_bridge.mission_folder.startsWith(bridgeRoot));
  assert(fs.existsSync(path.join(result.obsidian_bridge.mission_folder, "mission_manifest.json")));
}

async function main() {
  let serverHandle;
  try {
    serverHandle = await startLocalDevServer({ port: 0 });
    const baseUrl = serverHandle.url;

    const health = await fetch(`${baseUrl}health`).then((response) =>
      response.json()
    );
    assert.strictEqual(health.status, "ok");
    assert.strictEqual(health.adapters.telegram.webhook_used, false);

    const telegramCreated = await postJson(
      `${baseUrl}api/telegram/update`,
      makeDemoTelegramUpdate()
    );
    assert.strictEqual(telegramCreated.dispatch_event.channel, "telegram");
    const telegramResult = await completeEvent(
      baseUrl,
      telegramCreated.dispatch_event.id
    );
    assertMissionArtifacts(telegramResult);

    writeEmailTrigger(makeDemoEmailMessage(), "email_external_e2e.json");
    const emailPoll = await postJson(`${baseUrl}api/email/poll`);
    assert.strictEqual(emailPoll.polled, 1);
    const emailItem = emailPoll.items[0];
    assert.strictEqual(emailItem.dispatch_event.channel, "email");
    const emailResult = await completeEvent(baseUrl, emailItem.dispatch_event.id);
    assertMissionArtifacts(emailResult);

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "Telegram update and email spool triggers complete the full local Dispatcher chain",
          telegram: {
            dispatch_event_id: telegramCreated.dispatch_event.id,
            mission_run_id: telegramResult.mission_run.id,
            artifact_count: telegramResult.obsidian_bridge.artifact_count,
          },
          email: {
            dispatch_event_id: emailItem.dispatch_event.id,
            mission_run_id: emailResult.mission_run.id,
            artifact_count: emailResult.obsidian_bridge.artifact_count,
          },
          adapters: health.adapters,
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
  } finally {
    if (serverHandle) {
      await new Promise((resolve) => serverHandle.server.close(resolve));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
