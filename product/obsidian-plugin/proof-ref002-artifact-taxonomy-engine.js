const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONNECTOR = path.join(ROOT, "symbiot-connector-service");
const RUNTIME_LOGS = path.join(ROOT, "runtime_logs");
const PILOT_ROOT = path.join(ROOT, "..", "..", "docs", "00_idea");
const { scanReferenceLibraries } = require(path.join(CONNECTOR, "symbiot-reference-library"));
const {
  CLASSIFICATION_SCHEMA,
  TAXONOMY_VERSION,
  classifyInventory,
  classifyInventoryRecord,
  validateClassification
} = require(path.join(CONNECTOR, "symbiot-reference-taxonomy"));

const fixtures = [
  ["WHITE_PAPER_product.docx", ".docx", "white_paper", "CLASSIFIED"],
  ["white-paper-market.pdf", ".pdf", "white_paper", "CLASSIFIED"],
  ["Белая книга продукта.md", ".md", "white_paper", "CLASSIFIED"],
  ["benchmark_matrix_market.xlsx", ".xlsx", "benchmark_matrix", "CLASSIFIED"],
  ["Матрица бенчмарков.csv", ".csv", "benchmark_matrix", "CLASSIFIED"],
  ["benchmark-matrix-v2.xlsx", ".xlsx", "benchmark_matrix", "CLASSIFIED"],
  ["full_benchmark_spec.docx", ".docx", "benchmark_specification", "CLASSIFIED"],
  ["Полные бенчмарки.pdf", ".pdf", "benchmark_specification", "CLASSIFIED"],
  ["role_runtime_concept.docx", ".docx", "role_runtime_architecture", "CLASSIFIED"],
  ["agent_role_system_architecture.pdf", ".pdf", "role_runtime_architecture", "CLASSIFIED"],
  ["Архитектура ролей.md", ".md", "role_runtime_architecture", "CLASSIFIED"],
  ["financial_model_v4.xlsx", ".xlsx", "financial_model", "CLASSIFIED"],
  ["Финансовая модель проекта.xlsm", ".xlsm", "financial_model", "CLASSIFIED"],
  ["financial-model-base.xls", ".xls", "financial_model", "CLASSIFIED"],
  ["Бизнес-план проекта.docx", ".docx", "business_plan", "CLASSIFIED"],
  ["business_plan_final.pdf", ".pdf", "business_plan", "CLASSIFIED"],
  ["business-plan-outline.md", ".md", "business_plan", "CLASSIFIED"],
  ["Договор оказания услуг.docx", ".docx", "contract", "CLASSIFIED"],
  ["contract-template.pdf", ".pdf", "contract", "CLASSIFIED"],
  ["agreement_draft.md", ".md", "contract", "CLASSIFIED"],
  ["Договор инвестирования.pdf", ".pdf", "contract", "CLASSIFIED"],
  ["Стандарт качества.docx", ".docx", "standard_or_regulation", "CLASSIFIED"],
  ["Регламент работы роли.pdf", ".pdf", "standard_or_regulation", "CLASSIFIED"],
  ["security-policy.md", ".md", "standard_or_regulation", "CLASSIFIED"],
  ["industry_standard.pdf", ".pdf", "standard_or_regulation", "CLASSIFIED"],
  ["Отчет по проекту.docx", ".docx", "report", "CLASSIFIED"],
  ["market_report.pdf", ".pdf", "report", "CLASSIFIED"],
  ["final-report.html", ".html", "report", "CLASSIFIED"],
  ["report-summary.md", ".md", "report", "CLASSIFIED"],
  ["Методика оценки.docx", ".docx", "methodology_or_digest", "CLASSIFIED"],
  ["Гайд по продукту.pdf", ".pdf", "methodology_or_digest", "CLASSIFIED"],
  ["research_digest.md", ".md", "methodology_or_digest", "CLASSIFIED"],
  ["Исследование рынка.pdf", ".pdf", "methodology_or_digest", "CLASSIFIED"],
  ["Инвестиционная презентация.pptx", ".pptx", "investment_presentation", "CLASSIFIED"],
  ["investor_deck.ppt", ".ppt", "investment_presentation", "CLASSIFIED"],
  ["product_presentation.pptx", ".pptx", "presentation", "CLASSIFIED"],
  ["Презентация проекта.pptx", ".pptx", "presentation", "CLASSIFIED"],
  ["pitch_deck.pptx", ".pptx", "presentation", "CLASSIFIED"],
  ["Презентация клиенту.ppt", ".ppt", "presentation", "CLASSIFIED"],
  ["brandbook.pdf", ".pdf", "brand_identity_asset", "CLASSIFIED"],
  ["logo-main.svg", ".svg", "brand_identity_asset", "CLASSIFIED"],
  ["Айдентика бренда.png", ".png", "brand_identity_asset", "CLASSIFIED"],
  ["brand_identity.jpg", ".jpg", "brand_identity_asset", "CLASSIFIED"],
  ["логотип-клиента.jpeg", ".jpeg", "brand_identity_asset", "CLASSIFIED"],
  ["qa-page-1.png", ".png", "rendered_page_evidence", "CLASSIFIED"],
  ["qa2-page-6.png", ".png", "rendered_page_evidence", "CLASSIFIED"],
  ["screenshot-result.jpg", ".jpg", "rendered_page_evidence", "CLASSIFIED"],
  ["Скриншот приемки.webp", ".webp", "rendered_page_evidence", "CLASSIFIED"],
  ["accepted_result.docx", ".docx", "accepted_artifact", "CLASSIFIED"],
  ["Принятый результат.pdf", ".pdf", "accepted_artifact", "CLASSIFIED"],
  ["final_accepted.xlsx", ".xlsx", "accepted_artifact", "CLASSIFIED"],
  ["table.xlsx", ".xlsx", "spreadsheet", "NEEDS_REVIEW"],
  ["document.docx", ".docx", "document", "NEEDS_REVIEW"],
  ["material.pdf", ".pdf", "reference_pdf", "NEEDS_REVIEW"],
  ["image.png", ".png", "image", "NEEDS_REVIEW"],
  ["notes.md", ".md", "knowledge_note", "NEEDS_REVIEW"],
  ["archive.bin", ".bin", "unknown", "NEEDS_REVIEW"]
];

