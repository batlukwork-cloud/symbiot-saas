const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = __dirname;
const pluginDir = path.join(root, "symbiot-obsidian-plugin");
const testVault = path.join(root, "test_vault", "SYM_OBP_TEST_VAULT");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_LOOP_PROOF_2026-07-16.json");

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(testVault, { recursive: true });

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
    return {};
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
      return "SYM_OBP_TEST_VAULT";
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

async function getSnapshot() {
  const response = await fetch("http://127.0.0.1:8787/admin/snapshot");
  return response.json();
}

async function main() {
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

  const before = await getSnapshot();
  await plugin.onload();
  const loopEvidence = await plugin.runProofMissionLoop();
  const after = await getSnapshot();

  const expectedFiles = [
    "00_Core/SYM_CORE.md",
    "01_Roles/ROLE_TEMPLATE.md",
    "02_Missions/MISSION_TEMPLATE.md",
    "05_Evidence/EVIDENCE_TEMPLATE.md"
  ];
  const filesExist = expectedFiles.every((relativePath) => fs.existsSync(vaultPath(relativePath)));
  const evidenceFiles = fs.readdirSync(vaultPath("05_Evidence")).filter((name) => name.startsWith("OBP_001_PLUGIN_LOOP_"));
  const deviceId = plugin.getDeviceId();
  const deviceRegistered = after.devices.some((device) => device.id === deviceId);
  const missionCreated = after.missions.some((mission) => mission.source === "obsidian-plugin");
  const approvedQueueCreated = after.queues.some((queue) => Array.isArray(queue.llmProviders) && queue.llmProviders.includes("openai"));
  const blockedRunAudited = after.audit.some((record) => record.source === "obsidian-plugin" && record.action === "mission_run" && record.result === "blocked");
  const approvedRunAudited = after.audit.some((record) => record.source === "obsidian-plugin" && record.action === "mission_run" && record.result === "queued");

  const evidence = {
    project: "SYM-SaaS / OBP-001 Testable Obsidian Plugin Loop",
    date: "2026-07-16",
    level: "mocked_obsidian_runtime_plus_live_connector",
    testVault,
    beforeCounts: {
      devices: before.devices.length,
      missions: before.missions.length,
      queues: before.queues.length,
      audit: before.audit.length
    },
    afterCounts: {
      devices: after.devices.length,
      missions: after.missions.length,
      queues: after.queues.length,
      audit: after.audit.length
    },
    checks: {
      onloadCompleted: true,
      commandCount: plugin.commands.length,
      ribbonIconCount: plugin.ribbonIcons.length,
      statusBarText: plugin.statusBar.text,
      filesExist,
      evidenceFiles,
      openedFiles,
      deviceRegistered,
      missionCreated,
      approvedQueueCreated,
      blockedRunAudited,
      approvedRunAudited,
      loopEvidenceStatus: loopEvidence.status
    },
    restrictions: [
      "Obsidian API is mocked in Node proof",
      "Real Obsidian desktop load must be verified separately",
      "No real LLM execution",
      "Mobile remote production is not proven"
    ]
  };

  evidence.passed = Object.entries(evidence.checks)
    .filter(([key]) => !["statusBarText", "evidenceFiles", "openedFiles", "commandCount", "ribbonIconCount"].includes(key))
    .every(([, value]) => value === true || value === "PASS_WITH_CONDITIONS");
  evidence.status = evidence.passed ? "PASS_WITH_CONDITIONS" : "YELLOW";

  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, testVault }, null, 2));
  process.exitCode = evidence.passed ? 0 : 1;
}

main().finally(() => {
  Module._load = originalLoad;
});
