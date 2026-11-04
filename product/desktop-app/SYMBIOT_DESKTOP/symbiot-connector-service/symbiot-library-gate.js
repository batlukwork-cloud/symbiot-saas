const { createHash } = require("crypto");
const {
  DEFAULT_LIBRARY_BASE_PATH,
  buildSeparatedLibraryCatalog
} = require("./symbiot-reference-adapters");

const LIBRARY_GATE_VERSION = "2026.07.27-v1";

const DEFAULT_SCOPE_ORDER = Object.freeze(["client", "project", "symbiot"]);

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function inferTaskHints(text) {
  const lower = normalizeText(text);
  const hints = [];
  if (/финанс|финмодел|расчет|excel|xlsx|таблиц|бюджет|смет/i.test(lower)) hints.push("financial_modeling", "calculation_validation");
  if (/договор|контракт|юрид|agreement|nda/i.test(lower)) hints.push("contract_drafting", "legal_review");
  if (/презентац|ppt|pitch|deck|слайд/i.test(lower)) hints.push("presentation_production", "investment_packaging");
  if (/бренд|айдентик|логотип|маркетинг|упаковк/i.test(lower)) hints.push("visual_packaging", "brand_application");
  if (/отчет|разбор|аудит|результат|паспорт/i.test(lower)) hints.push("reporting", "result_delivery");
  if (/код|плагин|runtime|рантайм|api|интеграц|desktop|десктоп/i.test(lower)) hints.push("runtime_design", "role_design");
  if (/методик|регламент|правил|процесс|бизнес-процесс|бп/i.test(lower)) hints.push("method_development", "standards_application");
  if (/рынок|исслед|конкурент|аналитик|источник/i.test(lower)) hints.push("knowledge_grounding");
  return uniqueStrings(hints);
}

function inferArtifactFamilyHints(text) {
  const lower = normalizeText(text);
  const hints = [];
  if (/финанс|финмодел|расчет|excel|xlsx|таблиц/i.test(lower)) hints.push("financial_model", "structured_data");
  if (/презентац|ppt|pitch|deck|слайд/i.test(lower)) hints.push("presentation");
  if (/бренд|айдентик|логотип|визуал/i.test(lower)) hints.push("brand_asset", "visual_asset");
  if (/код|плагин|runtime|рантайм|архитектур/i.test(lower)) hints.push("architecture_document", "knowledge_document");
  if (/договор|контракт|кп|коммерческ|отчет|документ|паспорт/i.test(lower)) hints.push("business_document", "accepted_result");
  if (/методик|регламент|правил|книг|гайд|исслед/i.test(lower)) hints.push("knowledge_document");
  return uniqueStrings(hints);
}

function buildMissionQuery(intake, contract, route) {
  const missionText = String(intake && intake.missionText || "");
  const expectedArtifact = String((contract && contract.expectedArtifact) || (intake && intake.expectedArtifact) || "");
  const destination = String((contract && contract.destination) || (intake && intake.destination) || "");
  const text = [missionText, expectedArtifact, destination].join("\n");
  return {
    missionText,
    expectedArtifact,
    destination,
    selectedRoleIds: uniqueStrings((route && route.selectedRoles || []).map((role) => role.id)),
    taskHints: inferTaskHints(text),
    artifactFamilyHints: inferArtifactFamilyHints(text)
  };
}

function roleMatches(item, selectedRoleIds) {
  const allowed = new Set(item.allowedRoleIds || []);
  const classified = new Set((item.classification && item.classification.roleIds) || []);
  return selectedRoleIds.some((roleId) => allowed.has(roleId) || classified.has(roleId));
}

function taskMatches(item, taskHints) {
  const taskTypes = new Set((item.classification && item.classification.taskTypes) || []);
  return taskHints.some((taskType) => taskTypes.has(taskType));
}

function artifactMatches(item, artifactFamilyHints) {
  return artifactFamilyHints.includes(item.classification && item.classification.artifactFamily);
}

