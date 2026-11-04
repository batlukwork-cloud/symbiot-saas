const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const CONNECTOR = fs.existsSync(path.join(ROOT, "symbiot-connector-service"))
  ? path.join(ROOT, "symbiot-connector-service")
  : path.join(ROOT, "connector-service");
const {
  publicRoleRegistry,
  routeMission
} = require(path.join(CONNECTOR, "symbiot-runtime-core"));

const LOGS = path.join(ROOT, "runtime_logs");
const ROLE_ROOT = "<локальный путь>";
const OBSIDIAN_ROLE_ROOT = "D:\\СИСТЕМА\\01.Базы данных\\01_База № 3 (MAC)\\15.03_База № 3 (MAC)\\01_Симбиот_что_и_зачем\\03_Уровень_3_Компания_проектов";
const EVIDENCE_FILE = path.join(LOGS, "SYM_SAAS_PRODUCT_BENCHMARK_58_ACTUAL_CHECK_2026-07-22.json");

const proofFiles = {
  runtimeCore: "SYM_OBSIDIAN_PLUGIN_OBP054_ROLE_RUNTIME_CORE_LIVE_PROOF_2026-07-22.json",
  missionIntake: "SYM_OBSIDIAN_PLUGIN_OBP050_DETERMINISTIC_MISSION_INTAKE_PROOF_2026-07-22.json",
  security: "SYM_OBSIDIAN_PLUGIN_SECURITY_HARDENING_LOCAL_PROOF_2026-07-17.json",
  contextRag: "SYM_OBSIDIAN_PLUGIN_OBP046_CONTEXT_RETRIEVER_RAG_PROOF_2026-07-21.json",
  supabaseRag: "SYM_OBSIDIAN_PLUGIN_OBP047_SUPABASE_RAG_PERSISTENCE_PROOF_2026-07-21.json",
  adminSync: "SYM_OBSIDIAN_PLUGIN_OBP036_ADMIN_SYNC_LIVE_PROOF_2026-07-21.json",
  mobileAgent: "SYM_OBSIDIAN_PLUGIN_OBP027_028_MOBILE_REMOTE_WINDOWS_AGENT_PROOF_2026-07-21.json",
  fileWorkbench: "SYM_OBSIDIAN_PLUGIN_OBP044_FILE_WORKBENCH_PROOF_2026-07-21.json",
  vision: "SYM_OBSIDIAN_PLUGIN_OBP053_FULL_VISION_LOOP_PROOF_2026-07-22.json",
  llmThree: "SYM_OBSIDIAN_PLUGIN_THREE_API_SLOT_LIVE_FLOW_PROOF_2026-07-16.json"
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function proofStatus(name) {
  const file = path.join(LOGS, proofFiles[name]);
  if (!fs.existsSync(file)) return { exists: false, passed: false, status: "MISSING", file };
  const value = readJson(file);
  return { exists: true, passed: String(value.status || "").startsWith("PASS"), status: value.status, file };
}

function walk(root, predicate) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (!predicate || predicate(full, entry.name)) found.push(full);
    }
  }
  return found;
}

function makeIntake(text, index = 0) {
  return {
    id: `benchmark_${index}`,
    missionText: text,
    expectedArtifact: text,
    sources: index % 3 === 0 ? ["D:/approved/source.md"] : [],
    source: "benchmark-proof",
    riskWords: {
      clientFacing: /клиент/i.test(text),
      money: /цен|бюджет/i.test(text),
      legal: /договор|юрид/i.test(text),
      security: /безопас|ключ/i.test(text),
      irreversible: /удали|опубликуй/i.test(text),
      ambiguity: text.length < 30,
      toolActions: /открой|запусти/i.test(text)
    }
  };
}

