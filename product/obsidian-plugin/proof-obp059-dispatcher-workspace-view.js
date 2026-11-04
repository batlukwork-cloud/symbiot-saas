const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pluginDirectory = path.join(__dirname, "symbiot-obsidian-plugin");
const main = fs.readFileSync(path.join(pluginDirectory, "main.js"), "utf8");
const styles = fs.readFileSync(path.join(pluginDirectory, "styles.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDirectory, "manifest.json"), "utf8"));

assert.strictEqual(manifest.version, "0.5.0", "Obsidian source-of-truth dispatcher requires plugin 0.5.0");
assert.ok(/ItemView/.test(main), "Obsidian ItemView must be imported");
assert.ok(/registerView\(SYMBIOT_DISPATCHER_VIEW_TYPE/.test(main), "dispatcher workspace view must be registered");
assert.ok(/class SymbiotDispatcherView extends ItemView/.test(main), "dispatcher must be a native full workspace view");
assert.ok(/openDispatcherNavigator[\s\S]{0,700}setViewState\(\{ type: SYMBIOT_DISPATCHER_VIEW_TYPE/.test(main), "ribbon command must open a workspace tab");
assert.ok(!/openDispatcherNavigator\(\) \{\s*new SymbiotDispatcherModal/.test(main), "primary entry must not open the legacy modal");
assert.ok(/DISPATCHER_VIEW_STAGES = \[/.test(main), "route stages must be visible");
assert.ok((main.match(/state: "/g) || []).length >= 8, "route must expose at least eight stages");
assert.ok(/Тип миссии/.test(main), "mission type control must be visible");
assert.ok(/Рассчитать маршрут/.test(main), "route calculation action must be visible");
assert.ok(/Подтвердить план/.test(main), "human approval action must be visible");
assert.ok(/Инвестиционный анализ недвижимости/.test(main), "real-estate investment mission type must be available");
assert.ok(/Путь к исходной папке или файлу/.test(main), "explicit source input must be visible");
assert.ok(/PAUSED_FOR_GATE/.test(main), "blocked preflight state must be visible");
assert.ok(/Подтверждение заблокировано/.test(main), "blocked approval must be explained to the user");
assert.ok(/Ожидает вашего решения/.test(main), "technical state must have a human-readable label");
assert.ok(/Проверка источников/.test(main), "preflight must be named in user language");
assert.ok(/Результат диспетчеризации/.test(main), "mission routing result must be visible immediately");
assert.ok(/Скопировать номер миссии/.test(main), "mission id must be copyable");
assert.ok(/Исходная папка/.test(main) && /Копия в миссии/.test(main), "source locations must be directly actionable");
assert.ok(/Что должно получиться/.test(main) && /План работ/.test(main), "deliverables and full plan must be human-readable");
assert.ok(/Предварительная оценка бюджета/.test(main) && /Обновить контекст и бюджет/.test(main), "budget and Obsidian context must be refreshable");
assert.ok(/\/dispatcher\/v1\/recalculate/.test(main), "plugin must use the protected recalculation endpoint");
assert.ok(/loadDispatcherRuntimeProfile/.test(main) && /buildDispatcherObsidianContext/.test(main), "plugin must load its runtime profile through the Obsidian Vault API");
assert.ok(/obsidianContextRequired:\s*true/.test(main), "connector intake and recalculation must require an Obsidian snapshot");
assert.ok(/getDispatcherMissionTypeOptions/.test(main) && /missionTypes\.map/.test(main), "mission type control must use the Obsidian registry");
assert.ok(/00_Карточка_миссии\.md/.test(main) && /04_Контекст_Obsidian\.md/.test(main) && /05_Маршрут\.canvas/.test(main), "mission must be mirrored as a complete Obsidian package");
assert.ok(/activeDispatcherMissionId/.test(main) && /Сделать основной/.test(main), "user must be able to pin the intended mission first");
assert.ok(/Фактический результат ещё не создан/.test(main), "READY_FOR_HERMES must not be presented as completed execution");
assert.ok(/this\.selectedContract = prepared\.payload\.contract;[\s\S]{0,300}this\.pendingResultReveal = true;/.test(main), "successful routing must preserve the submitted text and reveal the result");
assert.ok(/scrollIntoView/.test(main), "new mission result must be brought into view");
assert.ok(/openDispatcherMissionNote[\s\S]{0,700}getDispatcherMission[\s\S]{0,400}mirrorDispatcherMission/.test(main), "existing runtime missions must hydrate an Obsidian note on demand");
assert.ok(/resultSummary[\s\S]{0,1000}КАРТА_ДИСПЕТЧЕРСКОЙ_СИМБИОТА/.test(main), "mission mirror must explain its real state and link back to the dispatcher map");
assert.ok(/symbiot-dispatcher-layout/.test(styles), "workspace layout styles must exist");
assert.ok(/grid-template-columns: minmax\(290px, 360px\) minmax\(0, 1fr\)/.test(styles), "desktop workspace must use a stable two-column layout");
assert.ok(/@media \(max-width: 900px\)/.test(styles), "workspace must adapt to smaller windows");

console.log(JSON.stringify({
  status: "PASS_DISPATCHER_WORKSPACE_VIEW",
  pluginVersion: manifest.version,
  primarySurface: "native_obsidian_item_view",
  primaryEntryIsModal: false,
  visibleControls: ["mission_input", "source_input", "mission_type", "execution_mode", "preflight", "route", "mission_table", "deliverables", "source_open", "full_plan", "budget_breakdown", "budget_recalculate", "human_approval"],
  existingMissionNoteHydration: true,
  observableMissionResult: true,
  submittedTextPreserved: true,
  missionMirrorLinked: true,
  blockedApprovalVisible: true,
  responsive: true
}, null, 2));