function libraryAffinity(item, query) {
  const text = normalizeText([
    query.missionText,
    query.expectedArtifact,
    query.destination
  ].join(" "));
  const id = item.libraryId;
  if (/финанс|финмодел|расчет|excel|xlsx|таблиц|бюджет/.test(text) && id === "lib_financial_models") return 16;
  if (/договор|типов|шаблон|документ|docx|word/.test(text) && id === "lib_document_templates") return 14;
  if (/продаж|коммерческ|кп|воронк|offer|оффер/.test(text) && id === "lib_sales_commercial") return 14;
  if (/презентац|маркетинг|бренд|pitch|deck|слайд/.test(text) && id === "lib_marketing_brand") return 14;
  if (/rea|девелоп|идп|проект|земел|объект|рынок/.test(text) && id === "lib_rea_development") return 13;
  if (/роль|ai|агент|runtime|рантайм|плагин|desktop|десктоп|архитектур/.test(text) && id === "lib_ai_roles_sources") return 13;
  if (/эталон|пример|образец|качественн|принят/.test(text) && id === "lib_accepted_examples") return 15;
  if (/кейс|пакет|проект/.test(text) && id === "lib_project_cases") return 10;
  if (/методик|книг|гайд|исслед/.test(text) && id === "lib_books_methods") return 10;
  return 0;
}

function mapReference(item, query, scope) {
  const roleMatch = roleMatches(item, query.selectedRoleIds);
  const taskMatch = taskMatches(item, query.taskHints);
  const artifactMatch = artifactMatches(item, query.artifactFamilyHints);
  return {
    scope,
    libraryId: item.libraryId,
    libraryLabel: item.libraryLabel,
    sourceId: item.inventory.sourceId,
    relativePath: item.inventory.relativePath,
    fileName: item.inventory.fileName,
    extension: item.inventory.extension,
    sizeBytes: item.inventory.sizeBytes,
    modifiedAt: item.inventory.modifiedAt,
    sha256: item.inventory.sha256,
    qualityStatus: item.inventory.qualityStatus,
    classificationStatus: item.classification.classificationStatus,
    artifactFamily: item.classification.artifactFamily,
    artifactType: item.classification.artifactType,
    roleMatch,
    taskMatch,
    artifactMatch,
    accessMode: "READ_ONLY",
    referenceStatus: item.classification.classificationStatus === "CLASSIFIED"
      ? "candidate_reference"
      : "needs_review_before_reference_use"
  };
}

function scoreReference(reference, query) {
  const scopeScore = reference.scope === "client" ? 40 : reference.scope === "project" ? 25 : 10;
  const roleScore = reference.roleMatch ? 20 : 0;
  const taskScore = reference.taskMatch ? 18 : 0;
  const artifactScore = reference.artifactMatch ? 12 : 0;
  const classifiedScore = reference.classificationStatus === "CLASSIFIED" ? 8 : 0;
  const libraryScore = libraryAffinity(reference, query);
  return scopeScore + roleScore + taskScore + artifactScore + classifiedScore + libraryScore;
}

function configuredScopes(options) {
  const scopes = [
    {
      scope: "client",
      basePath: options.clientLibraryBasePath || process.env.SYMBIOT_CLIENT_LIBRARY_BASE_PATH || null
    },
    {
      scope: "project",
      basePath: options.projectLibraryBasePath || process.env.SYMBIOT_PROJECT_LIBRARY_BASE_PATH || null
    },
    {
      scope: "symbiot",
      basePath: options.symbiotLibraryBasePath || process.env.SYMBIOT_REFERENCE_LIBRARY_BASE_PATH || DEFAULT_LIBRARY_BASE_PATH
    }
  ];
  return scopes.filter((scope) => scope.basePath);
}

