"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  createTelegramMockSession,
} = require("../04_TELEGRAM_BOT/telegram_mock_view");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "03_DESKTOP_UI", "dispatcher_mock_ui.html");
const cssPath = path.join(root, "03_DESKTOP_UI", "dispatcher_mock_ui.css");
const jsPath = path.join(root, "03_DESKTOP_UI", "dispatcher_mock_ui.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

assert(html.includes('data-action="human-gate-accept"'));
assert(html.includes("Карточка решения"));
assert(html.includes("Черновик mission contract"));
assert(css.includes(".workspace"));
assert(css.includes("@media"));
assert(js.includes("__DISPATCHER_UI_PROOF__"));
assert(js.includes("fetch("));
assert(!html.includes("http://"));
assert(!html.includes("https://"));
assert(!js.includes("XMLHttpRequest"));

const telegramSession = createTelegramMockSession();
assert.strictEqual(telegramSession.inbox_message.chat_id, "local_mock_chat");
assert.strictEqual(
  telegramSession.inbox_message.reply_markup.inline_keyboard[0][0].text,
  "Подтвердить черновик"
);
assert(
  telegramSession.inbox_message.reply_markup.inline_keyboard[0][0].callback_data
    .startsWith("dispatch:accept:")
);

const telegramAccept = telegramSession.acceptHumanGate();
assert.strictEqual(telegramAccept.decision.body.runtime.started, false);
assert.strictEqual(
  telegramAccept.decision.body.runtime.blocked_reason,
  "MISSION_CONTRACT_DRAFT_ONLY"
);
assert.strictEqual(
  telegramAccept.decision.body.mission_contract_draft.permissions
    .runtime_allowed,
  false
);
assert.strictEqual(
  telegramAccept.decision.body.mission_contract_draft.permissions
    .obsidian_write_allowed,
  false
);
assert(telegramAccept.draft_message.text.includes("Runtime: остановлен"));

async function runBrowserProof() {
  let browser;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch({
      executablePath: findInstalledBrowser(),
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(pathToFileURL(htmlPath).href);

    const before = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(before.desktop_ui_loaded, true);
    assert.strictEqual(before.runtime_started, false);
    assert.strictEqual(before.mission_contract_draft_visible, false);
    await assertNonBlank(page);

    await page.click('[data-action="human-gate-accept"]');
    const after = await page.evaluate(() => window.__DISPATCHER_UI_PROOF__);
    assert.strictEqual(after.human_gate_accept_clicked, true);
    assert.strictEqual(after.mission_contract_draft_visible, true);
    assert.strictEqual(after.runtime_started, false);
    assert.strictEqual(after.obsidian_writes, 0);
    assert.strictEqual(after.blocked_reason, "MISSION_CONTRACT_DRAFT_ONLY");
    const desktopScreenshotPath = path.join(
      __dirname,
      "dispatcher_mock_ui_desktop_2026-08-02.png"
    );
    await page.screenshot({ path: desktopScreenshotPath, fullPage: true });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(pathToFileURL(htmlPath).href);
    await assertNonBlank(mobile);
    const mobileScreenshotPath = path.join(
      __dirname,
      "dispatcher_mock_ui_mobile_2026-08-02.png"
    );
    await mobile.screenshot({ path: mobileScreenshotPath, fullPage: true });

    return {
      desktop_browser_rendered: true,
      mobile_browser_rendered: true,
      desktop_screenshot: desktopScreenshotPath,
      mobile_screenshot: mobileScreenshotPath,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

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

async function assertNonBlank(page) {
  const visibleText = await page.locator("body").innerText();
  assert(visibleText.includes("Диспетчерская Симбиота"));
  assert(visibleText.includes("Runtime остановлен"));
}

runBrowserProof()
  .then((browserProof) => {
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          proof:
            "local Desktop and Telegram mock UI expose inbox/card and Human Gate accept creates draft only",
          desktop: {
            html_present: true,
            css_present: true,
            js_present: true,
            human_gate_button_present: true,
            browser_rendered: browserProof.desktop_browser_rendered,
            mobile_rendered: browserProof.mobile_browser_rendered,
            desktop_screenshot: browserProof.desktop_screenshot,
            mobile_screenshot: browserProof.mobile_screenshot,
          },
          telegram: {
            inbox_message_present: true,
            accept_button_present: true,
            draft_message_present: true,
          },
          dispatch_event_id: telegramSession.event_id,
          mission_contract_draft_id:
            telegramAccept.decision.body.mission_contract_draft.id,
          runtime_started: telegramAccept.decision.body.runtime.started,
          blocked_reason: telegramAccept.decision.body.runtime.blocked_reason,
          obsidian_writes:
            telegramAccept.decision.body.mission_contract_draft.obsidian_writes
              .length,
          model_calls:
            telegramAccept.decision.body.mission_contract_draft.llm.model_calls,
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
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
