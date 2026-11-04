const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const {
  appendFeedback,
  readRelevantFeedback
} = require("./symbiot-connector-service/symbiot-reflexion-memory");
const {
  buildSeparatedLibraryCatalog,
  clearSeparatedLibraryCatalogCache,
  DEFAULT_LIBRARY_BASE_PATH
} = require("./symbiot-connector-service/symbiot-reference-adapters");

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, "runtime_logs", "SYM_SAAS_D1_PERFORMANCE_REFLEXION_PROOF_2026-07-31.json");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await delay(100);
  }
  throw new Error("connector_health_timeout");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.reason || `HTTP ${response.status}`);
  return payload;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiot-d1-reflexion-"));
  const feedbackFile = path.join(tempRoot, "hermes", "feedback.md");
  const correction = appendFeedback({
    title: "Не повторять тяжёлый последовательный маршрут",
    context: "Агент оптимизировал миссию с ключом sk-test-secret-value",
    error: "Три независимых LLM ожидались последовательно.",
    correction: "Пользователь потребовал ускорить работу Симбиота.",
    futureRule: "Независимые LLM выполнять параллельно и показывать пользователю активный этап."
  }, { filePath: feedbackFile });
  const memory = readRelevantFeedback("ускорить независимые LLM и показывать этап", { filePath: feedbackFile });
  const feedbackContent = fs.readFileSync(feedbackFile, "utf8");
  assert.strictEqual(correction.written, true);
  assert.strictEqual(memory.relevantCount, 1);
  assert(!feedbackContent.includes("sk-test-secret-value"));
  assert(feedbackContent.includes("[SECRET_REDACTED]"));

  clearSeparatedLibraryCatalogCache();
  const catalogStarted = Date.now();
  const firstCatalog = buildSeparatedLibraryCatalog({ basePath: DEFAULT_LIBRARY_BASE_PATH, includeHash: false });
  const firstCatalogMs = Date.now() - catalogStarted;
  const cachedStarted = Date.now();
  const secondCatalog = buildSeparatedLibraryCatalog({ basePath: DEFAULT_LIBRARY_BASE_PATH, includeHash: false });
  const cachedCatalogMs = Date.now() - cachedStarted;
  assert(firstCatalog.summary.fileCount > 0);
  assert.strictEqual(secondCatalog._runtimeCache.status, "hit");
  assert(cachedCatalogMs < Math.max(80, firstCatalogMs / 4));

  const parallelMockDelayMs = 350;
  let mockDelayMs = parallelMockDelayMs;
  const mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answer: `mock:${body.length}` }));
      }, mockDelayMs);
    });
  });
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(0, "127.0.0.1", resolve);
  });
  const mockPort = mockServer.address().port;
  const connectorPort = await freePort();
  const connectorData = path.join(tempRoot, "connector-data");
  const connector = spawn(process.execPath, [path.join(ROOT, "symbiot-connector-service", "server.js")], {
    cwd: path.join(ROOT, "symbiot-connector-service"),
    env: {
      ...process.env,
      SYMBIOT_CONNECTOR_PORT: String(connectorPort),
      SYMBIOT_CONNECTOR_DATA_DIR: connectorData,
      SYMBIOT_ALLOW_LOCAL_PROVIDER: "1",
      SYMBIOT_LLM_TIMEOUT_MS: "5000",
      SYMBIOT_REFLEXION_FEEDBACK_PATH: feedbackFile
    },
    windowsHide: true,
    stdio: "ignore"
  });

  try {
    const baseUrl = `http://127.0.0.1:${connectorPort}`;
    await waitForHealth(baseUrl);
    const appHtml = await (await fetch(`${baseUrl}/app?shell=desktop`)).text();
    const tokenMatch = appHtml.match(/const\s+token\s*=\s*("(?:[^"\\]|\\.)*")/);
    assert(tokenMatch, "desktop token marker missing");
    const token = JSON.parse(tokenMatch[1]);
    const providers = [1, 2, 3].map((slot) => ({
      id: `mock-${slot}`,
      name: `Mock ${slot}`,
      protocol: "generic_http",
      model: `mock-${slot}`,
      endpoint: `http://127.0.0.1:${mockPort}/generate`,
      responsePath: "answer",
      requiresKey: false,
      authType: "none"
    }));
    const parallelStarted = Date.now();
    const parallel = await requestJson(`${baseUrl}/llm/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, live: true, prompt: "parallel proof", providers, operationId: "parallel-proof" })
    });
    const parallelMs = Date.now() - parallelStarted;
    assert.strictEqual(parallel.comparison.results.length, 3);
    assert(parallel.comparison.results.every((item) => item.status === "live_provider_passed"));
    assert(parallelMs < 900, `parallel comparison took ${parallelMs} ms`);

    mockDelayMs = 4000;
    const cancelStarted = Date.now();
    const pending = requestJson(`${baseUrl}/llm/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, live: true, prompt: "cancel proof", providers, operationId: "cancel-proof" })
    });
    await delay(150);
    const cancellation = await requestJson(`${baseUrl}/app/operation/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, operationId: "cancel-proof" })
    });
    const cancelled = await pending;
    const cancellationMs = Date.now() - cancelStarted;
    assert.strictEqual(cancellation.cancelled, true);
    assert(cancelled.comparison.results.every((item) => item.status === "cancelled_by_user"));
    assert(cancellationMs < 1500, `cancellation took ${cancellationMs} ms`);

    assert(appHtml.includes("id=\"runtimeActivity\""));
    assert(appHtml.includes("id=\"cancelOperation\""));
    assert(appHtml.includes("/app/reflexion/feedback"));

    const proof = {
      ok: true,
      gate: "D1 / TST-001 performance and Reflexion engineering proof",
      generatedAt: new Date().toISOString(),
      readinessChanged: false,
      results: {
        reflexion: {
          fileCreated: fs.existsSync(feedbackFile),
          correctionWritten: correction.written,
          relevantRulesLoaded: memory.relevantCount,
          secretRedacted: !feedbackContent.includes("sk-test-secret-value")
        },
        libraryCatalog: {
          files: firstCatalog.summary.fileCount,
          coldMs: firstCatalogMs,
          cachedMs: cachedCatalogMs,
          cacheStatus: secondCatalog._runtimeCache.status
        },
        llmGateway: {
          providers: parallel.comparison.results.length,
          parallelMs,
          sequentialEquivalentFloorMs: parallelMockDelayMs * 3,
          cancellationMs,
          cancellationStatus: cancelled.comparison.results.map((item) => item.status)
        },
        interface: {
          activityIndicator: true,
          timer: appHtml.includes("activityTimer"),
          cancelControl: true,
          correctionWriteRoute: true
        }
      }
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  } finally {
    connector.kill();
    await new Promise((resolve) => mockServer.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
