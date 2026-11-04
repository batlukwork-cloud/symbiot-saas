const { spawn } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const CONNECTOR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const { hydrateApiVaultEnv } = require(path.join(CONNECTOR, "api-vault-env"));
const {
  requestHeaders,
  connectorTokenFingerprint
} = require(path.join(CONNECTOR, "connector-auth-helper"));
const {
  createTaskStateMachine,
  transitionTaskState
} = require(path.join(CONNECTOR, "symbiot-runtime-core"));

const PORT = Number(process.env.SYMBIOT_PROOF_PORT || 8804);
const BASE = `http://127.0.0.1:${PORT}`;
const RUNTIME_LOGS = path.join(ROOT, "runtime_logs");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepSeekKey() {
  hydrateApiVaultEnv({ records: [["sym-saas.deepseek.api-key", "DEEPSEEK_API_KEY"]] });
  const secret = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!secret) throw new Error("deepseek_key_not_found_in_api_vault");
  return secret;
}

async function request(method, route, body, authenticated = true) {
  const headers = { "content-type": "application/json" };
  if (authenticated) Object.assign(headers, requestHeaders(body));
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (error) { json = { parseError: error.message, raw }; }
  return { ok: response.ok, status: response.status, json };
}

async function waitForHealth() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const health = await request("GET", "/health");
      if (health.ok && health.json && health.json.ok) return;
    } catch (error) {
      // Connector is still starting.
    }
    await wait(150);
  }
  throw new Error("connector_health_timeout");
}

function hasSecret(value, secret) {
  return JSON.stringify(value).includes(secret);
}

