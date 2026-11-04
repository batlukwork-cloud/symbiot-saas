const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_LIBRARY_ADAPTERS,
  DEFAULT_LIBRARY_BASE_PATH,
  buildSeparatedLibraryCatalog,
  selectReferencesForRole
} = require("./symbiot-connector-service/symbiot-reference-adapters");

const PROJECT_ROOT = __dirname;
const LOG_DIR = path.join(PROJECT_ROOT, "runtime_logs");
const EVIDENCE_PATH = path.join(
  LOG_DIR,
  "SYM_SAAS_REF003_SEPARATED_LIBRARY_ADAPTERS_PROOF_2026-07-27.json"
);

function touch(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const fixtureBase = fs.mkdtempSync(path.join(os.tmpdir(), "sym-ref003-"));
for (const adapter of DEFAULT_LIBRARY_ADAPTERS) {
  fs.mkdirSync(path.join(fixtureBase, adapter.relativeRoot), { recursive: true });
}
touch(path.join(fixtureBase, "01_ШАБЛОНЫ_И_ТИПОВЫЕ_ДОКУМЕНТЫ", "Договор оказания услуг.docx"), "contract template");
touch(path.join(fixtureBase, "02_ФИНАНСЫ_И_ФИНМОДЕЛИ", "Финансовая модель проекта.xlsx"), "financial model");
touch(path.join(fixtureBase, "04_МАРКЕТИНГ_ПРЕЗЕНТАЦИИ_БРЕНД", "Инвестиционная презентация.pptx"), "deck");
touch(path.join(fixtureBase, "06_AI_РОЛИ_И_ИСХОДНИКИ", "role_runtime_concept.md"), "runtime");
touch(path.join(fixtureBase, "07_ПРИМЕРЫ_КАЧЕСТВЕННЫХ_РЕЗУЛЬТАТОВ", "accepted_result.docx"), "accepted");

const expectedRoots = [
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

const catalog = buildSeparatedLibraryCatalog({
  basePath: fixtureBase,
  includeHash: false,
  maxFilesPerLibrary: 100
});
const secondCatalog = buildSeparatedLibraryCatalog({
  basePath: fixtureBase,
  includeHash: false,
  maxFilesPerLibrary: 100
});

const financeRoute = selectReferencesForRole(catalog, {
  roleId: "data_analyst",
  libraryIds: ["lib_financial_models"],
  maxResults: 10
});
const developerRoute = selectReferencesForRole(catalog, {
  roleId: "developer",
  libraryIds: ["lib_ai_roles_sources"],
  maxResults: 10
});
const forbiddenFinanceRoute = selectReferencesForRole(catalog, {
  roleId: "brand_designer",
  libraryIds: ["lib_financial_models"],
  maxResults: 10
});

let outsideBaseBlocked = false;
try {
  buildSeparatedLibraryCatalog({
    basePath: fixtureBase,
    adapters: [{
      libraryId: "outside",
      label: "Outside",
      libraryType: "invalid",
      relativeRoot: "..\\outside",
      allowedRoleIds: ["quality_controller"]
    }]
  });
} catch (error) {
  outsideBaseBlocked = String(error.message).includes(
    "reference_adapter_outside_approved_base"
  );
}

let duplicateAdapterBlocked = false;
try {
  buildSeparatedLibraryCatalog({
    basePath: fixtureBase,
    adapters: [DEFAULT_LIBRARY_ADAPTERS[0], DEFAULT_LIBRARY_ADAPTERS[0]]
  });
} catch (error) {
  duplicateAdapterBlocked = String(error.message).includes(
    "reference_adapter_library_id_duplicate"
  );
}

const actualRoots = DEFAULT_LIBRARY_ADAPTERS.map((adapter) => adapter.relativeRoot);
const checks = {
  approvedBasePathUpdated:
    DEFAULT_LIBRARY_BASE_PATH === "D:\\СИСТЕМА\\02_БИБЛИОТЕКИ_СИМБИОТА",
  actualFlatRootsConnected:
    expectedRoots.every((root) => actualRoots.includes(root)) &&
    !actualRoots.includes("01_ДОКУМЕНТЫ_И_ШАБЛОНЫ") &&
    !actualRoots.includes("02_ПРЕЗЕНТАЦИИ"),
  adaptersReadOnly: catalog.adapters.every((adapter) =>
    adapter.accessMode === "READ_ONLY" &&
    adapter.writeAllowed === false &&
    adapter.automaticGoldPromotion === false
  ),
  noContentExtraction:
    catalog.policy.contentExtraction === false &&
    catalog.items.every((item) => item.inventory.contentExtracted === false),
  noLlmCalls: catalog.policy.llmCalls === 0,
  deterministicCatalogHash: catalog.catalogSha256 === secondCatalog.catalogSha256,
  sourceIdsUnique:
    new Set(catalog.items.map((item) => item.inventory.sourceId)).size ===
    catalog.items.length,
  financeRoleRouted:
    financeRoute.length === 1 &&
    financeRoute[0].libraryId === "lib_financial_models" &&
    financeRoute[0].accessMode === "READ_ONLY",
  developerRoleRouted:
    developerRoute.length === 1 &&
    developerRoute[0].libraryId === "lib_ai_roles_sources",
  forbiddenRoleBlocked: forbiddenFinanceRoute.length === 0,
  outsideBaseBlocked,
  duplicateAdapterBlocked
};

const passed = Object.values(checks).every(Boolean);
const evidence = {
  id: "REF-003",
  date: "2026-07-27",
  project: "SYM-SaaS / Symbiot Reference Architecture",
  gate: "Separated Library Adapters",
  status: passed
    ? "PASS_WITH_CONDITIONS_SEPARATED_LIBRARY_ADAPTERS_CURRENT_STRUCTURE_YELLOW"
    : "FAIL_SEPARATED_LIBRARY_ADAPTERS_RED",
  approvedBasePath: DEFAULT_LIBRARY_BASE_PATH,
  checks,
  summary: catalog.summary,
  boundaries: [
    "The proof checks the current flat Symbiot library structure through a fixture catalog.",
    "Adapters are read-only and do not mutate source library files.",
    "All files remain RAW; Dmitry approval and role/QA acceptance are required before GOLD promotion.",
    "Full semantic RAG, tenant isolation and live client-library sync remain separate proofs."
  ]
};

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  passed,
  status: evidence.status,
  evidencePath: EVIDENCE_PATH,
  libraryCount: catalog.summary.libraryCount,
  fileCount: catalog.summary.fileCount,
  checks
}, null, 2));
if (!passed) process.exitCode = 1;
