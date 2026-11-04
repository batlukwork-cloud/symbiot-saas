const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "symbiot-obsidian-plugin");
const OUT_DIR = path.join(ROOT, "runtime_logs");
const OUT_FILE = path.join(OUT_DIR, "SYM_OBSIDIAN_PLUGIN_RUSSIAN_FIRST_RUN_UX_PROOF_2026-07-17.json");

function read(relativePath) {
  return fs.readFileSync(relativePath, "utf8");
}

function includesAll(text, markers) {
  return markers.map((marker) => ({ marker, present: text.includes(marker) }));
}

function absentAll(text, markers) {
  return markers.map((marker) => ({ marker, absent: !text.includes(marker) }));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mainJs = read(path.join(PLUGIN_DIR, "main.js"));
  const stylesCss = read(path.join(PLUGIN_DIR, "styles.css"));
  const serverJs = read(path.join(__dirname, "server.js"));
  const packageJson = JSON.parse(read(path.join(__dirname, "package.json")));

  const requiredPluginMarkers = [
    "Симбиот: открыть панель",
    "Симбиот: проверить connector",
    "Симбиот: подключить этот vault",
    "Что сделать сейчас",
    "Граница доверия",
    "Состояние connector",
    "1. Проверить connector",
    "5. Открыть LLM Hub",
    "API-ключи и connector-token не записываются",
    "Плагин не должен читать весь vault",
    "LLM Hub: три окна",
    "Мобильный доступ",
    "Настройки Симбиота"
  ];

  const forbiddenOldUiMarkers = [
    "Open Symbiot panel",
    "Refresh Status",
    "Register Vault",
    "Prepare Workspace",
    "Create Mission",
    "Run Proof Loop",
    "Mobile Connector",
    "LLM responses",
    "Desktop Obsidian remains",
    "Runtime status",
    "Pair phone",
    "What works now",
    "Connector URL",
    "Symbiot settings"
  ];

  const requiredMobileMarkers = [
    "Симбиот: мобильный доступ",
    "Телефон работает как локальная панель управления Obsidian на компьютере.",
    "Удаленный доступ через интернет закрыт до отдельного security gate.",
    "токен:",
    "загрузка...",
    "LLM Hub: три окна",
    "выполняю..."
  ];

  const requiredCssMarkers = [
    ".symbiot-first-run",
    ".symbiot-trust-card"
  ];

  const pluginPresence = includesAll(mainJs, requiredPluginMarkers);
  const oldUiAbsence = absentAll(mainJs + "\n" + serverJs, forbiddenOldUiMarkers);
  const mobilePresence = includesAll(serverJs, requiredMobileMarkers);
  const cssPresence = includesAll(stylesCss, requiredCssMarkers);

  const checks = {
    pluginRussianFirstRunPresent: pluginPresence.every((item) => item.present),
    oldEnglishUiLabelsAbsent: oldUiAbsence.every((item) => item.absent),
    mobileRussianPanelPresent: mobilePresence.every((item) => item.present),
    firstRunCssPresent: cssPresence.every((item) => item.present),
    noVaultReadInPlugin: !/\b(?:app\.)?vault\.read\s*\(/.test(mainJs) && !/adapter\.read\s*\(/.test(mainJs),
    localConnectorDefault: mainJs.includes('connectorUrl: "http://127.0.0.1:8787"'),
    strictCorsConfigured: !serverJs.includes('"access-control-allow-origin": "*"') && serverJs.includes("local_allowlist"),
    packageScriptRegistered: packageJson.scripts && packageJson.scripts["proof:first-run"] === "node proof-russian-first-run-ux.js"
  };

  const passed = checks.pluginRussianFirstRunPresent &&
    checks.oldEnglishUiLabelsAbsent &&
    checks.mobileRussianPanelPresent &&
    checks.firstRunCssPresent &&
    checks.noVaultReadInPlugin &&
    checks.localConnectorDefault &&
    checks.strictCorsConfigured &&
    checks.packageScriptRegistered;

  const proof = {
    id: "OBP-032",
    date: "2026-07-17",
    project: "SYM-SaaS / Symbiot Obsidian Plugin",
    gate: "Russian UX & First Run / Trust Boundary",
    status: passed ? "PASS_WITH_CONDITIONS_RUSSIAN_FIRST_RUN_UX" : "YELLOW_RUSSIAN_FIRST_RUN_UX_INCOMPLETE",
    readinessChangeAllowed: false,
    files: {
      plugin: path.join(PLUGIN_DIR, "main.js"),
      styles: path.join(PLUGIN_DIR, "styles.css"),
      connector: path.join(__dirname, "server.js")
    },
    checks,
    details: {
      pluginPresence,
      oldUiAbsence,
      mobilePresence,
      cssPresence
    },
    boundaries: [
      "This proof confirms Russian first-run UX and local trust-boundary copy only.",
      "Security Gate improved: connector-token and strict local CORS are present; remote relay and production secret storage are still not closed.",
      "Marketplace/public sale/release readiness must not be marked GREEN from this proof alone.",
      "The plugin must not promise closed code as protection for client vault data. Local-first and explicit user actions remain the current boundary."
    ]
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(proof, null, 2), "utf8");
  console.log(JSON.stringify(proof, null, 2));
  if (!passed) process.exitCode = 1;
}

main();

