"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startLocalDevServer } = require("../01_CONNECTOR_SERVICE/local_dev_server");
const { bridgeRoot } = require("../05_OBSIDIAN_BRIDGE/local_obsidian_bridge");

const expectedArtifactNames = [
  "00_mission_passport.md",
  "01_mission_contract.md",
  "02_result.md",
  "03_evidence.md",
  "04_reflection.md",
  "mission_manifest.json",
];

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
    const { chromium } = require("playwright");
    browser = await chromium.launch({
      executablePath: findInstalledBrowser(),
      headless: true,
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
    await page.goto(serverHandle.url);
    await page.waitForFunction(
      () => window.__DISPATCHER_UI_PROOF__?.local_api_seeded === true
    );

    await page.click('[data-action="human-gate-accept"]');
    await page.waitForFunction(
      () => window.__DISPATCHER_UI_PROOF__?.local_api_decision_posted === true
    );

    await page.click('[data-action="mission-start"]');
    await page.waitForFunction(
      () => window.__DISPATCHER_UI_PROOF__?.local_mission_completed === true
    );

    const proof = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(proof.local_api_seeded, true);
    assert.strictEqual(proof.local_api_decision_posted, true);
    assert.strictEqual(proof.local_api_mission_start_posted, true);
    assert.strictEqual(proof.local_mission_completed, true);
    assert.strictEqual(proof.local_runtime_started, true);
    assert.strictEqual(proof.runtime_scope, "local_sandbox_only");
    assert.strictEqual(proof.obsidian_writes, 6);
    assert(proof.mission_folder.startsWith(bridgeRoot));

    const artifactNames = fs.readdirSync(proof.mission_folder).sort();
    assert.deepStrictEqual(artifactNames, expectedArtifactNames);

    const manifestPath = path.join(proof.mission_folder, "mission_manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.strictEqual(manifest.status, "completed_local_sandbox");
    assert.strictEqual(manifest.runtime_scope, "local_sandbox_only");
    assert.strictEqual(manifest.production_touched, false);
    assert.strictEqual(manifest.supabase_live_touched, false);
    assert.strictEqual(manifest.external_webhook_touched, false);
    assert.strictEqual(manifest.real_personal_data_used, false);
    assert.strictEqual(manifest.readiness_changed, false);
    assert.strictEqual(manifest.d1_tst_001_closed, false);

    const visibleText = await page.locator("body").innerText();
    assert(visibleText.includes("Локальная миссия завершена"));
    assert(visibleText.includes("Sandbox writes 6"));

    const screenshotPath = path.join(
      __dirname,
      "dispatcher_e2e_completed_2026-08-02.png"
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "local Dispatcher completes event to sandbox mission artifacts after Human Gate approvals",
          url_tested: serverHandle.url,
          dispatch_event_id: proof.dispatch_event_id,
          mission_contract_draft_id: proof.mission_contract_draft_id,
          mission_run_id: proof.mission_run_id,
          local_runtime_started: proof.local_runtime_started,
          runtime_scope: proof.runtime_scope,
          mission_folder: proof.mission_folder,
          artifact_count: proof.obsidian_writes,
          artifact_names: artifactNames,
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
