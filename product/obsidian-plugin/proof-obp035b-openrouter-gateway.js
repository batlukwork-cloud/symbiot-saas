const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const testVault = path.join(root, "test_vault", "SYM_OBP035B_OPENROUTER_GATEWAY_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp035b_temp_appdata");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP035B_OPENROUTER_GATEWAY_PROOF_2026-07-21.json");
const connectorPort = 8805;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;
const fakeOpenRouterKey = "sk-or-v1-proof-openrouter-gateway-key-not-real";

fs.rmSync(testVault, { recursive: true, force: true });
fs.rmSync(tempAppData, { recursive: true, force: true });
fs.mkdirSync(testVault, { recursive: true });
fs.mkdirSync(tempAppData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
process.env.APPDATA = tempAppData;

class Notice { constructor(message) { Notice.messages.push(String(message)); } }
Notice.messages = [];
class Modal { constructor(app) { this.app = app; this.contentEl = createElementMock(); } open(){ Modal.opened.push(this); if (this.onOpen) return this.onOpen(); return undefined; } close(){} }
Modal.opened = [];
class Plugin { constructor(app, manifest){ this.app = app; this.manifest = manifest || { id: "symbiot-obsidian-plugin", version: "0.1.1" }; this.commands = []; this.ribbonIcons = []; } async loadData(){ return Plugin.mockSettings || {}; } async saveData(data){ this.savedData = data; } addRibbonIcon(icon,title,callback){ this.ribbonIcons.push({ icon,title,callback }); } addCommand(command){ this.commands.push(command); } addSettingTab(tab){ this.settingTab = tab; } addStatusBarItem(){ return { addClass(){}, setText(text){ this.text = text; } }; } }
class PluginSettingTab { constructor(app, plugin){ this.app = app; this.plugin = plugin; this.containerEl = createElementMock(); } }
class Setting { constructor(containerEl){ this.containerEl = containerEl; } setName(){ return this; } setDesc(){ return this; } addText(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } addToggle(cb){ cb({ setValue(){ return this; }, onChange(){ return this; } }); return this; } }
function createElementMock(){ return { children: [], empty(){ this.children = []; }, addClass(){}, querySelector(){ return null; }, createEl(tag, options = {}){ const child = createElementMock(); child.tag = tag; child.text = options.text || ""; child.addEventListener = () => {}; child.setAttribute = () => {}; this.children.push(child); return child; }, createDiv(options = {}){ const child = createElementMock(); child.tag = "div"; child.cls = options.cls || ""; child.addEventListener = () => {}; this.children.push(child); return child; }, setText(text){ this.text = text; } }; }
function vaultPath(relativePath){ return path.join(testVault, ...relativePath.split("/")); }
function fileObj(relativePath){ const full = vaultPath(relativePath); if (!fs.existsSync(full)) return null; const stat = fs.statSync(full); return { path: relativePath, fullPath: full, stat: { size: stat.size, mtime: stat.mtimeMs } }; }
function makeVault(){ return { getName(){ return "SYM_OBP035B_OPENROUTER_GATEWAY_VAULT"; }, getAbstractFileByPath(relativePath){ return fileObj(relativePath); }, async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; }, async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return fileObj(relativePath); }, async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return fileObj(file.path); }, async read(file){ return fs.readFileSync(file.fullPath || vaultPath(file.path), "utf8"); } }; }
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){ const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline){ try { const response = await fetch(`${connectorUrl}/health`); const json = await response.json(); if (response.ok && json.ok) return json; } catch(error){ lastError = error; } await sleep(150); } throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`); }
function readConnectorToken(){ const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json"); const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8")); if (!parsed.token) throw new Error("connector token missing"); return parsed.token; }
function readVault(relativePath){ return fs.readFileSync(vaultPath(relativePath), "utf8"); }
function assertCheck(condition, message){ if (!condition) throw new Error(message); return true; }
function jsonHasNoSecret(value) { return !JSON.stringify(value).includes(fakeOpenRouterKey); }
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain){ if (request === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting }; return originalLoad.call(this, request, parent, isMain); };

async function main(){
  const server = spawn(process.execPath, [connectorServer], { cwd: connectorDir, env: { ...process.env, APPDATA: tempAppData, SYMBIOT_CONNECTOR_PORT: String(connectorPort), SYMBIOT_CONNECTOR_HOST: "127.0.0.1", SYMBIOT_ALLOWED_ORIGINS: `${connectorUrl},http://localhost:${connectorPort},app://obsidian.md` }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stdout = []; const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForHealth();
    const token = readConnectorToken();
    Plugin.mockSettings = { coreRoot: "00_Core", rolesRoot: "01_Roles", missionsRoot: "02_Missions", sourcesRoot: "03_Sources", resultsRoot: "04_Results", evidenceRoot: "05_Evidence", connectorUrl, connectorToken: token, autoRegister: false };
    const PluginClass = require(path.join(pluginDir, "main.js"));
    const openedFiles = [];
    const app = { vault: makeVault(), workspace: { getLeaf(){ return { async openFile(file){ openedFiles.push(file.path); } }; } } };
    const plugin = new PluginClass(app, { id: "symbiot-obsidian-plugin", version: "0.1.1" });
    await plugin.onload();
    const gateway = await plugin.connectOpenRouterGateway(fakeOpenRouterKey, { live: false });
    const comparison = await plugin.runThreeWindowLlmComparison("Дмитрий, очень приятно.", { live: false });
    const snapshotResponse = await fetch(`${connectorUrl}/admin/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
    const snapshot = await snapshotResponse.json();
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const openRouterSlots = [1, 2, 3].map((slot) => providers.find((provider) => provider.slot === slot && provider.id === `openrouter-slot-${slot}`));
    const resultText = readVault(openedFiles[openedFiles.length - 1]);
    const checks = {
      commandRegistered: assertCheck(plugin.commands.some((command) => command.id === "symbiot-openrouter-gateway"), "openrouter command missing"),
      gatewayEndpointOk: assertCheck(gateway.ok && gateway.json && gateway.json.status === "PASS_WITH_CONDITIONS_OPENROUTER_GATEWAY_CONFIGURED_YELLOW", "gateway endpoint failed"),
      threeSlotsConnected: assertCheck(openRouterSlots.every(Boolean), "openrouter slots missing"),
      slotsUseOpenRouterBase: assertCheck(openRouterSlots.every((provider) => provider.baseUrl === "https://openrouter.ai/api/v1" && provider.protocol === "openai_compatible"), "openrouter base/protocol mismatch"),
      keysPresentWithoutValues: assertCheck(openRouterSlots.every((provider) => provider.keyPresent === true && provider.keySource === "local_encrypted_store" && provider.keyFingerprint), "key presence/fingerprint missing"),
      comparisonThreeWindows: assertCheck(comparison.status === "live_disabled" && Array.isArray(comparison.results) && comparison.results.length === 3, "three-window comparison did not run"),
      comparisonUsesOpenRouter: assertCheck(comparison.results.every((item) => String(item.providerId).startsWith("openrouter-slot-")), "comparison did not use openrouter slots"),
      resultNoteCreated: assertCheck(resultText.includes("LLM Three-Window Comparison") && resultText.includes("## Three Windows"), "result note missing"),
      noSecretLeakGateway: assertCheck(jsonHasNoSecret(gateway.json), "gateway response leaked secret"),
      noSecretLeakSnapshot: assertCheck(jsonHasNoSecret(snapshot), "snapshot leaked secret"),
      noSecretLeakComparison: assertCheck(jsonHasNoSecret(comparison), "comparison leaked secret")
    };
    const safeGateway = gateway.json ? { status: gateway.json.status, models: gateway.json.gateway && gateway.json.gateway.models, slotCount: gateway.json.gateway && gateway.json.gateway.slots ? gateway.json.gateway.slots.length : 0, keyPresent: gateway.json.gateway && gateway.json.gateway.keyPresent, keyFingerprint: gateway.json.gateway && gateway.json.gateway.keyFingerprint } : null;
    const evidence = { id: "SYM_OBSIDIAN_PLUGIN_OBP035B_OPENROUTER_GATEWAY_PROOF_2026-07-21", date: "2026-07-21", project: "SYM-SaaS", gate: "OBP-035B OpenRouter Gateway", status: "PASS_WITH_CONDITIONS_OPENROUTER_GATEWAY_YELLOW", readinessChanged: false, readiness: "13205 / 14075 = 93.8%", testVault, gateway: safeGateway, comparison: { status: comparison.status, resultCount: comparison.results.length, providerIds: comparison.results.map((item) => item.providerId), liveRequested: comparison.liveRequested }, openedFiles, checks, connectorStdout: stdout.join(""), connectorStderr: stderr.join("") };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, slotCount: safeGateway.slotCount, comparisonStatus: comparison.status }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally { server.kill(); Module._load = originalLoad; }
}
main().catch((error) => { fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP035B_OPENROUTER_GATEWAY_PROOF_2026-07-21", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8"); console.error(error.stack || error.message); process.exitCode = 1; });