(async () => {
  fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
  const secret = deepSeekKey();
  const keyFingerprint = createHash("sha256").update(secret).digest("hex").slice(0, 12);
  const child = spawn(process.execPath, [path.join(CONNECTOR, "server.js")], {
    cwd: CONNECTOR,
    env: { ...process.env, SYMBIOT_CONNECTOR_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForHealth();
    const unauthorizedRegistry = await request("GET", "/role-registry", null, false);
    const connect = await request("POST", "/providers/connect", {
      source: "proof-obp054-role-runtime-core-live",
      input: `deepseek:${secret}`,
      slot: 1
    });
    const registry = await request("GET", "/role-registry");
    const mission = {
      source: "proof-obp054-role-runtime-core-live",
      missionText: "Подготовь краткий проверяемый план запуска клиентского теста Симбиота по разрешенным источникам и сохрани результат в Obsidian.",
      userFields: {
        expectedArtifact: "план клиентского теста",
        destination: "Obsidian vault / 02_Missions",
        sources: ["D:/approved/SYMBIOT_TEST_SCOPE.md"],
        acceptanceCheck: "результат содержит план, источники, допущения, evidence, ограничения и следующий шаг"
      }
    };
    const approvalGate = await request("POST", "/mission/full-loop", { ...mission, approved: false });
    const forbiddenTool = await request("POST", "/mission/full-loop", {
      ...mission,
      approved: true,
      requestedTools: ["arbitrary_program_execution"]
    });
    const live = await request("POST", "/mission/full-loop", {
      ...mission,
      approved: true,
      executeLlm: true,
      live: true
    });

    const roles = registry.json && registry.json.roleRegistry ? registry.json.roleRegistry.roles || [] : [];
    const loop = live.json && live.json.fullMissionLoop ? live.json.fullMissionLoop : null;
    const components = loop && Array.isArray(loop.infrastructureTrace) ? loop.infrastructureTrace : [];
    const expectedComponents = ["Gateway", "Router", "Role Registry", "Context Builder", "Role Runtime", "Validator", "Trace"];
    const artifactPath = loop && loop.result ? loop.result.path : null;
    const expectedStates = ["CREATED", "ROUTING", "ROLE_SELECTED", "CONTEXT_BUILDING", "READY_TO_RUN", "EXECUTING", "VALIDATING", "COMPLETED"];
    let invalidTransitionBlocked = false;
    try {
      const invalidMachine = createTaskStateMachine("invalid-transition-proof");
      transitionTaskState(invalidMachine, "EXECUTING", "must_fail");
    } catch (error) {
      invalidTransitionBlocked = /invalid_task_state_transition/.test(error.message);
    }
    const checks = {
      registryRequiresAuth: unauthorizedRegistry.status === 401,
      deepSeekConnected: Boolean(connect.ok && connect.json && connect.json.provider && connect.json.provider.keyPresent),
      versionedRegistryPresent: roles.length >= 7 && roles.every((role) => role.version && role.outputSchema && Array.isArray(role.allowedTools) && Array.isArray(role.forbiddenTools) && Array.isArray(role.evals)),
      approvalBlocksRuntime: Boolean(approvalGate.ok && approvalGate.json && approvalGate.json.status === "ready_for_approval" && approvalGate.json.runtimeStarted === false && approvalGate.json.modelCallsBeforeApproval === 0),
      forbiddenToolBlockedByPolicy: Boolean(!forbiddenTool.ok && forbiddenTool.status === 409 && forbiddenTool.json && forbiddenTool.json.status === "blocked_by_runtime_policy"),
      liveFullLoopPassed: Boolean(live.ok && loop && loop.status === "completed_yellow"),
      boundedRoleTeam: Boolean(loop && loop.roles.length >= 2 && loop.roles.length <= 5),
      rolePackagesUsedAtRuntime: Boolean(loop && loop.roles.every((role) => role.roleVersion && role.outputSchema && Array.isArray(role.allowedTools) && Array.isArray(role.evals))),
      exactInfrastructureChain: expectedComponents.every((name, index) => components[index] && components[index].component === name),
      formalStateMachineComplete: Boolean(loop && loop.taskMachine && expectedStates.every((name, index) => loop.taskMachine.history[index] && loop.taskMachine.history[index].state === name)),
      invalidStateTransitionBlocked: invalidTransitionBlocked,
      contextBuilderExplicitOnly: Boolean(loop && loop.context && loop.context.sourcePolicy === "explicit_sources_only" && loop.context.sourceCount === 1),
      fourMemoryLayers: Boolean(loop && loop.context && Object.keys(loop.context.memoryLayers || {}).length === 4),
      policyPassed: Boolean(loop && loop.policy && loop.policy.status === "approved_with_policy" && loop.policy.secretsMayEnterTrace === false),
      liveLlmAnswerNonEmpty: Boolean(loop && loop.llmExecution && loop.llmExecution.status === "live_provider_passed" && String(loop.llmExecution.answer || "").trim().length > 20),
      everyModelCallPassedGateway: Boolean(loop && loop.llmExecution && loop.llmExecution.modelCalls >= 1 && loop.llmExecution.gateway && loop.llmExecution.gateway.roleId && loop.llmExecution.contractSectionsComplete === true),
      llmEconomicsVisible: Boolean(loop && loop.llmExecution && Number.isFinite(loop.llmExecution.latencyMs) && loop.llmExecution.usage && Number.isFinite(loop.llmExecution.estimatedCostUsd)),
      outputValidatorPassed: Boolean(loop && loop.outputValidation && loop.outputValidation.status === "passed_with_conditions" && loop.outputValidation.failedChecks.length === 0),
      artifactExistsAndHasHash: Boolean(artifactPath && fs.existsSync(artifactPath) && loop.result.sha256 && fs.statSync(artifactPath).size > 200),
      replayDescriptorPresent: Boolean(loop && loop.executionTrace && loop.executionTrace.replay && loop.executionTrace.sha256 && loop.executionTrace.secretsRecorded === false),
      noSecretLeak: !hasSecret({ unauthorizedRegistry, connect, registry, approvalGate, forbiddenTool, live }, secret)
    };
    const passed = Object.values(checks).every(Boolean);
    const evidence = {
      id: "SYM_OBSIDIAN_PLUGIN_OBP054_ROLE_RUNTIME_CORE_LIVE_PROOF_2026-07-22",
      createdAt: new Date().toISOString(),
      status: passed ? "PASS_WITH_CONDITIONS_ROLE_RUNTIME_CORE_LIVE_YELLOW" : "FAIL_ROLE_RUNTIME_CORE_LIVE",
      runtimeLevel: "versioned_role_runtime_test_pilot",
      boundary: "Подтверждает реальную архитектурную цепочку и один live LLM-запуск. Не подтверждает market-ready, публичный relay, tenant security audit или глубокую приемку качества всех 58 benchmark.",
      keyFingerprint,
      connectorTokenFingerprint: connectorTokenFingerprint(),
      checks,
      runtime: loop ? {
        coreVersion: loop.runtimeCoreVersion,
        status: loop.status,
        roleCount: loop.roles.length,
        route: loop.route,
        context: loop.context,
        policyStatus: loop.policy.status,
        components: components.map((item) => ({ component: item.component, status: item.status })),
        taskStates: loop.taskMachine.history,
        provider: loop.llmExecution.providerName,
        model: loop.llmExecution.model,
        latencyMs: loop.llmExecution.latencyMs,
        usage: loop.llmExecution.usage,
        estimatedCostUsd: loop.llmExecution.estimatedCostUsd,
        validator: loop.outputValidation,
        artifact: loop.result,
        traceSha256: loop.executionTrace.sha256
      } : null,
      stdout: stdout.slice(-1000),
      stderr: stderr.slice(-1000)
    };
    const evidencePath = path.join(RUNTIME_LOGS, "SYM_OBSIDIAN_PLUGIN_OBP054_ROLE_RUNTIME_CORE_LIVE_PROOF_2026-07-22.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    if (!passed) {
      console.error(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ passed, status: evidence.status, evidencePath, checks }, null, 2));
    }
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
