const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Module = require("module");

const root = __dirname;
const pluginDir = path.join(root, "symbiot-obsidian-plugin");
const connectorDir = path.join(root, "symbiot-connector-service");
const testVault = path.join(root, "test_vault", "SYM_OBP_THREE_WINDOW_LLM_VAULT");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_THREE_WINDOW_LLM_PROOF_2026-07-16.json");
const port = Number(process.env.SYMBIOT_THREE_WINDOW_PROOF_PORT || 8798);
const baseUrl = `http://127.0.0.1:${port}`;
const proofPrompt = "Дмитрий, очень приятно.";

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(testVault, { recursive: true });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = { parseError: error.message, raw: text };
  }
  return { method, path: urlPath, status: response.status, ok: response.ok, json };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 6000) {
    try {
      const result = await request("GET", "/health");
      if (result.ok && result.json && result.json.ok) return result;
    } catch (error) {
      await wait(150);
    }
  }
  throw new Error("Connector service did not become healthy");
}

class Notice {
  constructor(message) {
    Notice.messages.push(String(message));
  }
}
Notice.messages = [];

function createElementMock() {
  return {
    children: [],
    classes: [],
    empty() { this.children = []; },
    addClass(cls) { this.classes.push(cls); this.cls = cls; },
    createEl(tag, options = {}) {
      const child = createElementMock();
      child.tag = tag;
      child.text = options.text || "";
      child.cls = options.cls || "";
      child.addEventListener = () => {};
      this.children.push(child);
      return child;
    },
    createDiv(options = {}) {
      const child = createElementMock();
      child.tag = "div";
      child.cls = options.cls || "";
      this.children.push(child);
      return child;
    }
  };
}

class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = createElementMock();
  }
  open() {
    Modal.opened.push(this);
    if (this.onOpen) return this.onOpen();
    return undefined;
  }
  close() {}
}
Modal.opened = [];

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.0" };
    this.commands = [];
    this.ribbonIcons = [];
    this.savedData = null;
  }
  async loadData() {
    return { connectorUrl: baseUrl };
  }
  async saveData(data) {
    this.savedData = data;
  }
  addRibbonIcon(icon, title, callback) {
    this.ribbonIcons.push({ icon, title, callback });
  }
  addCommand(command) {
    this.commands.push(command);
  }
  addSettingTab(tab) {
    this.settingTab = tab;
  }
  addStatusBarItem() {
    return {
      text: "",
      classes: [],
      addClass(cls) { this.classes.push(cls); },
      setText(text) { this.text = text; }
    };
  }
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createElementMock();
  }
}

