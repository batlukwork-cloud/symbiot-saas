const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const root = __dirname;
const pluginDir = path.join(root, "symbiot-obsidian-plugin");
const connectorDir = path.join(root, "symbiot-connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const testVault = path.join(root, "test_vault", "SYM_OBP038A_CLIENT_MISSION_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp038a_temp_appdata");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_CLIENT_MISSION_METHODOLOGIST_CONTRACT_PROOF_2026-07-20.json");
const connectorPort = 8791;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;

process.env.APPDATA = tempAppData;
fs.rmSync(testVault, { recursive: true, force: true });
fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(testVault, { recursive: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

class Notice {
  constructor(message) {
    Notice.messages.push(String(message));
  }
}
Notice.messages = [];

class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = createElementMock();
  }
  open() {
    if (this.onOpen) return this.onOpen();
    return undefined;
  }
  close() {}
}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.0" };
    this.commands = [];
    this.ribbonIcons = [];
    this.savedData = null;
  }
  async loadData() {
    return Plugin.mockSettings || {};
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
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
  setName() { return this; }
  setDesc() { return this; }
  addText(callback) {
    callback({ setValue() { return this; }, onChange() { return this; } });
    return this;
  }
  addToggle(callback) {
    callback({ setValue() { return this; }, onChange() { return this; } });
    return this;
  }
}

function createElementMock() {
  return {
    children: [],
    empty() { this.children = []; },
    addClass(cls) { this.cls = cls; },
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
      child.children = [];
      this.children.push(child);
      return child;
    }
  };
}

function vaultPath(relativePath) {
  return path.join(testVault, ...relativePath.split("/"));
}

function makeVault() {
  return {
    getName() {
      return "SYM_OBP038A_CLIENT_MISSION_VAULT";
    },
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${connectorUrl}/health`);
      const json = await response.json();
      if (response.ok && json.ok) return json;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`);
}

function readConnectorToken() {
  const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json");
  const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  if (!parsed.token) throw new Error("connector token missing");
  return parsed.token;
}

