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
  const sources = [
    "telegram",
    "email",
    "whatsapp",
    "webhook",
    "folder",
    "bitrix24",
  ];
  let serverHandle;
  let browser;

  try {
    serverHandle = await startLocalDevServer({ port: 0 });
    const { chromium } = require("playwright");
    browser = await chromium.launch({
      executablePath: findInstalledBrowser(),
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(serverHandle.url);
    await page.click('[data-view="sources"]');
    await page.waitForSelector("#sourcesView:not([hidden])");

    const status = await fetch(`${serverHandle.url}api/sources/status`).then(
      (response) => response.json()
    );
    for (const source of sources) {
      assert(status[source], `${source} source status is required`);
    }

    await page.click("#connectEmailButton");
    await page.waitForFunction(() =>
      document.querySelector("#emailSourceStatus").textContent.includes("Spool подключен")
    );
    await page.click("#testEmailButton");
    await page.waitForFunction(() =>
      document.querySelector("#emailSourceStatus").textContent.includes("Проверен")
    );

    for (const source of sources) {
      if (source === "telegram") {
        await page.click("#chainTelegramButton");
      } else if (source === "email") {
        await page.click("#chainEmailButton");
      } else {
        await page.click(`[data-source-chain="${source}"]`);
      }
      await page.waitForFunction(
        (proofKey) => window.__DISPATCHER_UI_PROOF__?.[proofKey] === true,
        `${source}_source_full_chain_pass`
      );
    }

    const proof = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    for (const source of sources) {
      assert.strictEqual(proof[`${source}_source_full_chain_pass`], true);
      assert.strictEqual(proof[`${source}_source_artifact_count`], 6);
    }

    const screenshotPath = path.join(
      __dirname,
      "dispatcher_all_sources_screen_2026-08-02.png"
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "All Sources screen inputs complete trigger -> decision card -> Human Gate -> mission contract draft -> approved local sandbox mission",
          url_tested: serverHandle.url,
          full_chain_sources: sources,
          artifact_count_each: 6,
          screenshot: screenshotPath,
          telegram_real_token_required_for_get_me: true,
          local_compatible_inputs: ["whatsapp", "webhook", "folder", "bitrix24"],
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
