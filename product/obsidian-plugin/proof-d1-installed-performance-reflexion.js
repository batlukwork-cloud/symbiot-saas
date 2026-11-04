const assert = require("assert");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseFeedbackEntries } = require("./symbiot-connector-service/symbiot-reflexion-memory");

const ROOT = __dirname;
const INSTALLED_ROOT = path.join(process.env.LOCALAPPDATA, "Programs", "Symbiot");
const FEEDBACK_PATH = path.join(process.env.LOCALAPPDATA, "hermes", "feedback.md");
const INSTALLER_PATH = path.join(process.env.USERPROFILE, "Desktop", "SymbiotSetup.exe");
const OUTPUT = path.join(ROOT, "runtime_logs", "SYM_SAAS_D1_INSTALLED_PERFORMANCE_REFLEXION_PROOF_2026-08-01.json");
const BASE_URL = "http://127.0.0.1:8787";

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function jsonRequest(route, options) {
  const response = await fetch(`${BASE_URL}${route}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.reason || `HTTP ${response.status}`);
  return payload;
}

async function main() {
  const health = await jsonRequest("/health");
  assert.strictEqual(health.ok, true);
  const appResponse = await fetch(`${BASE_URL}/app?shell=desktop`);
  const appHtml = await appResponse.text();
  const tokenMatch = appHtml.match(/const\s+token\s*=\s*("(?:[^"\\]|\\.)*")/);
  assert(tokenMatch, "installed desktop token marker missing");
  const token = JSON.parse(tokenMatch[1]);
  const missionText = "Подготовь план ускорения работы LLM и библиотек Симбиота. Результат сохрани в Obsidian в 02_Личная_операционная_система_ритм/01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ/02_Missions. Укажи источники, ограничения и критерий приемки: пользователь видит этапы и подтверждает результат.";
  const timingsMs = [];
  let intake = null;
  for (let index = 0; index < 5; index += 1) {
    const started = Date.now();
    intake = await jsonRequest("/app/mission/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, source: "d1-installed-performance-reflexion-proof", missionText })
    });
    timingsMs.push(Date.now() - started);
  }
  assert.strictEqual(intake.status, "ready_for_approval");
  const warmAverageMs = timingsMs.slice(1).reduce((total, value) => total + value, 0) / 4;
  assert(warmAverageMs < 250, `installed warm mission intake too slow: ${warmAverageMs} ms`);
  assert(intake.libraryGate.summary.catalogItems >= 1000);
  assert(intake.reflexionMemory.relevantCount >= 1);

  const installState = JSON.parse(fs.readFileSync(path.join(INSTALLED_ROOT, "install-state.json"), "utf8"));
  const missionFolder = path.join(installState.vaultPath, ...intake.artifactBundle.baseFolder.split("/"));
  assert(!fs.existsSync(missionFolder), "installed proof wrote mission files before confirmation");

  const feedbackEntries = parseFeedbackEntries(fs.readFileSync(FEEDBACK_PATH, "utf8"));
  assert(feedbackEntries.length >= 1);
  const syncedFiles = [
    "server.js",
    "symbiot-library-gate.js",
    "symbiot-reference-adapters.js",
    "symbiot-reference-library.js",
    "symbiot-reference-taxonomy.js",
    "symbiot-runtime-core.js",
    "symbiot-reflexion-memory.js"
  ].map((fileName) => {
    const sourcePath = path.join(ROOT, "symbiot-connector-service", fileName);
    const installedPath = path.join(INSTALLED_ROOT, "connector-service", fileName);
    return { fileName, sourceSha256: sha256(sourcePath), installedSha256: sha256(installedPath) };
  });
  assert(syncedFiles.every((item) => item.sourceSha256 === item.installedSha256));
  assert(appHtml.includes("id=\"runtimeActivity\""));
  assert(appHtml.includes("id=\"activityTimer\""));
  assert(appHtml.includes("id=\"cancelOperation\""));

  const installer = fs.statSync(INSTALLER_PATH);
  const proof = {
    ok: true,
    gate: "D1 / TST-001 installed performance and Reflexion proof",
    generatedAt: new Date().toISOString(),
    readinessChanged: false,
    installedRuntime: {
      health: true,
      sourceFilesSynced: true,
      fileCount: syncedFiles.length,
      missionStatus: intake.status,
      missionFilesBeforeConfirmation: 0,
      catalogItems: intake.libraryGate.summary.catalogItems,
      timingsMs,
      warmAverageMs: Number(warmAverageMs.toFixed(1)),
      reflexionEntries: feedbackEntries.length,
      relevantRulesLoaded: intake.reflexionMemory.relevantCount,
      activityIndicator: true,
      timer: true,
      cancellationControl: true
    },
    installer: {
      path: INSTALLER_PATH,
      version: "0.1.3",
      bytes: installer.size,
      sha256: sha256(INSTALLER_PATH),
      signed: false
    },
    conditions: [
      "D1 manual acceptance by Dmitry remains open.",
      "Readiness remains 13205 / 14075 = 93.8%.",
      "Installer remains unsigned."
    ]
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
