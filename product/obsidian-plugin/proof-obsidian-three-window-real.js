const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const obsidianExe = "<локальный путь>";
const obsidianConfig = path.join(process.env.APPDATA, "obsidian", "obsidian.json");
const runtimeLogs = path.join(root, "runtime_logs");
const evidencePath = path.join(runtimeLogs, "SYM_OBSIDIAN_PLUGIN_REAL_THREE_WINDOW_LLM_PROOF_2026-07-16.json");
const backupPath = path.join(runtimeLogs, "obsidian_json_backup_before_three_window_2026-07-16.json");
const testVaultPath = path.join(root, "test_vault", "SYM_OBP_NORMAL_INSTALL_VAULT");
const proofPrompt = "Дмитрий, очень приятно.";
const cdpPort = 9223;
const connectorUrl = "http://127.0.0.1:8787";
const mainVaultKey = "445d959e2710339b";
const normalVaultKey = "obp002normal716";

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  try { return { ok: response.ok, status: response.status, json: text ? JSON.parse(text) : null }; }
  catch (error) { return { ok: response.ok, status: response.status, json: { parseError: error.message, raw: text } }; }
}

function readObsidianConfig() {
  return JSON.parse(fs.readFileSync(obsidianConfig, "utf8"));
}

function writeObsidianConfig(config) {
  fs.writeFileSync(obsidianConfig, JSON.stringify(config), "utf8");
}

function switchToTestVault() {
  const config = readObsidianConfig();
  fs.writeFileSync(backupPath, JSON.stringify(config, null, 2), "utf8");
  config.vaults[normalVaultKey] = config.vaults[normalVaultKey] || { path: testVaultPath };
  config.vaults[normalVaultKey].path = testVaultPath;
  config.vaults[normalVaultKey].open = true;
  config.vaults[mainVaultKey].open = false;
  Object.keys(config.vaults).forEach((key) => {
    if (key !== normalVaultKey && key !== mainVaultKey && config.vaults[key]) config.vaults[key].open = false;
  });
  writeObsidianConfig(config);
}

function restoreMainVault() {
  const config = readObsidianConfig();
  if (config.vaults[mainVaultKey]) config.vaults[mainVaultKey].open = true;
  if (config.vaults[normalVaultKey]) config.vaults[normalVaultKey].open = false;
  Object.keys(config.vaults).forEach((key) => {
    if (key !== mainVaultKey && config.vaults[key]) config.vaults[key].open = false;
  });
  writeObsidianConfig(config);
}

async function waitForCdpTarget() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const result = await fetchJson(`http://127.0.0.1:${cdpPort}/json`);
      if (result.ok && Array.isArray(result.json) && result.json.length) {
        const target = result.json.find((item) => item.webSocketDebuggerUrl && (item.type === "page" || item.type === "webview")) || result.json.find((item) => item.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch (error) {}
    await wait(250);
  }
  throw new Error("CDP target was not available");
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result ? result.result.value : undefined;
  }
  close() {
    if (this.ws) this.ws.close();
  }
}

async function waitForApp(client) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const ready = await client.eval("Boolean(globalThis.app && app.plugins && app.commands && app.vault)");
      if (ready) return true;
    } catch (error) {}
    await wait(500);
  }
  throw new Error("Obsidian app object was not ready");
}