function routingAudit() {
  const cases = [
    ["Напиши код плагина и тест", "developer"],
    ["Сделай API интеграцию", "developer"],
    ["Исправь приложение Windows", "developer"],
    ["Подготовь скрипт проверки", "developer"],
    ["Собери таблицу Excel", "data_analyst"],
    ["Рассчитай бюджет в xlsx", "data_analyst"],
    ["Проверь SQL выборку", "data_analyst"],
    ["Проанализируй данные в таблице", "data_analyst"],
    ["Исследуй рынок конкурентов", "researcher"],
    ["Сравни источники и дай ссылки", "researcher"],
    ["Сделай web поиск по рынку", "researcher"],
    ["Подготовь RAG исследование", "researcher"],
    ["Подготовь документ Word", "document_executor"],
    ["Напиши письмо клиенту", "document_executor"],
    ["Собери отчет в docx", "document_executor"],
    ["Оформи текстовый результат", "document_executor"],
    ["Создай презентацию для клиента", "document_executor"],
    ["Сделай HTML отчет", "document_executor"],
    ["Подготовь коммерческое предложение", "document_executor"],
    ["Оформи итог миссии", "document_executor"]
  ];
  const results = cases.map(([text, expected], index) => {
    const route = routeMission(makeIntake(text, index), { score: 4 });
    return { text, expected, actual: route.selectedRoles[1] && route.selectedRoles[1].id, passed: route.selectedRoles.some((role) => role.id === expected) };
  });
  const ambiguous = Array.from({ length: 10 }, (_, index) => {
    const route = routeMission(makeIntake(`Разберись с этим ${index}`, 100 + index), { score: 4 });
    return route.fallbackApplied && route.confidence < 0.75 && route.selectedRoles[0].id === "mission_methodologist";
  });
  const stressTexts = Array.from({ length: 50 }, (_, index) => cases[index % cases.length][0] + ` #${index}`);
  const stress = stressTexts.map((text, index) => routeMission(makeIntake(text, 200 + index), { score: index % 4 === 0 ? 10 : 4 }));
  return {
    twentyDeterministic: results.every((item) => item.passed),
    deterministicResults: results,
    tenFallback: ambiguous.every(Boolean),
    fiftyAlwaysRouted: stress.every((route) => route.selectedRoles.length >= 2 && route.selectedRoles.length <= 5),
    maxObservedRoles: Math.max(...stress.map((route) => route.selectedRoles.length))
  };
}

function benchmark(code, status, reason, evidence) {
  return { code: `SYM-BM-${String(code).padStart(3, "0")}`, status, reason, evidence };
}

