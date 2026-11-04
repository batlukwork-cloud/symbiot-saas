const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function firstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates[0];
}

const CONNECTOR_PORT = process.env.SYMBIOT_CONNECTOR_PORT || "8787";
const APP_URL = process.env.SYMBIOT_APP_URL || `http://127.0.0.1:${CONNECTOR_PORT}/app?shell=desktop`;
const DESKTOP_ICON_PATH = path.resolve(__dirname, "assets", "symbiot-face-rounded-v2.png");
const CONNECTOR_DIR =
  process.env.SYMBIOT_CONNECTOR_DIR ||
  firstExistingPath([
    path.resolve(__dirname, "..", "symbiot-connector-service"),
    path.resolve(__dirname, "..", "connector-service"),
    path.resolve(process.resourcesPath || __dirname, "connector-service")
  ]);
const EMBEDDED_ELECTRON_EXE = path.resolve(__dirname, "node_modules", "electron", "dist", "electron.exe");
const NODE_EXE =
  process.env.SYMBIOT_NODE_EXE ||
  firstExistingPath([
    EMBEDDED_ELECTRON_EXE,
    process.execPath,
    "node"
  ]);
const NODE_USES_ELECTRON =
  process.env.SYMBIOT_NODE_USES_ELECTRON === "1" ||
  NODE_EXE === process.execPath ||
  /(^|[\\/])electron\.exe$/i.test(NODE_EXE);
const VISUAL_PROOF_OUTPUT = process.env.SYMBIOT_VISUAL_PROOF_OUTPUT || "";
const VISUAL_PROOF_INTERACTIVE = process.env.SYMBIOT_VISUAL_PROOF_INTERACTIVE === "1";
const BOOT_STATUS_OUTPUT =
  process.env.SYMBIOT_DESKTOP_BOOT_STATUS_OUTPUT ||
  path.resolve(__dirname, "..", "runtime_logs", "SYM_DESKTOP_BOOT_STATUS_CURRENT.json");
const PROOF_STATE_OUTPUT = process.env.SYMBIOT_DESKTOP_PROOF_STATE_OUTPUT || "";
let connectorProcess = null;

