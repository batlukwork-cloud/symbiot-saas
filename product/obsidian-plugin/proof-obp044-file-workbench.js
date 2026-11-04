const fs = require("fs");
const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const root = __dirname;
const pluginDir = fs.existsSync(path.join(root, "symbiot-obsidian-plugin")) ? path.join(root, "symbiot-obsidian-plugin") : path.join(root, "obsidian-plugin");
const connectorDir = fs.existsSync(path.join(root, "symbiot-connector-service")) ? path.join(root, "symbiot-connector-service") : path.join(root, "connector-service");
const connectorServer = path.join(connectorDir, "server.js");
const testVault = path.join(root, "test_vault", "SYM_OBP044_FILE_WORKBENCH_VAULT");
const tempAppData = path.join(root, "runtime_logs", "obp044_temp_appdata");
const evidenceDir = path.join(root, "runtime_logs");
const evidencePath = path.join(evidenceDir, "SYM_OBSIDIAN_PLUGIN_OBP044_FILE_WORKBENCH_PROOF_2026-07-21.json");
const connectorPort = 8797;
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
function makeVault(){ return { getName(){ return "SYM_OBP044_FILE_WORKBENCH_VAULT"; }, getAbstractFileByPath(relativePath){ return fileObj(relativePath); }, async createFolder(relativePath){ fs.mkdirSync(vaultPath(relativePath), { recursive: true }); return { path: relativePath }; }, async create(relativePath, content){ const full = vaultPath(relativePath); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content, "utf8"); return fileObj(relativePath); }, async modify(file, content){ fs.writeFileSync(file.fullPath || vaultPath(file.path), content, "utf8"); return fileObj(file.path); } }; }
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
    const result = await plugin.runFileWorkbenchMvp({ title: "OBP044_Test_Workfile", task: "Проверить File Workbench MVP", content: "# OBP044 Test Workfile\n\nКонтент остается в vault. Connector получает только metadata.\n" });
    const multiResponse = await fetch(`${connectorUrl}/file-workbench/create`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source: "proof-obp044",
        title: "Проверка пяти форматов Симбиота",
        content: "Симбиот создает проверяемый результат.\n\nДокумент содержит русский текст, evidence и следующий шаг.",
        rows: [["Критерий", "Статус"], ["Формат", "Проверен"], ["Evidence", "Есть"]],
        formats: ["md", "html", "docx", "xlsx", "pdf"],
        outputPath: "C:/unsafe-user-controlled-path"
      })
    });
    const multi = await multiResponse.json();
    const inputText = readVault(result.inputPath);
    const resultText = readVault(result.resultPath);
    const evidenceText = readVault(result.evidencePath);
    const snapshotResponse = await fetch(`${connectorUrl}/admin/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
    const snapshot = await snapshotResponse.json();
    const registered = result.fileRecord || {};
    const checks = {
      commandRegistered: assertCheck(plugin.commands.some((command) => command.id === "symbiot-file-workbench"), "file workbench command missing"),
      inputFileCreated: assertCheck(inputText.includes("OBP044 Test Workfile"), "input file missing"),
      resultNoteCreated: assertCheck(resultText.includes("File Workbench - результат") && resultText.includes("metadata -> result -> evidence"), "result note missing"),
      evidenceNoteCreated: assertCheck(evidenceText.includes("File Workbench - Evidence") && evidenceText.includes("connector не хранит содержимое: true"), "evidence note missing"),
      connectorRegisterOk: assertCheck(result.register.ok && registered.accessStatus === "metadata_registered_yellow", "connector registration failed"),
      contentNotStored: assertCheck(registered.contentStored === false && registered.contentPreviewStored === false, "connector stored content"),
      hashPresent: assertCheck(Boolean(result.sha256) && result.sha256.length === 64, "hash missing"),
      safeVaultPath: assertCheck(result.safeVaultPath === true && !path.isAbsolute(result.inputPath) && !result.inputPath.includes(".."), "unsafe vault path"),
      snapshotHasFileWorkbench: assertCheck(Array.isArray(snapshot.fileWorkbench) && snapshot.fileWorkbench.some((item) => item.id === registered.id), "snapshot missing file workbench record"),
      openedResult: assertCheck(openedFiles.includes(result.resultPath), "result note not opened")
    };
    const artifacts = Array.isArray(multi.artifacts) ? multi.artifacts : [];
    const byFormat = Object.fromEntries(artifacts.map((artifact) => [artifact.format, artifact]));
    const zipSignature = (filePath) => fs.readFileSync(filePath).subarray(0, 2).toString("utf8") === "PK";
    checks.multiFormatEndpointPassed = assertCheck(multiResponse.ok && multi.status === "PASS_WITH_CONDITIONS_FILE_WORKBENCH_MULTI_FORMAT_YELLOW", "multi-format endpoint failed");
    checks.allFiveFormatsCreated = assertCheck(["md", "html", "docx", "xlsx", "pdf"].every((format) => byFormat[format] && fs.existsSync(byFormat[format].path)), "one or more formats missing");
    checks.docxPackageValid = assertCheck(zipSignature(byFormat.docx.path) && fs.readFileSync(byFormat.docx.path).includes(Buffer.from("word/")), "DOCX package invalid");
    checks.xlsxPackageValid = assertCheck(zipSignature(byFormat.xlsx.path) && fs.readFileSync(byFormat.xlsx.path).includes(Buffer.from("xl/")), "XLSX package invalid");
    checks.pdfSignatureValid = assertCheck(fs.readFileSync(byFormat.pdf.path).subarray(0, 5).toString("ascii") === "%PDF-", "PDF signature invalid");
    checks.htmlAndMarkdownReadable = assertCheck(fs.readFileSync(byFormat.html.path, "utf8").includes("<!doctype html>") && fs.readFileSync(byFormat.md.path, "utf8").includes("Проверка пяти форматов"), "HTML/Markdown content invalid");
    checks.hashesAndDownloadContract = assertCheck(artifacts.length === 5 && artifacts.every((artifact) => artifact.sha256.length === 64 && artifact.bytes > 50 && artifact.downloadable), "hash/download contract invalid");
    checks.safeOutputRootEnforced = assertCheck(artifacts.every((artifact) => artifact.path.startsWith(multi.artifactRoot + path.sep)) && !artifacts.some((artifact) => artifact.path.includes("unsafe-user-controlled-path")), "unsafe output path accepted");
    const evidence = { id: "SYM_OBSIDIAN_PLUGIN_OBP044_FILE_WORKBENCH_PROOF_2026-07-21", date: "2026-07-22", project: "SYM-SaaS", gate: "B4 / OBP-044B File / Document Workbench", status: "PASS_WITH_CONDITIONS_FILE_WORKBENCH_MULTI_FORMAT_YELLOW", readinessChanged: false, readiness: "13205 / 14075 = 93.8%", testVault, result, multiFormat: multi, openedFiles, checks, connectorStdout: stdout.join(""), connectorStderr: stderr.join("") };
    evidence.passed = Object.values(checks).every(Boolean);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ passed: evidence.passed, status: evidence.status, evidencePath, inputPath: result.inputPath, resultPath: result.resultPath, evidenceNote: result.evidencePath }, null, 2));
    process.exitCode = evidence.passed ? 0 : 1;
  } finally { server.kill(); Module._load = originalLoad; }
}
main().catch((error) => { fs.writeFileSync(evidencePath, `${JSON.stringify({ id: "SYM_OBSIDIAN_PLUGIN_OBP044_FILE_WORKBENCH_PROOF_2026-07-21", status: "FAILED_RED", error: error.message, stack: error.stack }, null, 2)}\n`, "utf8"); console.error(error.stack || error.message); process.exitCode = 1; });
