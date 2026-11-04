const { createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REFLEXION_VERSION = "2026.07.31-v1";
const DEFAULT_FEEDBACK_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "hermes",
  "feedback.md"
);

const FEEDBACK_HEADER = `# Reflexion-журнал — разбор ошибок агента

> Назначение: когда пользователь исправляет ошибку агента, агент записывает сюда:
> что пошло не так → почему → как правильно.
> При будущих похожих задачах — читает этот файл, чтобы не повторять ошибки.

---

## Формат записи

\`\`\`
### [дата] Краткое описание ошибки
- **Контекст:** что агент делал
- **Ошибка:** что сделал не так
- **Исправление:** что сказал пользователь
- **На будущее:** как избежать повтора
\`\`\`

---

## Записи

<!-- Записи добавляются ниже -->
`;

const STOP_WORDS = new Set([
  "агент", "будет", "была", "были", "быть", "весь", "вот", "для", "его", "если",
  "или", "как", "когда", "надо", "она", "они", "при", "свой", "так", "что", "это"
]);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function feedbackPath(options = {}) {
  return path.resolve(options.filePath || process.env.SYMBIOT_REFLEXION_FEEDBACK_PATH || DEFAULT_FEEDBACK_PATH);
}

function redactSensitive(value) {
  return String(value || "")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[SECRET_REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi, "$1[SECRET_REDACTED]")
    .replace(/\b(api[_ -]?key|token|password|пароль|секрет)\s*[:=]\s*[^\s,;]+/gi, "$1: [SECRET_REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

function ensureFeedbackFile(options = {}) {
  const filePath = feedbackPath(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, FEEDBACK_HEADER, "utf8");
  return filePath;
}

function parseFeedbackEntries(content) {
  const entries = [];
  const pattern = /^### \[([^\]]+)\] ([^\n]+)\n- \*\*Контекст:\*\* ([^\n]*)\n- \*\*Ошибка:\*\* ([^\n]*)\n- \*\*Исправление:\*\* ([^\n]*)\n- \*\*На будущее:\*\* ([^\n]*)/gm;
  let match;
  while ((match = pattern.exec(String(content || "")))) {
    entries.push({
      createdAt: match[1].trim(),
      title: match[2].trim(),
      context: match[3].trim(),
      error: match[4].trim(),
      correction: match[5].trim(),
      futureRule: match[6].trim()
    });
  }
  return entries;
}

function tokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .match(/[a-zа-яё0-9]{3,}/g) || []
  );
}

function relevanceScore(entry, taskText) {
  const taskTokens = tokens(taskText);
  const entryTokens = tokens([entry.title, entry.context, entry.error, entry.correction, entry.futureRule].join(" "));
  let score = 0;
  for (const token of taskTokens) {
    if (!STOP_WORDS.has(token) && entryTokens.has(token)) score += 1;
  }
  return score;
}

function readRelevantFeedback(taskText, options = {}) {
  const filePath = ensureFeedbackFile(options);
  const entries = parseFeedbackEntries(fs.readFileSync(filePath, "utf8"));
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 12));
  const scored = entries
    .map((entry) => ({ ...entry, relevance: relevanceScore(entry, taskText) }))
    .filter((entry) => entry.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
  return {
    version: REFLEXION_VERSION,
    status: scored.length ? "relevant_feedback_loaded" : "no_relevant_feedback",
    filePath,
    totalEntries: entries.length,
    relevantCount: scored.length,
    entries: scored,
    modelCalls: 0
  };
}

function appendFeedback(entry, options = {}) {
  const normalized = {
    context: redactSensitive(entry && entry.context),
    error: redactSensitive(entry && entry.error),
    correction: redactSensitive(entry && entry.correction),
    futureRule: redactSensitive(entry && entry.futureRule)
  };
  if (Object.values(normalized).some((value) => !value)) throw new Error("reflexion_feedback_fields_required");
  const filePath = ensureFeedbackFile(options);
  const content = fs.readFileSync(filePath, "utf8");
  const fingerprint = sha256(Object.values(normalized).join("\n")).slice(0, 16);
  if (content.includes(`reflexion_id: ${fingerprint}`)) {
    return { ok: true, status: "duplicate_skipped", filePath, fingerprint, written: false };
  }
  const now = new Date().toISOString();
  const title = redactSensitive(entry && entry.title) || normalized.error.slice(0, 90);
  const block = [
    "",
    `### [${now}] ${title}`,
    `- **Контекст:** ${normalized.context}`,
    `- **Ошибка:** ${normalized.error}`,
    `- **Исправление:** ${normalized.correction}`,
    `- **На будущее:** ${normalized.futureRule}`,
    `<!-- reflexion_id: ${fingerprint} -->`,
    ""
  ].join("\n");
  fs.appendFileSync(filePath, block, "utf8");
  return { ok: true, status: "feedback_recorded", filePath, fingerprint, written: true, createdAt: now };
}

function reflexionPrompt(memory) {
  if (!memory || !Array.isArray(memory.entries) || !memory.entries.length) return "";
  return [
    "## Reflexion: правила из прошлых пользовательских исправлений",
    "Применяй только релевантные правила ниже. Они не отменяют текущий запрос и обязательные проверки.",
    ...memory.entries.map((entry, index) => `${index + 1}. ${entry.futureRule} Исправление пользователя: ${entry.correction}`)
  ].join("\n");
}

module.exports = {
  DEFAULT_FEEDBACK_PATH,
  REFLEXION_VERSION,
  appendFeedback,
  ensureFeedbackFile,
  parseFeedbackEntries,
  readRelevantFeedback,
  redactSensitive,
  reflexionPrompt
};