function runMissionLibraryGate({ intake, contract, route, options = {} }) {
  const query = buildMissionQuery(intake, contract, route);
  const maxReferences = Math.max(1, Math.min(Number(options.maxReferences || 12), 40));
  const maxFilesPerLibrary = Math.max(1, Math.min(Number(options.maxFilesPerLibrary || 5000), 25000));
  const catalogs = [];
  const unavailableScopes = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const scope of configuredScopes(options)) {
    try {
      const catalog = buildSeparatedLibraryCatalog({
        basePath: scope.basePath,
        adapters: options.adapters,
        includeHash: options.includeHash === true,
        maxFilesPerLibrary
      });
      if (catalog._runtimeCache && catalog._runtimeCache.status === "hit") cacheHits += 1;
      else cacheMisses += 1;
      catalogs.push({ scope: scope.scope, catalog });
    } catch (error) {
      unavailableScopes.push({
        scope: scope.scope,
        basePath: scope.basePath,
        status: "unavailable",
        reason: error.message
      });
    }
  }

  const candidates = catalogs.flatMap(({ scope, catalog }) =>
    catalog.items.map((item) => mapReference(item, query, scope))
  );
  const scored = candidates
    .map((reference) => ({ ...reference, score: scoreReference(reference, query) }))
    .filter((reference) =>
      reference.roleMatch ||
      reference.taskMatch ||
      reference.artifactMatch ||
      libraryAffinity(reference, query) > 0
    )
    .sort((left, right) =>
      right.score - left.score ||
      DEFAULT_SCOPE_ORDER.indexOf(left.scope) - DEFAULT_SCOPE_ORDER.indexOf(right.scope) ||
      left.relativePath.localeCompare(right.relativePath, "ru")
    );
  const selectedReferences = scored.slice(0, maxReferences);
  const selectedIds = new Set(selectedReferences.map((reference) => reference.sourceId));
  const rejectedReferences = scored
    .filter((reference) => !selectedIds.has(reference.sourceId))
    .slice(0, 20)
    .map((reference) => ({
      scope: reference.scope,
      libraryId: reference.libraryId,
      sourceId: reference.sourceId,
      relativePath: reference.relativePath,
      fileName: reference.fileName,
      score: reference.score,
      reason: "lower_ranked_candidate"
    }));

  const status = catalogs.length === 0
    ? "blocked_library_unavailable"
    : selectedReferences.length
      ? "passed_with_references"
      : "passed_no_references_yellow";
  const gate = {
    id: `library_gate_${intake.id}`,
    version: LIBRARY_GATE_VERSION,
    status,
    ok: status !== "blocked_library_unavailable",
    mandatory: true,
    ownerRoleId: "archive_registrar",
    ownerRoleRef: "РОЛЬ_AI_Архивариус_и_реестратор",
    modelCalls: 0,
    llmExecutionAllowed: false,
    scopeOrder: DEFAULT_SCOPE_ORDER,
    policy: {
      clientLibraryFirst: true,
      projectLibrarySecond: true,
      symbiotLibraryFallback: true,
      readOnly: true,
      fileMutation: false,
      contentExtraction: false,
      llmCalls: 0,
      automaticGoldPromotion: false,
      selectedReferencesBecomeAllowedSources: true,
      noSilentWholeVaultRead: true
    },
    query,
    summary: {
      catalogCount: catalogs.length,
      libraryCount: catalogs.reduce((total, entry) => total + entry.catalog.summary.libraryCount, 0),
      catalogItems: candidates.length,
      candidateCount: scored.length,
      selectedCount: selectedReferences.length,
      rejectedCount: Math.max(0, scored.length - selectedReferences.length),
      needsReviewCount: selectedReferences.filter((reference) => reference.classificationStatus === "NEEDS_REVIEW").length,
      unavailableScopeCount: unavailableScopes.length,
      cacheHits,
      cacheMisses
    },
    selectedReferences,
    rejectedReferences,
    unavailableScopes,
    afterMissionLoop: {
      required: true,
      action: "Архивариус сверяет результат миссии с эталонами и предлагает пополнение/улучшение библиотеки.",
      promotionRule: "GOLD/эталон создается только после приемки доменной ролью, методологом и QA; runtime сам не повышает качество."
    }
  };
  gate.sha256 = sha256(gate);
  return gate;
}

module.exports = {
  LIBRARY_GATE_VERSION,
  buildMissionQuery,
  inferArtifactFamilyHints,
  inferTaskHints,
  runMissionLibraryGate
};