class Setting {
  constructor(containerEl) { this.containerEl = containerEl; }
  setName() { return this; }
  setDesc() { return this; }
  addText(callback) { callback({ setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(callback) { callback({ setValue() { return this; }, onChange() { return this; } }); return this; }
}

function vaultPath(relativePath) {
  return path.join(testVault, ...relativePath.split("/"));
}

function makeVault() {
  return {
    getName() { return "SYM_OBP_THREE_WINDOW_LLM_VAULT"; },
    getAbstractFileByPath(relativePath) {
      const full = vaultPath(relativePath);
      if (fs.existsSync(full)) return { path: relativePath, fullPath: full };
      return null;
    },
    async createFolder(relativePath) {
      fs.mkdirSync(vaultPath(relativePath), { recursive: true });
      return { path: relativePath };
    },
    async create(relativePath, content) {
      const full = vaultPath(relativePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return { path: relativePath, fullPath: full };
    },
    async modify(file, content) {
      fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8");
      return file;
    }
  };
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return { Modal, Notice, Plugin, PluginSettingTab, Setting };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function fileIncludes(relativePath, patterns) {
  const text = fs.readFileSync(path.join(pluginDir, relativePath), "utf8");
  return patterns.every((pattern) => text.includes(pattern));
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: connectorDir,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const evidence = {
    project: "SYM-SaaS / OBP-003-004 Three-window LLM Hub",
    date: "2026-07-16",
    level: "mocked_obsidian_runtime_plus_live_connector",
    status: "RUNNING",
    baseUrl,
    testVault,
    prompt: proofPrompt,
    checks: {},
    restrictions: [
      "Three-window UX and connector loop are tested.",
      "Real external LLM API execution is not proven because no provider API keys are used.",
      "Status must remain YELLOW/PASS_WITH_CONDITIONS, not production GREEN."
    ]
  };

  try {
    await waitForHealth();
    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = {
      vault: makeVault(),
      workspace: {
        getLeaf() {
          return { async openFile(file) { openedFiles.push(file.path); } };
        }
      }
    };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.0" });
    await plugin.onload();

    const command = plugin.commands.find((item) => item.id === "symbiot-three-window-llm");
    const comparison = await plugin.runThreeWindowLlmComparison(proofPrompt);
    const snapshot = await request("GET", "/admin/snapshot");

    const resultFiles = fs.existsSync(vaultPath("04_Results"))
      ? fs.readdirSync(vaultPath("04_Results")).filter((name) => name.startsWith("LLM_THREE_WINDOW_"))
      : [];
    const evidenceFiles = fs.existsSync(vaultPath("05_Evidence"))
      ? fs.readdirSync(vaultPath("05_Evidence")).filter((name) => name.startsWith("LLM_THREE_WINDOW_EVIDENCE_"))
      : [];
    const latestResult = resultFiles.length ? fs.readFileSync(vaultPath(`04_Results/${resultFiles[resultFiles.length - 1]}`), "utf8") : "";
    const latestEvidence = evidenceFiles.length ? fs.readFileSync(vaultPath(`05_Evidence/${evidenceFiles[evidenceFiles.length - 1]}`), "utf8") : "";
    const modal = Modal.opened.find((item) => item.constructor && item.constructor.name === "SymbiotLlmComparisonModal");

    evidence.checks = {
      pluginLoaded: true,
      commandRegistered: Boolean(command),
      commandCount: plugin.commands.length,
      providerWindows: comparison.results.length,
      providerNames: comparison.results.map((result) => result.providerName),
      comparisonStatus: comparison.status,
      resultFiles,
      evidenceFiles,
      resultHasThreeSections: ["## OpenAI", "## Anthropic", "## Gemini"].every((marker) => latestResult.includes(marker)),
      evidenceMarksRealLlmFalse: latestEvidence.includes("real_llm_execution: false"),
      openedFiles,
      modalOpened: Boolean(modal),
      modalHasGridClass: Boolean(modal && modal.contentEl.children.some((child) => child.cls === "symbiot-llm-three-grid")),
      cssHasThreeWindowRules: fileIncludes("styles.css", ["symbiot-llm-three-grid", "symbiot-llm-pane", "grid-template-columns: repeat(3"]),
      serverSnapshotStatus: snapshot.status,
      serverComparisonCount: snapshot.json && Array.isArray(snapshot.json.llmComparisons) ? snapshot.json.llmComparisons.length : 0,
      serverHasLlmAudit: Boolean(snapshot.json && snapshot.json.audit.some((record) => record.action === "llm_compare")),
      promptMatched: comparison.prompt === proofPrompt
    };

    const passed = evidence.checks.commandRegistered &&
      evidence.checks.providerWindows === 3 &&
      evidence.checks.providerNames.includes("OpenAI") &&
      evidence.checks.providerNames.includes("Anthropic") &&
      evidence.checks.providerNames.includes("Gemini") &&
      ["missing_api_key", "live_disabled", "live_partial", "live_all_providers_passed"].includes(evidence.checks.comparisonStatus) &&
      evidence.checks.resultHasThreeSections &&
      evidence.checks.evidenceMarksRealLlmFalse &&
      evidence.checks.modalOpened &&
      evidence.checks.modalHasGridClass &&
      evidence.checks.cssHasThreeWindowRules &&
      evidence.checks.serverComparisonCount >= 1 &&
      evidence.checks.serverHasLlmAudit &&
      evidence.checks.promptMatched;

    evidence.status = passed ? "PASS_WITH_CONDITIONS" : "YELLOW";
    evidence.passed = passed;
    evidence.logs = logs;
  } catch (error) {
    evidence.status = "RED";
    evidence.passed = false;
    evidence.error = error.stack || error.message;
    evidence.logs = logs;
  } finally {
    child.kill();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main();

