const fs = require("fs");
const os = require("os");
const path = require("path");
const { routeMission, buildContext, buildRuntimePrompt, buildExecutionTrace } = require("./symbiot-connector-service/symbiot-runtime-core");
const { runMissionLibraryGate } = require("./symbiot-connector-service/symbiot-library-gate");

const PROJECT_ROOT = __dirname;
const LOG_DIR = path.join(PROJECT_ROOT, "runtime_logs");
const EVIDENCE_PATH = path.join(
  LOG_DIR,
  "SYM_OBSIDIAN_PLUGIN_OBP057_MISSION_LIBRARY_GATE_PROOF_2026-07-27.json"
);

function writeFixture(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const libraryBase = fs.mkdtempSync(path.join(os.tmpdir(), "sym-obp057-library-"));
const requiredRoots = [
  "01_ШАБЛОНЫ_И_ТИПОВЫЕ_ДОКУМЕНТЫ",
  "02_ФИНАНСЫ_И_ФИНМОДЕЛИ",
  "03_ПРОДАЖИ_И_КОММЕРЧЕСКИЙ_БЛОК",
  "04_МАРКЕТИНГ_ПРЕЗЕНТАЦИИ_БРЕНД",
  "05_REA_ДЕВЕЛОПМЕНТ_МЕТОДИКИ",
  "06_AI_РОЛИ_И_ИСХОДНИКИ",
  "07_ПРИМЕРЫ_КАЧЕСТВЕННЫХ_РЕЗУЛЬТАТОВ",
  "09_БУХГАЛТЕРИЯ_И_ПЕРВИЧКА",
  "11_ПРОЕКТНЫЕ_КЕЙСЫ_И_ПАКЕТЫ",
  "14_КНИГИ_И_МЕТОДИЧЕСКИЕ_ИСТОЧНИКИ"
];
for (const root of requiredRoots) fs.mkdirSync(path.join(libraryBase, root), { recursive: true });
writeFixture(path.join(libraryBase, "01_ШАБЛОНЫ_И_ТИПОВЫЕ_ДОКУМЕНТЫ", "Договор оказания услуг.docx"), "contract");
writeFixture(path.join(libraryBase, "02_ФИНАНСЫ_И_ФИНМОДЕЛИ", "Финансовая модель проекта.xlsx"), "finance");
writeFixture(path.join(libraryBase, "06_AI_РОЛИ_И_ИСХОДНИКИ", "role_runtime_concept.md"), "runtime");
writeFixture(path.join(libraryBase, "07_ПРИМЕРЫ_КАЧЕСТВЕННЫХ_РЕЗУЛЬТАТОВ", "accepted_result.docx"), "accepted");

const intake = {
  id: "obp057fixture",
  missionText: "Доработай Symbiot Obsidian plugin и desktop runtime: добавь обязательную работу с библиотекой, паспорт миссии, trace и КСГ.",
  goal: "Доработать mission runtime библиотеки",
  expectedArtifact: "код, runtime proof и запись в КСГ",
  destination: "Obsidian vault и product source",
  sources: [],
  constraints: ["без удаления файлов клиента", "без секретов"],
  riskWords: {
    clientFacing: true,
    money: false,
    legal: false,
    security: false,
    irreversible: false,
    ambiguity: false,
    toolActions: true
  },
  source: "proof-obp057"
};
const contract = {
  id: "contract_obp057fixture",
  missionId: "mission_obp057fixture",
  goal: intake.goal,
  expectedArtifact: intake.expectedArtifact,
  destination: intake.destination,
  acceptanceCheck: "runtime prompt, context and trace include Library Gate",
  constraints: intake.constraints
};
const equalizer = {
  id: "equalizer_obp057fixture",
  score: 4,
  effortMode: "work",
  modelTier: "balanced",
  validatorDepth: "standard"
};
const route = routeMission(intake, equalizer);
const libraryGate = runMissionLibraryGate({
  intake,
  contract,
  route,
  options: {
    symbiotLibraryBasePath: libraryBase,
    includeHash: false,
    maxReferences: 8,
    maxFilesPerLibrary: 100
  }
});
const context = buildContext(intake, contract, route, { libraryGate });
const prompt = buildRuntimePrompt({ intake, contract, equalizer, route, context });
const policy = {
  id: "policy_obp057fixture",
  status: "approved_with_policy",
  approved: true,
  blockedReasons: []
};
const validator = {
  status: "passed_with_conditions",
  failedChecks: []
};
const trace = buildExecutionTrace({
  intake,
  contract,
  route,
  context,
  policy,
  runtimeStatus: "completed_yellow",
  validator,
  modelCalls: 0
});

const checks = {
  libraryGateMandatory: libraryGate.mandatory === true,
  noLlmBeforeGate: libraryGate.modelCalls === 0 && libraryGate.policy.llmCalls === 0,
  noFileMutation: libraryGate.policy.fileMutation === false && libraryGate.policy.readOnly === true,
  referencesSelected: libraryGate.status === "passed_with_references" && libraryGate.summary.selectedCount > 0,
  archivistOwnsGate: libraryGate.ownerRoleId === "archive_registrar",
  contextPolicyUpdated:
    context.sourcePolicy === "explicit_sources_plus_mandatory_library_gate" &&
    context.libraryGate.id === libraryGate.id &&
    context.libraryReferences.length === libraryGate.summary.selectedCount,
  promptContainsLibraryGate:
    prompt.includes("Library Gate") &&
    prompt.includes("Эталонные документы библиотеки") &&
    prompt.includes("role_runtime_concept.md"),
  traceContainsLibraryGate:
    trace.components.some((item) =>
      item.component === "Library Gate" &&
      item.status === "passed_with_references" &&
      item.evidence.selectedReferences > 0
    ),
  replayIncludesContext: trace.replay.contextSha256 === context.sha256,
  noAutomaticGold: libraryGate.policy.automaticGoldPromotion === false
};
const passed = Object.values(checks).every(Boolean);
const evidence = {
  id: "OBP-057",
  date: "2026-07-27",
  project: "SYM-SaaS / Symbiot Obsidian Plugin + Desktop Runtime",
  status: passed
    ? "PASS_WITH_CONDITIONS_MISSION_LIBRARY_GATE_YELLOW"
    : "FAIL_MISSION_LIBRARY_GATE_RED",
  checks,
  route: {
    id: route.id,
    selectedRoleIds: route.selectedRoles.map((role) => role.id)
  },
  libraryGate,
  context: {
    id: context.id,
    sourcePolicy: context.sourcePolicy,
    libraryReferenceCount: context.libraryReferences.length,
    sha256: context.sha256
  },
  trace: {
    id: trace.id,
    componentCount: trace.components.length,
    components: trace.components.map((item) => item.component),
    sha256: trace.sha256
  },
  boundaries: [
    "This proof checks deterministic mission-time Library Gate wiring with fixture files.",
    "It does not perform semantic content extraction or vector RAG.",
    "It does not promote library files to GOLD automatically.",
    "Client and project library roots are supported by environment/config, but tenant isolation remains a separate production proof."
  ]
};

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  passed,
  status: evidence.status,
  evidencePath: EVIDENCE_PATH,
  libraryGateStatus: libraryGate.status,
  selectedReferences: libraryGate.summary.selectedCount,
  traceComponents: evidence.trace.components,
  checks
}, null, 2));
if (!passed) process.exitCode = 1;