function fixtureRecord(fileName, extension, index) {
  return {
    sourceId: `fixture_${String(index).padStart(3, "0")}`,
    fileName,
    extension,
    relativePath: fileName,
    libraryType: "fixture_library",
    qualityStatus: "RAW"
  };
}

fs.mkdirSync(RUNTIME_LOGS, { recursive: true });
const fixtureResults = fixtures.map(([fileName, extension, expectedType, expectedStatus], index) => {
  const actual = classifyInventoryRecord(fixtureRecord(fileName, extension, index));
  return {
    fileName,
    expectedType,
    actualType: actual.artifactType,
    expectedStatus,
    actualStatus: actual.classificationStatus,
    schemaValid: validateClassification(actual).valid,
    passed:
      actual.artifactType === expectedType &&
      actual.classificationStatus === expectedStatus &&
      validateClassification(actual).valid
  };
});

let invalidInputBlocked = false;
try {
  classifyInventoryRecord({ sourceId: "broken" });
} catch (error) {
  invalidInputBlocked = /record_invalid/.test(error.message);
}

const inventory = scanReferenceLibraries({
  roots: [{
    rootId: "sym_saas_l0_product_promise",
    libraryType: "product_documents",
    path: PILOT_ROOT
  }],
  includeHash: true,
  maxFiles: 5000
});
const first = classifyInventory(inventory);
const second = classifyInventory(inventory);
const byName = new Map(inventory.records.map((record) => [record.fileName, record.sourceId]));
const classificationBySource = new Map(first.classifications.map((item) => [item.sourceId, item]));
const expectedReal = [
  ["WHITE_PAPER_SYMBIOT_PRODUCT_BENEFITS_2026-07-20.docx", "white_paper"],
  ["benchmark_matrix_Symbiot_vs_JustAI_vs_Product_Isaev_2026-07-20.xlsx", "benchmark_matrix"],
  ["Agent_Role_Runtime_Concept.docx", "role_runtime_architecture"],
  ["agent_role_system_concept.docx", "role_runtime_architecture"],
  ["Симбиот_Полные_бенчмарки.docx", "benchmark_specification"],
  ["Controlling_Reasoning_Effort_in_LLMs_RU_EN_digest.pdf", "methodology_or_digest"],
  ["Гайд-Hermes-Часть3.pdf", "methodology_or_digest"],
  ["qa-page-1.png", "rendered_page_evidence"]
];
const realChecks = expectedReal.map(([fileName, expectedType]) => {
  const sourceId = byName.get(fileName);
  const classification = classificationBySource.get(sourceId);
  return {
    fileName,
    expectedType,
    actualType: classification && classification.artifactType,
    status: classification && classification.classificationStatus,
    passed: Boolean(
      classification &&
      classification.artifactType === expectedType &&
      classification.classificationStatus === "CLASSIFIED"
    )
  };
});

