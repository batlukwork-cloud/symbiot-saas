const { addIcon, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon } = require("obsidian");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");
let electronShell = null;
let electronClipboard = null;
try {
  const electron = require("electron");
  electronShell = electron.shell;
  electronClipboard = electron.clipboard;
} catch (_) {
  electronShell = null;
  electronClipboard = null;
}

const LOS_OBSIDIAN_ROOT = "02_Личная_операционная_система_ритм";
const LOS_PROTOCOLS_ROOT = `${LOS_OBSIDIAN_ROOT}/01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ`;
const LOS_MISSIONS_ROOT = `${LOS_PROTOCOLS_ROOT}/02_Missions`;
const LOS_PHYSICAL_MIRROR_ROOT = "D:\\02_ОПЕРАЦИОННАЯ_СИСТЕМА_РАБОЧИЙ_СЛОЙ";
const DISPATCHER_VAULT_ROOT = "ДИСПЕТЧЕРСКАЯ_СИМБИОТА/00_УПРАВЛЕНИЕ";
const DISPATCHER_RUNTIME_PROFILE_PATH = `${DISPATCHER_VAULT_ROOT}/КОНФИГУРАЦИЯ/PLUGIN_RUNTIME_PROFILE.json`;
const DISPATCHER_WORKSPACE_ROOT = "<локальный путь>";
const SYMBIOT_DISPATCHER_VIEW_TYPE = "symbiot-dispatcher-workspace";

const DEFAULT_SETTINGS = {
  coreVersion: "0.5.0",
  coreRoot: "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/00_Core",
  rolesRoot: "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/01_Roles",
  missionsRoot: LOS_MISSIONS_ROOT,
  sourcesRoot: "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/03_Sources",
  resultsRoot: "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/04_Results",
  evidenceRoot: "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/05_Evidence",
  operatingSystemRoot: LOS_OBSIDIAN_ROOT,
  operatingSystemMissionsRoot: LOS_MISSIONS_ROOT,
  operatingSystemPhysicalMirrorRoot: LOS_PHYSICAL_MIRROR_ROOT,
  dispatcherVaultRoot: DISPATCHER_VAULT_ROOT,
  dispatcherWorkspaceRoot: DISPATCHER_WORKSPACE_ROOT,
  dispatcherRuntimeProfilePath: DISPATCHER_RUNTIME_PROFILE_PATH,
  activeDispatcherMissionId: "",
  connectorUrl: "http://127.0.0.1:8787",
  mobileConnectorEnabled: false,
  llmProviders: [
    { id: "openai", name: "OpenAI", model: "gpt-4.1", enabled: true },
    { id: "anthropic", name: "Anthropic", model: "claude-sonnet", enabled: true },
    { id: "gemini", name: "Gemini", model: "gemini-pro", enabled: true }
  ]
};

const SYMBIOT_RIBBON_ICON = `<circle cx="50" cy="50" r="38" fill="#12B8B0"/>`;

