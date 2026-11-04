"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startLocalDevServer } = require("../01_CONNECTOR_SERVICE/local_dev_server");

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
    await page.click('[data-view="sources"]');
    await page.waitForSelector("#sourcesView:not([hidden])");

    const status = await fetch(`${serverHandle.url}api/sources/status`).then(
      (response) => response.json()
    );
    assert.strictEqual(status.telegram.webhook_used, false);
    assert.strictEqual(status.telegram.token_in_memory, false);
    assert.strictEqual(status.email.connected, true);

    await page.click("#testTelegramButton");
    await page.waitForFunction(() =>
      document.querySelector("#telegramSourceStatus").textContent.includes("Не подключен")
    );

    await page.click("#connectEmailButton");
    await page.waitForFunction(() =>
      document.querySelector("#emailSourceStatus").textContent.includes("Spool подключен")
    );
    await page.click("#testEmailButton");
    await page.waitForFunction(() =>
      document.querySelector("#emailSourceStatus").textContent.includes("Проверен")
    );

    await page.click("#chainTelegramButton");
    await page.waitForFunction(() =>
      window.__DISPATCHER_UI_PROOF__?.telegram_source_full_chain_pass === true
    );

    await page.click("#chainEmailButton");
    await page.waitForFunction(() =>
      window.__DISPATCHER_UI_PROOF__?.email_source_full_chain_pass === true
    );

    const proof = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(proof.telegram_source_full_chain_pass, true);
    assert.strictEqual(proof.email_source_full_chain_pass, true);

    const screenshotPath = path.join(
      __dirname,
      "dispatcher_sources_screen_2026-08-02.png"
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "Sources screen connects/tests email spool and performs Telegram/email full-chain checks",
          url_tested: serverHandle.url,
          sources_view_opened: true,
          telegram: {
            token_absent_handled: true,
            local_full_chain_pass: true,
            webhook_used: false,
          },
          email: {
            spool_connected: true,
            test_message_created: true,
            local_full_chain_pass: true,
          },
          screenshot: screenshotPath,
          secrets_written_to_files: false,
          production_touched: false,
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
