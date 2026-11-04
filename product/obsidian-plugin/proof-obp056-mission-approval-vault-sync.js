const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONNECTOR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const RUNTIME_LOGS = path.join(ROOT, "runtime_logs");
const TEMP_ROOT = path.join(RUNTIME_LOGS, "obp056_mission_approval_vault_sync");
const TEMP_VAULT = path.join(TEMP_ROOT, "client-vault");
const TEMP_DATA = path.join(TEMP_ROOT, "connector-data");
const OUT_FILE = path.join(RUNTIME_LOGS, "SYM_OBSIDIAN_PLUGIN_OBP056_MISSION_APPROVAL_VAULT_SYNC_PROOF_2026-07-27.json");
const PORT = Number(process.env.SYMBIOT_OBP056_PROOF_PORT || 18856);
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {
    json = { raw };
  }
  return { ok: response.ok, status: response.status, json, raw };
}

async function waitForHealth() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const health = await request("GET", "/health");
      if (health.ok && health.json && health.json.ok) return;
    } catch (_) {
      // Connector is still starting.
    }
    await wait(150);
  }
  throw new Error("connector_health_timeout");
}

function ensureSafeTempRoot() {
  const resolvedLogs = path.resolve(RUNTIME_LOGS);
  const resolvedTemp = path.resolve(TEMP_ROOT);
  const relative = path.relative(resolvedLogs, resolvedTemp);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe_temp_root");
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEMP_VAULT, ".obsidian"), { recursive: true });
  fs.mkdirSync(TEMP_DATA, { recursive: true });
}

function readRelative(relativePath) {
  return fs.readFileSync(path.join(TEMP_VAULT, ...relativePath.split("/")), "utf8");
}

function existsRelative(relativePath) {
  return fs.existsSync(path.join(TEMP_VAULT, ...relativePath.split("/")));
}

function noSecretLeak(value) {
  return !/(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_\-$]{12,}|AIza[0-9A-Za-z_-]{12,}|postgresql:\/\/[^:\s]+:[^@\s]+@)/i.test(JSON.stringify(value));
}

