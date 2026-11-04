const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = __dirname;
const pluginDir = path.join(root, "symbiot-obsidian-plugin");
const testVault = path.join(root, "test_vault", "SYM_OBP040_SINGLE_AGENT_SHELL_VAULT");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP040_SINGLE_AGENT_SHELL_PROOF_2026-07-21.json");

fs.rmSync(testVault, { recursive: true, force: true });
fs.mkdirSync(testVault, { recursive: true });
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
  open() { if (this.onOpen) return this.onOpen(); return undefined; }
  close() {}
}
Modal.instances = [];

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

class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); } }
class Setting { constructor(containerEl) { this.containerEl = containerEl; } setName(){return this;} setDesc(){return this;} addText(cb){cb({setValue(){return this;},onChange(){return this;}});return this;} addToggle(cb){cb({setValue(){return this;},onChange(){return this;}});return this;} }

function flattenText(node) {
  return [node.text || "", ...(node.children || []).map(flattenText)].join("\n");
}

function vaultPath(relativePath) {
  return path.join(testVault, ...relativePath.split("/"));
}

function makeVault() {
  return {
    getName() { return "SYM_OBP040_SINGLE_AGENT_SHELL_VAULT"; },
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

function readVault(relativePath) {
  return fs.readFileSync(vaultPath(relativePath), "utf8");
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

global.fetch = async () => ({
  ok: false,
  status: 503,
  async text() { return JSON.stringify({ ok: false, status: "offline" }); }
});

async function main() {
  Plugin.mockSettings = {
    coreRoot: "00_Core",
    rolesRoot: "01_Roles",
    missionsRoot: "02_Missions",
    sourcesRoot: "03_Sources",
    resultsRoot: "04_Results",
    evidenceRoot: "05_Evidence",
    connectorUrl: "http://127.0.0.1:8799",
    autoRegister: false
  };

  const PluginClass = require(path.join(pluginDir, "main.js"));
  const openedFiles = [];
  const app = {
    vault: makeVault(),
    workspace: { getLeaf() { return { async openFile(file) { openedFiles.push(file.path); } }; } }
  };
  const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
  await plugin.onload();
  await plugin.initializeCore();
  await plugin.openControlPanel();
  const modal = Modal.instances[Modal.instances.length - 1];
  const modalText = flattenText(modal.contentEl);
  const mission = await plugin.createMissionNote({ syncConnector: false });

  const mainSource = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
  const styles = fs.readFileSync(path.join(pluginDir, "styles.css"), "utf8");
  const passport = readVault(mission.paths.passport);
  const subagents = readVault(mission.paths.aiTeam);
  const evidence = readVault(mission.paths.evidence);
  const canvas = JSON.parse(readVault(mission.paths.canvas));
  const manifest = JSON.parse(readVault(mission.paths.manifest));

  const checks = {
    syntaxPrecheckedSeparately: true,
    ribbonOneAgent: assertCheck(plugin.ribbonIcons.some((item) => item.title === "Симбиот" && item.icon === "bot"), "ribbon is not single Symbiot bot"),
    modalSingleEntry: assertCheck(modalText.includes("Один вход: Симбиот"), "single agent entry text missing"),
    modalSubagentDisclosure: assertCheck(modalText.includes("Состав субагентов миссии"), "subagent disclosure missing"),
    modalNoRoleZooPromise: assertCheck(modalText.includes("Пользователь управляет задачей и результатом, а не отдельными ролями"), "no role-zoo promise missing"),
    modalPrimaryMissionButton: assertCheck(modalText.includes("Поручить миссию Симбиоту"), "primary mission button missing"),
    missionSubagentFileRenamed: assertCheck(mission.paths.aiTeam.endsWith("03_Субагенты_Симбиота.md"), "subagent file not renamed"),
    oldAiTeamFileNotCreated: assertCheck(!fs.existsSync(vaultPath(`${mission.missionFolder}/03_AI_Команда.md`)), "old AI team file still created"),
    passportOneAgent: assertCheck(passport.includes("Пользователь работает с одним агентом `Симбиот`"), "passport lacks one-agent contract"),
    subagentsUserLanguage: assertCheck(subagents.includes("Пользователь видит одного агента") && subagents.includes("управлять не ролями, а результатом миссии"), "subagent file is not user-oriented"),
    subagentLimit: assertCheck(manifest.aiTeamMaxRolesDefault === 5 && subagents.includes("2-5 субагентов"), "2-5 subagent limit missing"),
    evidenceOneAgentCheck: assertCheck(evidence.includes("Пользователь видит одного агента `Симбиот`"), "evidence one-agent check missing"),
    canvasUserLabel: assertCheck(canvas.nodes.some((node) => String(node.text).includes("Субагенты Симбиота")), "canvas subagent node missing"),
    stylesPresent: assertCheck(styles.includes(".symbiot-agent-shell") && styles.includes(".symbiot-subagent-details"), "single-agent styles missing"),
    noOldVisibleAiTeamLabel: assertCheck(!mainSource.includes("# AI-команда") && !mainSource.includes("03_AI_Команда.md"), "old visible AI-team labels remain")
  };

  const result = {
    id: "SYM_OBSIDIAN_PLUGIN_OBP040_SINGLE_AGENT_SHELL_PROOF_2026-07-21",
    date: "2026-07-21",
    project: "SYM-SaaS",
    gate: "OBP-040 Single Symbiot Agent Shell",
    status: "PASS_WITH_CONDITIONS_SINGLE_AGENT_SHELL_YELLOW",
    readinessChanged: false,
    readiness: "13205 / 14075 = 93.8%",
    testVault,
    mission: { id: mission.missionId, folder: mission.missionFolder, paths: mission.paths, openedFiles },
    checks,
    yellowConditions: [
      "Реальная ручная проверка Дмитрия в Obsidian после reload остается нужна.",
      "Роли сжаты в пользовательском UI, но полноценный Agent Runtime MVP закрывается в OBP-041.",
      "RAG, OpenRouter, admin sync, mobile remote и Windows agent остаются отдельными YELLOW gates."
    ]
  };
  result.passed = Object.values(checks).every(Boolean);
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: result.passed, status: result.status, evidencePath, missionPath: mission.paths.passport }, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    id: "SYM_OBSIDIAN_PLUGIN_OBP040_SINGLE_AGENT_SHELL_PROOF_2026-07-21",
    date: "2026-07-21",
    project: "SYM-SaaS",
    gate: "OBP-040 Single Symbiot Agent Shell",
    status: "FAILED_RED",
    readinessChanged: false,
    error: error.message,
    stack: error.stack
  }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