async function getSnapshot(token) {
  const response = await fetch(`${connectorUrl}/admin/snapshot`, {
    headers: { "x-symbiot-connector-token": token }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`snapshot failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

function readJsonFromVault(relativePath) {
  return JSON.parse(fs.readFileSync(vaultPath(relativePath), "utf8"));
}

function readTextFromVault(relativePath) {
  return fs.readFileSync(vaultPath(relativePath), "utf8");
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

async function main() {
  const server = spawn(process.execPath, [connectorServer], {
    cwd: connectorDir,
    env: {
      ...process.env,
      APPDATA: tempAppData,
      SYMBIOT_CONNECTOR_PORT: String(connectorPort),
      SYMBIOT_CONNECTOR_HOST: "127.0.0.1",
      SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md`
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const stdout = [];
  const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    const health = await waitForHealth();
    const token = readConnectorToken();
    Plugin.mockSettings = {
      coreRoot: "00_Core",
      rolesRoot: "01_Roles",
      missionsRoot: "02_Missions",
      sourcesRoot: "03_Sources",
      resultsRoot: "04_Results",
      evidenceRoot: "05_Evidence",
      connectorUrl,
      autoRegister: false
    };

    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = {
      vault: makeVault(),
      workspace: {
        getLeaf() {
          return {
            async openFile(file) {
              openedFiles.push(file.path);
            }
          };
        }
      }
    };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.0" });

    await plugin.onload();
    await plugin.initializeCore();
    const mission = await plugin.createMissionNote({ syncConnector: true });
    const snapshot = await getSnapshot(token);

    const expectedPaths = mission.paths;
    const expectedFiles = Object.values(expectedPaths);
    const filesExist = expectedFiles.every((relativePath) => fs.existsSync(vaultPath(relativePath)));
    const canvas = readJsonFromVault(expectedPaths.canvas);
    const manifest = readJsonFromVault(expectedPaths.manifest);
    const html = readTextFromVault(expectedPaths.htmlResult);
    const sources = readTextFromVault(expectedPaths.sources);
    const passport = readTextFromVault(expectedPaths.passport);
    const connectorMethodology = snapshot.missionMethodology.find((item) => item.missionId === mission.missionId);
    const sourceMain = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");

    const checks = {
      healthOk: assertCheck(health.ok === true, "connector health is not ok"),
      tokenCreated: assertCheck(token.length >= 32, "connector token is too short"),
      onloadCompleted: true,
      workspaceTemplatesExist: assertCheck(
        fs.existsSync(vaultPath("02_Missions/MISSION_FOLDER_TEMPLATE.md")) &&
        fs.existsSync(vaultPath("02_Missions/MISSION_ROUTE_TEMPLATE.canvas")) &&
        fs.existsSync(vaultPath("02_Missions/MISSION_HTML_RESULT_TEMPLATE.html")),
        "mission workspace templates missing"
      ),
      missionFolderCreated: assertCheck(fs.existsSync(vaultPath(mission.missionFolder)), "mission folder missing"),
      missionFilesExist: assertCheck(filesExist, "not all mission files exist"),
      passportHasOwner: assertCheck(passport.includes("РОЛЬ_AI_Методолог_клиентских_миссий"), "methodology owner missing in passport"),
      canvasValidJson: assertCheck(Array.isArray(canvas.nodes) && Array.isArray(canvas.edges), "canvas does not contain nodes/edges"),
      canvasHasRoute: assertCheck(canvas.nodes.length >= 6 && canvas.edges.length >= 6, "canvas route is too small"),
      canvasHasSecurityMetadata: assertCheck(canvas.metadata && canvas.metadata.noSilentVaultRead === true, "canvas security metadata missing"),
      sourcePermissionStatuses: assertCheck(
        sources.includes("allowed") && sources.includes("needs_user_permission") && sources.includes("skip_private"),
        "source permission statuses missing"
      ),
      htmlContractSections: assertCheck(
        html.includes("Итог") && html.includes("Основания") && html.includes("Риски") && html.includes("Следующий шаг"),
        "html result contract sections missing"
      ),
      manifestNoSilentRead: assertCheck(manifest.security && manifest.security.noSilentVaultRead === true, "manifest noSilentVaultRead missing"),
      connectorMissionCreated: assertCheck(snapshot.missions.some((item) => item.id === mission.missionId), "connector mission missing"),
      connectorMethodologyCreated: assertCheck(Boolean(connectorMethodology), "connector methodology contract missing"),
      connectorSupabaseMappingYellow: assertCheck(
        connectorMethodology &&
          connectorMethodology.supabaseMapping &&
          [
            "planned_yellow_until_migration_and_live_write_proof",
            "schema_ready_yellow_until_live_write_proof",
            "persisted_yellow"
          ].includes(connectorMethodology.supabaseMapping.status),
        "Supabase mapping YELLOW boundary missing"
      ),
      noAppVaultReadStatic: assertCheck(!/app\.vault\.read\s*\(/.test(sourceMain), "plugin contains app.vault.read call")
    };

    const evidence = {
      project: "SYM-SaaS / OBP-038A Client Mission Methodologist Runtime Contract",
      date: "2026-07-20",
      level: "mocked_obsidian_runtime_plus_live_connector",
      runtimeLevel: "local_connector_metadata_contract",
      status: "PASS_WITH_CONDITIONS_LOCAL_METADATA_YELLOW",
      testVault,
      tempAppData,
      connectorUrl,
      mission: {
        id: mission.missionId,
        title: mission.title,
        folder: mission.missionFolder,
        paths: mission.paths,
        openedFiles
      },
      connectorCounts: {
        missions: snapshot.missions.length,
        missionMethodology: snapshot.missionMethodology.length,
        audit: snapshot.audit.length
      },
      connectorMethodology,
      checks,
      restrictions: [
        "Obsidian API is mocked in Node proof; real desktop load must be manually verified.",
        "Supabase mission_canvas_nodes / mission_canvas_edges / mission_methodology_patterns are planned, not migrated in this proof.",
        "Real RAG execution and market-ready release are not proven by this proof.",
        "No hidden vault read is checked statically for app.vault.read only. Runtime permission UX still needs desktop acceptance."
      ],
      connectorStdout: stdout.join(""),
      connectorStderr: stderr.join("")
    };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, testVault, missionId: mission.missionId }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally {
    server.kill();
    Module._load = originalLoad;
  }
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    project: "SYM-SaaS / OBP-038A Client Mission Methodologist Runtime Contract",
    date: "2026-07-20",
    status: "FAILED_RED",
    error: error.message,
    stack: error.stack
  }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
