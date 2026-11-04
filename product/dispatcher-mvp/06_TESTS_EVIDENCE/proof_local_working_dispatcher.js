"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startLocalDevServer } = require("../01_CONNECTOR_SERVICE/local_dev_server");

const evidenceDir = __dirname;

function findInstalledBrowser() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  const browserPath = candidates.find((candidate) => fs.existsSync(candidate));
  assert(browserPath, "Installed Chrome or Edge browser is required");
  return browserPath;
}

async function main() {
  let serverHandle;
  let browser;

  try {
    serverHandle = await startLocalDevServer({ port: 0 });
    const health = await fetch(`${serverHandle.url}health`).then((response) =>
      response.json()
    );
    assert.strictEqual(health.status, "ok");
    assert.strictEqual(health.local_only, true);
    assert.strictEqual(health.production_touched, false);
    assert.strictEqual(health.external_webhook_touched, false);

    const { chromium } = require("playwright");
    browser = await chromium.launch({
      executablePath: findInstalledBrowser(),
      headless: true,
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(serverHandle.url);
    await page.waitForFunction(
      () => window.__DISPATCHER_UI_PROOF__?.local_api_seeded === true
    );

    const before = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(before.api_mode, true);
    assert.strictEqual(before.local_api_seeded, true);
    assert.strictEqual(before.runtime_started, false);

    await page.click('[data-action="human-gate-accept"]');
    await page.waitForFunction(
      () => window.__DISPATCHER_UI_PROOF__?.local_api_decision_posted === true
    );

    const after = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(after.api_mode, true);
    assert.strictEqual(after.local_api_decision_posted, true);
    assert.strictEqual(after.mission_contract_draft_visible, true);
    assert.strictEqual(after.runtime_started, false);
    assert.strictEqual(after.obsidian_writes, 0);
    assert.strictEqual(after.blocked_reason, "MISSION_CONTRACT_DRAFT_ONLY");

    const visibleText = await page.locator("body").innerText();
    assert(visibleText.includes("Черновик mission contract"));
    assert(visibleText.includes("Runtime остановлен"));

    const screenshotPath = path.join(
      evidenceDir,
      "dispatcher_working_local_desktop_2026-08-02.png"
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const inbox = await fetch(`${serverHandle.url}dispatch/inbox`).then(
      (response) => response.json()
    );
    assert.strictEqual(inbox.count, 1);

    const card = await fetch(
      `${serverHandle.url}dispatch/events/${after.dispatch_event_id}/card`
    ).then((response) => response.json());
    assert.strictEqual(
      card.mission_contract_draft.id,
      "mission_contract_draft_6d44dd27101d9f95"
    );
    assert.strictEqual(card.mission_contract_draft.runtime_started, false);

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "local runnable Dispatcher works through 127.0.0.1 API and Human Gate creates draft only",
          url_tested: serverHandle.url,
          health_ok: true,
          desktop_loaded_from_local_server: true,
          local_api_seeded: true,
          human_gate_click_posted_to_local_api: true,
          dispatch_event_id: after.dispatch_event_id,
          mission_contract_draft_id:
            card.mission_contract_draft.id,
          runtime_started: card.mission_contract_draft.runtime_started,
          blocked_reason: after.blocked_reason,
          obsidian_writes: card.mission_contract_draft.obsidian_writes.length,
          model_calls: card.mission_contract_draft.llm.model_calls,
          screenshot: screenshotPath,
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
    if (browser) {
      await browser.close();
    }
    if (serverHandle) {
      await new Promise((resolve) => serverHandle.server.close(resolve));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