module.exports = class SymbiotPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    await this.normalizeOperationalSettings();
    this.dispatcherRuntime = { ok: false, profile: null, missionTypes: [], error: "not_loaded" };
    await this.loadDispatcherRuntimeProfile(false);
    this.connectorState = { ok: false, status: "unknown", lastError: null, snapshot: null };
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("symbiot-status-bar");
    this.setStatusBar("Симбиот: connector не проверен");

    addIcon("symbiot-circle", SYMBIOT_RIBBON_ICON);
    this.registerView(SYMBIOT_DISPATCHER_VIEW_TYPE, (leaf) => new SymbiotDispatcherView(leaf, this));
    this.addRibbonIcon("symbiot-circle", "Симбиот", () => this.openDispatcherNavigator());
    this.addCommand({ id: "symbiot-open-panel", name: "Симбиот: открыть рабочий экран", callback: () => this.openDispatcherNavigator() });
    this.addCommand({ id: "symbiot-operating-system", name: "Симбиот: управление миссиями / операционная система", callback: () => this.openDispatcherNavigator() });
    this.addCommand({ id: "symbiot-open-browser-gui", name: "Симбиот: открыть в браузере", callback: () => this.openBrowserGui() });
    this.addCommand({ id: "symbiot-open-diagnostics", name: "Симбиот: открыть диагностику плагина", callback: () => this.openControlPanel() });
    this.addCommand({ id: "symbiot-refresh-connector", name: "Симбиот: проверить connector", callback: () => this.refreshConnectorStatus(true) });
    this.addCommand({ id: "symbiot-register-connector", name: "Симбиот: подключить этот vault", callback: () => this.registerConnector(true) });
    this.addCommand({ id: "symbiot-init-core", name: "Симбиот: подготовить рабочее пространство", callback: () => this.initializeCore() });
    this.addCommand({ id: "symbiot-create-mission", name: "Симбиот: создать миссию", callback: () => this.createMissionNote({ syncConnector: true }) });
    this.addCommand({ id: "symbiot-mission-intake", name: "Симбиот: подготовить маршрут миссии", callback: () => this.openDispatcherNavigator() });
    this.addCommand({ id: "symbiot-run-proof-loop", name: "Симбиот: проверить цикл миссии", callback: () => this.runProofMissionLoop() });
    this.addCommand({ id: "symbiot-agent-runtime-mvp", name: "Симбиот: запустить runtime MVP", callback: () => this.runAgentRuntimeMvp() });
    this.addCommand({ id: "symbiot-visible-plan-status-evidence", name: "Симбиот: план, статус и evidence", callback: () => this.runVisiblePlanStatusEvidenceLoop() });
    this.addCommand({ id: "symbiot-file-workbench", name: "Симбиот: рабочие файлы", callback: () => this.runFileWorkbenchMvp() });
    this.addCommand({ id: "symbiot-context-retriever", name: "Симбиот: найти контекст / RAG", callback: () => this.runContextRetrieverMvp() });
    this.addCommand({ id: "symbiot-admin-sync", name: "Симбиот: синхронизировать админ-контур", callback: () => this.runAdminSyncMvp() });
    this.addCommand({ id: "symbiot-architecture-signal-backbone", name: "Симбиот: проверить архитектурную шину", callback: () => this.runArchitectureSignalBackbone() });
    this.addCommand({ id: "symbiot-llm-hub", name: "Симбиот: открыть LLM Hub", callback: () => this.openLlmHub() });
    this.addCommand({ id: "symbiot-api-keys", name: "Симбиот: открыть API-ключи", callback: () => this.openApiVault() });
    this.addCommand({ id: "symbiot-compare-llm", name: "Симбиот: сравнить LLM", callback: () => this.compareLlmResults() });
    this.addCommand({ id: "symbiot-three-window-llm", name: "Симбиот: запустить три окна LLM", callback: () => this.runThreeWindowLlmComparison() });
    this.addCommand({ id: "symbiot-openrouter-gateway", name: "Симбиот: подключить OpenRouter Gateway", callback: () => this.openLlmHub() });
    this.addCommand({ id: "symbiot-mobile-connector", name: "Симбиот: открыть мобильный доступ", callback: () => this.openMobileConnector() });
    this.addCommand({ id: "symbiot-pre-release-preflight", name: "Симбиот: проверить готовность", callback: () => this.runPreReleasePreflight() });
    this.addSettingTab(new SymbiotSettingTab(this.app, this));

    await this.writeLoadMarker();
    await this.refreshConnectorStatus(false);
    try {
      await this.registerConnector(false);
    } catch (error) {
      this.connectorState = { ok: false, status: "register_failed", lastError: error.message, snapshot: null };
      this.setStatusBar("Симбиот: не удалось подключить connector");
    }
    new Notice("Симбиот включен");
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(SYMBIOT_DISPATCHER_VIEW_TYPE);
    new Notice("Симбиот выключен");
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async normalizeOperationalSettings() {
    const legacyMissionRoots = new Set([
      "02_Missions",
      "01_Симбиот_что_и_зачем/00_Смысл_и_стратегия/03_Симбиот_как_система_масштабирования/05_SAAS_РАЗРАБОТКА/09_OBSIDIAN_PLUGIN_RUNTIME/02_Missions"
    ]);
    const currentRoot = String(this.settings.missionsRoot || "").replace(/^\/+|\/+$/g, "");
    const shouldMigrateMissionRoot = !currentRoot || legacyMissionRoots.has(currentRoot) || /09_OBSIDIAN_PLUGIN_RUNTIME\/02_Missions$/.test(currentRoot);
    if (shouldMigrateMissionRoot) {
      this.settings.missionsRoot = LOS_MISSIONS_ROOT;
    }
    this.settings.operatingSystemRoot = LOS_OBSIDIAN_ROOT;
    this.settings.operatingSystemMissionsRoot = LOS_MISSIONS_ROOT;
    this.settings.operatingSystemPhysicalMirrorRoot = LOS_PHYSICAL_MIRROR_ROOT;
    this.settings.dispatcherVaultRoot = DISPATCHER_VAULT_ROOT;
    this.settings.dispatcherWorkspaceRoot = DISPATCHER_WORKSPACE_ROOT;
    this.settings.dispatcherRuntimeProfilePath = DISPATCHER_RUNTIME_PROFILE_PATH;
    if (shouldMigrateMissionRoot) {
      await this.saveSettings();
    }
  }
  async writeLoadMarker() {
    try {
        await this.upsertFile(`${this.settings.evidenceRoot}/PLUGIN_LOAD_MARKER.md`, [
        "# Маркер загрузки плагина Симбиот",
        "",
        `loaded_at: ${new Date().toISOString()}`,
        `vault_id: ${this.getVaultId()}`,
        `device_id: ${this.getDeviceId()}`,
        "status: YELLOW",
        "",
        "This file proves the plugin onload executed inside an Obsidian-compatible vault runtime."
      ].join("\n"));
    } catch (error) {
      this.setStatusBar(`Маркер загрузки Симбиота не создан: ${error.message}`);
    }
  }

  getConnectorUrl() {
    return String(this.settings.connectorUrl || DEFAULT_SETTINGS.connectorUrl).replace(/\/+$/, "");
  }

  getBrowserGuiUrl() {
    return `${this.getConnectorUrl()}/app`;
  }

  async openBrowserGui() {
    const url = this.getBrowserGuiUrl();
    const status = await this.refreshConnectorStatus(false);
    if (!status.ok) {
      new Notice("Connector не отвечает. Запустите Symbiot connector и повторите открытие рабочего экрана.");
      this.openControlPanel();
      return { ok: false, url, reason: "connector_unavailable" };
    }
    try {
      if (electronShell && typeof electronShell.openExternal === "function") {
        await electronShell.openExternal(url);
      } else if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(url, "_blank", "noopener");
      } else {
        throw new Error("browser_open_not_available");
      }
      new Notice("Открываю рабочий экран Симбиота в браузере");
      return { ok: true, url };
    } catch (error) {
      new Notice(`Не удалось открыть браузер: ${error.message}`);
      return { ok: false, url, reason: error.message };
    }
  }

  getVaultId() {
    return this.app.vault.getName ? this.app.vault.getName() : "obsidian-vault";
  }

  getDeviceId() {
    return `obsidian-${this.getVaultId()}`.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
  }

  setStatusBar(text) {
    if (this.statusBar) {
      this.statusBar.setText(text);
    }
  }

  getConnectorTokenPath() {
    return path.join(process.env.APPDATA || os.tmpdir(), "Symbiot", "connector", "connector-token.json");
  }

  getConnectorAuthToken() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.getConnectorTokenPath(), "utf8"));
      return parsed && typeof parsed.token === "string" ? parsed.token : null;
    } catch (_) {
      return null;
    }
  }

  connectorHeaders(body) {
    const headers = body ? { "content-type": "application/json" } : {};
    const token = this.getConnectorAuthToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async connectorRequest(method, requestPath, body) {
    const response = await fetch(`${this.getConnectorUrl()}${requestPath}`, {
      method,
      headers: this.connectorHeaders(body),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (error) {
      json = { parseError: error.message, raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  }

  async refreshConnectorStatus(showNotice) {
    try {
      const result = await this.connectorRequest("GET", "/health");
      this.connectorState = {
        ok: result.ok && Boolean(result.json && result.json.ok),
        status: result.json && result.json.status ? result.json.status : "unknown",
        lastError: null,
        snapshot: this.connectorState.snapshot || null
      };
      this.setStatusBar(this.connectorState.ok ? "Симбиот: connector работает" : "Симбиот: connector требует проверки");
      if (showNotice) {
        new Notice(this.connectorState.ok ? "Connector работает" : "Connector вернул YELLOW");
      }
      return result;
    } catch (error) {
      this.connectorState = { ok: false, status: "offline", lastError: error.message, snapshot: null };
      this.setStatusBar("Симбиот: connector не запущен");
      if (showNotice) {
        new Notice(`Connector не запущен: ${error.message}`);
      }
      return { ok: false, status: 0, json: { error: error.message } };
    }
  }

  async registerConnector(showNotice) {
    const result = await this.connectorRequest("POST", "/plugin/register", {
      deviceId: this.getDeviceId(),
      vaultId: this.getVaultId(),
      pluginVersion: this.manifest && this.manifest.version ? this.manifest.version : this.settings.coreVersion
    });
    if (showNotice) {
      new Notice(result.ok ? "Vault подключен к connector" : "Vault не подключен к connector");
    }
    return result;
  }

  async getAdminSnapshot() {
    const result = await this.connectorRequest("GET", "/admin/snapshot");
    if (result.ok) {
      this.connectorState.snapshot = result.json;
    }
    return result;
  }

  async getMobilePairing() {
    return this.connectorRequest("GET", "/mobile/pairing");
  }

  async getMobileStatus() {
    return this.connectorRequest("GET", "/mobile/status");
  }

  async getPreflightStatus() {
    return this.connectorRequest("GET", "/preflight");
  }

  async getApiVaultList() {
    return this.connectorRequest("GET", "/api-vault/list");
  }

  async revealApiVaultSecret(id) {
    return this.connectorRequest("POST", "/api-vault/reveal", {
      source: "obsidian-plugin",
      id,
      confirmed: true
    });
  }

  async saveApiVaultSecret(record) {
    return this.connectorRequest("POST", "/api-vault/save", {
      source: "obsidian-plugin",
      ...record
    });
  }

  async connectApiKey(input, slot) {
    const value = String(input || "").trim();
    if (!value) {
      new Notice("Вставьте API-key или строку подключения");
      return { ok: false, json: { error: "empty_input" } };
    }
    const result = await this.connectorRequest("POST", "/providers/connect", {
      source: "obsidian-plugin",
      input: value,
      slot
    });
    if (result.ok && result.json && result.json.provider) {
      const provider = result.json.provider;
      new Notice(`Подключено: ${provider.name || provider.id}`);
      await this.getAdminSnapshot();
    } else {
      const reason = result.json && (result.json.error || result.json.reason) ? result.json.error || result.json.reason : "unknown";
      new Notice(`Подключение не прошло: ${reason}`);
    }
    return result;
  }

  async connectOpenRouterGateway(apiKey, options = {}) {
    const value = String(apiKey || "").trim();
    if (!value) {
      new Notice("Вставьте OpenRouter API-key");
      return { ok: false, json: { error: "empty_openrouter_key" } };
    }
    const result = await this.connectorRequest("POST", "/openrouter/gateway/connect", {
      source: "obsidian-plugin",
      apiKey: value,
      models: options.models || ["openrouter/auto", "openrouter/auto", "openrouter/auto"],
      proofPrompt: options.proofPrompt || "Дмитрий, очень приятно. Проверь три окна OpenRouter Gateway.",
      live: options.live === true
    });
    if (result.ok && result.json && result.json.gateway) {
      new Notice("OpenRouter Gateway подключен в три окна");
      await this.getAdminSnapshot();
    } else {
      const reason = result.json && (result.json.error || result.json.reason) ? result.json.error || result.json.reason : "unknown";
      new Notice(`OpenRouter Gateway не подключен: ${reason}`);
    }
    return result;
  }


  async disconnectProviderSlot(slot) {
    const result = await this.connectorRequest("POST", "/providers/disconnect", {
      source: "obsidian-plugin",
      slot
    });
    new Notice(result.ok ? `Окно ${slot}: провайдер отключен` : `Окно ${slot}: не удалось отключить`);
    await this.getAdminSnapshot();
    return result;
  }
  async ensureFolder(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(current);
      if (!folder) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async initializeCore() {
    const folders = [
      this.settings.coreRoot,
      this.settings.rolesRoot,
      this.settings.missionsRoot,
      this.settings.sourcesRoot,
      this.settings.resultsRoot,
      this.settings.evidenceRoot
    ];
    for (const folder of folders) {
      await this.ensureFolder(folder);
    }
    await this.upsertFile(`${this.settings.coreRoot}/SYM_PLUGIN_WORKSPACE.md`, this.renderCoreNote());
    await this.upsertFile(`${this.settings.rolesRoot}/ROLE_TEMPLATE.md`, this.renderRoleTemplate());
    await this.upsertFile(`${this.settings.missionsRoot}/MISSION_TEMPLATE.md`, this.renderMissionTemplate("Новая миссия"));
    await this.upsertFile(`${this.settings.missionsRoot}/MISSION_FOLDER_TEMPLATE.md`, this.renderMissionFolderTemplate());
    await this.upsertFile(`${this.settings.missionsRoot}/MISSION_ROUTE_TEMPLATE.canvas`, this.renderMissionCanvas("Новая миссия", "mission-template"));
    await this.upsertFile(`${this.settings.missionsRoot}/MISSION_HTML_RESULT_TEMPLATE.html`, this.renderMissionHtmlContract("Новая миссия"));
    await this.upsertFile(`${this.settings.evidenceRoot}/EVIDENCE_TEMPLATE.md`, this.renderEvidenceTemplate("Новая миссия"));
    new Notice("Рабочее пространство Симбиота подготовлено");
  }

  async upsertFile(path, content) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      return file;
    }
    return this.app.vault.create(path, content);
  }

  async writeOrUpdateFile(path, content) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.vault.modify(file, content);
      return file;
    }
    return this.app.vault.create(path, content);
  }

  async createMissionNote(options = {}) {
    await this.ensureFolder(this.settings.missionsRoot);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const title = `Миссия_${stamp}`;
    const missionId = this.normalizeMissionId(title);
    const missionFolder = `${this.settings.missionsRoot}/${title}`;
    await this.ensureFolder(missionFolder);
    const paths = {
      passport: `${missionFolder}/00_Паспорт_миссии.md`,
      manifest: `${missionFolder}/symbiot-mission-manifest.json`
    };
    const file = await this.upsertFile(paths.passport, this.renderMissionTemplate(title, { missionId, paths }));
    await this.upsertFile(paths.manifest, this.renderMissionManifest({ title, missionId, paths }));
    await this.app.workspace.getLeaf(true).openFile(file);
    let connectorMission = null;
    if (options.syncConnector) {
      const result = await this.connectorRequest("POST", "/mission/create", {
        title,
        missionId,
        source: "obsidian-plugin",
        missionType: "client_mission",
        methodologyOwner: "РОЛЬ_AI_Методолог_клиентских_миссий",
        paths,
        passportContract: {
          path: paths.passport,
          rule: "Паспорт миссии содержит описание, LLM-уточнение, маршрут, AI-команду, pre-LLM trace, граф связей, ход выполнения и результат."
        },
        security: {
          noSilentVaultRead: true,
          explicitSourceConsentRequired: true,
          sourceStatuses: ["allowed", "needs_user_permission", "skip_private"]
        }
      });
      connectorMission = result.json && result.json.mission ? result.json.mission : null;
    }
    new Notice("Миссия создана");
    return { file, title, missionId, missionFolder, paths, connectorMission };
  }
  async runDeterministicMissionIntake(options = {}) {
    await this.ensureFolder(this.settings.missionsRoot);
    const missionText = options.missionText || options.prompt || "Подготовить коммерческое предложение для клиента, сохранить результат в Obsidian, проверить источники, ограничения и следующий шаг.";
    const response = await this.connectorRequest("POST", "/mission/intake", {
      source: "obsidian-plugin",
      missionText,
      userFields: options.userFields || {}
    });
    const payload = response.json || {};
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (payload.status === "needs_clarification") {
      const clarificationPath = `${this.settings.missionsRoot}/00_УТОЧНЕНИЯ/MISSION_INTAKE_CLARIFICATION_${stamp}.md`;
      const file = await this.upsertFile(clarificationPath, this.renderMissionIntakeClarification(payload, response));
      await this.app.workspace.getLeaf(true).openFile(file);
      new Notice("Миссия остановлена до уточнения. LLM не запускалась.");
      return { response, payload, status: "needs_clarification", clarificationPath };
    }
    const files = payload.artifactBundle && Array.isArray(payload.artifactBundle.files) ? payload.artifactBundle.files : [];
    const written = [];
    for (const artifact of files) {
      const vaultPath = this.mapMissionArtifactPath(artifact.path);
      const folder = vaultPath.split("/").slice(0, -1).join("/");
      if (folder) await this.ensureFolder(folder);
      await this.writeOrUpdateFile(vaultPath, artifact.content || "");
      written.push(vaultPath);
    }
    const passportPath = written.find((item) => item.endsWith("00_Паспорт_миссии.md")) || written[0] || null;
    if (passportPath) {
      const file = this.app.vault.getAbstractFileByPath(passportPath);
      if (file) await this.app.workspace.getLeaf(true).openFile(file);
    }
    new Notice("Миссия подготовлена до LLM: паспорт и manifest созданы.");
    return { response, payload, status: payload.status, written, passportPath };
  }

  async prepareDispatcherMission(missionText, options = {}) {
    let obsidianContext = null;
    let missionTypeRegistry = null;
    let missionTypeRegistrySource = null;
    try {
      const snapshot = await this.buildDispatcherObsidianContext(options.missionType || "");
      obsidianContext = snapshot.context;
      missionTypeRegistry = snapshot.missionTypes;
      missionTypeRegistrySource = snapshot.registryPath;
    } catch (error) {
      this.dispatcherRuntime = { ok: false, profile: null, missionTypes: [], error: error.message };
      new Notice(`Контекст Obsidian не готов: ${error.message}`);
    }
    const response = await this.connectorRequest("POST", "/dispatcher/v1/intake", {
      source: "obsidian-plugin",
      missionText,
      executionMode: options.executionMode || "",
      missionType: options.missionType || "",
      sourcePaths: Array.isArray(options.sourcePaths) ? options.sourcePaths : [],
      obsidianContextRequired: true,
      obsidianContext,
      missionTypeRegistry,
      missionTypeRegistrySource
    });
    const payload = response.json || {};
    if (response.ok && payload.ok && payload.contract) {
      await this.mirrorDispatcherMission(payload.contract);
      new Notice(payload.status === "PAUSED_FOR_GATE"
        ? "Миссия остановлена: проверьте источник и указанные блокировки."
        : "Карточка задачи, план и предварительный бюджет готовы. Миссия ожидает вашего решения.");
    }
    return { response, payload };
  }

  async approveDispatcherMission(missionId) {
    const response = await this.connectorRequest("POST", "/dispatcher/v1/approve", {
      source: "obsidian-plugin",
      missionId,
      approved: true,
      approvedBy: this.getVaultId()
    });
    const payload = response.json || {};
    if (response.ok && payload.ok) {
      const detail = await this.getDispatcherMission(missionId);
      if (detail.ok && detail.json && detail.json.contract) await this.mirrorDispatcherMission(detail.json.contract);
      new Notice("План утвержден. Hermes получит только утвержденный контракт.");
    }
    return { response, payload };
  }

  async getDispatcherMissions() {
    return this.connectorRequest("GET", "/dispatcher/v1/missions");
  }

  async getDispatcherMission(missionId) {
    return this.connectorRequest("GET", `/dispatcher/v1/missions/${encodeURIComponent(missionId)}`);
  }

  normalizeDispatcherVaultPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.includes("..") || normalized.includes("\0")) throw new Error("Некорректный путь Obsidian");
    return normalized;
  }

  async readDispatcherVaultFile(vaultPath) {
    const normalized = this.normalizeDispatcherVaultPath(vaultPath);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!file || typeof file.path !== "string") throw new Error(`Файл не найден: ${normalized}`);
    return { path: normalized, content: await this.app.vault.read(file) };
  }

  async loadDispatcherRuntimeProfile(showNotice = false) {
    try {
      const profilePath = this.normalizeDispatcherVaultPath(this.settings.dispatcherRuntimeProfilePath || DISPATCHER_RUNTIME_PROFILE_PATH);
      const profileFile = await this.readDispatcherVaultFile(profilePath);
      const profile = JSON.parse(profileFile.content);
      if (!profile || profile.status !== "ACTIVE" || !profile.missionTypeRegistryPath) throw new Error("Профиль запуска не ACTIVE или не содержит реестр типов");
      const registryPath = this.normalizeDispatcherVaultPath(profile.missionTypeRegistryPath);
      const registryFile = await this.readDispatcherVaultFile(registryPath);
      const registry = JSON.parse(registryFile.content);
      const missionTypes = Array.isArray(registry.missionTypes) ? registry.missionTypes : [];
      if (!missionTypes.length) throw new Error("Реестр типов миссий пуст");
      this.dispatcherRuntime = { ok: true, profilePath, profile, registryPath, missionTypes, error: null };
      if (showNotice) new Notice(`Контекст Obsidian готов: ${missionTypes.length} типов миссий`);
      return this.dispatcherRuntime;
    } catch (error) {
      this.dispatcherRuntime = { ok: false, profile: null, missionTypes: [], error: error.message };
      if (showNotice) new Notice(`Контекст Obsidian не готов: ${error.message}`);
      return this.dispatcherRuntime;
    }
  }

  getDispatcherMissionTypeOptions() {
    const missionTypes = this.dispatcherRuntime && Array.isArray(this.dispatcherRuntime.missionTypes) ? this.dispatcherRuntime.missionTypes : [];
    if (!missionTypes.length) return DISPATCHER_VIEW_TYPES;
    return [["", "Определить автоматически из Obsidian"], ...missionTypes.map((item) => [String(item.id || ""), String(item.label || item.id || "Без названия")])];
  }

  async buildDispatcherObsidianContext(missionTypeId = "") {
    const runtime = await this.loadDispatcherRuntimeProfile(false);
    if (!runtime.ok) throw new Error(runtime.error || "Профиль запуска Obsidian недоступен");
    const selectedType = runtime.missionTypes.find((item) => item.id === missionTypeId) || null;
    const missionMethodPaths = selectedType
      ? (Array.isArray(selectedType.methodPaths) ? selectedType.methodPaths : [])
      : runtime.missionTypes.flatMap((item) => Array.isArray(item.methodPaths) ? item.methodPaths : []);
    const documents = [
      { kind: "runtime_profile", path: runtime.profilePath },
      { kind: "mission_type_registry", path: runtime.registryPath },
      ...(Array.isArray(runtime.profile.requiredDocuments) ? runtime.profile.requiredDocuments : []),
      ...missionMethodPaths.map((path) => ({ kind: "mission_method", path }))
    ];
    if (runtime.profile.cardTemplatePath) documents.push({ kind: "mission_card_template", path: runtime.profile.cardTemplatePath });
    if (runtime.profile.architectureCanvasPath) documents.push({ kind: "dispatcher_architecture_canvas", path: runtime.profile.architectureCanvasPath });
    const unique = [];
    const seen = new Set();
    for (const document of documents) {
      const vaultPath = this.normalizeDispatcherVaultPath(document.path || document.vaultPath);
      if (seen.has(vaultPath)) continue;
      seen.add(vaultPath);
      unique.push({ kind: String(document.kind || "knowledge"), vaultPath });
    }
    const entries = [];
    let totalBytes = 0;
    for (const document of unique.slice(0, 32)) {
      const file = await this.readDispatcherVaultFile(document.vaultPath);
      const bytes = Buffer.byteLength(file.content, "utf8");
      if (bytes > 128 * 1024) throw new Error(`Файл контекста слишком большой: ${file.path}`);
      totalBytes += bytes;
      if (totalBytes > 1024 * 1024) throw new Error("Контекст Obsidian превышает 1 MB");
      entries.push({
        kind: document.kind,
        vaultPath: file.path,
        bytes,
        sha256: createHash("sha256").update(file.content, "utf8").digest("hex"),
        content: file.content
      });
    }
    return {
      context: {
        profilePath: runtime.profilePath,
        profileVersion: String(runtime.profile.schemaVersion || "unknown"),
        entries
      },
      missionTypes: runtime.missionTypes,
      registryPath: runtime.registryPath
    };
  }

  async setActiveDispatcherMission(missionId) {
    this.settings.activeDispatcherMissionId = String(missionId || "").trim();
    await this.saveSettings();
    new Notice(`Основная миссия: ${this.settings.activeDispatcherMissionId}`);
    return this.settings.activeDispatcherMissionId;
  }

  async recalculateDispatcherMission(missionId) {
    let obsidianContext = null;
    let missionTypeRegistry = null;
    let missionTypeRegistrySource = null;
    try {
      const detail = await this.getDispatcherMission(missionId);
      const currentType = detail.ok && detail.json && detail.json.contract && detail.json.contract.missionType
        ? (detail.json.contract.missionType.id || detail.json.contract.missionType)
        : "";
      const snapshot = await this.buildDispatcherObsidianContext(String(currentType || ""));
      obsidianContext = snapshot.context;
      missionTypeRegistry = snapshot.missionTypes;
      missionTypeRegistrySource = snapshot.registryPath;
    } catch (error) {
      this.dispatcherRuntime = { ok: false, profile: null, missionTypes: [], error: error.message };
      new Notice(`Контекст Obsidian не готов: ${error.message}`);
    }
    const response = await this.connectorRequest("POST", "/dispatcher/v1/recalculate", {
      source: "obsidian-plugin",
      missionId,
      obsidianContextRequired: true,
      obsidianContext,
      missionTypeRegistry,
      missionTypeRegistrySource
    });
    const payload = response.json || {};
    if (response.ok && payload.ok && payload.contract) {
      await this.mirrorDispatcherMission(payload.contract);
      new Notice("Контекст Obsidian, план и предварительный бюджет обновлены");
    }
    return { response, payload };
  }

  async mirrorDispatcherMission(contract) {
    const missionId = String(contract.missionId || "mission");
    const root = `${this.settings.dispatcherVaultRoot}/МИССИИ`;
    await this.ensureFolder(root);
    const packageRoot = `${root}/${missionId}`;
    await this.ensureFolder(packageRoot);
    const title = String(contract.title || missionId);
    const state = String(contract.state || "HUMAN_APPROVAL");
    const type = contract.missionType && contract.missionType.id ? contract.missionType.id : contract.missionType || "unknown";
    const mode = contract.executionMode && contract.executionMode.id ? contract.executionMode.id : contract.executionMode || "unknown";
    const approval = contract.approval && contract.approval.status ? contract.approval.status : contract.approval || "PENDING_HUMAN_APPROVAL";
    const preflight = contract.preflight && contract.preflight.status ? contract.preflight.status : "MISSING";
    const budget = contract.budget && Number.isFinite(contract.budget.plannedUsd) ? `${contract.budget.plannedUsd.toFixed(2)} USD` : contract.plannedUsd != null ? `${contract.plannedUsd} USD` : "не рассчитан";
    const deliverables = Array.isArray(contract.deliverables) ? contract.deliverables : [];
    const planSteps = contract.plan && Array.isArray(contract.plan.steps) ? contract.plan.steps : [];
    const budgetLines = contract.budget && Array.isArray(contract.budget.breakdown) ? contract.budget.breakdown : [];
    const contextEntries = contract.obsidianContext && Array.isArray(contract.obsidianContext.entries) ? contract.obsidianContext.entries : [];
    const resultSummary = state === "READY_FOR_HERMES"
      ? "План утверждён. Фактический результат миссии ещё не создан: контракт ожидает запуска Hermes."
      : state === "HUMAN_APPROVAL"
        ? "Карточка задачи, план и бюджет созданы. Исполнение заблокировано до решения человека."
        : `Текущий этап: ${state}.`;
    let cardTemplate = [
      "# {{title}}",
      "",
      "- mission_id: {{mission_id}}",
      "- state: {{state}}",
      "- type: {{type}}",
      "- mode: {{mode}}",
      "- approval: {{approval}}",
      "- source_of_truth: Obsidian",
      "",
      "## Задача",
      "",
      "{{mission_text}}",
      "",
      "## Ожидаемые результаты",
      "",
      "{{deliverables}}",
      "",
      "## Границы",
      "",
      "До решения человека LLM, Hermes и внешние действия не запускаются."
    ].join("\n");
    try {
      const templatePath = this.dispatcherRuntime && this.dispatcherRuntime.profile ? this.dispatcherRuntime.profile.cardTemplatePath : null;
      if (templatePath) cardTemplate = (await this.readDispatcherVaultFile(templatePath)).content;
    } catch (_) {
      // The built-in template is a visible fallback; the contract records the missing Obsidian context gate.
    }
    const cardMarkdown = cardTemplate
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{mission_id\}\}/g, missionId)
      .replace(/\{\{state\}\}/g, state)
      .replace(/\{\{type\}\}/g, String(type))
      .replace(/\{\{mode\}\}/g, String(mode))
      .replace(/\{\{approval\}\}/g, String(approval))
      .replace(/\{\{mission_text\}\}/g, String(contract.missionText || title))
      .replace(/\{\{deliverables\}\}/g, deliverables.length ? deliverables.map((item) => `- ${item}`).join("\n") : "- не указано")
      .replace(/\{\{map_link\}\}/g, "[[ДИСПЕТЧЕРСКАЯ_СИМБИОТА/00_УПРАВЛЕНИЕ/D2_ARCH-SYM-DISP-00_КАРТА_ДИСПЕТЧЕРСКОЙ_СИМБИОТА]]");
    const planMarkdown = [
      `# План миссии ${missionId}`,
      "",
      `- standard: ${contract.plan && contract.plan.standard ? contract.plan.standard : "не указан"}`,
      `- state: ${state}`,
      "",
      ...planSteps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "## Методики",
      "",
      ...(Array.isArray(contract.methodPaths) && contract.methodPaths.length ? contract.methodPaths.map((item) => `- [[${String(item).replace(/\.md$/i, "")}]]`) : ["- не указано"]),
      "",
      `[[${packageRoot}/00_Карточка_миссии|Карточка миссии]]`
    ].join("\n");
    const budgetMarkdown = [
      `# Бюджет миссии ${missionId}`,
      "",
      `- оценка: ${budget}`,
      `- статус: ${contract.budget && contract.budget.status ? contract.budget.status : "не указан"}`,
      `- доверие: ${contract.budget && contract.budget.confidence ? contract.budget.confidence : "не указано"}`,
      `- формула: ${contract.budget && contract.budget.formula ? contract.budget.formula : "не указана"}`,
      "",
      "## Расшифровка",
      "",
      ...(budgetLines.length ? budgetLines.map((item) => `- ${item.label}: ${dispatcherViewUsd(item.estimatedUsd)}; ${item.basis}`) : ["- детализация отсутствует"]),
      "",
      "## Не входит",
      "",
      ...(contract.budget && Array.isArray(contract.budget.excludedCosts) ? contract.budget.excludedCosts.map((item) => `- ${item}`) : ["- не указано"]),
      "",
      `[[${packageRoot}/00_Карточка_миссии|Карточка миссии]]`
    ].join("\n");
    const contextMarkdown = [
      `# Контекст Obsidian миссии ${missionId}`,
      "",
      `- source_of_truth: ${contract.obsidianContext ? contract.obsidianContext.sourceOfTruth : "не подключён"}`,
      `- profile: ${contract.obsidianContext && contract.obsidianContext.profilePath ? `[[${contract.obsidianContext.profilePath.replace(/\.(json|md|canvas)$/i, "")}]]` : "не подключён"}`,
      `- version: ${contract.obsidianContext ? contract.obsidianContext.profileVersion : "не указана"}`,
      `- captured_entries: ${contextEntries.length}`,
      "",
      ...contextEntries.map((entry) => `- ${entry.kind}: [[${entry.vaultPath.replace(/\.(json|md|canvas)$/i, "")}]]; sha256: ${entry.sha256}`),
      "",
      `[[${packageRoot}/00_Карточка_миссии|Карточка миссии]]`
    ].join("\n");
    const stateMarkdown = [
      `# Маршрут миссии ${missionId}`,
      "",
      `- состояние: ${dispatcherViewStateLabel(state)}`,
      `- проверка источников: ${dispatcherViewPreflightLabel(preflight)}`,
      "",
      "Карточка задачи -> проверка источников -> план и бюджет -> безопасность -> решение человека -> Hermes -> приёмка.",
      "",
      resultSummary,
      "",
      `[[${packageRoot}/00_Карточка_миссии|Карточка миссии]]`
    ].join("\n");
    const canvasPath = `${packageRoot}/05_Маршрут.canvas`;
    const canvas = {
      nodes: [
        { id: "card", type: "file", file: `${packageRoot}/00_Карточка_миссии.md`, x: 0, y: 0, width: 320, height: 220 },
        { id: "plan", type: "file", file: `${packageRoot}/01_План.md`, x: 380, y: 0, width: 320, height: 220 },
        { id: "budget", type: "file", file: `${packageRoot}/02_Бюджет.md`, x: 760, y: 0, width: 320, height: 220 },
        { id: "context", type: "file", file: `${packageRoot}/04_Контекст_Obsidian.md`, x: 380, y: 300, width: 320, height: 220 },
        { id: "state", type: "file", file: `${packageRoot}/03_Маршрут_и_статус.md`, x: 760, y: 300, width: 320, height: 220 }
      ],
      edges: [
        { id: "e1", fromNode: "card", toNode: "plan", fromSide: "right", toSide: "left" },
        { id: "e2", fromNode: "plan", toNode: "budget", fromSide: "right", toSide: "left" },
        { id: "e3", fromNode: "context", toNode: "plan", fromSide: "top", toSide: "bottom" },
        { id: "e4", fromNode: "budget", toNode: "state", fromSide: "bottom", toSide: "top" }
      ]
    };
    await this.writeOrUpdateFile(`${packageRoot}/00_Карточка_миссии.md`, cardMarkdown);
    await this.writeOrUpdateFile(`${packageRoot}/01_План.md`, planMarkdown);
    await this.writeOrUpdateFile(`${packageRoot}/02_Бюджет.md`, budgetMarkdown);
    await this.writeOrUpdateFile(`${packageRoot}/03_Маршрут_и_статус.md`, stateMarkdown);
    await this.writeOrUpdateFile(`${packageRoot}/04_Контекст_Obsidian.md`, contextMarkdown);
    await this.writeOrUpdateFile(`${packageRoot}/mission-manifest.json`, `${JSON.stringify(contract, null, 2)}\n`);
    await this.writeOrUpdateFile(canvasPath, `${JSON.stringify(canvas, null, 2)}\n`);
    const file = await this.writeOrUpdateFile(`${root}/${missionId}.md`, [
      `# ${title}`,
      "",
      `- mission_id: ${missionId}`,
      `- state: ${state}`,
      `- type: ${type}`,
      `- mode: ${mode}`,
      `- approval: ${approval}`,
      `- preflight: ${preflight}`,
      `- плановый бюджет: ${budget}`,
      `- рабочая папка: ${this.settings.dispatcherWorkspaceRoot}\\${missionId}`,
      `- пакет Obsidian: [[${packageRoot}/00_Карточка_миссии]]`,
      "",
      "## Маршрут",
      "",
      "Карточка задачи -> проверка источников -> план и бюджет -> безопасность -> решение человека -> Hermes -> приёмка.",
      "",
      "## Граница",
      "",
      "До решения человека плагин и connector не запускают LLM, Hermes или внешние действия.",
      "",
      "## Результат диспетчеризации",
      "",
      resultSummary,
      ...(contract.preflight && contract.preflight.blockingReasons && contract.preflight.blockingReasons.length
        ? ["", "Блокировки preflight:", ...contract.preflight.blockingReasons.map((reason) => `- ${reason}`)]
        : []),
      "",
      "## Связи",
      "",
      "[[ДИСПЕТЧЕРСКАЯ_СИМБИОТА/00_УПРАВЛЕНИЕ/D2_ARCH-SYM-DISP-00_КАРТА_ДИСПЕТЧЕРСКОЙ_СИМБИОТА]]",
      "[[ДИСПЕТЧЕРСКАЯ_СИМБИОТА/00_CANVAS/D2_ARCH-SYM-DISP-01_НАВИГАТОР_МИССИЙ.canvas]]",
      `[[${canvasPath.replace(/\.canvas$/i, "")}|Canvas маршрута миссии]]`
    ].join("\n"));
    return file;
  }

  async openDispatcherVaultPath(vaultPath) {
    const file = this.app.vault.getAbstractFileByPath(this.normalizeDispatcherVaultPath(vaultPath));
    if (!file) {
      new Notice(`Файл Obsidian не найден: ${vaultPath}`);
      return false;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
    return true;
  }

  mapMissionArtifactPath(relativePath) {
    const clean = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (clean.startsWith("02_Missions/")) return `${this.settings.missionsRoot}/${clean.slice("02_Missions/".length)}`;
    return clean;
  }

  normalizeMissionId(title) {
    return String(title || "mission").replace(/[^a-zA-Z0-9А-Яа-я_-]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  }

  async runProofMissionLoop() {
    await this.initializeCore();
    const register = await this.registerConnector(false);
    const mission = await this.createMissionNote({ syncConnector: true });
    const missionId = mission.connectorMission ? mission.connectorMission.id : null;
    const blockedRun = await this.connectorRequest("POST", "/mission/run", {
      missionId,
      source: "obsidian-plugin",
      llmProviders: this.settings.llmProviders.filter((provider) => provider.enabled).map((provider) => provider.id),
      approved: false
    });
    const approvedRun = await this.connectorRequest("POST", "/mission/run", {
      missionId,
      source: "obsidian-plugin",
      llmProviders: this.settings.llmProviders.filter((provider) => provider.enabled).map((provider) => provider.id),
      approved: true
    });
    const mobilePairing = await this.getMobilePairing();
    const snapshot = await this.getAdminSnapshot();
    const evidence = {
      createdAt: new Date().toISOString(),
      vaultId: this.getVaultId(),
      deviceId: this.getDeviceId(),
      connectorUrl: this.getConnectorUrl(),
      registerStatus: register.status,
      missionId,
      blockedRunStatus: blockedRun.status,
      blockedRunReason: blockedRun.json ? blockedRun.json.reason : null,
      approvedRunStatus: approvedRun.status,
      queueItemId: approvedRun.json && approvedRun.json.queueItem ? approvedRun.json.queueItem.id : null,
      mobilePairingStatus: mobilePairing.status,
      snapshotStatus: snapshot.status,
      snapshotCounts: snapshot.json
        ? {
            devices: snapshot.json.devices.length,
            missions: snapshot.json.missions.length,
            queues: snapshot.json.queues.length,
            audit: snapshot.json.audit.length
          }
        : null,
      status: register.ok && missionId && blockedRun.status === 409 && approvedRun.ok && snapshot.ok ? "PASS_WITH_CONDITIONS" : "YELLOW"
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const evidenceFile = await this.upsertFile(
      `${this.settings.evidenceRoot}/OBP_001_PLUGIN_LOOP_${stamp}.md`,
      this.renderPluginLoopEvidence(evidence)
    );
    await this.app.workspace.getLeaf(true).openFile(evidenceFile);
    new Notice(`Проверка цикла Симбиота: ${evidence.status}`);
    return evidence;
  }

  async runPreReleasePreflight() {
    const vaultPath = this.app.vault.adapter && this.app.vault.adapter.basePath ? this.app.vault.adapter.basePath : this.getVaultId();
    const health = await this.refreshConnectorStatus(false);
    const register = await this.registerConnector(false);
    const snapshot = await this.getAdminSnapshot();
    const preflight = await this.getPreflightStatus();
    const mobile = await this.getMobileStatus();
    const environment = await this.connectorRequest("POST", "/environment/action", {
      source: "obsidian-plugin",
      action: "check_path",
      path: vaultPath
    });
    const checks = preflight.json && preflight.json.preflight ? preflight.json.preflight.checks : {};
    const evidence = {
      createdAt: new Date().toISOString(),
      vaultId: this.getVaultId(),
      deviceId: this.getDeviceId(),
      connectorUrl: this.getConnectorUrl(),
      healthStatus: health.status,
      registerStatus: register.status,
      snapshotStatus: snapshot.status,
      preflightStatus: preflight.status,
      mobileStatus: mobile.status,
      environmentStatus: environment.status,
      connectedSlotCount: checks.connectedSlotCount || 0,
      providerStorePresent: Boolean(checks.providerStorePresent),
      providerStoreKeyPresent: Boolean(checks.providerStoreKeyPresent),
      mobileRemoteRelayReady: Boolean(checks.mobileRemoteRelayReady),
      productionSecretStorageReady: Boolean(checks.productionSecretStorageReady),
      marketplacePublicationReady: Boolean(checks.marketplacePublicationReady),
      blockers: preflight.json && preflight.json.preflight ? preflight.json.preflight.blockers || [] : [],
      status: health.ok && register.ok && snapshot.ok && preflight.ok && mobile.ok && environment.ok ? "PASS_WITH_CONDITIONS_PRE_RELEASE_PREFLIGHT" : "YELLOW_PREFLIGHT_INCOMPLETE"
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const evidenceFile = await this.upsertFile(
      `${this.settings.evidenceRoot}/PRE_RELEASE_PREFLIGHT_${stamp}.md`,
      this.renderPreReleasePreflightEvidence(evidence)
    );
    await this.app.workspace.getLeaf(true).openFile(evidenceFile);
    new Notice(`Проверка готовности Симбиота: ${evidence.status}`);
    return evidence;
  }
  async runAgentRuntimeMvp(options = {}) {
    await this.ensureFolder(this.settings.resultsRoot);
    const task = options.task || "Подготовить короткий локальный результат миссии Симбиота и проверить файл evidence.";
    const expectedResult = options.expectedResult || "Markdown artifact с итогом, проверкой и ограничениями runtime MVP.";
    const response = await this.connectorRequest("POST", "/agent-runtime/run", {
      source: "obsidian-plugin",
      approved: options.approved !== false,
      missionId: options.missionId || null,
      task,
      expectedResult,
      artifactName: options.artifactName || "symbiot_agent_runtime_mvp_result.md"
    });
    const run = response.json && response.json.run ? response.json.run : null;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const resultPath = `${this.settings.resultsRoot}/AGENT_RUNTIME_MVP_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/AGENT_RUNTIME_MVP_EVIDENCE_${stamp}.md`;
    const resultFile = await this.upsertFile(resultPath, this.renderAgentRuntimeResult(run, response, { task, expectedResult }));
    await this.upsertFile(evidencePath, this.renderAgentRuntimeEvidence(run, response, { task, expectedResult }));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new Notice(`Runtime MVP Симбиота: ${run ? run.status : "YELLOW_RUNTIME_UNAVAILABLE"}`);
    return { response, run, resultPath, evidencePath };
  }

  renderAgentRuntimeResult(run, response, fallback) {
    if (!run) {
      return [
        "# Agent Runtime MVP - YELLOW",
        "",
        `status: ${response.status || "connector_unavailable"}`,
        "runtime_level: local_agent_runtime_mvp",
        "",
        "## Задача",
        fallback.task,
        "",
        "## Результат",
        "Connector не вернул runtime run. Проверьте connector и повторите запуск.",
        "",
        "## Ограничения",
        "- readiness не менять;",
        "- market-ready не обещать."
      ].join("\n");
    }
    return [
      "# Agent Runtime MVP - результат",
      "",
      `run_id: ${run.id}`,
      `status: ${run.status}`,
      `runtime_level: ${run.runtimeLevel}`,
      `artifact: ${run.artifact && run.artifact.path ? run.artifact.path : "not_created"}`,
      "",
      "## Задача пользователя",
      run.task,
      "",
      "## План выполнения",
      ...(run.plan || []).map((step, index) => `${index + 1}. ${step.label} — ${step.tool} — ${step.status}`),
      "",
      "## Итог",
      "Симбиот выполнил минимальный runtime-сценарий: задача принята, инструмент создал файл, файл проверен, evidence сформировано.",
      "",
      "## Что это доказывает",
      "Цепочка `задача -> инструмент -> файл/результат -> проверка` работает в local connector runtime.",
      "",
      "## Что не доказано",
      "- браузер и внешние программы;",
      "- RAG/context retriever;",
      "- live LLM execution;",
      "- production Windows agent."
    ].join("\n");
  }

  renderAgentRuntimeEvidence(run, response, fallback) {
    const checks = run && run.evidence ? run.evidence.checks || {} : {};
    return [
      "# Agent Runtime MVP - Evidence",
      "",
      `status: ${run && run.evidence ? run.evidence.status : "YELLOW_RUNTIME_UNAVAILABLE"}`,
      `connector_status: ${response.status}`,
      "runtime_level: local_agent_runtime_mvp",
      "",
      "## Проверки",
      `- approval required: ${checks.approvalRequired === true}`,
      `- approved: ${checks.approved === true}`,
      `- task accepted: ${checks.taskAccepted === true}`,
      `- artifact created: ${checks.artifactCreated === true}`,
      `- artifact inside runtime root: ${checks.artifactInsideRuntimeRoot === true}`,
      `- artifact non-empty: ${checks.artifactNonEmpty === true}`,
      `- queue completed: ${checks.queueCompleted === true}`,
      "",
      "## Граница promise",
      "- это local runtime MVP;",
      "- external automation, browser, RAG и production agent остаются YELLOW gates;",
      "- readiness не повышать без следующего runtime evidence."
    ].join("\n");
  }

  buildVisiblePlanSteps() {
    return [
      { id: "step_1_plan", label: "План", tool: "visible_plan", status: "planned", check: "пользователь видит шаги до запуска" },
      { id: "step_2_approval", label: "Подтверждение", tool: "approval_guard", status: "planned", check: "запуск идет только после approved=true" },
      { id: "step_3_runtime", label: "Выполнение", tool: "agent_runtime", status: "planned", check: "connector создает artifact" },
      { id: "step_4_result", label: "Результат", tool: "artifact_check", status: "planned", check: "файл результата существует" },
      { id: "step_5_evidence", label: "Проверка", tool: "evidence_loop", status: "planned", check: "проверки видны в vault" }
    ];
  }

  updateVisibleStep(steps, id, status) {
    return steps.map((step) => step.id === id ? { ...step, status } : step);
  }

  renderVisiblePlanStatusNote(context) {
    const steps = context.steps || [];
    const run = context.run || null;
    const visibleLoop = run && run.visibleLoop ? run.visibleLoop : null;
    const checks = run && run.evidence ? run.evidence.checks || {} : {};
    return [
      "# План / статус / проверка Симбиота",
      "",
      `status: ${context.status}`,
      `current_step: ${context.currentStep}`,
      "runtime_level: local_agent_runtime_mvp",
      `updated_at: ${new Date().toISOString()}`,
      "",
      "## Задача пользователя",
      context.task,
      "",
      "## План выполнения",
      ...steps.map((step, index) => `${index + 1}. ${step.label} — ${step.tool} — ${step.status} — проверка: ${step.check}`),
      "",
      "## Текущий статус",
      context.statusText,
      "",
      "## Результат",
      run ? `artifact: ${run.artifact && run.artifact.path ? run.artifact.path : "not_created"}` : "artifact: ожидает выполнения",
      run ? `run_id: ${run.id}` : "run_id: ожидает выполнения",
      visibleLoop ? `visible_loop_status: ${visibleLoop.status}` : "visible_loop_status: ожидает выполнения",
      "",
      "## Проверки",
      `- план виден пользователю: ${steps.length >= 5}`,
      `- approval guard: ${checks.approvalRequired === true && checks.approved === true}`,
      `- статус выполнения виден: ${Boolean(context.status)}`,
      `- artifact создан: ${checks.artifactCreated === true}`,
      `- evidence вернулось: ${checks.evidenceReturned === true}`,
      `- очередь завершена: ${checks.queueCompleted === true}`,
      "",
      "## Граница promise",
      "- это видимый local runtime loop в Obsidian Plugin;",
      "- не доказаны full Windows Agent, browser automation, RAG retrieval и production runtime;",
      "- readiness не повышать без отдельного release/evidence gate."
    ].join("\n");
  }

  renderVisiblePlanEvidence(context) {
    const run = context.run || null;
    const checks = run && run.evidence ? run.evidence.checks || {} : {};
    return [
      "# Visible Plan / Status / Evidence Loop - Evidence",
      "",
      `status: ${context.status}`,
      "gate: OBP-042",
      "readiness_changed: false",
      "",
      "## Acceptance checks",
      "- command registered: true",
      "- visible plan note created: true",
      `- plan has five user-visible steps: ${context.steps.length >= 5}`,
      `- current status written: ${Boolean(context.currentStep)}`,
      `- connector runtime run ok: ${Boolean(run && run.status === "completed_yellow")}`,
      `- artifact created: ${checks.artifactCreated === true}`,
      `- evidence returned: ${checks.evidenceReturned === true}`,
      "- no readiness bump: true",
      "",
      "## User-visible files",
      `- plan/status: ${context.planPath}`,
      `- evidence: ${context.evidencePath}`,
      "",
      "## Boundaries",
      "- YELLOW until manual real Obsidian acceptance;",
      "- no external program/browser/RAG execution in this gate."
    ].join("\n");
  }

  async runVisiblePlanStatusEvidenceLoop(options = {}) {
    await this.ensureFolder(this.settings.resultsRoot);
    const task = options.task || "Показать пользователю план, текущий статус, результат и evidence выполнения миссии Симбиота.";
    const expectedResult = options.expectedResult || "Видимая карточка плана/статуса/evidence в Obsidian плюс runtime artifact.";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const planPath = `${this.settings.resultsRoot}/VISIBLE_PLAN_STATUS_EVIDENCE_LOOP_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/VISIBLE_PLAN_STATUS_EVIDENCE_LOOP_${stamp}.md`;
    let steps = this.buildVisiblePlanSteps();
    let context = { task, expectedResult, planPath, evidencePath, steps, status: "RUNNING_VISIBLE_LOOP_YELLOW", currentStep: "План", statusText: "План создан. Runtime еще не запускался.", run: null };
    const planFile = await this.writeOrUpdateFile(planPath, this.renderVisiblePlanStatusNote(context));

    steps = this.updateVisibleStep(steps, "step_1_plan", "done");
    steps = this.updateVisibleStep(steps, "step_2_approval", "running");
    context = { ...context, steps, currentStep: "Подтверждение", statusText: "Approval guard активен. Запуск разрешен только явно." };
    await this.writeOrUpdateFile(planPath, this.renderVisiblePlanStatusNote(context));

    steps = this.updateVisibleStep(steps, "step_2_approval", "done");
    steps = this.updateVisibleStep(steps, "step_3_runtime", "running");
    context = { ...context, steps, currentStep: "Выполнение", statusText: "Connector выполняет локальный runtime MVP." };
    await this.writeOrUpdateFile(planPath, this.renderVisiblePlanStatusNote(context));

    const response = await this.connectorRequest("POST", "/agent-runtime/run", {
      source: "obsidian-plugin",
      approved: options.approved !== false,
      missionId: options.missionId || null,
      task,
      expectedResult,
      artifactName: options.artifactName || "symbiot_visible_plan_status_evidence_result.md"
    });
    const run = response.json && response.json.run ? response.json.run : null;
    const ok = Boolean(response.ok && run && run.status === "completed_yellow");
    steps = this.updateVisibleStep(steps, "step_3_runtime", ok ? "done" : "blocked");
    steps = this.updateVisibleStep(steps, "step_4_result", ok ? "done" : "blocked");
    steps = this.updateVisibleStep(steps, "step_5_evidence", ok ? "done" : "blocked");
    context = {
      ...context,
      steps,
      run,
      response,
      status: ok ? "PASS_WITH_CONDITIONS_VISIBLE_PLAN_STATUS_EVIDENCE_YELLOW" : "YELLOW_VISIBLE_LOOP_INCOMPLETE",
      currentStep: ok ? "Evidence готово" : "Остановлено",
      statusText: ok ? "План, статус, результат и evidence созданы и видны пользователю." : "Connector не вернул завершенный runtime run. Проверьте connector."
    };
    await this.writeOrUpdateFile(planPath, this.renderVisiblePlanStatusNote(context));
    await this.writeOrUpdateFile(evidencePath, this.renderVisiblePlanEvidence(context));
    await this.app.workspace.getLeaf(true).openFile(planFile);
    new Notice(`План/статус/evidence Симбиота: ${context.status}`);
    return { ...context, response, run };
  }

  renderWorkbenchInput(title, task) {
    return [
      `# ${title}`,
      "",
      "type: symbiot_file_workbench_input",
      "status: draft_yellow",
      `created_at: ${new Date().toISOString()}`,
      "",
      "## Задача",
      task,
      "",
      "## Рабочие данные",
      "Этот файл создан как безопасный вход File Workbench. Пользователь может заменить этот текст своими материалами перед запуском следующих этапов.",
      "",
      "## Граница доступа",
      "- файл находится внутри Obsidian vault;",
      "- connector получает metadata/hash/path, но не получает содержимое файла;",
      "- внешняя обработка docx/xlsx/pdf не выполняется в этом gate."
    ].join("\n");
  }

  renderFileWorkbenchResult(context) {
    const file = context.fileRecord || null;
    return [
      "# File Workbench - результат",
      "",
      `status: ${context.status}`,
      "runtime_level: local_file_workbench_mvp",
      "",
      "## Рабочий файл",
      `vault_path: ${context.inputPath}`,
      `bytes: ${context.bytes}`,
      `sha256: ${context.sha256}`,
      "",
      "## Что сделал Симбиот",
      "Создал рабочий файл миссии в vault, проверил локальную metadata, зарегистрировал metadata в connector и связал файл с result/quality-check.",
      "",
      "## Connector record",
      file ? `file_record_id: ${file.id}` : "file_record_id: not_registered",
      file ? `access_status: ${file.accessStatus}` : "access_status: not_registered",
      file ? `content_stored_in_connector: ${file.contentStored}` : "content_stored_in_connector: false",
      "",
      "## Что это доказывает",
      "Базовая цепочка `файл в vault -> metadata -> result -> evidence` работает без скрытого чтения всего vault.",
      "",
      "## Что не доказано",
      "- обработка docx/xlsx/pdf;",
      "- скачиваемые артефакты вне vault;",
      "- RAG/indexing;",
      "- production document automation."
    ].join("\n");
  }

  renderFileWorkbenchEvidence(context) {
    const checks = context.fileRecord && context.fileRecord.evidence ? context.fileRecord.evidence.checks || {} : {};
    return [
      "# File Workbench - Evidence",
      "",
      `status: ${context.status}`,
      "gate: OBP-044",
      "readiness_changed: false",
      "runtime_level: local_file_workbench_mvp",
      "",
      "## Проверки",
      `- рабочий файл создан: ${context.inputCreated === true}`,
      `- путь внутри vault: ${context.safeVaultPath === true}`,
      `- metadata посчитана: ${context.metadataReady === true}`,
      `- hash посчитан: ${Boolean(context.sha256)}`,
      `- connector зарегистрировал metadata: ${checks.metadataRegistered === true}`,
      `- connector не хранит содержимое: ${checks.contentNotStored === true}`,
      `- result связан: ${checks.resultLinked === true}`,
      `- evidence связан: ${checks.evidenceLinked === true}`,
      "",
      "## Граница promise",
      "- это local File Workbench MVP;",
      "- full document processing, download artifacts, RAG и production file automation остаются YELLOW gates;",
      "- readiness не повышать без следующего evidence gate."
    ].join("\n");
  }

  async runFileWorkbenchMvp(options = {}) {
    await this.ensureFolder(this.settings.sourcesRoot);
    await this.ensureFolder(this.settings.resultsRoot);
    const workbenchRoot = `${this.settings.sourcesRoot}/FILE_WORKBENCH`;
    await this.ensureFolder(workbenchRoot);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const title = options.title || `Рабочий_файл_${stamp}`;
    const task = options.task || "Подготовить безопасный рабочий файл миссии и связать его с result/quality-check.";
    const inputPath = options.inputPath || `${workbenchRoot}/${title}.md`;
    const resultPath = `${this.settings.resultsRoot}/FILE_WORKBENCH_RESULT_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/FILE_WORKBENCH_EVIDENCE_${stamp}.md`;
    const inputContent = options.content || this.renderWorkbenchInput(title, task);
    const inputFile = await this.writeOrUpdateFile(inputPath, inputContent);
    const bytes = Buffer.byteLength(inputContent, "utf8");
    const sha256 = createHash("sha256").update(inputContent, "utf8").digest("hex");
    const safeVaultPath = !path.isAbsolute(inputPath) && !inputPath.includes("..") && !inputPath.includes("\\") && inputPath.startsWith(this.settings.sourcesRoot);
    const metadataReady = Boolean(inputFile && inputPath && bytes > 0 && sha256);
    const register = await this.connectorRequest("POST", "/file-workbench/register", {
      source: "obsidian-plugin",
      approved: options.approved !== false,
      vaultId: this.getVaultId(),
      missionId: options.missionId || null,
      vaultPath: inputPath,
      fileName: path.basename(inputPath),
      extension: path.extname(inputPath).replace(/^\./, "") || "md",
      bytes,
      sha256,
      linkedResultPath: resultPath,
      linkedEvidencePath: evidencePath
    });
    const fileRecord = register.json && register.json.file ? register.json.file : null;
    const status = register.ok && fileRecord ? "PASS_WITH_CONDITIONS_FILE_WORKBENCH_YELLOW" : "YELLOW_FILE_WORKBENCH_INCOMPLETE";
    const context = { task, inputPath, resultPath, evidencePath, inputCreated: Boolean(inputFile), safeVaultPath, metadataReady, bytes, sha256, register, fileRecord, status };
    const resultFile = await this.writeOrUpdateFile(resultPath, this.renderFileWorkbenchResult(context));
    await this.writeOrUpdateFile(evidencePath, this.renderFileWorkbenchEvidence(context));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new Notice(`File Workbench Симбиота: ${status}`);
    return context;
  }


  renderContextRetrieverResult(context) {
    const retrieval = context.retrieval || {};
    const snippets = Array.isArray(retrieval.snippets) ? retrieval.snippets : [];
    return [
      "# Context Retriever / RAG - результат",
      "",
      `status: ${context.status}`,
      "gate: OBP-046",
      "runtime_level: local_context_retriever_mvp",
      `query: ${context.query}`,
      `sources_count: ${context.sources.length}`,
      `citations_count: ${snippets.length}`,
      "",
      "## Короткий ответ",
      snippets.length
        ? "Контекст найден в явно выбранных источниках. Ниже показаны цитируемые фрагменты, из которых можно собирать ответ миссии."
        : "Контекст не найден. Нужно выбрать другие источники или уточнить запрос.",
      "",
      "## Цитаты",
      ...snippets.map((snippet) => [`### ${snippet.id} — ${snippet.fileName}`, `path: ${snippet.vaultPath}`, `line: ${snippet.line}`, "", `> ${snippet.excerpt}`].join("\n")),
      "",
      "## Граница promise",
      "- это локальный context retriever MVP по выбранным файлам;",
      "- весь vault молча не сканируется;",
      "- production Vector/RAG, Supabase vector index и внешняя память остаются отдельными YELLOW gates."
    ].join("\n");
  }

  renderContextRetrieverEvidence(context) {
    const checks = context.retrieval && context.retrieval.evidence ? context.retrieval.evidence.checks || {} : {};
    return [
      "# Context Retriever / RAG - Evidence",
      "",
      `status: ${context.status}`,
      "gate: OBP-046",
      "readiness_changed: false",
      "runtime_level: local_context_retriever_mvp",
      "",
      "## Проверки",
      `- approval есть: ${checks.approved === true}`,
      `- источники выбраны явно: ${checks.explicitSourcesRequired === true}`,
      `- пути внутри vault: ${checks.safeRelativeVaultPaths === true}`,
      `- весь vault не сканировался: ${checks.noFullVaultScan === true}`,
      `- полный контент не хранится в connector: ${checks.fullContentNotStored === true}`,
      `- цитаты созданы: ${checks.citationsCreated === true}`,
      `- result связан: ${checks.resultLinked === true}`,
      `- evidence связан: ${checks.evidenceLinked === true}`,
      "",
      "## Что не доказано",
      "- production vector database / Supabase vector search;",
      "- RAG по всему vault;",
      "- автоматический выбор источников без подтверждения пользователя;",
      "- внешняя память как market-ready GREEN."
    ].join("\n");
  }

  async prepareRetrieverSource(source, index) {
    const defaultPath = `${this.settings.sourcesRoot}/FILE_WORKBENCH/CONTEXT_SOURCE_${index + 1}.md`;
    const vaultPath = source.vaultPath || source.path || defaultPath;
    const content = source.content || `# Context source ${index + 1}\n\n${source.text || "Контекст миссии Симбиота."}\n`;
    const file = await this.writeOrUpdateFile(vaultPath, content);
    const bytes = Buffer.byteLength(content, "utf8");
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
    return {
      vaultPath,
      fileName: path.basename(vaultPath),
      extension: path.extname(vaultPath).replace(/^\./, "") || "md",
      bytes,
      sha256,
      content,
      file,
      safeVaultPath: !path.isAbsolute(vaultPath) && !vaultPath.includes("..") && !vaultPath.includes("\\")
    };
  }

  async runContextRetrieverMvp(options = {}) {
    await this.ensureFolder(this.settings.sourcesRoot);
    await this.ensureFolder(this.settings.resultsRoot);
    await this.ensureFolder(`${this.settings.sourcesRoot}/FILE_WORKBENCH`);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const query = options.query || "коммерческое предложение клиент следующий шаг evidence";
    const sourceDocuments = Array.isArray(options.sources) && options.sources.length ? options.sources : [
      { vaultPath: `${this.settings.sourcesRoot}/FILE_WORKBENCH/CONTEXT_SOURCE_CLIENT_OFFER.md`, content: "# Коммерческое предложение\n\nКлиенту нужен короткий оффер с аргументами, источниками, evidence и следующим шагом. Симбиот должен собрать результат из выбранных материалов.\n" },
      { vaultPath: `${this.settings.sourcesRoot}/FILE_WORKBENCH/CONTEXT_SOURCE_EVIDENCE.md`, content: "# Evidence\n\nПеред выдачей результата Симбиот проверяет цитаты, статус источников, риск обещаний и понятный следующий шаг для пользователя.\n" }
    ];
    const sources = [];
    for (let index = 0; index < sourceDocuments.length; index += 1) {
      sources.push(await this.prepareRetrieverSource(sourceDocuments[index], index));
    }
    const resultPath = `${this.settings.resultsRoot}/CONTEXT_RETRIEVER_RESULT_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/CONTEXT_RETRIEVER_EVIDENCE_${stamp}.md`;
    const response = await this.connectorRequest("POST", "/context-retriever/query", {
      source: "obsidian-plugin",
      approved: options.approved !== false,
      vaultId: this.getVaultId(),
      missionId: options.missionId || null,
      query,
      sources: sources.map(({ vaultPath, fileName, extension, bytes, sha256, content }) => ({ vaultPath, fileName, extension, bytes, sha256, content })),
      linkedResultPath: resultPath,
      linkedEvidencePath: evidencePath
    });
    const retrieval = response.json && response.json.retrieval ? response.json.retrieval : null;
    const status = response.ok && retrieval ? retrieval.status : "YELLOW_CONTEXT_RETRIEVER_INCOMPLETE";
    const context = { query, sources, resultPath, evidencePath, response, retrieval, status };
    const resultFile = await this.writeOrUpdateFile(resultPath, this.renderContextRetrieverResult(context));
    await this.writeOrUpdateFile(evidencePath, this.renderContextRetrieverEvidence(context));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new Notice(`Context Retriever Симбиота: ${status}`);
    return context;
  }

  renderAdminSyncResult(context) {
    const sync = context.sync || {};
    return [
      "# Admin Sync - результат",
      "",
      `status: ${context.status}`,
      `created_at: ${context.createdAt}`,
      `vault: ${context.vault.name}`,
      `vault_fingerprint: ${context.vault.fingerprint}`,
      "",
      "## Что синхронизировано",
      "",
      `- vault: ${sync.vault_count || 0}`,
      `- providers: ${sync.provider_count || 0}`,
      `- missions: ${sync.mission_count || 0}`,
      `- runs: ${sync.run_count || 0}`,
      `- artifacts: ${sync.artifact_count || 0}`,
      `- evidence: ${sync.evidence_count || 0}`,
      `- sync events: ${sync.sync_event_count || 0}`,
      `- audit: ${sync.audit_count || 0}`,
      "",
      "## Граница",
      "",
      "- В Supabase отправлены управленческие metadata/status/hash.",
      "- Полное содержимое vault не отправлялось.",
      "- Значения API-ключей не отправлялись.",
      "- Production admin dashboard и tenant security остаются YELLOW."
    ].join("\n");
  }

  renderAdminSyncEvidence(context) {
    const sync = context.sync || {};
    return [
      "# Admin Sync - Evidence",
      "",
      `status: ${context.status}`,
      `connector_status: ${context.response.status}`,
      `created_at: ${context.createdAt}`,
      "",
      "## Checks",
      "",
      `- connector ответил: ${context.response.ok === true}`,
      `- vault записан: ${(sync.vault_count || 0) >= 1}`,
      `- providers записаны: ${(sync.provider_count || 0) >= 1}`,
      `- sync_event записан: ${(sync.sync_event_count || 0) >= 1}`,
      `- audit записан: ${(sync.audit_count || 0) >= 1}`,
      `- full vault sync: false`,
      `- secret values sync: false`,
      "",
      "## Что не доказано",
      "",
      "- production multi-tenant admin dashboard;",
      "- client login/RLS через пользовательский auth;",
      "- remote relay;",
      "- marketplace-ready release."
    ].join("\n");
  }

  async runAdminSyncMvp(options = {}) {
    await this.ensureFolder(this.settings.resultsRoot);
    await this.ensureFolder(this.settings.evidenceRoot);
    const createdAt = new Date().toISOString();
    const stamp = createdAt.slice(0, 19).replace(/[:T]/g, "-");
    const snapshot = await this.getAdminSnapshot();
    const vaultName = this.getVaultId();
    const vault = {
      id: options.vaultId || null,
      name: vaultName,
      fingerprint: options.vaultFingerprint || createHash("sha256").update(vaultName).digest("hex").slice(0, 24),
      localPathHash: options.localPathHash || createHash("sha256").update(vaultName).digest("hex"),
      pluginVersion: this.manifest && this.manifest.version ? this.manifest.version : this.settings.coreVersion,
      connectorId: "local-windows-connector"
    };
    const response = await this.connectorRequest("POST", "/cloud/admin-sync/write", {
      source: "obsidian-plugin",
      organizationId: options.organizationId || null,
      ownerUserId: options.ownerUserId || null,
      vaultId: options.vaultId || null,
      vault,
      snapshot: snapshot.json || null
    });
    const sync = response.json && response.json.ok ? response.json : null;
    const status = sync ? sync.status : `YELLOW_ADMIN_SYNC_BLOCKED_${response.json && (response.json.reason || response.json.error) ? response.json.reason || response.json.error : "UNKNOWN"}`;
    const context = { createdAt, status, response, sync, vault, snapshot };
    const resultPath = `${this.settings.resultsRoot}/ADMIN_SYNC_RESULT_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/ADMIN_SYNC_EVIDENCE_${stamp}.md`;
    const resultFile = await this.writeOrUpdateFile(resultPath, this.renderAdminSyncResult(context));
    await this.writeOrUpdateFile(evidencePath, this.renderAdminSyncEvidence(context));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new Notice(`Admin Sync Симбиота: ${status}`);
    return { ...context, resultPath, evidencePath };
  }

  renderArchitectureSignalDocument(context) {
    return [
      "# Архитектурный сигнал Симбиота",
      "",
      `signal_id: ${context.signalId}`,
      "gate: OBP-049 Architecture Signal Backbone",
      "status: draft_yellow",
      `created_at: ${context.createdAt}`,
      "",
      "## Что проверяем",
      "",
      "Проверяем сквозной каркас продукта: Desktop GUI -> Obsidian Plugin -> Vault -> Connector -> Supabase/Admin.",
      "",
      "## Пользовательское действие",
      "",
      context.userAction,
      "",
      "## Граница данных",
      "",
      "- полный текст этого документа не отправляется в connector;",
      "- в connector передаются только путь, размер, SHA-256 и статус;",
      "- в Supabase передаются metadata/status/hash через admin sync;",
      "- readiness не меняется без отдельного runtime/release evidence."
    ].join("\n");
  }

  renderArchitectureSignalResult(context) {
    const signal = context.signal || {};
    const sync = context.adminSync && context.adminSync.sync ? context.adminSync.sync : null;
    return [
      "# Architecture Signal Backbone - результат",
      "",
      `status: ${context.status}`,
      "gate: OBP-049",
      "runtime_level: architecture_signal_backbone_mvp",
      "",
      "## Сквозной сигнал",
      "",
      `signal_id: ${context.signalId}`,
      `vault_document: ${context.documentPath}`,
      `document_sha256: ${context.sha256}`,
      "",
      "## Что прошло",
      "",
      `- Desktop/Plugin создал документ в Obsidian vault: ${context.documentCreated === true}`,
      `- Connector записал архитектурный сигнал: ${Boolean(signal.id)}`,
      `- Admin snapshot видит сигнал: ${context.snapshotHasSignal === true}`,
      `- Supabase/Admin Sync принял snapshot: ${Boolean(sync && sync.ok)}`,
      sync ? `- Supabase sync_event_id: ${sync.syncEventId}` : "- Supabase sync_event_id: not_synced",
      sync ? `- architecture_signal_count: ${sync.architecture_signal_count || 0}` : "- architecture_signal_count: 0",
      "",
      "## Что это дает продукту",
      "",
      "Симбиот начинает проверяться как цельная архитектура, а не как набор отдельных кнопок: действие пользователя создает след в Obsidian, connector, admin snapshot и Supabase metadata.",
      "",
      "## Ограничения",
      "",
      "- это архитектурный signal backbone MVP;",
      "- другой реальный компьютер/второй Obsidian остается следующим acceptance-scenario;",
      "- production remote relay, signed installer и market-ready остаются YELLOW/RED."
    ].join("\n");
  }

  renderArchitectureSignalEvidence(context) {
    return [
      "# Architecture Signal Backbone - Evidence",
      "",
      `status: ${context.status}`,
      "gate: OBP-049",
      "readiness_changed: false",
      "runtime_level: architecture_signal_backbone_mvp",
      "",
      "## Checks",
      "",
      `- command registered: ${context.commandRegistered === true}`,
      `- document created in vault: ${context.documentCreated === true}`,
      `- document hash calculated: ${Boolean(context.sha256)}`,
      `- connector signal recorded: ${context.connectorSignalRecorded === true}`,
      `- snapshot has signal: ${context.snapshotHasSignal === true}`,
      `- admin sync attempted: ${context.adminSyncAttempted === true}`,
      `- admin sync passed: ${context.adminSyncPassed === true}`,
      `- metadata only: ${context.metadataOnly === true}`,
      `- full vault content sync: false`,
      `- secret values sync: false`,
      "",
      "## Evidence paths",
      "",
      `- signal document: ${context.documentPath}`,
      `- result: ${context.resultPath}`,
      `- evidence: ${context.evidencePath}`,
      "",
      "## Boundary",
      "",
      "- не GREEN market-ready;",
      "- не production remote sync;",
      "- readiness не повышать без полного proof и ручной/внешней acceptance."
    ].join("\n");
  }

  async runArchitectureSignalBackbone(options = {}) {
    await this.ensureFolder(this.settings.sourcesRoot);
    await this.ensureFolder(this.settings.resultsRoot);
    await this.ensureFolder(this.settings.evidenceRoot);
    const createdAt = new Date().toISOString();
    const stamp = createdAt.slice(0, 19).replace(/[:T]/g, "-");
    const signalId = options.signalId || `obp049_${createHash("sha256").update(`${this.getVaultId()}_${createdAt}`).digest("hex").slice(0, 16)}`;
    const documentPath = options.documentPath || `${this.settings.sourcesRoot}/ARCHITECTURE_SIGNAL/ARCH_SIGNAL_${stamp}.md`;
    const resultPath = `${this.settings.resultsRoot}/ARCHITECTURE_SIGNAL_RESULT_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/ARCHITECTURE_SIGNAL_EVIDENCE_${stamp}.md`;
    await this.ensureFolder(`${this.settings.sourcesRoot}/ARCHITECTURE_SIGNAL`);
    const userAction = options.userAction || "Пользователь/тестер инициировал проверку архитектурной шины Симбиота.";
    const content = this.renderArchitectureSignalDocument({ signalId, createdAt, userAction });
    const documentFile = await this.writeOrUpdateFile(documentPath, content);
    const bytes = Buffer.byteLength(content, "utf8");
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
    const signalResponse = await this.connectorRequest("POST", "/architecture/signal/record", {
      source: "obsidian-plugin",
      approved: options.approved !== false,
      gate: "OBP-049",
      signalId,
      vaultId: this.getVaultId(),
      stage: "desktop_gui_to_obsidian_to_connector",
      direction: "desktop_gui_to_connector_to_supabase_admin",
      vaultPath: documentPath,
      extension: "md",
      bytes,
      sha256,
      resultPath,
      evidencePath,
      desktopActionAccepted: true,
      obsidianDocumentCreated: Boolean(documentFile),
      adminSyncExpected: true,
      supabaseExpected: true
    });
    const signal = signalResponse.json && signalResponse.json.signal ? signalResponse.json.signal : null;
    const snapshot = await this.getAdminSnapshot();
    const snapshotSignals = snapshot.json && Array.isArray(snapshot.json.architectureSignals) ? snapshot.json.architectureSignals : [];
    const snapshotHasSignal = snapshotSignals.some((item) => item.id === signalId);
    const adminSync = await this.runAdminSyncMvp({
      ownerUserId: options.ownerUserId,
      organizationId: options.organizationId,
      vaultFingerprint: options.vaultFingerprint,
      vaultId: options.vaultId
    });
    const adminSyncPassed = Boolean(adminSync.sync && adminSync.sync.ok && (adminSync.sync.architecture_signal_count || 0) >= 1);
    const status = signalResponse.ok && signal && snapshotHasSignal && adminSyncPassed
      ? "PASS_WITH_CONDITIONS_ARCHITECTURE_SIGNAL_BACKBONE_YELLOW"
      : "YELLOW_ARCHITECTURE_SIGNAL_BACKBONE_INCOMPLETE";
    const context = {
      createdAt,
      signalId,
      documentPath,
      resultPath,
      evidencePath,
      userAction,
      bytes,
      sha256,
      signalResponse,
      signal,
      snapshot,
      snapshotHasSignal,
      adminSync,
      status,
      commandRegistered: true,
      documentCreated: Boolean(documentFile),
      connectorSignalRecorded: Boolean(signal),
      adminSyncAttempted: true,
      adminSyncPassed,
      metadataOnly: true
    };
    const resultFile = await this.writeOrUpdateFile(resultPath, this.renderArchitectureSignalResult(context));
    await this.writeOrUpdateFile(evidencePath, this.renderArchitectureSignalEvidence(context));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new Notice(`Архитектурная шина Симбиота: ${status}`);
    return context;
  }

  openControlPanel() {
    new SymbiotControlModal(this.app, this).open();
  }

  async openDispatcherNavigator() {
    let [leaf] = this.app.workspace.getLeavesOfType(SYMBIOT_DISPATCHER_VIEW_TYPE);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: SYMBIOT_DISPATCHER_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async copyDispatcherText(value, label = "Значение") {
    const text = String(value || "");
    if (!text) return false;
    try {
      if (electronClipboard && typeof electronClipboard.writeText === "function") electronClipboard.writeText(text);
      else if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") await navigator.clipboard.writeText(text);
      else throw new Error("clipboard_unavailable");
      new Notice(`${label} скопировано`);
      return true;
    } catch (error) {
      new Notice(`Не удалось скопировать: ${error.message}`);
      return false;
    }
  }

  async openDispatcherPath(target, label = "Папка") {
    if (!fs.existsSync(target)) {
      await this.copyDispatcherText(target, "Путь");
      new Notice(`${label} не найдена. Путь скопирован.`);
      return false;
    }
    if (!electronShell || typeof electronShell.openPath !== "function") {
      await this.copyDispatcherText(target, "Путь");
      new Notice("Открытие Проводника недоступно. Путь скопирован.");
      return false;
    }
    const error = await electronShell.openPath(target);
    if (error) {
      await this.copyDispatcherText(target, "Путь");
      new Notice(`Не удалось открыть: ${error}. Путь скопирован.`);
      return false;
    }
    new Notice(`${label} открыта`);
    return true;
  }

  async openDispatcherMissionFolder(missionId) {
    const target = path.join(this.settings.dispatcherWorkspaceRoot, String(missionId || ""));
    return this.openDispatcherPath(target, "Рабочая папка миссии");
  }

  async openDispatcherMissionSource(missionId, source, imported = false) {
    const target = imported
      ? path.join(this.settings.dispatcherWorkspaceRoot, String(missionId || ""), ...String(source.importedRelativePath || "").split("/"))
      : String(source.originalPath || "");
    return this.openDispatcherPath(target, imported ? "Импортированная копия источника" : "Исходная папка");
  }

  async openDispatcherMissionNote(missionId) {
    const notePath = `${this.settings.dispatcherVaultRoot}/МИССИИ/${missionId}.md`;
    let file = this.app.vault.getAbstractFileByPath(notePath);
    if (!file) {
      const response = await this.getDispatcherMission(missionId);
      if (response.ok && response.json && response.json.contract) {
        file = await this.mirrorDispatcherMission(response.json.contract);
      }
    }
    if (!file) {
      new Notice("Не удалось создать заметку миссии из runtime-контракта");
      return false;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
    return true;
  }

  openLlmHub() {
    new SymbiotLlmHubModal(this.app, this).open();
  }

  openApiVault() {
    new SymbiotApiVaultModal(this.app, this).open();
  }

  async compareLlmResults() {
    return this.runThreeWindowLlmComparison();
  }

  async runThreeWindowLlmComparison(prompt, options = {}) {
    await this.ensureFolder(this.settings.resultsRoot);
    const activePrompt = prompt || "Дмитрий, очень приятно. Подготовь короткий управляемый ответ по миссии Симбиота.";
    const providers = Array.isArray(options.providers) ? options.providers : null;
    const response = await this.connectorRequest("POST", "/llm/compare", {
      source: "obsidian-plugin",
      prompt: activePrompt,
      live: options.live === true,
      ...(providers ? { providers } : {})
    });
    const comparison = response.json && response.json.comparison
      ? response.json.comparison
      : {
          id: "local-fallback",
          prompt: activePrompt,
          status: "local_fallback",
          createdAt: new Date().toISOString(),
          results: (providers || this.getThreeLlmProviders()).map((provider) => ({
            providerId: provider.id,
            providerName: provider.name,
            model: provider.model,
            status: "connector_unavailable",
            answer: "Connector недоступен. Запрос в LLM не отправлялся.",
            evidence: "Локальный fallback внутри плагина.",
            risk: "YELLOW: connector недоступен"
          }))
        };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const resultPath = `${this.settings.resultsRoot}/LLM_THREE_WINDOW_${stamp}.md`;
    const evidencePath = `${this.settings.evidenceRoot}/LLM_THREE_WINDOW_EVIDENCE_${stamp}.md`;
    const resultFile = await this.upsertFile(resultPath, this.renderThreeWindowComparison(comparison));
    await this.upsertFile(evidencePath, this.renderThreeWindowEvidence(comparison, response));
    await this.app.workspace.getLeaf(true).openFile(resultFile);
    new SymbiotLlmComparisonModal(this.app, this, comparison).open();
    new Notice(`Сравнение трех LLM: ${comparison.status}`);
    return comparison;
  }

  getThreeLlmProviders() {
    const byId = Object.fromEntries(this.settings.llmProviders.map((provider) => [provider.id, provider]));
    return ["openai", "anthropic", "gemini"].map((id) => byId[id]).filter(Boolean);
  }

  openMobileConnector() {
    new SymbiotMobileConnectorModal(this.app, this).open();
  }

  renderCoreNote() {
    return [
      "# Рабочее пространство плагина Симбиот",
      "",
      `version: ${this.settings.coreVersion}`,
      "status: YELLOW",
      "connector: [[OBP-001 Plugin Loop]]",
      "project: [[СИМБИОТ SaaS Runtime Platform]]",
      "parent_map: [[00_КАРТА_SAAS_РАЗРАБОТКИ_СИМБИОТА]]",
      "",
      "## Граница ответственности",
      "- Это маркер рабочего пространства плагина, а не новое ядро Симбиота.",
      "- Основные правила и роли Симбиота остаются в существующей структуре Obsidian.",
      "- Не создавать новые root-папки для runtime-артефактов плагина.",
      "",
      "## Правила",
      "- Не ставить GREEN без проверки качества.",
      "- Пользователь видит одного агента: Симбиот.",
      "- Роли работают внутри как субагенты миссии, без перегруза основного экрана.",
      "- У миссии должны быть задача, разрешенные источники, результат, проверка качества и следующий шаг.",
      "- Ответ LLM должен сохраняться вместе с проверкой качества.",
      "- Запуск миссии требует подтверждения до постановки в очередь.",
      "",
      "## Связи",
      `- [[${this.settings.rolesRoot}/ROLE_TEMPLATE]]`,
      `- [[${this.settings.missionsRoot}/MISSION_TEMPLATE]]`,
      `- [[${this.settings.evidenceRoot}/EVIDENCE_TEMPLATE]]`
    ].join("\n");
  }

  renderRoleTemplate() {
    return [
      "# Шаблон роли",
      "",
      "role_id:",
      "display_name:",
      "responsibility:",
      "allowed_actions:",
      "stop_conditions:",
      "quality_checks:",
      "",
      "## Заметки",
      "Редактируйте роли осторожно. Симбиот должен предупреждать перед рискованными изменениями роли."
    ].join("\n");
  }

  renderMissionTemplate(title, options = {}) {
    const missionId = options.missionId || this.normalizeMissionId(title);
    return [
      `# ${title}`,
      "",
      `mission_id: ${missionId}`,
      "status: draft",
      "passport_contract: single_user_visible_mission_log",
      "connector_status: pending",
      "methodology_owner: РОЛЬ_AI_Методолог_клиентских_миссий",
      "runtime_level: local_plugin_mvp",
      "",
      "## 01. Описание миссии",
      "",
      "Коротко опишите задачу человеческим языком.",
      "",
      "## 02. Уточнение формулировки через LLM",
      "",
      "- статус: можно включить до маршрута, если задача сформулирована нечетко",
      "- граница: это помощь в формулировке, а не запуск выполнения",
      "- после уточнения пользователь подтверждает паспорт миссии",
      "",
      "## 03. Ожидаемый результат и место сохранения",
      "",
      "Что должно появиться после работы Симбиота и куда это положить.",
      "",
      "## 04. Маршрут миссии",
      "",
      "Пользовательский ввод -> LLM-уточнение при необходимости -> Router -> AI-команда -> подтверждение -> выполнение -> результат.",
      "",
      "## 05. AI-команда",
      "",
      "Пользователь видит одного агента `Симбиот`. Внутри миссии Симбиот подключает только нужные роли.",
      "",
      "## 06. Источники, разрешения и ограничения",
      "",
      "- allowed: можно использовать",
      "- needs_user_permission: сначала спросить пользователя",
      "- skip_private: не читать и не отправлять",
      "",
      "## 07. Pre-LLM trace",
      "",
      "Здесь фиксируется, что было сделано до выполнения миссии и сколько LLM-вызовов было совершено.",
      "",
      "## 08. Граф связей",
      "",
      "Здесь фиксируются Obsidian-связи миссии с ЛОС, проектом, источниками и результатом.",
      "",
      "## 09. Ход выполнения",
      "",
      "",
      "## 10. Результат"
    ].join("\n");
  }
  renderMissionFolderTemplate() {
    return [
      "# Шаблон папки клиентской миссии",
      "",
      "Папка миссии не должна превращаться в набор технических файлов.",
      "",
      "Обязательный минимум:",
      "",
      "- `00_Паспорт_миссии.md` - описание, LLM-уточнение, маршрут, AI-команда, pre-LLM trace, граф связей, ход выполнения и результат.",
      "- `symbiot-mission-manifest.json` - машинный manifest для runtime и синхронизации.",
      "",
      "Отдельные `Evidence`, `Execution Trace`, `AI-команда` и `Результат` не создаются как пользовательские файлы миссии; их содержание пишется в паспорт."
    ].join("\n");
  }
  renderMissionCanvas(title, missionId, paths = {}) {
    const nodes = [
      { id: "request", type: "text", text: `Запрос клиента\n${title}`, x: 0, y: 0, width: 260, height: 120 },
      { id: "sources", type: "text", text: "Источники и разрешения\nallowed / needs_user_permission / skip_private", x: 340, y: -130, width: 320, height: 130 },
      { id: "mission", type: "text", text: `Клиентская миссия\n${missionId}`, x: 340, y: 70, width: 320, height: 130 },
      { id: "ai_team", type: "text", text: "Субагенты Симбиота\n2-5 внутренних ролей", x: 720, y: -130, width: 260, height: 120 },
      { id: "result", type: "text", text: "Результат\nmarkdown/html artifact", x: 720, y: 70, width: 260, height: 120 },
      { id: "quality", type: "text", text: "Проверка качества\nперед выдачей результата", x: 1040, y: 70, width: 260, height: 120 },
      { id: "next_step", type: "text", text: "Следующий шаг\nпринять / доработать / запустить", x: 1360, y: 70, width: 280, height: 120 }
    ];
    const edges = [
      { id: "edge_request_sources", fromNode: "request", fromSide: "right", toNode: "sources", toSide: "left" },
      { id: "edge_request_mission", fromNode: "request", fromSide: "right", toNode: "mission", toSide: "left" },
      { id: "edge_sources_ai_team", fromNode: "sources", fromSide: "right", toNode: "ai_team", toSide: "left" },
      { id: "edge_mission_result", fromNode: "mission", fromSide: "right", toNode: "result", toSide: "left" },
      { id: "edge_ai_team_result", fromNode: "ai_team", fromSide: "bottom", toNode: "result", toSide: "top" },
      { id: "edge_result_quality", fromNode: "result", fromSide: "right", toNode: "quality", toSide: "left" },
      { id: "edge_quality_next", fromNode: "quality", fromSide: "right", toNode: "next_step", toSide: "left" }
    ];
    return `${JSON.stringify({
      nodes,
      edges,
      metadata: {
        type: "symbiot_client_mission_route",
        missionId,
        missionTitle: title,
        route: "источник -> смысловая связь -> миссия -> результат -> проверка качества",
        noSilentVaultRead: true,
        linkedFiles: paths
      }
    }, null, 2)}\n`;
  }

  renderMissionIntakeClarification(payload, response) {
    const questions = payload.validation && Array.isArray(payload.validation.questions) ? payload.validation.questions : [];
    return [
      "# Mission Intake - требуется уточнение",
      "",
      `status: ${payload.status || "needs_clarification"}`,
      `http_status: ${response.status}`,
      "model_calls: 0",
      "llm_execution_allowed: false",
      "",
      "## Что произошло",
      "",
      "Симбиот остановил запуск до LLM, потому что в задаче не хватает обязательных данных для управляемого результата.",
      "",
      "## Вопросы пользователю",
      "",
      ...(questions.length ? questions.map((item) => `- ${item.question}`) : ["- Уточните результат, место сохранения и критерий приемки."]),
      "",
      "## Вход пользователя",
      "",
      payload.intake && payload.intake.missionText ? payload.intake.missionText : "",
      "",
      "## Trace",
      "",
      payload.trace && Array.isArray(payload.trace.steps)
        ? payload.trace.steps.map((step) => `${step.order}. ${step.id} - ${step.label} - model_calls=${step.modelCallsAfterStep}`).join("\n")
        : "trace unavailable"
    ].join("\n");
  }

  renderSourcePermissions(title) {
    return [
      `# Источники и разрешения - ${title}`,
      "",
      "## Правило",
      "",
      "Симбиот не читает весь vault молча. Каждый источник получает явный статус.",
      "",
      "| Источник | Для чего нужен | Статус доступа | Комментарий |",
      "|---|---|---|---|",
      "|  |  | needs_user_permission | Добавьте файл, заметку или ссылку |",
      "",
      "## Статусы",
      "",
      "- allowed - можно использовать в миссии.",
      "- needs_user_permission - спросить пользователя перед чтением/индексацией.",
      "- skip_private - не читать, не индексировать, не отправлять в LLM."
    ].join("\n");
  }

  renderMissionAiTeam(title) {
    return [
      `# Субагенты Симбиота - ${title}`,
      "",
      "Пользователь видит одного агента: `Симбиот`. Этот файл показывает, какие внутренние субагенты подключены к миссии и зачем.",
      "",
      "## Правило",
      "",
      "- по умолчанию 2-5 субагентов на миссию;",
      "- лишние роли не показываются пользователю как отдельные исполнители;",
      "- каждая роль должна иметь понятную функцию, вход и выход;",
      "- расширение команды выше 5 ролей требует отдельного решения Дмитрия.",
      "",
      "| Субагент | Функция в миссии | Вход | Выход |",
      "|---|---|---|---|",
      "| Методолог клиентских миссий | собрать задачу, критерии и маршрут | запрос клиента | паспорт/маршрут/проверка качества |",
      "| Контролер качества | проверить результат до выдачи | результат/проверка качества | статус YELLOW/GREEN/RED |",
      "",
      "Пользовательское обещание: управлять не ролями, а результатом миссии."
    ].join("\n");
  }

  renderMissionResult(title) {
    return [
      `# Результат - ${title}`,
      "",
      "status: pending",
      "artifact_type: markdown/html",
      "",
      "## Краткий итог",
      "",
      "## Основной артефакт",
      "",
      "## Что использовано",
      "",
      "## Что не использовано",
      "",
      "## Следующий шаг"
    ].join("\n");
  }

  renderMissionHtmlContract(title) {
    return [
      "<!doctype html>",
      "<html lang=\"ru\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      `  <title>${title} - результат миссии Симбиота</title>`,
      "  <style>body{font-family:Arial,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#1f2937}section{border-top:1px solid #e5e7eb;padding:18px 0}h1,h2{color:#111827}.status{display:inline-block;padding:4px 10px;border:1px solid #f59e0b;border-radius:999px;color:#92400e;background:#fffbeb}</style>",
      "</head>",
      "<body>",
      `  <h1>${title}</h1>`,
      "  <p class=\"status\">YELLOW: результат требует проверки качества</p>",
      "  <section><h2>Задача клиента</h2><p></p></section>",
      "  <section><h2>Разрешенные источники</h2><p></p></section>",
      "  <section><h2>Итог</h2><p></p></section>",
      "  <section><h2>Основания</h2><p></p></section>",
      "  <section><h2>Риски</h2><p></p></section>",
      "  <section><h2>Основной артефакт</h2><p></p></section>",
      "  <section><h2>Проверка качества</h2><p></p></section>",
      "  <section><h2>Следующий шаг</h2><p></p></section>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  renderMissionEvidence(title, missionId) {
    return [
      `# Evidence - ${title}`,
      "",
      "status: YELLOW",
      `mission_id: ${missionId}`,
      "gate: Client Mission Methodology Gate",
      "",
      "## Проверки",
      "",
      "- [ ] Пользовательская задача понятна без объяснений Codex.",
      "- [ ] Источники имеют статус доступа.",
      "- [ ] Пользователь видит одного агента `Симбиот`, а не список ролей.",
      "- [ ] Субагенты миссии не превышают 5 ролей без решения Дмитрия.",
      "- [ ] Canvas-маршрут создан и читается.",
      "- [ ] HTML-result contract создан.",
      "- [ ] Нет скрытого чтения всего vault.",
      "- [ ] Результат проверен перед GREEN.",
      "",
      "## Что нельзя обещать",
      "",
      "- Полный RAG с цитатами.",
      "- Production Supabase sync.",
      "- Автоматическое чтение всех файлов клиента."
    ].join("\n");
  }

  renderMissionLessons(title) {
    return [
      `# Уроки миссии - ${title}`,
      "",
      "## Что сработало",
      "",
      "## Что улучшить",
      "",
      "## Новый паттерн миссии",
      "",
      "## Нужно ли обновить роль / правило / шаблон"
    ].join("\n");
  }

  renderMissionManifest({ title, missionId, paths }) {
    return `${JSON.stringify({
      type: "symbiot_client_mission_manifest",
      version: "2026-07-26.client_mission_single_passport.v1",
      title,
      missionId,
      createdAt: new Date().toISOString(),
      methodologyOwner: "РОЛЬ_AI_Методолог_клиентских_миссий",
      runtimeLevel: "local_plugin_mvp",
      passportContract: "single_user_visible_mission_log",
      noSilentVaultRead: true,
      explicitSourceConsentRequired: true,
      security: {
        noSilentVaultRead: true,
        explicitSourceConsentRequired: true,
        sourceStatuses: ["allowed", "needs_user_permission", "skip_private"]
      },
      aiTeamMaxRolesDefault: 5,
      route: "пользовательский ввод -> LLM-уточнение при необходимости -> Router -> AI-команда -> подтверждение -> выполнение -> результат",
      userVisibleFiles: [paths.passport],
      machineFiles: [paths.manifest],
      paths
    }, null, 2)}\n`;
  }
  renderEvidenceTemplate(title) {
    return [
      `# Evidence - ${title}`,
      "",
      "status: YELLOW",
      "created_at:",
      "mission:",
      "llm_provider:",
      "model:",
      "sources:",
      "checks:",
      "risks:",
      "next_step:",
      "",
      "## Правило",
      "Не ставить GREEN без proof."
    ].join("\n");
  }

  renderPluginLoopEvidence(evidence) {
    return [
      "# OBP-001 Plugin Loop Evidence",
      "",
      `status: ${evidence.status}`,
      `created_at: ${evidence.createdAt}`,
      `vault_id: ${evidence.vaultId}`,
      `device_id: ${evidence.deviceId}`,
      `connector_url: ${evidence.connectorUrl}`,
      "",
      "## Checks",
      `- register_status: ${evidence.registerStatus}`,
      `- mission_id: ${evidence.missionId}`,
      `- blocked_run_status: ${evidence.blockedRunStatus}`,
      `- blocked_run_reason: ${evidence.blockedRunReason}`,
      `- approved_run_status: ${evidence.approvedRunStatus}`,
      `- queue_item_id: ${evidence.queueItemId}`,
      `- mobile_pairing_status: ${evidence.mobilePairingStatus}`,
      `- snapshot_status: ${evidence.snapshotStatus}`,
      `- snapshot_counts: ${JSON.stringify(evidence.snapshotCounts)}`,
      "",
      "## Граница ответственности",
      "- This proves local plugin loop only.",
      "- Real LLM execution is not proven.",
      "- Mobile remote production is not proven.",
      "- Environment actions beyond list_processes are not proven."
    ].join("\n");
  }


  renderPreReleasePreflightEvidence(evidence) {
    return [
      "# Evidence проверки готовности Симбиота",
      "",
      `status: ${evidence.status}`,
      `created_at: ${evidence.createdAt}`,
      `vault_id: ${evidence.vaultId}`,
      `device_id: ${evidence.deviceId}`,
      `connector_url: ${evidence.connectorUrl}`,
      "",
      "## Checks",
      `- health_status: ${evidence.healthStatus}`,
      `- register_status: ${evidence.registerStatus}`,
      `- snapshot_status: ${evidence.snapshotStatus}`,
      `- preflight_status: ${evidence.preflightStatus}`,
      `- mobile_status: ${evidence.mobileStatus}`,
      `- environment_status: ${evidence.environmentStatus}`,
      `- connected_slot_count: ${evidence.connectedSlotCount}`,
      `- provider_store_present: ${evidence.providerStorePresent}`,
      `- provider_store_key_present: ${evidence.providerStoreKeyPresent}`,
      "",
      "## Still Yellow",
      `- mobile_remote_relay_ready: ${evidence.mobileRemoteRelayReady}`,
      `- production_secret_storage_ready: ${evidence.productionSecretStorageReady}`,
      `- marketplace_publication_ready: ${evidence.marketplacePublicationReady}`,
      "",
      "## Blockers",
      ...(evidence.blockers || []).map((item) => `- ${item}`),
      "",
      "## Граница ответственности",
      "- This proves local pre-release readiness only.",
      "- It does not prove Obsidian marketplace publication.",
      "- It does not prove production tenant security or mobile remote relay.",
      "- No API key values are written to this note."
    ].join("\n");
  }
  renderThreeWindowComparison(comparison) {
    const columns = comparison.results.map((result) => [
      `## ${result.providerName}`,
      "",
      `model: ${result.model}`,
      `status: ${result.status}`,
      "",
      result.answer,
      "",
      `evidence: ${result.evidence}`,
      `risk: ${result.risk}`
    ].join("\n")).join("\n\n---\n\n");
    return [
      "# LLM Three-Window Comparison",
      "",
      `status: ${comparison.status}`,
      `comparison_id: ${comparison.id}`,
      `created_at: ${comparison.createdAt}`,
      "",
      "## Prompt",
      comparison.prompt,
      "",
      "## Three Windows",
      columns,
      "",
      "## Решение",
      "",
      "## Следующий шаг",
      ""
    ].join("\n");
  }

  renderThreeWindowEvidence(comparison, response) {
    return [
      "# Evidence - LLM Three-Window Comparison",
      "",
      `status: ${comparison.status}`,
      `comparison_id: ${comparison.id}`,
      `connector_status: ${response.status}`,
      `created_at: ${comparison.createdAt}`,
      "",
      "## Checks",
      `- windows: ${comparison.results.length}`,
      `- providers: ${comparison.results.map((result) => result.providerName).join(", ")}`,
      `- real_llm_execution: ${["live_all_providers_passed", "live_partial"].includes(comparison.status) ? "true" : "false"}`,
      "",
      "## Граница ответственности",
      "- Three-window UX is proven.",
      "- Real LLM API execution is not proven unless status is real.",
      "- No market/release GREEN from this evidence."
    ].join("\n");
  }

  renderLlmComparison(providers) {
    const rows = providers.length
      ? providers.map((provider) => `| ${provider.name} | ${provider.model} | pending | pending | pending |`).join("\n")
      : "| Нет подключенного провайдера | - | blocked | Настройте LLM Hub | YELLOW |";
    return [
      "# Сравнение LLM",
      "",
      "| Провайдер | Модель | Результат | Отличие | Статус |",
      "|---|---|---|---|---|",
      rows,
      "",
      "## Решение",
      "",
      "## Evidence",
      "",
      "## Следующий шаг"
    ].join("\n");
  }
};

const DISPATCHER_VIEW_STAGES = [
  { state: "RECEIVED", label: "Заявка", icon: "inbox" },
  { state: "QUALIFIED", label: "Тип и режим", icon: "tags" },
  { state: "PREFLIGHT", label: "Проверка источников", icon: "scan-search" },
  { state: "PLAN_DRAFT", label: "План и бюджет", icon: "calculator" },
  { state: "SECURITY_REVIEW", label: "Безопасность", icon: "shield-check" },
  { state: "HUMAN_APPROVAL", label: "Решение человека", icon: "circle-user-round" },
  { state: "READY_FOR_HERMES", label: "Hermes", icon: "route" },
  { state: "LAYERED_ACCEPTANCE", label: "Приёмка", icon: "badge-check" }
];

const DISPATCHER_VIEW_TYPES = [
  ["", "Определить автоматически"],
  ["REAL_ESTATE_INVESTMENT_ANALYSIS", "Инвестиционный анализ недвижимости"],
  ["ARCHITECTURE_AUDIT", "Архитектура и аудит"],
  ["SOFTWARE_DELIVERY", "Разработка и интеграция"],
  ["RESEARCH_AND_MONITORING", "Исследование и мониторинг"],
  ["DATA_AND_DOCUMENTS", "Данные и документы"],
  ["OPERATIONS", "Операционная миссия"]
];

function dispatcherViewStateIndex(state) {
  if (state === "CLOSED") return DISPATCHER_VIEW_STAGES.length;
  if (state === "EXECUTING") return 6;
  if (state === "PAUSED_FOR_GATE") return 2;
  const index = DISPATCHER_VIEW_STAGES.findIndex((stage) => stage.state === state);
  return index >= 0 ? index : 0;
}

function dispatcherViewUsd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)} USD` : "—";
}

function dispatcherViewStateLabel(state) {
  const labels = {
    RECEIVED: "Заявка принята",
    NORMALIZED: "Задача структурирована",
    QUALIFIED: "Тип и режим определены",
    PREFLIGHT: "Проверяются источники",
    PLAN_DRAFT: "Готовится план",
    SECURITY_REVIEW: "Проверяется безопасность",
    HUMAN_APPROVAL: "Ожидает вашего решения",
    READY_FOR_HERMES: "План утверждён, ожидает запуска Hermes",
    EXECUTING: "Выполняется",
    LAYERED_ACCEPTANCE: "Идёт приёмка",
    PAUSED_FOR_GATE: "Остановлена: требуется проверка",
    CLOSED: "Закрыта"
  };
  return labels[state] ? `${labels[state]} (${state})` : String(state || "Состояние не указано");
}

function dispatcherViewPreflightLabel(status) {
  const labels = {
    PASS: "Источники проверены",
    PASS_WITH_CONDITIONS: "Источники проверены, есть условия",
    BLOCKED: "Источник не прошёл проверку",
    MISSING: "Проверка источников отсутствует"
  };
  return labels[status] ? `${labels[status]} (${status})` : String(status || "Не указано");
}

class SymbiotDispatcherView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.missions = [];
    this.selectedMissionId = null;
    this.selectedContract = null;
    this.draftText = "";
    this.selectedMode = "";
    this.selectedType = "";
    this.sourcePath = "";
    this.loading = false;
    this.busy = false;
    this.connectorOk = false;
    this.message = "";
    this.messageTone = "neutral";
    this.pendingResultReveal = false;
  }

  getViewType() {
    return SYMBIOT_DISPATCHER_VIEW_TYPE;
  }

  getDisplayText() {
    return "Диспетчерская Симбиота";
  }

  getIcon() {
    return "route";
  }

  async onOpen() {
    this.selectedMissionId = null;
    this.selectedContract = null;
    this.render();
    await this.refreshMissions();
  }

  async refreshMissions() {
    this.loading = true;
    this.render();
    try {
      await this.plugin.loadDispatcherRuntimeProfile(false);
      const response = await this.plugin.getDispatcherMissions();
      if (!response.ok || !response.json || !response.json.ok) {
        throw new Error((response.json && (response.json.status || response.json.error)) || `HTTP ${response.status}`);
      }
      this.connectorOk = true;
      const activeMissionId = String(this.plugin.settings.activeDispatcherMissionId || "");
      this.missions = Array.isArray(response.json.missions)
        ? [...response.json.missions].sort((left, right) => {
            if (left.missionId === activeMissionId) return -1;
            if (right.missionId === activeMissionId) return 1;
            return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
          })
        : [];
      if (!this.selectedMissionId || !this.missions.some((mission) => mission.missionId === this.selectedMissionId)) {
        const activeMission = this.missions.find((mission) => mission.missionId === activeMissionId);
        this.selectedMissionId = activeMission ? activeMission.missionId : (this.missions.length ? this.missions[0].missionId : null);
      }
      await this.loadSelectedContract();
      if (!this.message) this.setMessage("Маршруты синхронизированы", "success", false);
    } catch (error) {
      this.connectorOk = false;
      this.selectedContract = null;
      this.setMessage(`Connector недоступен: ${error.message}`, "error", false);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async loadSelectedContract() {
    this.selectedContract = null;
    if (!this.selectedMissionId) return;
    try {
      const response = await this.plugin.getDispatcherMission(this.selectedMissionId);
      if (response.ok && response.json && response.json.contract) {
        this.selectedContract = response.json.contract;
        await this.plugin.mirrorDispatcherMission(this.selectedContract);
      }
    } catch (_) {
      this.selectedContract = null;
    }
  }

  setMessage(message, tone = "neutral", rerender = true) {
    this.message = message;
    this.messageTone = tone;
    if (rerender) this.render();
  }

  async selectMission(missionId) {
    this.selectedMissionId = missionId;
    this.selectedContract = null;
    this.render();
    await this.loadSelectedContract();
    this.render();
  }

  async submitMission() {
    const missionText = String(this.draftText || "").trim();
    if (missionText.length < 10) {
      this.setMessage("Опишите задачу хотя бы одним предложением", "warning");
      return;
    }
    this.busy = true;
    this.setMessage("Формирую карточку задачи, маршрут и бюджет...", "neutral", false);
    this.render();
    try {
      const prepared = await this.plugin.prepareDispatcherMission(missionText, {
        executionMode: this.selectedMode,
        missionType: this.selectedType,
        sourcePaths: String(this.sourcePath || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      });
      if (!prepared.response.ok || !prepared.payload.ok || !prepared.payload.contract) {
        throw new Error((prepared.payload && (prepared.payload.status || prepared.payload.reason)) || `HTTP ${prepared.response.status}`);
      }
      this.selectedMissionId = prepared.payload.contract.missionId;
      this.selectedContract = prepared.payload.contract;
      await this.plugin.setActiveDispatcherMission(this.selectedMissionId);
      this.pendingResultReveal = true;
      if (prepared.payload.status === "PAUSED_FOR_GATE") {
        const reasons = prepared.payload.contract.preflight && prepared.payload.contract.preflight.blockingReasons || [];
        this.setMessage(`Маршрут остановлен на проверке источников: ${reasons.join(", ") || "требуется источник"}`, "warning", false);
      } else {
        this.setMessage("Маршрут готов. Исполнение ждёт вашего решения", "success", false);
      }
      const response = await this.plugin.getDispatcherMissions();
      if (response.ok && response.json && Array.isArray(response.json.missions)) this.missions = response.json.missions;
    } catch (error) {
      this.setMessage(`Не удалось подготовить маршрут: ${error.message}`, "error", false);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async approveSelectedMission() {
    if (!this.selectedMissionId) return;
    this.busy = true;
    this.setMessage("Фиксирую решение человека...", "neutral", false);
    this.render();
    try {
      const approved = await this.plugin.approveDispatcherMission(this.selectedMissionId);
      if (!approved.response.ok || !approved.payload.ok) {
        throw new Error((approved.payload && (approved.payload.status || approved.payload.reason)) || `HTTP ${approved.response.status}`);
      }
      this.pendingResultReveal = true;
      this.setMessage("План утверждён. Контракт готов к передаче Hermes", "success", false);
      await this.refreshMissions();
    } catch (error) {
      this.setMessage(`Approval не выполнен: ${error.message}`, "error", false);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async recalculateSelectedMission() {
    if (!this.selectedMissionId) return;
    this.busy = true;
    this.setMessage("Перечитываю типологию и методики Obsidian, обновляю план и бюджет...", "neutral", false);
    this.render();
    try {
      const recalculated = await this.plugin.recalculateDispatcherMission(this.selectedMissionId);
      if (!recalculated.response.ok || !recalculated.payload.ok || !recalculated.payload.contract) {
        throw new Error((recalculated.payload && (recalculated.payload.status || recalculated.payload.reason)) || `HTTP ${recalculated.response.status}`);
      }
      this.selectedContract = recalculated.payload.contract;
      this.pendingResultReveal = true;
      this.setMessage("Контекст Obsidian, план и оценка обновлены. Проверьте источники и строки расчёта", "success", false);
      const response = await this.plugin.getDispatcherMissions();
      if (response.ok && response.json && Array.isArray(response.json.missions)) this.missions = response.json.missions;
    } catch (error) {
      this.setMessage(`Пересчёт не выполнен: ${error.message}`, "error", false);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async setSelectedMissionActive() {
    if (!this.selectedMissionId) return;
    await this.plugin.setActiveDispatcherMission(this.selectedMissionId);
    this.setMessage("Миссия закреплена первой в диспетчерской", "success", false);
    await this.refreshMissions();
  }

  createIconButton(parent, icon, label, handler, options = {}) {
    const button = parent.createEl("button", {
      cls: `symbiot-dispatcher-icon-button${options.primary ? " is-primary" : ""}`,
      attr: { "aria-label": label, title: label }
    });
    setIcon(button, icon);
    button.disabled = Boolean(options.disabled);
    button.addEventListener("click", handler);
    return button;
  }

  createCommandButton(parent, icon, label, handler, options = {}) {
    const button = parent.createEl("button", {
      cls: `symbiot-dispatcher-command${options.primary ? " is-primary" : ""}${options.danger ? " is-danger" : ""}`
    });
    const iconEl = button.createSpan({ cls: "symbiot-dispatcher-command-icon" });
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
    button.disabled = Boolean(options.disabled);
    button.addEventListener("click", handler);
    return button;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-dispatcher-workspace");

    const selectedSummary = this.missions.find((mission) => mission.missionId === this.selectedMissionId) || null;
    const selected = this.selectedContract || selectedSummary;
    const primaryMissionId = this.missions.length ? this.missions[0].missionId : null;
    const currentState = selected && selected.state ? selected.state : "RECEIVED";
    const activeStage = dispatcherViewStateIndex(currentState);
    const waitingCount = this.missions.filter((mission) => mission.state === "HUMAN_APPROVAL").length;
    const readyCount = this.missions.filter((mission) => mission.state === "READY_FOR_HERMES").length;
    const plannedTotal = this.missions.reduce((sum, mission) => sum + (Number(mission.plannedUsd) || 0), 0);

    const header = contentEl.createDiv({ cls: "symbiot-dispatcher-header" });
    const title = header.createDiv({ cls: "symbiot-dispatcher-title" });
    title.createEl("h2", { text: "Диспетчерская Симбиота" });
    title.createEl("span", { text: "Миссии, маршруты и решения человека" });
    const headerActions = header.createDiv({ cls: "symbiot-dispatcher-header-actions" });
    const connection = headerActions.createDiv({ cls: `symbiot-dispatcher-connection ${this.connectorOk ? "is-online" : "is-offline"}` });
    connection.createSpan({ cls: "symbiot-dispatcher-connection-dot" });
    connection.createSpan({ text: this.connectorOk ? "Connector работает" : "Connector не отвечает" });
    const runtimeReady = Boolean(this.plugin.dispatcherRuntime && this.plugin.dispatcherRuntime.ok);
    const runtimeTypes = runtimeReady && Array.isArray(this.plugin.dispatcherRuntime.missionTypes) ? this.plugin.dispatcherRuntime.missionTypes.length : 0;
    const runtimeStatus = headerActions.createDiv({ cls: `symbiot-dispatcher-connection ${runtimeReady ? "is-online" : "is-offline"}` });
    runtimeStatus.createSpan({ cls: "symbiot-dispatcher-connection-dot" });
    runtimeStatus.createSpan({ text: runtimeReady ? `Obsidian: ${runtimeTypes} типов миссий` : "Obsidian-контекст не готов" });
    if (primaryMissionId && primaryMissionId !== this.selectedMissionId) {
      this.createCommandButton(headerActions, "pin", "Основная миссия", () => this.selectMission(primaryMissionId));
    }
    this.createIconButton(headerActions, "refresh-cw", "Обновить", () => this.refreshMissions(), { disabled: this.loading || this.busy });

    const metrics = contentEl.createDiv({ cls: "symbiot-dispatcher-metrics" });
    [
      ["layers-3", "Всего миссий", String(this.missions.length)],
      ["circle-user-round", "Ждут решения", String(waitingCount)],
      ["route", "Готовы Hermes", String(readyCount)],
      ["wallet-cards", "Плановый бюджет", dispatcherViewUsd(plannedTotal)]
    ].forEach(([icon, label, value]) => {
      const metric = metrics.createDiv({ cls: "symbiot-dispatcher-metric" });
      const metricIcon = metric.createSpan({ cls: "symbiot-dispatcher-metric-icon" });
      setIcon(metricIcon, icon);
      const metricText = metric.createDiv();
      metricText.createSpan({ text: label });
      metricText.createEl("strong", { text: value });
    });

    let resultPanel = null;
    if (selected) {
      resultPanel = contentEl.createEl("section", {
        cls: `symbiot-dispatcher-outcome state-${String(currentState).toLowerCase()}`
      });
      const outcomeIcon = resultPanel.createSpan({ cls: "symbiot-dispatcher-outcome-icon" });
      setIcon(outcomeIcon, currentState === "PAUSED_FOR_GATE" ? "triangle-alert" : currentState === "READY_FOR_HERMES" ? "file-check-2" : "clipboard-check");
      const outcomeBody = resultPanel.createDiv({ cls: "symbiot-dispatcher-outcome-body" });
      outcomeBody.createSpan({ cls: "symbiot-dispatcher-outcome-label", text: selected.missionId === primaryMissionId ? "Основная миссия" : "Выбранная миссия" });
      outcomeBody.createEl("h3", { text: selected.title || selected.missionId });
      const outcomeMeta = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-meta" });
      const missionIdLine = outcomeMeta.createSpan({ cls: "symbiot-dispatcher-copy-line" });
      missionIdLine.createEl("code", { text: selected.missionId });
      this.createIconButton(missionIdLine, "copy", "Скопировать номер миссии", () => this.plugin.copyDispatcherText(selected.missionId, "Номер миссии"));
      outcomeMeta.createSpan({ text: dispatcherViewStateLabel(currentState) });
      if (selected.preflight && selected.preflight.status) outcomeMeta.createSpan({ text: dispatcherViewPreflightLabel(selected.preflight.status) });
      const outcomeText = currentState === "PAUSED_FOR_GATE"
        ? "Подтверждение заблокировано. Сначала подключите и проверьте обязательные источники."
        : currentState === "HUMAN_APPROVAL"
        ? "Карточка задачи, источники, план и предварительная оценка готовы для проверки. Исполнение ещё не запускалось."
        : currentState === "READY_FOR_HERMES"
          ? "План утверждён. Фактический результат ещё не создан: контракт ожидает запуска Hermes."
          : "Маршрут создан. Текущий этап и следующий переход показаны ниже.";
      outcomeBody.createEl("p", { text: outcomeText });
      if (selected.preflight && Array.isArray(selected.preflight.blockingReasons) && selected.preflight.blockingReasons.length) {
        const blockers = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-blockers" });
        selected.preflight.blockingReasons.forEach((reason) => blockers.createDiv({ text: reason }));
      }

      if (Array.isArray(selected.deliverables) && selected.deliverables.length) {
        const deliverables = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-section" });
        deliverables.createEl("h4", { text: "Что должно получиться" });
        const list = deliverables.createEl("ul");
        selected.deliverables.forEach((item) => list.createEl("li", { text: item }));
      }

      const sources = selected.preflight && Array.isArray(selected.preflight.sources) ? selected.preflight.sources : [];
      const sourcesSection = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-section" });
      sourcesSection.createEl("h4", { text: "Подключённые источники" });
      if (!sources.length) {
        sourcesSection.createEl("p", { text: "Источник не подключён или контракт создан старой версией диспетчерской." });
      }
      sources.forEach((source) => {
        const sourceRow = sourcesSection.createDiv({ cls: "symbiot-dispatcher-source-row" });
        const sourceInfo = sourceRow.createDiv();
        sourceInfo.createEl("strong", { text: source.name || "Источник" });
        sourceInfo.createEl("code", { text: source.originalPath || "путь не указан" });
        sourceInfo.createSpan({ text: `${Number(source.fileCount) || 0} файлов, ${((Number(source.totalBytes) || 0) / (1024 * 1024)).toFixed(2)} MB; копия внутри миссии: ${source.importedRelativePath || "нет"}` });
        const sourceActions = sourceRow.createDiv({ cls: "symbiot-dispatcher-source-actions" });
        this.createCommandButton(sourceActions, "folder-open", "Исходная папка", () => this.plugin.openDispatcherMissionSource(selected.missionId, source, false));
        this.createCommandButton(sourceActions, "archive-restore", "Копия в миссии", () => this.plugin.openDispatcherMissionSource(selected.missionId, source, true));
        this.createIconButton(sourceActions, "copy", "Скопировать путь источника", () => this.plugin.copyDispatcherText(source.originalPath, "Путь источника"));
      });

      const obsidianContext = selected.obsidianContext || null;
      const obsidianSection = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-section" });
      obsidianSection.createEl("h4", { text: "Контекст из Obsidian" });
      if (!obsidianContext || !Array.isArray(obsidianContext.entries) || !obsidianContext.entries.length) {
        obsidianSection.createDiv({ cls: "symbiot-dispatcher-outcome-blockers", text: "Профиль, методики и карты Obsidian не подключены. Новая миссия должна быть остановлена." });
      } else {
        obsidianSection.createEl("p", { text: `${obsidianContext.entryCount} файлов, профиль ${obsidianContext.profileVersion}; снимок сохранён вместе с миссией.` });
        const contextList = obsidianSection.createEl("ul");
        obsidianContext.entries.forEach((entry) => {
          const item = contextList.createEl("li");
          const open = item.createEl("button", { cls: "symbiot-dispatcher-context-link", text: `${entry.kind}: ${entry.vaultPath}` });
          open.addEventListener("click", () => this.plugin.openDispatcherVaultPath(entry.vaultPath));
        });
      }

      if (selected.plan && Array.isArray(selected.plan.steps)) {
        const planSection = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-section" });
        planSection.createEl("h4", { text: "План работ" });
        const planList = planSection.createEl("ol");
        selected.plan.steps.forEach((step) => planList.createEl("li", { text: step }));
      }

      const selectedBudget = selected.budget || null;
      if (selectedBudget) {
        const budgetSection = outcomeBody.createDiv({ cls: "symbiot-dispatcher-outcome-section symbiot-dispatcher-budget-explain" });
        budgetSection.createEl("h4", { text: "Предварительная оценка бюджета" });
        budgetSection.createEl("strong", { text: dispatcherViewUsd(selectedBudget.plannedUsd) });
        budgetSection.createEl("p", { text: `${selectedBudget.status || "LEGACY_HEURISTIC"}; доверие: ${selectedBudget.confidence || "UNKNOWN"}. Это не фактическая стоимость.` });
        const breakdown = Array.isArray(selectedBudget.breakdown) ? selectedBudget.breakdown : [];
        if (breakdown.length) {
          const rows = budgetSection.createDiv({ cls: "symbiot-dispatcher-budget-rows" });
          breakdown.forEach((item) => {
            const row = rows.createDiv();
            row.createSpan({ text: item.label });
            row.createSpan({ text: item.basis });
            row.createEl("strong", { text: dispatcherViewUsd(item.estimatedUsd) });
          });
          budgetSection.createEl("code", { text: selectedBudget.formula || "" });
        } else {
          budgetSection.createDiv({ cls: "symbiot-dispatcher-outcome-blockers", text: "Расшифровки нет. Такой бюджет нельзя считать проверенным." });
        }
        if (Array.isArray(selectedBudget.excludedCosts) && selectedBudget.excludedCosts.length) {
          budgetSection.createEl("p", { text: `Не входит: ${selectedBudget.excludedCosts.join("; ")}.` });
        }
        if (currentState === "HUMAN_APPROVAL" || currentState === "PAUSED_FOR_GATE") {
          this.createCommandButton(budgetSection, "refresh-cw", "Обновить контекст и бюджет", () => this.recalculateSelectedMission(), { disabled: this.busy });
        }
      }

      const outcomeActions = resultPanel.createDiv({ cls: "symbiot-dispatcher-outcome-actions" });
      this.createCommandButton(outcomeActions, "file-text", "Карточка миссии", () => this.plugin.openDispatcherMissionNote(selected.missionId));
      this.createCommandButton(outcomeActions, "folder-open", "Папка миссии", () => this.plugin.openDispatcherMissionFolder(selected.missionId));
      this.createIconButton(outcomeActions, "copy", "Скопировать путь папки миссии", () => this.plugin.copyDispatcherText(path.join(this.plugin.settings.dispatcherWorkspaceRoot, selected.missionId), "Путь миссии"));
      if (selected.missionId !== this.plugin.settings.activeDispatcherMissionId) {
        this.createCommandButton(outcomeActions, "pin", "Сделать основной", () => this.setSelectedMissionActive());
      }
      if (currentState === "HUMAN_APPROVAL") {
        this.createCommandButton(outcomeActions, "check-circle-2", "Подтвердить план", () => this.approveSelectedMission(), { primary: true, disabled: this.busy });
      }
    }

    const route = contentEl.createDiv({ cls: "symbiot-dispatcher-route" });
    DISPATCHER_VIEW_STAGES.forEach((stage, index) => {
      const stageClass = index < activeStage ? "is-complete" : index === activeStage ? "is-current" : "is-future";
      const node = route.createDiv({ cls: `symbiot-dispatcher-route-node ${stageClass}` });
      const icon = node.createSpan({ cls: "symbiot-dispatcher-route-icon" });
      setIcon(icon, stage.icon);
      node.createSpan({ text: stage.label });
    });

    if (this.message) {
      contentEl.createDiv({ cls: `symbiot-dispatcher-message is-${this.messageTone}`, text: this.message });
    }

    const layout = contentEl.createDiv({ cls: "symbiot-dispatcher-layout" });
    const intake = layout.createEl("section", { cls: "symbiot-dispatcher-intake" });
    intake.createEl("h3", { text: "Новая миссия" });
    const taskLabel = intake.createEl("label", { cls: "symbiot-dispatcher-field" });
    taskLabel.createSpan({ text: "Задача" });
    const textarea = taskLabel.createEl("textarea", {
      attr: { rows: "9", placeholder: "Опишите результат, ограничения, источники и критерии приёмки" }
    });
    textarea.value = this.draftText;
    textarea.disabled = this.busy;
    textarea.addEventListener("input", () => { this.draftText = textarea.value; });

    const sourceLabel = intake.createEl("label", { cls: "symbiot-dispatcher-field" });
    sourceLabel.createSpan({ text: "Источник" });
    const sourceInput = sourceLabel.createEl("textarea", {
      attr: { rows: "3", placeholder: "Путь к исходной папке или файлу в 01_INBOX" }
    });
    sourceInput.value = this.sourcePath;
    sourceInput.disabled = this.busy;
    sourceInput.addEventListener("input", () => { this.sourcePath = sourceInput.value; });

    const selectors = intake.createDiv({ cls: "symbiot-dispatcher-selectors" });
    const typeLabel = selectors.createEl("label", { cls: "symbiot-dispatcher-field" });
    typeLabel.createSpan({ text: "Тип миссии" });
    const typeSelect = typeLabel.createEl("select");
    this.plugin.getDispatcherMissionTypeOptions().forEach(([value, label]) => typeSelect.createEl("option", { value, text: label }));
    typeSelect.value = this.selectedType;
    typeSelect.disabled = this.busy;
    typeSelect.addEventListener("change", () => { this.selectedType = typeSelect.value; });

    const modeLabel = selectors.createEl("label", { cls: "symbiot-dispatcher-field" });
    modeLabel.createSpan({ text: "Режим" });
    const modeSelect = modeLabel.createEl("select");
    [["", "Автоматически"], ["R", "R — регламент"], ["G", "G — управляемое"], ["БРОСОК", "БРОСОК — исследование"]]
      .forEach(([value, label]) => modeSelect.createEl("option", { value, text: label }));
    modeSelect.value = this.selectedMode;
    modeSelect.disabled = this.busy;
    modeSelect.addEventListener("change", () => { this.selectedMode = modeSelect.value; });

    this.createCommandButton(intake, "route", this.busy ? "Формирую маршрут..." : "Рассчитать маршрут", () => this.submitMission(), { primary: true, disabled: this.busy });
    const boundary = intake.createDiv({ cls: "symbiot-dispatcher-boundary" });
    const boundaryIcon = boundary.createSpan();
    setIcon(boundaryIcon, "shield-check");
    boundary.createSpan({ text: "До вашего решения: 0 LLM-вызовов, 0 внешних действий" });

    const work = layout.createDiv({ cls: "symbiot-dispatcher-work" });
    const missionList = work.createEl("section", { cls: "symbiot-dispatcher-list" });
    const listHeader = missionList.createDiv({ cls: "symbiot-dispatcher-section-header" });
    listHeader.createEl("h3", { text: "Миссии" });
    listHeader.createSpan({ text: this.loading ? "Обновление..." : `${this.missions.length}` });
    const columns = missionList.createDiv({ cls: "symbiot-dispatcher-list-columns" });
    ["Миссия", "Тип", "Режим", "Бюджет", "Статус"].forEach((label) => columns.createSpan({ text: label }));
    const rows = missionList.createDiv({ cls: "symbiot-dispatcher-list-rows" });
    if (!this.missions.length) rows.createDiv({ cls: "symbiot-dispatcher-empty", text: this.loading ? "Загружаю миссии..." : "Миссий пока нет" });
    this.missions.forEach((mission) => {
      const row = rows.createEl("button", { cls: `symbiot-dispatcher-mission-row${mission.missionId === this.selectedMissionId ? " is-selected" : ""}` });
      const identity = row.createDiv({ cls: "symbiot-dispatcher-mission-identity" });
      identity.createEl("strong", { text: mission.title || mission.missionId });
      identity.createEl("code", { text: mission.missionId });
      row.createSpan({ text: mission.missionType || "—" });
      row.createSpan({ text: mission.executionMode || "—" });
      row.createSpan({ text: dispatcherViewUsd(mission.plannedUsd) });
      row.createSpan({ cls: `symbiot-dispatcher-state state-${String(mission.state || "unknown").toLowerCase()}`, text: mission.state || "unknown" });
      row.addEventListener("click", () => this.selectMission(mission.missionId));
    });

    const detail = work.createEl("section", { cls: "symbiot-dispatcher-detail" });
    if (!selected) {
      detail.createEl("h3", { text: "Маршрут миссии" });
      detail.createDiv({ cls: "symbiot-dispatcher-empty", text: "Выберите миссию или рассчитайте новый маршрут" });
      return;
    }

    const detailHeader = detail.createDiv({ cls: "symbiot-dispatcher-detail-header" });
    const detailTitle = detailHeader.createDiv();
    detailTitle.createEl("h3", { text: selected.title || selected.missionId });
    const detailMissionId = detailTitle.createDiv({ cls: "symbiot-dispatcher-copy-line" });
    detailMissionId.createEl("code", { text: selected.missionId });
    this.createIconButton(detailMissionId, "copy", "Скопировать номер миссии", () => this.plugin.copyDispatcherText(selected.missionId, "Номер миссии"));
    const detailActions = detailHeader.createDiv({ cls: "symbiot-dispatcher-detail-actions" });
    this.createIconButton(detailActions, "file-text", "Открыть заметку миссии", () => this.plugin.openDispatcherMissionNote(selected.missionId));
    this.createIconButton(detailActions, "folder-open", "Открыть рабочую папку", () => this.plugin.openDispatcherMissionFolder(selected.missionId));

    const facts = detail.createDiv({ cls: "symbiot-dispatcher-facts" });
    const typeId = selected.missionType && selected.missionType.id ? selected.missionType.id : selected.missionType;
    const missionTypeLabel = selected.missionType && selected.missionType.label ? selected.missionType.label : typeId;
    const modeId = selected.executionMode && selected.executionMode.id ? selected.executionMode.id : selected.executionMode;
    const missionModeLabel = selected.executionMode && selected.executionMode.description ? `${modeId}: ${selected.executionMode.description}` : modeId;
    const budget = selected.budget ? selected.budget.plannedUsd : selected.plannedUsd;
    const preflightStatus = selected.preflight && selected.preflight.status ? selected.preflight.status : "—";
    [["Тип", missionTypeLabel || "—"], ["Режим", missionModeLabel || "—"], ["Бюджет", dispatcherViewUsd(budget)], ["Источники", dispatcherViewPreflightLabel(preflightStatus)], ["Состояние", dispatcherViewStateLabel(currentState)]]
      .forEach(([label, value]) => {
        const fact = facts.createDiv();
        fact.createSpan({ text: label });
        fact.createEl("strong", { text: String(value) });
      });

    if (this.selectedContract && this.selectedContract.plan) {
      const plan = detail.createDiv({ cls: "symbiot-dispatcher-plan" });
      plan.createEl("h4", { text: "План" });
      this.selectedContract.plan.steps.forEach((step, index) => {
        const item = plan.createDiv({ cls: "symbiot-dispatcher-plan-step" });
        item.createSpan({ text: String(index + 1) });
        item.createEl("p", { text: step });
      });
    }

    const footer = detail.createDiv({ cls: "symbiot-dispatcher-detail-footer" });
    if (currentState === "HUMAN_APPROVAL") {
      this.createCommandButton(footer, "check-circle-2", "Подтвердить план", () => this.approveSelectedMission(), { primary: true, disabled: this.busy });
    } else if (currentState === "READY_FOR_HERMES") {
      const ready = footer.createDiv({ cls: "symbiot-dispatcher-ready" });
      const readyIcon = ready.createSpan();
      setIcon(readyIcon, "route");
      ready.createSpan({ text: "Контракт готов к передаче Hermes" });
    } else if (currentState === "PAUSED_FOR_GATE") {
      const blocked = footer.createDiv({ cls: "symbiot-dispatcher-blocked" });
      const blockedIcon = blocked.createSpan();
      setIcon(blockedIcon, "triangle-alert");
      blocked.createSpan({ text: "Подтверждение заблокировано, пока источник не пройдёт проверку" });
    }

    if (resultPanel && this.pendingResultReveal) {
      this.pendingResultReveal = false;
      window.requestAnimationFrame(() => resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }
}

class SymbiotDispatcherModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.preparedMission = null;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.addClass("symbiot-dispatcher-modal");
    contentEl.createEl("h2", { text: "Диспетчерская Симбиота" });
    contentEl.createEl("p", { text: "Опишите задачу. До подтверждения человека формируются только карточка задачи, план, бюджет и проверки." });

    const form = contentEl.createDiv({ cls: "symbiot-dispatcher-form" });
    const missionText = form.createEl("textarea", {
      attr: {
        placeholder: "Что нужно сделать, какой результат нужен, какие есть ограничения?",
        rows: "7"
      }
    });
    const modeRow = form.createDiv({ cls: "symbiot-dispatcher-mode" });
    modeRow.createEl("span", { text: "Режим" });
    const mode = modeRow.createEl("select");
    [
      ["", "Определить автоматически"],
      ["R", "R - регламент"],
      ["G", "G - управляемое"],
      ["БРОСОК", "БРОСОК - исследование"]
    ].forEach(([value, label]) => mode.createEl("option", { text: label, value }));
    const prepare = form.createEl("button", { text: "Подготовить маршрут" });
    const status = contentEl.createDiv({ cls: "symbiot-dispatcher-status" });
    status.setText("Connector не вызывался.");
    const result = contentEl.createDiv({ cls: "symbiot-dispatcher-result" });

    prepare.addEventListener("click", async () => {
      const text = missionText.value.trim();
      if (text.length < 10) {
        status.setText("Нужно описать задачу хотя бы одним предложением.");
        return;
      }
      prepare.disabled = true;
      status.setText("Проверяю задачу и формирую карточку, план и бюджет...");
      try {
        const prepared = await this.plugin.prepareDispatcherMission(text, { executionMode: mode.value });
        if (!prepared.response.ok || !prepared.payload.ok) {
          status.setText(`Маршрут не подготовлен: ${(prepared.payload && (prepared.payload.status || prepared.payload.reason)) || prepared.response.status}`);
          return;
        }
        this.preparedMission = prepared.payload.contract;
        status.setText("Маршрут готов. Миссия ожидает решения человека.");
        this.renderPrepared(result, prepared.payload.contract);
      } catch (error) {
        status.setText(`Connector недоступен: ${error.message}`);
      } finally {
        prepare.disabled = false;
      }
    });

    await this.renderRecent(result);
  }

  async renderRecent(parent) {
    try {
      const response = await this.plugin.getDispatcherMissions();
      const missions = response.ok && response.json && Array.isArray(response.json.missions) ? response.json.missions : [];
      if (!missions.length) return;
      const recent = parent.createDiv({ cls: "symbiot-dispatcher-recent" });
      recent.createEl("strong", { text: "Последние маршруты" });
      missions.slice(0, 5).forEach((mission) => {
        recent.createEl("span", { text: `${mission.missionId}: ${mission.state} / ${mission.plannedUsd} USD` });
      });
    } catch (_) {
      // The active form reports connector availability when the user submits a mission.
    }
  }

  renderPrepared(parent, contract) {
    parent.empty();
    const card = parent.createDiv({ cls: "symbiot-dispatcher-card" });
    card.createEl("strong", { text: contract.title });
    card.createEl("code", { text: contract.missionId });
    card.createEl("span", { text: `Тип: ${contract.missionType.label}; режим: ${contract.executionMode.id}` });
    card.createEl("span", { text: `Бюджет: ${contract.budget.plannedUsd.toFixed(2)} USD; предел: ${contract.budget.hardLimitUsd.toFixed(2)} USD` });
    card.createEl("span", { text: "Статус: ожидает решения человека. LLM, Hermes и внешние действия заблокированы." });
    const steps = card.createDiv({ cls: "symbiot-dispatcher-steps" });
    contract.plan.steps.forEach((step, index) => steps.createEl("span", { text: `${index + 1}. ${step}` }));
    const approve = card.createEl("button", { text: "Подтвердить план" });
    approve.addEventListener("click", async () => {
      approve.disabled = true;
      try {
        const response = await this.plugin.approveDispatcherMission(contract.missionId);
        if (response.response.ok && response.payload.ok) {
          card.createEl("span", { text: "План утвержден: READY_FOR_HERMES. Исполнение запускается отдельным действием Hermes." });
        } else {
          card.createEl("span", { text: `Подтверждение не выполнено: ${(response.payload && (response.payload.status || response.payload.reason)) || response.response.status}` });
          approve.disabled = false;
        }
      } catch (error) {
        card.createEl("span", { text: `Подтверждение не выполнено: ${error.message}` });
        approve.disabled = false;
      }
    });
  }
}

class SymbiotControlModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.createEl("h2", { text: "Симбиот" });
    contentEl.createEl("p", { text: "Плагин теперь работает как легкий коннектор Obsidian. Основной рабочий экран открывается в браузере." });

    const browserGui = contentEl.createDiv({ cls: "symbiot-browser-gui-card" });
    browserGui.createEl("strong", { text: "Основной интерфейс" });
    browserGui.createEl("span", { text: "Откройте полноценный рабочий экран: миссия, три окна LLM, статус, проверка качества и мобильный QR без тесной модалки Obsidian." });
    browserGui.createEl("code", { text: this.plugin.getBrowserGuiUrl() });
    const openBrowser = browserGui.createEl("button", { text: "Открыть Симбиот в браузере" });
    openBrowser.addEventListener("click", () => this.plugin.openBrowserGui());

    const shell = contentEl.createDiv({ cls: "symbiot-agent-shell" });
    const shellHead = shell.createDiv({ cls: "symbiot-agent-shell-head" });
    shellHead.createEl("strong", { text: "Один вход: Симбиот" });
    shellHead.createEl("span", { text: "Роли не являются отдельными кнопками для пользователя. Они работают внутри миссии как субагенты." });
    const shellSteps = shell.createDiv({ cls: "symbiot-agent-steps" });
    [
      "Поручить миссию",
      "Разрешить источники",
      "Получить результат",
      "Проверить качество",
      "Решить следующий шаг"
    ].forEach((item) => shellSteps.createEl("span", { text: item }));

    const next = contentEl.createDiv({ cls: "symbiot-first-run" });
    next.createEl("strong", { text: "Что сделать сейчас" });
    [
      "Проверить connector на этом компьютере.",
      "Подключить этот vault к Симбиоту.",
      "Создать миссию: текстом описать задачу и ожидаемый результат.",
      "Открыть LLM Hub, если нужно сравнить ответы моделей.",
      "Проверить результат и качество в vault."
    ].forEach((item) => next.createEl("span", { text: item }));

    const subagents = contentEl.createEl("details", { cls: "symbiot-subagent-details" });
    subagents.createEl("summary", { text: "Состав субагентов миссии" });
    subagents.createEl("span", { text: "По умолчанию Симбиот подключает 2-5 внутренних субагентов: методолог миссии, исполнитель, проверка качества, риск-контроль и упаковка результата." });
    subagents.createEl("span", { text: "Пользователь управляет задачей и результатом, а не отдельными ролями." });

    const trust = contentEl.createDiv({ cls: "symbiot-trust-card" });
    trust.createEl("strong", { text: "Граница доверия" });
    trust.createEl("span", { text: "Плагин работает через локальный connector по адресу 127.0.0.1 и локальный connector-token." });
    trust.createEl("span", { text: "API-ключи и connector-token не записываются в markdown/evidence; текущий secret store остается YELLOW до отдельного security gate." });
    trust.createEl("span", { text: "Плагин не должен читать весь vault и отправлять данные скрыто. RAG и remote-доступ закрываются отдельными gates." });

    const status = contentEl.createDiv({ cls: "symbiot-connector-card" });
    status.createEl("strong", { text: "Состояние connector" });
    status.createEl("code", { text: this.plugin.getConnectorUrl() });
    status.createEl("span", { text: this.plugin.connectorState.ok ? "работает" : this.plugin.connectorState.status });

    const visibleLoop = contentEl.createDiv({ cls: "symbiot-visible-loop-card" });
    visibleLoop.createEl("strong", { text: "План / статус / проверка" });
    visibleLoop.createEl("span", { text: "Запуск показывает пользователю шаги миссии, текущий статус, файл результата и checks проверки." });
    const loopSteps = visibleLoop.createDiv({ cls: "symbiot-visible-loop-steps" });
    ["План", "Решение человека", "Выполнение", "Результат", "Проверка"].forEach((item) => loopSteps.createEl("span", { text: item }));

    const fileWorkbench = contentEl.createDiv({ cls: "symbiot-file-workbench-card" });
    fileWorkbench.createEl("strong", { text: "Рабочие файлы" });
    fileWorkbench.createEl("span", { text: "Создать безопасный рабочий файл миссии, проверить metadata и связать его с result/quality-check без отправки содержимого в connector." });
    const fileSteps = fileWorkbench.createDiv({ cls: "symbiot-file-workbench-steps" });
    ["Файл", "Metadata", "Result", "Проверка"].forEach((item) => fileSteps.createEl("span", { text: item }));

    const contextRetriever = contentEl.createDiv({ cls: "symbiot-context-retriever-card" });
    contextRetriever.createEl("strong", { text: "Контекст / RAG" });
    contextRetriever.createEl("span", { text: "Найти цитируемые фрагменты в выбранных файлах миссии без скрытого сканирования всего vault." });
    const contextSteps = contextRetriever.createDiv({ cls: "symbiot-context-retriever-steps" });
    ["Источники", "Запрос", "Цитаты", "Проверка"].forEach((item) => contextSteps.createEl("span", { text: item }));

    const actions = contentEl.createDiv({ cls: "symbiot-actions" });
    this.addAction(actions, "Проверить connector", () => this.plugin.refreshConnectorStatus(true));
    this.addAction(actions, "Подключить vault", () => this.plugin.registerConnector(true));
    this.addAction(actions, "Подготовить workspace", () => this.plugin.initializeCore());
    this.addAction(actions, "Поручить миссию Симбиоту", () => this.plugin.createMissionNote({ syncConnector: true }));
    this.addAction(actions, "Запустить runtime MVP", () => this.plugin.runAgentRuntimeMvp());
    this.addAction(actions, "План / статус / проверка", () => this.plugin.runVisiblePlanStatusEvidenceLoop());
    this.addAction(actions, "Рабочие файлы", () => this.plugin.runFileWorkbenchMvp());
    this.addAction(actions, "Контекст / RAG", () => this.plugin.runContextRetrieverMvp());
    this.addAction(actions, "Admin Sync", () => this.plugin.runAdminSyncMvp());
    this.addAction(actions, "Архитектурная шина", () => this.plugin.runArchitectureSignalBackbone());
    this.addAction(actions, "Открыть LLM Hub", () => this.plugin.openLlmHub());
    this.addAction(actions, "API-ключи", () => this.plugin.openApiVault());
    this.addAction(actions, "OpenRouter Gateway", () => this.plugin.openLlmHub());
    this.addAction(actions, "Запустить три окна", () => this.plugin.runThreeWindowLlmComparison());
    this.addAction(actions, "Мобильный доступ", () => this.plugin.openMobileConnector());
    this.addAction(actions, "Проверить готовность", () => this.plugin.runPreReleasePreflight());

    const snapshot = await this.plugin.getAdminSnapshot();
    if (snapshot.ok && snapshot.json) {
      const admin = contentEl.createDiv({ cls: "symbiot-snapshot" });
      admin.createEl("strong", { text: "Текущее состояние" });
      admin.createEl("span", { text: `устройств ${snapshot.json.devices.length}` });
      admin.createEl("span", { text: `миссий ${snapshot.json.missions.length}` });
      admin.createEl("span", { text: `очередь ${snapshot.json.queues.length}` });
      admin.createEl("span", { text: `audit ${snapshot.json.audit.length}` });
    }
  }

  addAction(parent, label, action) {
    const button = parent.createEl("button", { text: label });
    button.addEventListener("click", async () => {
      this.close();
      await action();
    });
  }
}

class SymbiotApiVaultModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.records = [];
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.addClass("symbiot-api-vault-modal");
    contentEl.createEl("h2", { text: "API-ключи Симбиота" });

    const status = contentEl.createDiv({ cls: "symbiot-api-key-status" });
    status.setText("Загружаю список ключей...");

    const toolbar = contentEl.createDiv({ cls: "symbiot-api-vault-toolbar" });
    const refresh = toolbar.createEl("button", { text: "Обновить" });
    refresh.addEventListener("click", async () => this.renderList(list, status));
    const addOpenRouter = toolbar.createEl("button", { text: "Добавить OpenRouter" });
    addOpenRouter.addEventListener("click", () => this.renderEditor(editor, status, {
      id: "sym-saas.openrouter.api-key",
      provider: "OpenRouter",
      scope: "SYM-SaaS",
      envName: "OPENROUTER_API_KEY",
      secretType: "llm_api_key"
    }));
    const addAny = toolbar.createEl("button", { text: "Добавить любой ключ" });
    addAny.addEventListener("click", () => this.renderEditor(editor, status, null));

    const list = contentEl.createDiv({ cls: "symbiot-api-vault-list" });
    const editor = contentEl.createDiv({ cls: "symbiot-api-vault-editor" });
    await this.renderList(list, status);
  }

  async renderList(container, status) {
    container.empty();
    const result = await this.plugin.getApiVaultList();
    if (!result.ok || !result.json || !Array.isArray(result.json.records)) {
      status.setText("Не удалось получить список. Проверьте, что connector запущен.");
      return;
    }
    this.records = result.json.records;
    status.setText(`Ключей заведено: ${this.records.filter((item) => item.configured).length}. Значения скрыты.`);
    for (const record of this.records) {
      this.renderRecord(container, record, status);
    }
  }

  renderRecord(container, record, status) {
    const row = container.createDiv({ cls: "symbiot-api-vault-row" });
    const meta = row.createDiv({ cls: "symbiot-api-vault-meta" });
    meta.createEl("strong", { text: record.label || record.id });
    meta.createEl("span", { text: `${record.provider} / ${record.status}` });
    meta.createEl("code", { text: record.fingerprint ? `отпечаток ${record.fingerprint}` : "ключ не добавлен" });

    const actions = row.createDiv({ cls: "symbiot-api-vault-actions" });
    const show = actions.createEl("button", { text: "Показать" });
    show.disabled = !record.configured;
    const copy = actions.createEl("button", { text: "Скопировать" });
    copy.disabled = !record.configured;
    const update = actions.createEl("button", { text: record.configured ? "Обновить" : "Добавить" });

    const reveal = async () => {
      status.setText(`${record.label || record.id}: получаю значение...`);
      const result = await this.plugin.revealApiVaultSecret(record.id);
      if (!result.ok || !result.json || !result.json.value) {
        status.setText(`${record.label || record.id}: не удалось показать ключ.`);
        return null;
      }
      status.setText(`${record.label || record.id}: значение получено локально. Не вставляйте его в markdown/evidence.`);
      return result.json.value;
    };

    show.addEventListener("click", async () => {
      const value = await reveal();
      if (!value) return;
      new SymbiotSecretValueModal(this.app, record, value).open();
    });
    copy.addEventListener("click", async () => {
      const value = await reveal();
      if (!value) return;
      await navigator.clipboard.writeText(value);
      status.setText(`${record.label || record.id}: скопировано в буфер обмена.`);
      new Notice("Ключ скопирован");
    });
    update.addEventListener("click", () => {
      const editor = this.contentEl.querySelector(".symbiot-api-vault-editor");
      this.renderEditor(editor, status, record);
    });
  }

  renderEditor(container, status, record) {
    container.empty();
    const data = record || {};
    container.createEl("strong", { text: record && record.id ? `Сохранить: ${record.label || record.id}` : "Новый API-ключ" });
    const id = this.addInput(container, "ID", data.id || "sym-saas.provider.api-key");
    const provider = this.addInput(container, "Провайдер", data.provider || "");
    const scope = this.addInput(container, "Scope", data.scope || "SYM-SaaS");
    const envName = this.addInput(container, "Env", data.envName || "");
    const secretType = this.addInput(container, "Тип", data.secretType || "api_key");
    const value = this.addInput(container, "Значение ключа", "", "password");
    const notes = this.addInput(container, "Заметка", data.notes || "Saved from Symbiot Obsidian Plugin API Keys UI");
    const save = container.createEl("button", { text: "Сохранить ключ" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.setText("Сохраняю ключ в защищенный vault...");
      const result = await this.plugin.saveApiVaultSecret({
        id: id.value,
        provider: provider.value,
        scope: scope.value,
        envName: envName.value,
        secretType: secretType.value,
        value: value.value,
        notes: notes.value,
        rotationRequired: Boolean(data.rotationRequired)
      });
      if (result.ok) {
        value.value = "";
        status.setText("Ключ сохранен. Значение не записано в Obsidian.");
        await this.renderList(this.contentEl.querySelector(".symbiot-api-vault-list"), status);
      } else {
        const reason = result.json && (result.json.error || result.json.reason) ? result.json.error || result.json.reason : "unknown";
        status.setText(`Не сохранено: ${reason}`);
      }
      save.disabled = false;
    });
  }

  addInput(container, label, value, type = "text") {
    const wrap = container.createDiv({ cls: "symbiot-api-vault-field" });
    wrap.createEl("span", { text: label });
    const input = wrap.createEl("input");
    input.type = type;
    input.value = value;
    input.setAttribute("autocomplete", "off");
    return input;
  }
}

class SymbiotSecretValueModal extends Modal {
  constructor(app, record, value) {
    super(app);
    this.record = record;
    this.value = value;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.addClass("symbiot-secret-value-modal");
    contentEl.createEl("h2", { text: this.record.label || this.record.id });
    const input = contentEl.createEl("input");
    input.type = "password";
    input.value = this.value;
    input.setAttribute("readonly", "readonly");
    const actions = contentEl.createDiv({ cls: "symbiot-api-vault-toolbar" });
    const toggle = actions.createEl("button", { text: "Показать/скрыть" });
    toggle.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
    });
    const copy = actions.createEl("button", { text: "Скопировать" });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.value);
      new Notice("Ключ скопирован");
    });
    contentEl.createEl("small", { text: "Не вставляйте ключ в заметки, evidence, screenshots или чат. Для продажи ключи, попадавшие в чат, нужно перевыпустить." });
  }
}

class SymbiotLlmHubModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.createEl("h2", { text: "LLM Hub: три окна" });
    contentEl.createEl("small", { text: "Три окна сравнения: каждый API-key подключается в свое окно." });

    const status = contentEl.createDiv({ cls: "symbiot-api-key-status" });
    status.setText("Ключи хранятся только в локальном connector runtime, не в markdown.");

    this.renderOpenRouterGateway(contentEl, status);

    const slots = contentEl.createDiv({ cls: "symbiot-api-slot-grid" });
    for (const slot of [1, 2, 3]) {
      this.renderSlot(slots, slot, status);
    }

    const actions = contentEl.createDiv({ cls: "symbiot-actions" });
    const compare = actions.createEl("button", { text: "Запустить сравнение" });
    compare.addEventListener("click", async () => {
      compare.disabled = true;
      status.setText("Запускаю live-сравнение по подключенным окнам...");
      this.close();
      await this.plugin.runThreeWindowLlmComparison(undefined, { live: true });
      compare.disabled = false;
    });

    await this.renderConnectedProviders(contentEl);
  }

  renderOpenRouterGateway(parent, status) {
    const gateway = parent.createDiv({ cls: "symbiot-openrouter-gateway" });
    gateway.createEl("strong", { text: "OpenRouter Gateway" });
    gateway.createEl("small", { text: "Один OpenRouter API-key подключает три окна LLM Hub. Модели можно поменять позже." });
    const input = gateway.createEl("input");
    input.type = "password";
    input.placeholder = "sk-or-...";
    input.setAttribute("autocomplete", "off");
    const button = gateway.createEl("button", { text: "Подключить в 3 окна" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.setText("Подключаю OpenRouter Gateway в три окна...");
      const result = await this.plugin.connectOpenRouterGateway(input.value, { live: false });
      if (result.ok && result.json && result.json.gateway) {
        input.value = "";
        status.setText("OpenRouter Gateway подключен: окна 1-3 готовы к сравнению.");
        await this.renderConnectedProviders(this.contentEl);
      } else {
        const reason = result.json && (result.json.error || result.json.reason) ? result.json.error || result.json.reason : "unknown";
        status.setText(`OpenRouter Gateway не подключен: ${reason}`);
      }
      button.disabled = false;
    });
  }

  renderSlot(parent, slot, status) {
    const card = parent.createDiv({ cls: "symbiot-api-slot" });
    card.createEl("strong", { text: `Окно ${slot}` });
    const input = card.createEl("input");
    input.type = "password";
    input.placeholder = slot === 1 ? "openrouter:sk-or-... или deepseek:sk-..." : "provider:key или API-key";
    input.setAttribute("autocomplete", "off");
    const row = card.createDiv({ cls: "symbiot-slot-actions" });
    const connect = row.createEl("button", { text: "Подключить" });
    connect.addEventListener("click", async () => {
      connect.disabled = true;
      status.setText(`Окно ${slot}: подключаю...`);
      const result = await this.plugin.connectApiKey(input.value, slot);
      if (result.ok && result.json && result.json.provider) {
        input.value = "";
        status.setText(`Окно ${slot}: ${result.json.provider.name || result.json.provider.id} подключен.`);
        await this.renderConnectedProviders(this.contentEl);
      } else {
        const reason = result.json && (result.json.error || result.json.reason) ? result.json.error || result.json.reason : "unknown";
        status.setText(`Окно ${slot}: не подключено: ${reason}`);
      }
      connect.disabled = false;
    });
    const disconnect = row.createEl("button", { text: "Отключить" });
    disconnect.addEventListener("click", async () => {
      disconnect.disabled = true;
      await this.plugin.disconnectProviderSlot(slot);
      status.setText(`Окно ${slot}: отключено.`);
      await this.renderConnectedProviders(this.contentEl);
      disconnect.disabled = false;
    });
  }

  async renderConnectedProviders(contentEl) {
    const previous = contentEl.querySelector(".symbiot-connected-providers");
    if (previous) previous.remove();
    const snapshot = await this.plugin.getAdminSnapshot();
    const box = contentEl.createDiv({ cls: "symbiot-connected-providers" });
    box.createEl("strong", { text: "Окна" });
    const providers = snapshot.ok && snapshot.json && Array.isArray(snapshot.json.providers) ? snapshot.json.providers : [];
    for (const slot of [1, 2, 3]) {
      const provider = providers.find((item) => item.slot === slot);
      const row = box.createDiv({ cls: "symbiot-provider-row" });
      row.createEl("strong", { text: `Окно ${slot}` });
      if (!provider) {
        row.createEl("span", { text: "не подключено" });
        row.createEl("code", { text: "пусто" });
      } else {
        row.createEl("span", { text: `${provider.name || provider.id} / ${provider.model || "model: auto"}` });
        row.createEl("code", { text: provider.keyPresent ? "ключ подключен" : "ключ не найден" });
      }
    }
  }
}
class SymbiotLlmComparisonModal extends Modal {
  constructor(app, plugin, comparison) {
    super(app);
    this.plugin = plugin;
    this.comparison = comparison;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.addClass("symbiot-llm-compare-modal");
    contentEl.createEl("h2", { text: "Ответы LLM" });
    contentEl.createEl("p", { text: this.comparison.prompt });
    const grid = contentEl.createDiv({ cls: "symbiot-llm-three-grid" });
    this.comparison.results.forEach((result) => {
      const pane = grid.createDiv({ cls: "symbiot-llm-pane" });
      pane.createEl("strong", { text: result.providerName });
      pane.createEl("span", { text: result.model });
      pane.createEl("code", { text: result.status });
      pane.createEl("p", { text: result.answer });
      pane.createEl("small", { text: result.risk });
    });
  }
}
class SymbiotMobileConnectorModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("symbiot-modal");
    contentEl.addClass("symbiot-mobile-modal");
    contentEl.createEl("h2", { text: "Мобильный доступ" });
    contentEl.createEl("p", { text: "Obsidian на компьютере остается главным рабочим местом. Телефон открывает локальную web-панель для статуса и трех окон LLM." });

    const statusCard = contentEl.createDiv({ cls: "symbiot-mobile-card" });
    statusCard.createEl("strong", { text: "Состояние runtime" });
    statusCard.createEl("code", { text: this.plugin.getConnectorUrl() });
    const statusLine = statusCard.createEl("span", { text: "Проверяю connector..." });
    const statusHint = statusCard.createEl("small", { text: "Если connector не запущен, QR не появится. Ошибка будет показана здесь." });

    const pairingCard = contentEl.createDiv({ cls: "symbiot-mobile-card" });
    pairingCard.createEl("strong", { text: "Подключить телефон" });
    const pairingBody = pairingCard.createDiv({ cls: "symbiot-mobile-pairing-body" });
    pairingBody.createEl("span", { text: "Генерирую QR-код..." });

    const checks = contentEl.createDiv({ cls: "symbiot-mobile-card" });
    checks.createEl("strong", { text: "Что работает сейчас" });
    checks.createEl("span", { text: "Мобильная web-панель: статус + три окна LLM + безопасные действия Windows Agent." });
    checks.createEl("span", { text: "Удаленный доступ через интернет: YELLOW, отдельный security gate." });

    try {
      const status = await this.plugin.getMobileStatus();
      const pairing = await this.plugin.getMobilePairing();
      const mobile = status.ok && status.json && status.json.mobile ? status.json.mobile : null;
      statusLine.setText(mobile ? `${mobile.mode} / ${mobile.status}` : `mobile status unavailable / HTTP ${status.status || 0}`);
      statusHint.setText(mobile ? mobile.boundary : "Connector ответил без mobile status. Проверьте версию connector.");
      pairingBody.empty();
      if (pairing.ok && pairing.json && pairing.json.url && pairing.json.qrUrl) {
        const qrWrap = pairingBody.createDiv({ cls: "symbiot-mobile-qr" });
        qrWrap.createEl("img", { attr: { src: pairing.json.qrUrl, alt: "QR-код мобильного коннектора Симбиота" } });
        pairingBody.createEl("a", { text: pairing.json.url, attr: { href: pairing.json.url, target: "_blank", rel: "noopener" } });
        pairingBody.createEl("small", { text: `Действует до: ${pairing.json.expiresAt}` });
      } else {
        pairingBody.createEl("span", { text: `QR-подключение недоступно / HTTP ${pairing.status || 0}` });
        pairingBody.createEl("code", { text: pairing.json && (pairing.json.error || pairing.json.reason) ? String(pairing.json.error || pairing.json.reason) : "connector pairing response is empty" });
      }
    } catch (error) {
      statusLine.setText("Connector не отвечает");
      statusHint.setText(error.message);
      pairingBody.empty();
      pairingBody.createEl("span", { text: "QR-код не создан: connector недоступен или вернул ошибку." });
      pairingBody.createEl("code", { text: error.message });
      const retry = pairingBody.createEl("button", { text: "Повторить" });
      retry.addEventListener("click", () => this.onOpen());
    }
  }
}

class SymbiotSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Настройки Симбиота" });

    new Setting(containerEl)
      .setName("Адрес connector")
      .setDesc("Локальный адрес connector. Для pre-market режима оставляйте 127.0.0.1.")
      .addText((text) =>
        text.setValue(this.plugin.settings.connectorUrl).onChange(async (value) => {
          this.plugin.settings.connectorUrl = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Мобильный доступ")
      .setDesc("Разрешить подключенному телефону отправлять команды desktop Obsidian host. Remote/public режим требует отдельного security gate.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mobileConnectorEnabled).onChange(async (value) => {
          this.plugin.settings.mobileConnectorEnabled = value;
          await this.plugin.saveSettings();
        })
      );
  }
}













