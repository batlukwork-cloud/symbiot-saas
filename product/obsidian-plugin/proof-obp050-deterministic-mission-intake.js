const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const testVault = path.join(root, "test_vault", "SYM_OBP050_DETERMINISTIC_MISSION_INTAKE_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp050_temp_appdata");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP050_DETERMINISTIC_MISSION_INTAKE_PROOF_2026-07-22.json");
const connectorPort = 8806;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;
const requiredBenchmarks = ["SYM-BM-053", "SYM-BM-054", "SYM-BM-055", "SYM-BM-056", "SYM-BM-057", "SYM-BM-058"];

fs.rmSync(testVault, { recursive: true, force: true });
fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(testVault, { recursive: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
process.env.APPDATA = tempAppData;

class Notice { constructor(message) { Notice.messages.push(String(message)); } }
Notice.messages = [];
class Modal { constructor(app) { this.app = app; this.contentEl = createElementMock(); } open(){ if (this.onOpen) return this.onOpen(); } close(){} }
class Plugin { constructor(app, manifest){ this.app = app; this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.1" }; this.commands = []; this.ribbonIcons = []; } async loadData(){ return Plugin.mockSettings || {}; } async saveData(data){ this.savedData = data; } addRibbonIcon(icon,title,callback){ this.ribbonIcons.push({ icon,title,callback }); } addCommand(command){ this.commands.push(command); } addSettingTab(tab){ this.settingTab = tab; } addStatusBarItem(){ return { addClass(){}, setText(text){ this.text = text; } }; } }
class PluginSettingTab { constructor(app, plugin){ this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); } }
class Setting { constructor(containerEl){ this.containerEl = containerEl; } setName(){ return this; } setDesc(){ return this; } addText(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } addToggle(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } }
function createElementMock(){ return { children: [], empty(){ this.children = []; }, addClass(){}, createEl(tag, options = {}){ const child = createElementMock(); child.tag = tag; child.text = options.text || ""; child.addEventListener = () => {}; child.setAttribute = () => {}; this.children.push(child); return child; }, createDiv(options = {}){ const child = createElementMock(); child.tag = "div"; child.cls = options.cls || ""; child.addEventListener = () => {}; this.children.push(child); return child; }, setText(text){ this.text = text; } }; }
function vaultPath(relativePath){ return path.join(testVault, ...relativePath.split("/")); }
function makeVault(){ return { getName(){ return "SYM_OBP050_DETERMINISTIC_MISSION_INTAKE_VAULT"; }, getAbstractFileByPath(relativePath){ const full = vaultPath(relativePath); return fs.existsSync(full) ? { path: relativePath, fullPath: full } : null; }, async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; }, async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return { path: relativePath, fullPath: full }; }, async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return file; } }; }
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){ const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline){ try { const response = await fetch(`${connectorUrl}/health`); const json = await response.json(); if (response.ok && json.ok) return json; } catch(error){ lastError = error; } await sleep(150); } throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`); }
function readConnectorToken(){ const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json"); const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8")); if (!parsed.token) throw new Error("connector token missing"); return parsed.token; }
function readVault(relativePath){ return fs.readFileSync(vaultPath(relativePath), "utf8"); }
function assertCheck(condition, message){ if (!condition) throw new Error(message); return true; }
function addIcon(){}
async function postJson(endpoint, token, body){ const response = await fetch(`${connectorUrl}${endpoint}`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); const json = await response.json(); if (!response.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(json)}`); return json; }
async function getJson(endpoint, token){ const response = await fetch(`${connectorUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } }); const json = await response.json(); if (!response.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(json)}`); return json; }
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain){ if (request === "obsidian") return { addIcon, Modal, Notice, Plugin, PluginSettingTab, Setting }; return originalLoad.call(this, request, parent, isMain); };