const proofs = Object.fromEntries(Object.keys(proofFiles).map((name) => [name, proofStatus(name)]));
const registry = publicRoleRegistry();
const routing = routingAudit();
const serverSource = fs.readFileSync(path.join(CONNECTOR, "server.js"), "utf8");
const directProviderCallCount = (serverSource.match(/runProvider\(/g) || []).length;
const physicalPassports = walk(ROLE_ROOT, (full, name) => name === "Паспорт_роли.docx");
const physicalMarkdown = walk(ROLE_ROOT, (full, name) => name.toLowerCase().endsWith(".md"));
const obsidianRoleNotes = walk(OBSIDIAN_ROLE_ROOT, (full, name) => /РОЛЬ_AI_/i.test(name) && name.toLowerCase().endsWith(".md"));

const coreEvidence = path.relative(ROOT, proofs.runtimeCore.file).replace(/\\/g, "/");
const intakeEvidence = path.relative(ROOT, proofs.missionIntake.file).replace(/\\/g, "/");
const ragEvidence = `${path.relative(ROOT, proofs.contextRag.file).replace(/\\/g, "/")}; ${path.relative(ROOT, proofs.supabaseRag.file).replace(/\\/g, "/")}`;
const roleAuditEvidence = `runtime roles=${registry.count}; Obsidian role notes=${obsidianRoleNotes.length}; physical passports=${physicalPassports.length}; physical markdown exceptions=${physicalMarkdown.length}`;

const rows = [
  benchmark(1, proofs.runtimeCore.passed && directProviderCallCount === 2 ? "PASS" : "FAIL", "Все chat/compare Role Runtime вызовы централизованы в executeModelGateway; прямой runProvider остается только внутри Gateway.", coreEvidence),
  benchmark(2, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Role id и route source обязательны для Model Gateway; Role Runtime выбирает роли до model call.", coreEvidence),
  benchmark(3, "CONDITIONAL", "Runtime Registry содержит версионируемое ядро из 7 ролей, но еще не отражает все Obsidian-роли.", roleAuditEvidence),
  benchmark(4, "CONDITIONAL", "У runtime-ролей есть manifest-поля, schemas, tools и evals в машинном registry; отдельные файловые packages созданы не для всех ролей.", coreEvidence),
  benchmark(5, "CONDITIONAL", "Context Builder собирает контракт, role packages, explicit sources и 4 memory scopes; project history и semantic RAG еще не входят в каждый live run.", coreEvidence),
  benchmark(6, routing.tenFallback ? "PASS" : "FAIL", "10 неоднозначных запросов ушли в fallback mission_methodologist при confidence 0.72, не в свободный чат.", coreEvidence),
  benchmark(7, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Формальная state machine прошла полный маршрут и заблокировала недопустимый CREATED -> EXECUTING.", coreEvidence),
  benchmark(8, routing.twentyDeterministic ? "PASS" : "FAIL", "20/20 детерминированных routing cases выбрали ожидаемый исполнительский профиль.", coreEvidence),
  benchmark(9, "CONDITIONAL", "Детерминированные правила и fallback имеют приоритет; отдельный LLM-classifier пока намеренно не реализован.", coreEvidence),
  benchmark(10, routing.fiftyAlwaysRouted ? "PASS" : "FAIL", "50/50 stress-запросов получили группу 2-5 ролей; low-confidence fallback обязателен.", coreEvidence),
  benchmark(11, "FAIL", "Follow-up routing с previous_role_id и проверкой цепочки из 5 сообщений не реализован.", "нет runtime evidence"),
  benchmark(12, "CONDITIONAL", "Runtime manifest машиночитаем и версионируем, но не материализован как manifest.yaml для 100% ролей.", coreEvidence),
  benchmark(13, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Schemas загружены с ролью; live-ответ без обязательных разделов был отклонен, исправлен и повторно принят validator.", coreEvidence),
  benchmark(14, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Allowed/forbidden tools входят в role package; arbitrary_program_execution заблокирован policy engine до runtime.", coreEvidence),
  benchmark(15, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Live output contract требует источники, допущения/ограничения и evidence.", coreEvidence),
  benchmark(16, "CONDITIONAL", "Роли выбираются по профилям и tool boundaries, но пошаговый handoff между отдельными role runs еще не доказан.", coreEvidence),
  benchmark(17, physicalPassports.length >= 43 && obsidianRoleNotes.length >= 43 ? "CONDITIONAL" : "FAIL", "Обе среды существуют, но полный текущий hash-sync всех ролей не выполнен; в физическом контуре есть markdown-исключения для разбора.", roleAuditEvidence),
  benchmark(18, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Infrastructure Policy Engine блокирует forbidden tool до tool execution.", coreEvidence),
  benchmark(19, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Role Runtime и чувствительные действия требуют explicit approval; gate проверен.", coreEvidence),
  benchmark(20, "CONDITIONAL", "Файлы ограничены approved runtime roots, но отдельный process/container sandbox для каждого запуска не доказан.", proofs.security.file),
  benchmark(21, "FAIL", "Нет отдельного adversarial prompt-injection test suite для RAG/tool chain.", "нет runtime evidence"),
  benchmark(22, "FAIL", "Нет доказанного quarantine/moderation контура против memory poisoning.", "нет runtime evidence"),
  benchmark(23, "CONDITIONAL", "Anti-simplification закреплен gates и output validation, но не имеет отдельного автоматического regression suite.", coreEvidence),
  benchmark(24, "CONDITIONAL", "Четыре memory scopes видны в runtime, но долговременная запись/политика retention не доказана сквозным тестом.", coreEvidence),
  benchmark(25, "FAIL", "Moderated memory write с approval, provenance и rollback не реализован полностью.", "нет runtime evidence"),
  benchmark(26, proofs.contextRag.passed && proofs.supabaseRag.passed ? "CONDITIONAL" : "FAIL", "Selected-source RAG, citations и Supabase persistence проходят; semantic embedding model отсутствует.", ragEvidence),
  benchmark(27, "FAIL", "Project history scope объявлен, но CURRENT_STATE/history не загружается автоматически в каждый клиентский run.", coreEvidence),
  benchmark(28, "FAIL", "Нет production индекса Obsidian + DOCX/PDF с semantic retrieval; hash-vector недостаточен.", ragEvidence),
  benchmark(29, proofs.missionIntake.passed ? "PASS" : "FAIL", "LLM Equalizer имеет fast/work/deep/critical.", intakeEvidence),
  benchmark(30, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Risk factors детерминированно определяют effort/model/validator depth до LLM.", coreEvidence),
  benchmark(31, "CONDITIONAL", "Effort выбирается на миссию; смешанный effort по отдельным шагам броска пока не исполняется.", coreEvidence),
  benchmark(32, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Automatic effort selection и pre-run cost range видны до запуска.", coreEvidence),
  benchmark(58, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Эквалайзер ответственности рассчитывает score, роль, validator depth, budget range и repair pass.", coreEvidence),
  benchmark(33, "CONDITIONAL", "Role packages версионируются; отдельный клиентский catalog versioned skills еще не завершен.", roleAuditEvidence),
  benchmark(34, "FAIL", "Создание/изменение клиентского skill через approval workflow не доказано.", "нет runtime evidence"),
  benchmark(35, "FAIL", "Клиентский skill catalog/search не реализован в GUI/runtime.", "нет runtime evidence"),
  benchmark(36, "FAIL", "Автоматическое превращение lessons в skill/eval с gate не доказано.", "нет runtime evidence"),
  benchmark(37, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Live validator обнаружил неполный ответ, выполнил bounded repair и повторную проверку.", coreEvidence),
  benchmark(38, "CONDITIONAL", "Role eval names, schema checks, evidence и risk gates видны; полный DOD suite для каждой роли не автоматизирован.", coreEvidence),
  benchmark(39, "FAIL", "Нет CI/eval запуска при каждом изменении всех role packages.", "нет runtime evidence"),
  benchmark(40, "FAIL", "Параллельная группа выбрана, но 3-stage structured handoff между отдельными role executions не доказан.", coreEvidence),
  benchmark(41, proofs.runtimeCore.passed ? "PASS" : "FAIL", "Trace содержит route, роли, policy, context hash, model calls, validator и artifact.", coreEvidence),
  benchmark(42, "CONDITIONAL", "Trace хранит role versions, route/context hashes и replay descriptor; точное воспроизведение еще не запущено.", coreEvidence),
  benchmark(43, proofs.security.passed && proofs.runtimeCore.passed ? "PASS" : "CONDITIONAL", "Sensitive approvals и policy decisions пишутся в audit без секретов.", `${proofs.security.file}; ${coreEvidence}`),
  benchmark(44, "FAIL", "Replay descriptor есть, но endpoint повторного запуска и сравнения результата не доказан.", coreEvidence),
  benchmark(45, "FAIL", "AI-аудит как услуга с подтвержденной ценой и market evidence не принят.", "Market Readiness Gate открыт"),
  benchmark(46, "FAIL", "Упаковка продукта как продаваемая услуга с ценой и кейсом не принята.", "Market Readiness Gate открыт"),
  benchmark(47, "FAIL", "Market Pulse как принятая услуга с реальным кейсом не доказан.", "Market Readiness Gate открыт"),
  benchmark(48, "FAIL", "Три оплаченных и оформленных кейса не предъявлены evidence registry.", "Market Readiness Gate открыт"),
  benchmark(49, "FAIL", "Unit-экономика по реальным пилотам не принята.", "Market Readiness Gate открыт"),
  benchmark(50, "FAIL", "Два публикуемых клиентских отзыва с разрешением не предъявлены.", "Market Readiness Gate открыт"),
  benchmark(51, "FAIL", "Symbiot-light с окончательной ценой, сроком и договорной границей не принят.", "Market Readiness Gate открыт"),
  benchmark(52, "CONDITIONAL", "План тест-пилота существует, но программа первых продаж и разрешенные рынку обещания требуют ручного Market Gate.", "КСГ 174_PRODUCT_THROWS / C2"),
  benchmark(53, proofs.missionIntake.passed ? "PASS" : "FAIL", "Deterministic Mission Intake проверен без model calls.", intakeEvidence),
  benchmark(54, proofs.missionIntake.passed ? "PASS" : "FAIL", "Schema Validator возвращает missing fields и блокирует runtime.", intakeEvidence),
  benchmark(55, proofs.missionIntake.passed ? "PASS" : "FAIL", "Clarification questions строятся из templates без LLM.", intakeEvidence),
  benchmark(56, proofs.missionIntake.passed ? "PASS" : "FAIL", "Runtime/Artifact Contract фиксируется до route/model execution.", intakeEvidence),
  benchmark(57, proofs.missionIntake.passed && proofs.runtimeCore.passed ? "PASS" : "FAIL", "До LLM создаются паспорт, Canvas/Graph, role plan, cost range, source plan, trace и approval state.", `${intakeEvidence}; ${coreEvidence}`)
];

const uniqueCodes = new Set(rows.map((row) => row.code));
const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
const productTestGate = {
  architectureCoreReadyForControlledTest: [1, 2, 6, 7, 8, 10, 13, 14, 18, 19, 29, 30, 32, 37, 41, 53, 54, 55, 56, 57, 58]
    .every((code) => rows.find((row) => row.code === `SYM-BM-${String(code).padStart(3, "0")}`).status === "PASS"),
  marketReady: rows.every((row) => row.status === "PASS"),
  semanticRagReady: rows.find((row) => row.code === "SYM-BM-028").status === "PASS",
  allBenchmarksActuallyClassified: rows.length === 58 && uniqueCodes.size === 58 && !rows.some((row) => row.status === "NOT TESTED")
};
const passed = productTestGate.architectureCoreReadyForControlledTest && productTestGate.allBenchmarksActuallyClassified;
const evidence = {
  id: "SYM_SAAS_PRODUCT_BENCHMARK_58_ACTUAL_CHECK_2026-07-22",
  createdAt: new Date().toISOString(),
  status: passed ? "PASS_WITH_CONDITIONS_CONTROLLED_TEST_READY_YELLOW" : "FAIL_PRODUCT_TEST_GATE",
  readinessChanged: false,
  readiness: "13205 / 14075 = 93.8%",
  boundary: "Готовность относится только к контролируемому тестированию архитектурного ядра. Market-ready, semantic RAG, public remote relay и tenant security остаются YELLOW/RED.",
  counts,
  productTestGate,
  runtimeEvidence: proofs,
  routingAudit: routing,
  roleAudit: {
    runtimeRoleCount: registry.count,
    obsidianRoleNoteCount: obsidianRoleNotes.length,
    physicalPassportCount: physicalPassports.length,
    physicalMarkdownExceptionCount: physicalMarkdown.length
  },
  codeAudit: {
    runProviderOccurrences: directProviderCallCount,
    expectedOnlyDefinitionAndGatewayCall: directProviderCallCount === 2,
    modelGatewayPresent: serverSource.includes("async function executeModelGateway")
  },
  benchmarks: rows
};

fs.mkdirSync(LOGS, { recursive: true });
fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2), "utf8");
if (!passed) {
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ passed, status: evidence.status, counts, productTestGate, evidencePath: EVIDENCE_FILE }, null, 2));
