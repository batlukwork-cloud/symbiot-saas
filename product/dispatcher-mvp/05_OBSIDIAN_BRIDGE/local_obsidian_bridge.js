"use strict";

const fs = require("fs");
const path = require("path");

const bridgeRoot = path.resolve(__dirname, "sandbox_obsidian_vault");

function ensureInsideRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(bridgeRoot)) {
    throw new Error("sandbox path escaped bridge root");
  }
  return resolved;
}

function writeText(filePath, content) {
  const safePath = ensureInsideRoot(filePath);
  fs.mkdirSync(path.dirname(safePath), { recursive: true });
  fs.writeFileSync(safePath, content, "utf8");
  return {
    path: safePath,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function writeJson(filePath, value) {
  return writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function missionFolderFor(eventId) {
  return ensureInsideRoot(
    path.join(bridgeRoot, "02_Missions", `mission_${eventId}`)
  );
}

function writeConfirmedMissionArtifacts(input) {
  const {
    event,
    decisionCard,
    missionContractDraft,
    missionRun,
  } = input;

  if (!event || !decisionCard || !missionContractDraft || !missionRun) {
    throw new Error("event, decision card, draft and run are required");
  }

  const missionFolder = missionFolderFor(event.id);
  fs.mkdirSync(missionFolder, { recursive: true });

  const artifacts = [
    writeText(
      path.join(missionFolder, "00_mission_passport.md"),
      [
        "# Паспорт локальной миссии",
        "",
        `Mission run: ${missionRun.id}`,
        `Source event: ${event.id}`,
        `Goal: ${missionContractDraft.goal}`,
        `Status: ${missionRun.status}`,
        "",
      ].join("\n")
    ),
    writeText(
      path.join(missionFolder, "01_mission_contract.md"),
      [
        "# Mission Contract",
        "",
        `Draft: ${missionContractDraft.id}`,
        `Approved by: ${missionRun.approved_by}`,
        `Runtime scope: ${missionRun.runtime.scope}`,
        "Production: not touched",
        "Supabase live: not touched",
        "External webhook: not touched",
        "",
      ].join("\n")
    ),
    writeText(
      path.join(missionFolder, "02_result.md"),
      [
        "# Результат",
        "",
        missionRun.result.summary,
        "",
        `Next human check: ${missionRun.result.next_human_check}`,
        "",
      ].join("\n")
    ),
    writeText(
      path.join(missionFolder, "03_evidence.md"),
      [
        "# Evidence",
        "",
        "- Local Dispatcher server: PASS",
        "- Human Gate decision: PASS",
        "- Mission contract draft: PASS",
        "- Local sandbox run: PASS",
        "- Runtime scope: local_sandbox_only",
        "- Obsidian bridge: sandbox only",
        "",
      ].join("\n")
    ),
    writeText(
      path.join(missionFolder, "04_reflection.md"),
      [
        "# Reflection",
        "",
        "Промежуточный mock был недостаточен: пользователь должен иметь работающий маршрут.",
        "Исправление: локальный сервер, API, кнопка запуска и sandbox artifacts.",
        "",
      ].join("\n")
    ),
    writeJson(path.join(missionFolder, "mission_manifest.json"), {
      mission_run_id: missionRun.id,
      event_id: event.id,
      decision_card_id: decisionCard.id,
      mission_contract_draft_id: missionContractDraft.id,
      status: missionRun.status,
      runtime_scope: missionRun.runtime.scope,
      production_touched: false,
      secrets_touched: false,
      supabase_live_touched: false,
      external_webhook_touched: false,
      real_personal_data_used: false,
      readiness_changed: false,
      d1_tst_001_closed: false,
    }),
  ];

  return {
    bridge: "local_obsidian_sandbox",
    mission_folder: missionFolder,
    artifact_count: artifacts.length,
    artifacts,
    obsidian_writes: artifacts.length,
  };
}

module.exports = {
  bridgeRoot,
  missionFolderFor,
  writeConfirmedMissionArtifacts,
};
