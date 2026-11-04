const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const testVault = path.join(root, "test_vault", "SYM_OBP046_CONTEXT_RETRIEVER_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp046_temp_appdata");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP046_CONTEXT_RETRIEVER_RAG_PROOF_2026-07-21.json");
const connectorPort = 8798;
const connectorUrl = `http://127.0.0.1:${connectorPort}`;

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
function fileObj(relativePath){ const full = vaultPath(relativePath); if (!fs.existsSync(full)) return null; const stat = fs.statSync(full); return { path: relativePath, fullPath: full, stat: { size: stat.size, mtime: stat.mtimeMs } }; }
function makeVault(){ return { getName(){ return "SYM_OBP046_CONTEXT_RETRIEVER_VAULT"; }, getAbstractFileByPath(relativePath){ return fileObj(relativePath); }, async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; }, async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return fileObj(relativePath); }, async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return fileObj(file.path); }, async read(file){ return fs.readFileSync(file.fullPath || vaultPath(file.path), "utf8"); } }; }
function sleep(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForHealth(){ const deadline = Date.now() + 10000; let lastError = null; while (Date.now() < deadline){ try { const response = await fetch(`${connectorUrl}/health`); const json = await response.json(); if (response.ok && json.ok) return json; } catch(error){ lastError = error; } await sleep(150); } throw new Error(`connector health timeout: ${lastError ? lastError.message : "unknown"}`); }
function readConnectorToken(){ const tokenFile = path.join(tempAppData, "Symbiot", "connector", "connector-token.json"); const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8")); if (!parsed.token) throw new Error("connector token missing"); return parsed.token; }
function readVault(relativePath){ return fs.readFileSync(vaultPath(relativePath), "utf8"); }
function assertCheck(condition, message){ if (!condition) throw new Error(message); return true; }
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
    const result = await plugin.runContextRetrieverMvp({
      query: "клиент коммерческое предложение evidence следующий шаг",
      sources: [
        { vaultPath: "03_Sources/FILE_WORKBENCH/OBP046_Client_Context.md", content: "# Клиентский контекст\n\nКлиенту нужно коммерческое предложение с понятным следующим шагом и короткой аргументацией.\n\nСимбиот должен не выдумывать, а брать контекст из выбранных источников.\n" },
        { vaultPath: "03_Sources/FILE_WORKBENCH/OBP046_Evidence_Context.md", content: "# Evidence контекст\n\nПеред выдачей результата нужны citations, статус источников, evidence и проверка риска обещаний.\n" }
      ]
    });
    const resultText = readVault(result.resultPath);
    const evidenceText = readVault(result.evidencePath);
    const unsafeResponse = await fetch(`${connectorUrl}/context-retriever/query`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "proof", approved: true, query: "test", sources: [{ vaultPath: "../secret.md", content: "secret" }] }) });
    const unsafeJson = await unsafeResponse.json();
    const snapshotResponse = await fetch(`${connectorUrl}/admin/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
    const snapshot = await snapshotResponse.json();
    const retrieval = result.retrieval || {};
    const checks = {
      commandRegistered: assertCheck(plugin.commands.some((command) => command.id === "symbiot-context-retriever"), "context retriever command missing"),
      resultNoteCreated: assertCheck(resultText.includes("Context Retriever / RAG - результат") && resultText.includes("## Цитаты"), "result note missing citations"),
      evidenceNoteCreated: assertCheck(evidenceText.includes("весь vault не сканировался: true") && evidenceText.includes("полный контент не хранится"), "evidence note missing boundary"),
      connectorQueryOk: assertCheck(result.response.ok && retrieval.status === "PASS_WITH_CONDITIONS_CONTEXT_RETRIEVER_RAG_YELLOW", "connector query failed"),
      citationsCreated: assertCheck(Array.isArray(retrieval.snippets) && retrieval.snippets.length >= 2, "citations missing"),
      selectedSourcesOnly: assertCheck(retrieval.selectedSourcesOnly === true && retrieval.noFullVaultScan === true, "silent vault scan boundary missing"),
      fullContentNotStored: assertCheck(retrieval.fullContentStored === false && !JSON.stringify(retrieval.sources || []).includes("коммерческое предложение с понятным"), "full content stored in connector record"),
      unsafePathBlocked: assertCheck(unsafeResponse.status === 409 && unsafeJson.reason === "unsafe_vault_path", "unsafe path was not blocked"),
      snapshotHasRetriever: assertCheck(Array.isArray(snapshot.contextRetriever) && snapshot.contextRetriever.some((item) => item.id === retrieval.id), "snapshot missing context retriever record"),
      openedResult: assertCheck(openedFiles.includes(result.resultPath), "result note not opened")
    };
    const evidence = { id: "SYM_OBSIDIAN_PLUGIN_OBP046_CONTEXT_RETRIEVER_RAG_PROOF_2026-07-21", date: "2026-07-21", project: "SYM-SaaS", gate: "OBP-046 Context Retriever + RAG", status: "PASS_WITH_CONDITIONS_CONTEXT_RETRIEVER_RAG_YELLOW", readinessChanged: false, readiness: "13205 / 14075 = 93.8%", testVault, result: { status: result.status, resultPath: result.resultPath, evidencePath: result.evidencePath, sourceCount: result.sources.length, citationCount: retrieval.snippets.length }, unsafeJson, openedFiles, checks, connectorStdout: stdout.join(""), connectorStderr: stderr.join("") };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, resultPath: result.resultPath, evidenceNote: result.evidencePath, citationCount: retrieval.snippets.length }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally { server.kill(); Module._load = originalLoad; }
}
main().catch((error) => { fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP046_CONTEXT_RETRIEVER_RAG_PROOF_2026-07-21", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8"); console.error(error.stack || error.message); process.exitCode = 1; });
