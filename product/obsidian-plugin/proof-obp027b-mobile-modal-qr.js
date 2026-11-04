const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP027B_MOBILE_MODAL_QR_RENDER_PROOF_2026-07-21.json");

fs.mkdirSync(evidenceDir, { recursive: true });

class Notice {
  constructor(message) { Notice.messages.push(String(message)); }
}
Notice.messages = [];

function createElementMock() {
  return {
    children: [],
    tag: "",
    text: "",
    cls: "",
    attr: {},
    empty() { this.children = []; },
    addClass(cls) { this.cls = this.cls ? `${this.cls} ${cls}` : cls; },
    createEl(tag, options = {}) {
      const child = createElementMock();
      child.tag = tag;
      child.text = options.text || "";
      child.cls = options.cls || "";
      child.attr = options.attr || {};
      child.addEventListener = () => {};
      child.setAttribute = (key, value) => { child.attr[key] = value; };
      this.children.push(child);
      return child;
    },
    createDiv(options = {}) {
      const child = createElementMock();
      child.tag = "div";
      child.cls = options.cls || "";
      child.addEventListener = () => {};
      this.children.push(child);
      return child;
    },
    setText(value) { this.text = String(value); }
  };
}

class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = createElementMock();
    Modal.instances.push(this);
  }
  open() {
    Modal.lastOpenPromise = this.onOpen ? Promise.resolve(this.onOpen()) : Promise.resolve();
    return Modal.lastOpenPromise;
  }
  close() {}
}
Modal.instances = [];
Modal.lastOpenPromise = Promise.resolve();

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.1" };
    this.commands = [];
    this.ribbonIcons = [];
  }
  async loadData() { return Plugin.mockSettings || {}; }
  async saveData(data) { this.savedData = data; }
  addRibbonIcon(icon, title, callback) { this.ribbonIcons.push({ icon, title, callback }); }
  addCommand(command) { this.commands.push(command); }
  addSettingTab(tab) { this.settingTab = tab; }
  addStatusBarItem() { return { addClass() {}, setText(text) { this.text = text; } }; }
}

class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); }
}
class Setting {
  constructor(containerEl) { this.containerEl = containerEl; }
  setName(){ return this; }
  setDesc(){ return this; }
  addText(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; }
  addToggle(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; }
}

function flattenText(node) {
  return [node.text || "", ...(node.children || []).map(flattenText)].join("\n");
}

function findNodes(node, predicate, acc = []) {
  if (predicate(node)) acc.push(node);
  for (const child of node.children || []) findNodes(child, predicate, acc);
  return acc;
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting };
  return originalLoad.call(this, request, parent, isMain);
};

async function runScenario(fetchImpl) {
  Modal.instances = [];
  Modal.lastOpenPromise = Promise.resolve();
  global.fetch = fetchImpl;
  Plugin.mockSettings = {
    connectorUrl: "http://127.0.0.1:8787",
    autoRegister: false,
    mobileConnectorEnabled: true
  };
  delete require.cache[require.resolve(path.join(pluginDir, "main.js"))];
  const PluginClass = require(path.join(pluginDir, "main.js"));
  const app = { vault: { getName(){ return "SYM_OBP027B_MODAL_QR_VAULT"; } }, workspace: { getLeaf(){ return { async openFile(){} }; } } };
  const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
  await plugin.onload();
  plugin.openMobileConnector();
  await Modal.lastOpenPromise;
  return Modal.instances[Modal.instances.length - 1].contentEl;
}

async function main() {
  const successBody = await runScenario(async (url) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/mobile/status")) {
      return { ok: true, status: 200, async text(){ return JSON.stringify({ ok: true, mobile: { mode: "local_mobile_web_mvp", status: "yellow", boundary: "Local mobile web ready." } }); } };
    }
    if (textUrl.endsWith("/mobile/pairing")) {
      return { ok: true, status: 200, async text(){ return JSON.stringify({ ok: true, token: "mobile-token-proof", url: "http://127.0.0.1:8787/mobile?token=mobile-token-proof", qrUrl: "http://127.0.0.1:8787/mobile/qr.svg?token=mobile-token-proof", expiresAt: "2026-07-21T23:59:00.000Z" }); } };
    }
    return { ok: false, status: 404, async text(){ return JSON.stringify({ ok: false, error: "not_found" }); } };
  });
  const successText = flattenText(successBody);
  const successImages = findNodes(successBody, (node) => node.tag === "img");
  const successLinks = findNodes(successBody, (node) => node.tag === "a");

  const failureBody = await runScenario(async () => {
    throw new Error("connector refused in modal proof");
  });
  const failureText = flattenText(failureBody);
  const retryButtons = findNodes(failureBody, (node) => node.tag === "button" && node.text === "Повторить");

  const mainSource = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
  const checks = {
    successModalHasPairingCard: assertCheck(successText.includes("Подключить телефон"), "mobile pairing card missing"),
    successModalHasQrImage: assertCheck(successImages.some((node) => String(node.attr.src || "").includes("/mobile/qr.svg?token=")), "QR image is not rendered in modal"),
    successModalHasClickableUrl: assertCheck(successLinks.some((node) => String(node.attr.href || "").includes("/mobile?token=")), "mobile URL link is not rendered in modal"),
    successModalHasWindowsAgentCopy: assertCheck(successText.includes("безопасные действия Windows Agent"), "Windows Agent mobile copy missing"),
    failureModalDoesNotStayBlank: assertCheck(failureText.includes("QR-код не создан") && failureText.includes("connector refused in modal proof"), "failure modal does not show connector error"),
    failureModalHasRetry: assertCheck(retryButtons.length === 1, "retry button missing in failure modal"),
    modalUsesTryCatch: assertCheck(mainSource.includes("try {") && mainSource.includes("QR-код не создан"), "mobile modal does not contain explicit error handling")
  };
  const evidence = {
    id: "SYM_OBSIDIAN_PLUGIN_OBP027B_MOBILE_MODAL_QR_RENDER_PROOF_2026-07-21",
    date: "2026-07-21",
    project: "SYM-SaaS / OBP-027B Mobile Modal QR Render Fix",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    status: "PASS_WITH_CONDITIONS_MOBILE_MODAL_QR_RENDER_YELLOW",
    checks,
    boundaries: [
      "This proof checks Obsidian plugin modal DOM, not only connector endpoint.",
      "Manual client-machine acceptance is still required.",
      "Production remote relay remains YELLOW."
    ]
  };
  evidence.passed = Object.values(checks).every(Boolean);
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, checks }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, JSON.stringify({
    id: "SYM_OBSIDIAN_PLUGIN_OBP027B_MOBILE_MODAL_QR_RENDER_PROOF_2026-07-21",
    date: "2026-07-21",
    project: "SYM-SaaS / OBP-027B Mobile Modal QR Render Fix",
    readinessChanged: false,
    status: "FAILED_RED",
    error: error.message,
    stack: error.stack
  }, null, 2), "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