function writeBootStatus(status) {
  if (!BOOT_STATUS_OUTPUT) return;
  const payload = {
    ...status,
    writtenAt: new Date().toISOString(),
    appUrl: APP_URL,
    connectorPort: CONNECTOR_PORT,
    connectorDir: CONNECTOR_DIR
  };
  fs.mkdirSync(path.dirname(BOOT_STATUS_OUTPUT), { recursive: true });
  fs.writeFileSync(BOOT_STATUS_OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fallbackHtml(reason) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Симбиот - запуск</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1f2026; color: #f4f4f6; font-family: Inter, Segoe UI, Arial, sans-serif; }
    main { width: min(720px, calc(100vw - 48px)); }
    h1 { margin: 0 0 18px; font-size: 32px; font-weight: 700; letter-spacing: 0; }
    p { margin: 0 0 14px; color: #c9ccd4; font-size: 16px; line-height: 1.5; }
    code { color: #ffffff; background: #2a2d36; padding: 2px 6px; border-radius: 4px; }
    button { margin-top: 18px; border: 0; border-radius: 6px; padding: 12px 18px; background: #8f7ad9; color: #fff; font-weight: 700; cursor: pointer; }
    .box { border-top: 1px solid #363945; padding-top: 18px; margin-top: 18px; }
  </style>
</head>
<body>
  <main data-symbiot-desktop-fallback="connector-not-ready">
    <h1>Симбиот не смог открыть рабочий экран</h1>
    <p>Desktop-приложение запущено, но локальный connector пока не ответил.</p>
    <div class="box">
      <p>Адрес: <code>${escapeHtml(APP_URL)}</code></p>
      <p>Причина: <code>${escapeHtml(reason)}</code></p>
      <button onclick="window.location.href='${escapeHtml(APP_URL)}'">Повторить</button>
    </div>
  </main>
</body>
</html>`;
}

function writeProofState(state) {
  if (!PROOF_STATE_OUTPUT) return;
  fs.mkdirSync(path.dirname(PROOF_STATE_OUTPUT), { recursive: true });
  fs.writeFileSync(PROOF_STATE_OUTPUT, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function connectorIsAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${CONNECTOR_PORT}/health`);
    const payload = await response.json();
    return response.ok && payload && payload.ok;
  } catch (_) {
    return false;
  }
}

function startConnectorIfNeeded() {
  return connectorIsAlive().then((alive) => {
    if (alive) {
      writeBootStatus({ phase: "connector_reuse", connectorAlive: true, connectorStarted: false });
      return;
    }
    const connectorEnv = { ...process.env, SYMBIOT_CONNECTOR_PORT: CONNECTOR_PORT };
    if (NODE_USES_ELECTRON) {
      connectorEnv.ELECTRON_RUN_AS_NODE = "1";
    }
    connectorProcess = spawn(NODE_EXE, ["server.js"], {
      cwd: CONNECTOR_DIR,
      env: connectorEnv,
      windowsHide: true,
      stdio: "ignore"
    });
    connectorProcess.unref();
    writeBootStatus({ phase: "connector_spawned", connectorAlive: false, connectorStarted: true, connectorProcessId: connectorProcess.pid || null });
  });
}

async function waitForConnectorReady() {
  for (let index = 0; index < 40; index += 1) {
    if (await connectorIsAlive()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: "Симбиот",
    icon: DESKTOP_ICON_PATH,
    backgroundColor: "#1f2026",
    autoHideMenuBar: true,
    show: !VISUAL_PROOF_OUTPUT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: Boolean(VISUAL_PROOF_OUTPUT)
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.once("did-finish-load", async () => {
    writeBootStatus({ phase: "window_loaded", connectorAlive: await connectorIsAlive(), loadedUrl: mainWindow.webContents.getURL() });
    if (!VISUAL_PROOF_OUTPUT) return;
    if (VISUAL_PROOF_INTERACTIVE) {
      await mainWindow.webContents.executeJavaScript(`
        document.getElementById('compareLayout')?.click();
        document.getElementById('compareLayout')?.click();
        document.getElementById('previewToggle')?.click();
        document.getElementById('themeToggle')?.click();
        document.body.setAttribute('data-visual-proof-actions', 'done');
        true;
      `);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    const proofState = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        return {
          url: window.location.href,
          shell: document.querySelector('[data-symbiot-app-shell]')?.getAttribute('data-symbiot-app-shell') || '',
          fallback: document.querySelector('[data-symbiot-desktop-fallback]')?.getAttribute('data-symbiot-desktop-fallback') || '',
          hasSymbiot: text.includes('СИМБИОТ'),
          hasLlmHub: text.includes('LLM Hub'),
          hasContextRag: text.includes('Контекст / RAG'),
          hasFiles: text.includes('Рабочие файлы'),
          hasVision: text.includes('Зрение'),
          hasMobile: text.includes('Мобильный доступ'),
          hasWindowsAgent: text.includes('Windows Agent'),
          hasAdminSync: text.includes('Admin Sync'),
          hasCompareLayout: Boolean(document.getElementById('compareLayout')),
          hasPreviewToggle: Boolean(document.getElementById('previewToggle')),
          hasThemeToggle: Boolean(document.getElementById('themeToggle')),
          visualProofActions: document.body?.getAttribute('data-visual-proof-actions') || ''
        };
      })()
    `);
    writeProofState(proofState);
    const image = await mainWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(VISUAL_PROOF_OUTPUT), { recursive: true });
    fs.writeFileSync(VISUAL_PROOF_OUTPUT, image.toPNG());
    app.quit();
  });

  mainWindow.webContents.once("did-fail-load", (_event, code, description, url) => {
    writeBootStatus({ phase: "window_failed", connectorAlive: false, code, description, failedUrl: url });
    if (!VISUAL_PROOF_OUTPUT) return;
    fs.mkdirSync(path.dirname(VISUAL_PROOF_OUTPUT), { recursive: true });
    fs.writeFileSync(`${VISUAL_PROOF_OUTPUT}.error.json`, JSON.stringify({ code, description, url }, null, 2), "utf8");
    app.quit();
  });

  const ready = await waitForConnectorReady();
  if (ready) {
    writeBootStatus({ phase: "connector_ready_before_load", connectorAlive: true });
    mainWindow.loadURL(APP_URL);
  } else {
    writeBootStatus({ phase: "fallback_loaded", connectorAlive: false, reason: "connector_health_timeout" });
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml("connector_health_timeout"))}`);
  }
}

app.whenReady().then(async () => {
  await startConnectorIfNeeded();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