async function main(){
  const server = spawn(process.execPath, [connectorServer], { cwd: connectorDir, env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_CONNECTOR_HOST: "127.0.0.1", SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stdout = []; const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForHealth();
    const token = readConnectorToken();
    const incomplete = await postJson("/mission/intake", token, { source: "proof", missionText: "Сделай мне хорошо по бизнес-задаче." });
    const completeText = [
      "Подготовить коммерческое предложение для клиента по внедрению Симбиота.",
      "Результат нужен как документ с аргументами, источниками, рисками и следующим шагом.",
      "Сохрани результат в Obsidian vault.",
      "Проверь, что в документе есть понятный итог, ограничения, проверка качества и следующий шаг для клиента."
    ].join(" ");
    const complete = await postJson("/mission/intake", token, { source: "proof", missionText: completeText });
    Plugin.mockSettings = { coreRoot: "00_Core", rolesRoot: "01_Roles", missionsRoot: "02_Личная_операционная_система_ритм/01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ/02_Missions", sourcesRoot: "03_Sources", resultsRoot: "04_Results", evidenceRoot: "05_Evidence", connectorUrl, connectorToken: token, autoRegister: false };
    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = { vault: makeVault(), workspace: { getLeaf(){ return { async openFile(file){ openedFiles.push(file.path); } }; } } };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
    await plugin.onload();
    const pluginResult = await plugin.runDeterministicMissionIntake({ missionText: completeText });
    const passportPath = pluginResult.passportPath;
    const passportText = passportPath ? readVault(passportPath) : "";
    const manifestPath = pluginResult.written.find((item) => item.endsWith("symbiot-mission-manifest.json"));
    const manifest = manifestPath ? JSON.parse(readVault(manifestPath)) : null;
    const state = await getJson("/app/state", token);
    const checks = {
      commandRegistered: assertCheck(plugin.commands.some((command) => command.id === "symbiot-mission-intake"), "mission intake command missing"),
      incompleteBlocked: assertCheck(incomplete.status === "needs_clarification", "incomplete mission was not blocked"),
      incompleteNoModelCalls: assertCheck(incomplete.modelCalls === 0 && incomplete.trace.modelCalls === 0 && incomplete.llmExecutionAllowed === false, "incomplete mission called or allowed LLM"),
      deterministicQuestions: assertCheck(incomplete.validation.questions.length >= 2 && incomplete.validation.questions.every((item) => item.question), "clarification questions missing"),
      completeReady: assertCheck(complete.status === "ready_for_approval", "complete mission not ready for approval"),
      contractBeforeRuntime: assertCheck(complete.trace.steps.findIndex((step) => step.id === "runtime_contract_created") < complete.trace.steps.findIndex((step) => step.id === "awaiting_user_approval"), "runtime contract order broken"),
      equalizerPresent: assertCheck(complete.responsibilityEqualizer && complete.responsibilityEqualizer.effortMode && complete.responsibilityEqualizer.modelTier && complete.responsibilityEqualizer.validatorDepth, "responsibility equalizer missing"),
      modelCallsZeroBeforeApproval: assertCheck(complete.modelCalls === 0 && complete.trace.steps.every((step) => step.modelCallsAfterStep === 0), "model calls before approval are not zero"),
      artifactBundlePrepared: assertCheck(complete.artifactBundle.files.length === 2 && complete.artifactBundle.paths.passport && complete.artifactBundle.paths.manifest && !complete.artifactBundle.paths.canvas, "artifact bundle is not single-passport contract"),
      pluginWrotePassport: assertCheck(passportText.includes("model_calls_before_approval: 0") && passportText.includes("## 02. Уточнение формулировки через LLM") && passportText.includes("## 04. Маршрут миссии") && passportText.includes("## 05. AI-команда") && passportText.includes("## 07. Pre-LLM trace") && passportText.includes("## 08. Граф связей"), "plugin passport missing single-log sections"),
      pluginWroteManifest: assertCheck(Boolean(manifest && manifest.userVisibleFiles && manifest.userVisibleFiles.length === 1 && manifest.machineFiles && manifest.machineFiles.length === 1), "plugin manifest missing single-passport contract"),
      appStateHasMissionIntake: assertCheck(Array.isArray(state.missionIntakes) && state.missionIntakes.some((item) => item.status === "ready_for_approval"), "app state missing mission intake"),
      benchmarkMapping: assertCheck(requiredBenchmarks.every((id) => complete.benchmarkIds.includes(id)), "benchmark mapping incomplete"),
      noSecretLeak: assertCheck(!JSON.stringify({ incomplete, complete, state }).includes("sb_secret_"), "secret leaked into proof payload")
    };
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP050_DETERMINISTIC_MISSION_INTAKE_PROOF_2026-07-22",
      date: "2026-07-22",
      project: "SYM-SaaS",
      gate: "A3 / OBP-050 Deterministic Mission Intake + Runtime Contract",
      status: "PASS_WITH_CONDITIONS_DETERMINISTIC_MISSION_INTAKE_YELLOW",
      readinessChanged: false,
      readiness: "13205 / 14075 = 93.8%",
      checks,
      incomplete,
      complete,
      pluginResult,
      openedFiles,
      testVault,
      connectorStdout: stdout.join(""),
      connectorStderr: stderr.join("")
    };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, passportPath, manifestPath }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally {
    server.kill();
    Module._load = originalLoad;
  }
}

main().catch((error) => {
  fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP050_DETERMINISTIC_MISSION_INTAKE_PROOF_2026-07-22", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