const checks = {
  schemaMachineReadable:
    CLASSIFICATION_SCHEMA.type === "object" &&
    Array.isArray(CLASSIFICATION_SCHEMA.required) &&
    CLASSIFICATION_SCHEMA.required.includes("classificationSha256"),
  fixtureCountAtLeast50: fixtures.length >= 50,
  allFixturesPassed: fixtureResults.every((result) => result.passed),
  invalidInputBlocked,
  realInventoryClassified: realChecks.every((result) => result.passed),
  deterministicTaxonomyHash: first.taxonomySha256 === second.taxonomySha256,
  noLlmCalls: first.policy.llmCalls === 0,
  noContentRead: first.policy.contentRead === false,
  noAutomaticGold: first.policy.automaticGoldPromotion === false &&
    first.classifications.every((item) => item.qualityStatus === "RAW"),
  ambiguousFilesNeedReview: fixtureResults
    .filter((result) => result.expectedStatus === "NEEDS_REVIEW")
    .every((result) => result.actualStatus === "NEEDS_REVIEW"),
  allOutputsSchemaValid: first.classifications.every((item) => validateClassification(item).valid)
};
const passed = Object.values(checks).every(Boolean);
const evidence = {
  id: "SYM_SAAS_REF002_ARTIFACT_TAXONOMY_ENGINE_PROOF_2026-07-26",
  createdAt: new Date().toISOString(),
  status: passed
    ? "PASS_WITH_CONDITIONS_ARTIFACT_TAXONOMY_PILOT_YELLOW"
    : "FAIL_ARTIFACT_TAXONOMY",
  runtimeLevel: "deterministic_metadata_taxonomy_pilot",
  boundary:
    "Доказывает schema/classifier/NEEDS_REVIEW на fixtures и одном разрешенном L0 inventory. Не доказывает типологию всех библиотек, пользовательскую приемку спорных классов, GOLD, semantic RAG или tenant isolation.",
  taxonomyVersion: TAXONOMY_VERSION,
  checks,
  fixtureSummary: {
    count: fixtures.length,
    passed: fixtureResults.filter((item) => item.passed).length,
    failed: fixtureResults.filter((item) => !item.passed)
  },
  realChecks,
  taxonomy: first
};
const evidencePath = path.join(
  RUNTIME_LOGS,
  "SYM_SAAS_REF002_ARTIFACT_TAXONOMY_ENGINE_PROOF_2026-07-26.json"
);
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({
  passed,
  status: evidence.status,
  evidencePath,
  fixtureCount: fixtures.length,
  fixturePassed: evidence.fixtureSummary.passed,
  inventorySummary: first.summary,
  checks
}, null, 2));
if (!passed) process.exitCode = 1;