async function main() {
  fs.mkdirSync(runtimeLogs, { recursive: true });
  const evidence = {
    project: "SYM-SaaS / OBP-003-004 Real Obsidian three-window LLM proof",
    date: "2026-07-16",
    level: "real_obsidian_desktop_plus_live_connector",
    status: "RUNNING",
    prompt: proofPrompt,
    testVaultPath,
    connectorUrl,
    checks: {},
    restrictions: [
      "Real Obsidian desktop command execution is tested.",
      "Connector may return missing_api_key/live_disabled until provider keys and live proof are configured.",
      "No readiness increase and no production GREEN."
    ]
  };
  let child = null;
  let client = null;
  try {
    switchToTestVault();
    child = spawn(obsidianExe, [`--remote-debugging-port=${cdpPort}`], { detached: false, stdio: "ignore", windowsHide: false });
    const target = await waitForCdpTarget();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await waitForApp(client);

    await client.eval(`(async () => { await app.plugins.setEnable(true); await app.plugins.enablePluginAndSave('symbiot-obsidian-plugin'); return true; })()`);
    await wait(2000);
    const commands = await client.eval(`Object.keys(app.commands.commands).filter((id) => id.includes('symbiot')).sort()`);
    const pluginLoaded = await client.eval(`Boolean(app.plugins.plugins['symbiot-obsidian-plugin'] || app.plugins.manifests['symbiot-obsidian-plugin'])`);
    const commandId = commands.includes("symbiot-obsidian-plugin:symbiot-three-window-llm")
      ? "symbiot-obsidian-plugin:symbiot-three-window-llm"
      : commands.find((id) => id.includes("three-window-llm"));
    if (!commandId) throw new Error(`three-window command missing: ${commands.join(", ")}`);

    await client.eval(`(async () => { const plugin = app.plugins.plugins['symbiot-obsidian-plugin']; if (plugin) { plugin.settings.connectorUrl = '${connectorUrl}'; await plugin.saveSettings(); } return true; })()`);
    await client.eval(`app.commands.executeCommandById('${commandId}')`);
    await wait(3000);

    const modalPaneCount = await client.eval(`document.querySelectorAll('.symbiot-llm-pane').length`);
    const modalGridCount = await client.eval(`document.querySelectorAll('.symbiot-llm-three-grid').length`);
    const snapshot = await fetchJson(`${connectorUrl}/admin/snapshot`);

    const resultDir = path.join(testVaultPath, "04_Results");
    const evidenceDir = path.join(testVaultPath, "05_Evidence");
    const resultFiles = fs.existsSync(resultDir) ? fs.readdirSync(resultDir).filter((name) => name.startsWith("LLM_THREE_WINDOW_")) : [];
    const evidenceFiles = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir).filter((name) => name.startsWith("LLM_THREE_WINDOW_EVIDENCE_")) : [];
    const latestResult = resultFiles.length ? fs.readFileSync(path.join(resultDir, resultFiles[resultFiles.length - 1]), "utf8") : "";
    const latestEvidence = evidenceFiles.length ? fs.readFileSync(path.join(evidenceDir, evidenceFiles[evidenceFiles.length - 1]), "utf8") : "";

    evidence.checks = {
      targetUrl: target.url,
      pluginLoaded,
      commands,
      commandId,
      modalPaneCount,
      modalGridCount,
      resultFiles,
      evidenceFiles,
      resultHasPrompt: latestResult.includes(proofPrompt),
      resultHasThreeSections: ["## OpenAI", "## Anthropic", "## Gemini"].every((marker) => latestResult.includes(marker)),
      evidenceMarksRealLlmFalse: latestEvidence.includes("real_llm_execution: false"),
      snapshotStatus: snapshot.status,
      serverComparisonCount: snapshot.json && Array.isArray(snapshot.json.llmComparisons) ? snapshot.json.llmComparisons.length : 0,
      serverHasLlmAudit: Boolean(snapshot.json && snapshot.json.audit.some((record) => record.action === "llm_compare")),
      comparisonStatus: snapshot.json && snapshot.json.llmComparisons && snapshot.json.llmComparisons[0] ? snapshot.json.llmComparisons[0].status : null
    };

    const passed = pluginLoaded &&
      Boolean(commandId) &&
      modalPaneCount === 3 &&
      modalGridCount >= 1 &&
      evidence.checks.resultHasPrompt &&
      evidence.checks.resultHasThreeSections &&
      evidence.checks.evidenceMarksRealLlmFalse &&
      evidence.checks.serverComparisonCount >= 1 &&
      evidence.checks.serverHasLlmAudit &&
      ["missing_api_key", "live_disabled", "live_partial", "live_all_providers_passed"].includes(evidence.checks.comparisonStatus);

    evidence.status = passed ? "PASS_WITH_CONDITIONS" : "YELLOW";
    evidence.passed = passed;
  } catch (error) {
    evidence.status = "RED";
    evidence.passed = false;
    evidence.error = error.stack || error.message;
  } finally {
    try { if (client) client.close(); } catch (error) {}
    try { if (child && !child.killed) child.kill(); } catch (error) {}
    try { restoreMainVault(); evidence.restoredMainVault = true; } catch (error) { evidence.restoreError = error.message; }
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main();

