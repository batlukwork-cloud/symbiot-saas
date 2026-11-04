const assert = require("assert");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const connectorDirectory = path.join(__dirname, "symbiot-connector-service");
const vaultRoot = "D:\\СИСТЕМА\\01.Базы данных\\01_База № 3 (MAC)\\15.03_База № 3 (MAC)";
const profilePath = "ДИСПЕТЧЕРСКАЯ_СИМБИОТА/00_УПРАВЛЕНИЕ/КОНФИГУРАЦИЯ/PLUGIN_RUNTIME_PROFILE.json";
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiot-obp062-"));
const workspaceRoot = path.join(proofRoot, "01_INBOX", "Настройка диспетчерской");
const dataDirectory = path.join(proofRoot, "connector-data");
const port = 19500 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;

function vaultFile(vaultPath) {
  return path.join(vaultRoot, ...String(vaultPath).split("/"));
}

function entry(kind, vaultPath, content = fs.readFileSync(vaultFile(vaultPath), "utf8")) {
  return {
    kind,
    vaultPath,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    content
  };
}

function snapshot(profile, registry, sentinel) {
  const modifiedRegistry = JSON.parse(JSON.stringify(registry));
  const softwareType = modifiedRegistry.missionTypes.find((item) => item.id === "SOFTWARE_DELIVERY");
  assert.ok(softwareType, "SOFTWARE_DELIVERY must exist in Obsidian registry");
  softwareType.planSteps = [sentinel, ...softwareType.planSteps.slice(1)];
  const registryContent = `${JSON.stringify(modifiedRegistry, null, 2)}\n`;
  const entries = [
    entry("runtime_profile", profilePath),
    entry("mission_type_registry", profile.missionTypeRegistryPath, registryContent),
    ...profile.requiredDocuments.map((document) => entry(document.kind, document.path)),
    entry("mission_card_template", profile.cardTemplatePath),
    entry("dispatcher_architecture_canvas", profile.architectureCanvasPath),
    ...softwareType.methodPaths.map((methodPath) => entry("mission_method", methodPath))
  ];
  return {
    context: {
      profilePath,
      profileVersion: profile.schemaVersion,
      entries
    },
    registry: modifiedRegistry
  };
}

function startConnector() {
  return spawn(process.execPath, ["server.js"], {
    cwd: connectorDirectory,
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(port),
      SYMBIOT_CONNECTOR_DATA_DIR: dataDirectory,
      SYMBIOT_DISPATCHER_WORKSPACE_ROOT: workspaceRoot
    },
    windowsHide: true,
    stdio: "ignore"
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const payload = await response.json();
      if (response.ok && payload.ok) return;
    } catch (_) {
      // Connector can take a short moment to bind its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("connector_health_timeout");
}

async function request(requestPath, token, body) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function stopConnector(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) return resolve();
    child.once("exit", resolve);
    child.kill();
  });
}