(async () => {
  fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
  ensureSafeTempRoot();
  const child = spawn(process.execPath, [path.join(CONNECTOR, "server.js")], {
    cwd: CONNECTOR,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(PORT),
      SYMBIOT_CONNECTOR_DATA_DIR: TEMP_DATA,
      SYMBIOT_VAULT_PATH: TEMP_VAULT,
      SYMBIOT_LLM_LIVE_ENABLED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForHealth();
    const app = await request("GET", "/app?shell=desktop");
    const tokenMatch = app.raw.match(/const token = ("[^"]+");/);
    if (!tokenMatch) throw new Error("desktop_pairing_token_not_found");
    const token = JSON.parse(tokenMatch[1]);
    const missionBody = {
      token,
      source: "proof-obp056-mission-approval-vault-sync",
      missionText: "Подготовь план запуска новой услуги для малого бизнеса. Результат сохрани в Obsidian в операционный слой ЛОС: 02_Личная_операционная_система_ритм/01_ПРОТОКОЛЫ_ДНЯ_И_ЛОГИ/02_Missions. Укажи допущения, источники и следующий шаг."
    };
    const intake = await request("POST", "/app/mission/intake", missionBody);
    const intakeRecord = intake.json;
    const baseFolder = intakeRecord && intakeRecord.artifactBundle ? intakeRecord.artifactBundle.baseFolder : "";
    const missionFolderBeforeConfirmation = baseFolder
      ? fs.existsSync(path.join(TEMP_VAULT, ...baseFolder.split("/")))
      : false;
    const confirm = await request("POST", "/app/mission/confirm", {
      token,
      source: "proof-obp056-mission-approval-vault-sync",
      intakeId: intakeRecord.id,
      approved: true,
      executeLlm: false,
      live: false
    });
    const loop = confirm.json && confirm.json.fullMissionLoop ? confirm.json.fullMissionLoop : null;
    const expectedFiles = [
      `${baseFolder}/00_Паспорт_миссии.md`,
      `${baseFolder}/01_Маршрут_миссии.canvas`,
      `${baseFolder}/03_AI_Команда.md`,
      `${baseFolder}/04_Результат.md`,
      `${baseFolder}/05_Evidence.md`,
      `${baseFolder}/06_Execution_Trace.md`,
      `${baseFolder}/07_Pre_LLM_Trace.md`,
      `${baseFolder}/08_Граф_связей.md`,
      `${baseFolder}/symbiot-mission-manifest.json`
    ];
    const passport = expectedFiles.every(existsRelative) ? readRelative(expectedFiles[0]) : "";
    const manifest = expectedFiles.every(existsRelative) ? JSON.parse(readRelative(expectedFiles[8])) : null;
    const replay = await request("POST", "/app/mission/confirm", {
      token,
      source: "proof-obp056-mission-approval-vault-sync",
      intakeId: intakeRecord.id,
      approved: true,
      executeLlm: false,
      live: false
    });
    const checks = {
      desktopHasExplicitApprovalActions: app.ok
        && app.raw.includes("Скорректировать")
        && app.raw.includes("Подтвердить и запустить")
        && app.raw.includes("/app/mission/confirm"),
      intakePreparedWithoutLlm: Boolean(intake.ok && intakeRecord.status === "ready_for_approval" && intakeRecord.modelCalls === 0),
      intakeHasLibraryGate: Boolean(
        intakeRecord.libraryGate &&
        intakeRecord.libraryGate.mandatory === true &&
        intakeRecord.libraryGate.modelCalls === 0 &&
        intakeRecord.contextPlan &&
        intakeRecord.contextPlan.sourcePolicy === "explicit_sources_plus_mandatory_library_gate"
      ),
      nothingWrittenBeforeConfirmation: !missionFolderBeforeConfirmation,
      confirmationUsesPreparedIntake: Boolean(confirm.ok && loop && loop.intakeId === intakeRecord.id && loop.missionId === intakeRecord.runtimeContract.missionId),
      fullRuntimeLoopCompleted: Boolean(
        loop &&
        loop.status === "completed_yellow" &&
        loop.infrastructureTrace.length === 8 &&
        loop.infrastructureTrace.some((item) => item.component === "Library Gate")
      ),
      fullLoopHasLibraryGate: Boolean(
        loop &&
        loop.libraryGate &&
        loop.libraryGate.status &&
        loop.qa &&
        loop.qa.checks &&
        loop.qa.checks.libraryGateMandatory === true &&
        loop.qa.checks.referenceLibraryContextBuilt === true
      ),
      configuredVaultSelected: Boolean(loop && loop.vaultSync && loop.vaultSync.source === "environment"),
      missionFolderAndAllFilesWritten: expectedFiles.every(existsRelative) && loop.vaultSync.fileCount === expectedFiles.length,
      passportCompleted: passport.includes("status: completed_yellow") && passport.includes("## 11. Подтверждение и ход выполнения") && passport.includes("## 12. Результат"),
      passportContainsSingleHistory: passport.includes("## 04. Маршрут миссии") && passport.includes("## 05. AI-команда") && passport.includes("## 07. Pre-LLM trace") && passport.includes("## 08. Граф связей"),
      passportContainsLibraryGate: passport.includes("Эталонные документы библиотеки") && passport.includes("Library Gate обязателен"),
      manifestLinksSameIntake: Boolean(manifest && manifest.intakeId === intakeRecord.id && manifest.status === "completed_yellow" && manifest.resultStoredInPassport === true && manifest.libraryGate && manifest.libraryGate.id),
      repeatConfirmationBlocked: replay.status === 409 && replay.json && replay.json.status === "mission_intake_not_ready_for_approval",
      noSecretLeak: noSecretLeak({ app: app.raw, intake: intake.json, confirm: confirm.json, replay: replay.json })
    };
    const passed = Object.values(checks).every(Boolean);
    const proof = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP056_MISSION_APPROVAL_VAULT_SYNC_PROOF_2026-07-27",
      createdAt: new Date().toISOString(),
      status: passed ? "PASS_WITH_CONDITIONS_MISSION_APPROVAL_VAULT_SYNC_YELLOW" : "FAIL_MISSION_APPROVAL_VAULT_SYNC",
      runtimeLevel: "local_desktop_to_real_obsidian_vault_bridge_proof",
      checks,
      mission: {
        intakeId: intakeRecord.id,
        missionId: loop && loop.missionId,
        baseFolder,
        fileCount: loop && loop.vaultSync ? loop.vaultSync.fileCount : 0,
        expectedFiles
      },
      boundary: "Доказывает явное подтверждение, обязательный Library Gate и запись полного комплекта из девяти файлов миссии в выбранный vault. Не закрывает ручную приемку Дмитрием, цифровую подпись, публичный mobile relay, semantic RAG или production tenant security.",
      stdout: stdout.slice(-1000),
      stderr: stderr.slice(-1000)
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(proof, null, 2), "utf8");
    console.log(JSON.stringify({ passed, status: proof.status, checks, evidencePath: OUT_FILE }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