async function main() {
  const profile = JSON.parse(fs.readFileSync(vaultFile(profilePath), "utf8"));
  const registry = JSON.parse(fs.readFileSync(vaultFile(profile.missionTypeRegistryPath), "utf8"));
  assert.strictEqual(profile.status, "ACTIVE", "Obsidian runtime profile must be active");
  assert.strictEqual(registry.missionTypes.length, 6, "Obsidian mission type registry must contain six types");
  const registeredPaths = [
    profile.missionTypeRegistryPath,
    profile.cardTemplatePath,
    profile.architectureCanvasPath,
    ...profile.requiredDocuments.map((item) => item.path),
    ...registry.missionTypes.flatMap((item) => item.methodPaths)
  ];
  registeredPaths.forEach((vaultPath) => assert.ok(fs.existsSync(vaultFile(vaultPath)), `registered Obsidian path must exist: ${vaultPath}`));

  const child = startConnector();
  try {
    await waitForHealth();
    const token = JSON.parse(fs.readFileSync(path.join(dataDirectory, "connector-token.json"), "utf8")).token;
    const missionText = "Доработать существующий Obsidian плагин, проверить API интеграцию и автоматические тесты.";

    const missing = await request("/dispatcher/v1/intake", token, {
      source: "obp062-proof",
      missionText,
      missionType: "SOFTWARE_DELIVERY",
      obsidianContextRequired: true
    });
    assert.strictEqual(missing.response.status, 200, "missing context must still create an observable contract");
    assert.strictEqual(missing.payload.status, "PAUSED_FOR_GATE", "mission without required Obsidian context must pause");
    assert.ok(missing.payload.contract.preflight.blockingReasons.includes("OBSIDIAN_RUNTIME_PROFILE_REQUIRED"), "missing profile must be explicit");

    const firstSnapshot = snapshot(profile, registry, "OBSIDIAN_PLAN_SENTINEL_V1");
    const prepared = await request("/dispatcher/v1/intake", token, {
      source: "obp062-proof",
      missionText,
      missionType: "SOFTWARE_DELIVERY",
      obsidianContextRequired: true,
      obsidianContext: firstSnapshot.context,
      missionTypeRegistry: [{ id: "OPERATIONS", label: "Adversarial body value" }]
    });
    assert.strictEqual(prepared.response.status, 200, "valid Obsidian snapshot must be accepted");
    assert.strictEqual(prepared.payload.status, "HUMAN_APPROVAL", "valid snapshot must reach human approval");
    assert.strictEqual(prepared.payload.contract.plan.steps[0], "OBSIDIAN_PLAN_SENTINEL_V1", "plan must come from captured MISSION_TYPES.json");
    assert.strictEqual(prepared.payload.contract.missionTypeRegistrySource, profile.missionTypeRegistryPath, "registry source must be the captured Obsidian file");
    assert.strictEqual(prepared.payload.contract.obsidianContext.entryCount, firstSnapshot.context.entries.length, "contract must record captured entries");
    assert.ok(fs.existsSync(path.join(prepared.payload.missionDirectory, "00_ВХОДЯЩИЕ", "OBSIDIAN_CONTEXT_MANIFEST.json")), "immutable context manifest must be written");

    const secondSnapshot = snapshot(profile, registry, "OBSIDIAN_PLAN_SENTINEL_V2_RECALCULATED");
    secondSnapshot.context.entries.forEach((contextEntry) => {
      const roundTrip = JSON.parse(JSON.stringify(contextEntry));
      const roundTripHash = crypto.createHash("sha256").update(roundTrip.content, "utf8").digest("hex");
      assert.strictEqual(roundTripHash, contextEntry.sha256, `context entry must survive JSON transport: ${contextEntry.vaultPath}`);
    });
    const recalculated = await request("/dispatcher/v1/recalculate", token, {
      source: "obp062-proof",
      missionId: prepared.payload.contract.missionId,
      obsidianContextRequired: true,
      obsidianContext: secondSnapshot.context
    });
    assert.strictEqual(recalculated.response.status, 200, "unapproved mission must accept a refreshed Obsidian snapshot");
    assert.strictEqual(
      recalculated.payload.contract.plan.steps[0],
      "OBSIDIAN_PLAN_SENTINEL_V2_RECALCULATED",
      `recalculation must rebuild the plan from Obsidian: ${JSON.stringify({ registrySource: recalculated.payload.contract.missionTypeRegistrySource, context: recalculated.payload.contract.obsidianContext, blockers: recalculated.payload.contract.preflight.blockingReasons })}`
    );
    assert.strictEqual(recalculated.payload.contract.state, "HUMAN_APPROVAL", "refresh must not approve or execute the mission");

    const tamperedSnapshot = snapshot(profile, registry, "TAMPERED");
    tamperedSnapshot.context.entries[1].content += "\nmodified-after-hash";
    const tampered = await request("/dispatcher/v1/intake", token, {
      source: "obp062-proof",
      missionText,
      missionType: "SOFTWARE_DELIVERY",
      obsidianContextRequired: true,
      obsidianContext: tamperedSnapshot.context
    });
    assert.strictEqual(tampered.payload.status, "PAUSED_FOR_GATE", "tampered context must pause the mission");
    assert.ok(tampered.payload.contract.preflight.blockingReasons.some((reason) => reason.startsWith("OBSIDIAN_CONTEXT_HASH_MISMATCH")), "hash mismatch must be visible");

    console.log(JSON.stringify({
      status: "PASS_OBSIDIAN_SOURCE_OF_TRUTH",
      registeredPaths: new Set(registeredPaths).size,
      missionTypes: registry.missionTypes.length,
      capturedEntries: prepared.payload.contract.obsidianContext.entryCount,
      initialState: prepared.payload.status,
      refreshedState: recalculated.payload.contract.state,
      bodyRegistryIgnored: prepared.payload.contract.missionType.id === "SOFTWARE_DELIVERY",
      tamperBlocked: tampered.payload.status === "PAUSED_FOR_GATE"
    }, null, 2));
  } finally {
    await stopConnector(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
