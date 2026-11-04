"use strict";

(function initDispatcherMockUi() {
  const proof = {
    desktop_ui_loaded: true,
    api_mode: false,
    inbox_visible: true,
    decision_card_visible: true,
    human_gate_button_visible: true,
    mission_contract_draft_visible: false,
    runtime_started: false,
    obsidian_writes: 0,
    model_calls: 0,
    production_touched: false,
    secrets_touched: false,
    supabase_live_touched: false,
    external_webhook_touched: false,
    real_personal_data_used: false,
  };

  const acceptButton = document.querySelector("#acceptDraftButton");
  const contractDraft = document.querySelector("#contractDraft");
  const footerState = document.querySelector("#footerState");
  const runtimeStatus = document.querySelector("#runtimeStatus");
  const obsidianStatus = document.querySelector(".status-strip .status-pill:last-child");
  const selectedInboxItem = document.querySelector("#selectedInboxItem");
  const inboxTitle = document.querySelector("#inboxTitle");
  const inboxMeta = document.querySelector("#inboxMeta");
  const inboxSummary = document.querySelector("#inboxSummary");
  const inboxCounter = document.querySelector("#inboxCounter");
  const decisionTitle = document.querySelector("#decisionTitle");
  const sourceValue = document.querySelector("#sourceValue");
  const summaryValue = document.querySelector("#summaryValue");
  const suggestedActionValue = document.querySelector("#suggestedActionValue");
  const draftId = document.querySelector("#draftId");
  const draftGoal = document.querySelector("#draftGoal");
  const startMissionButton = document.querySelector("#startMissionButton");
  const missionResult = document.querySelector("#missionResult");
  const missionRunId = document.querySelector("#missionRunId");
  const missionFolder = document.querySelector("#missionFolder");
  const artifactCount = document.querySelector("#artifactCount");
  const missionSummary = document.querySelector("#missionSummary");
  const telegramDemoButton = document.querySelector("#telegramDemoButton");
  const emailDemoButton = document.querySelector("#emailDemoButton");
  const dispatcherView = document.querySelector("#dispatcherView");
  const sourcesView = document.querySelector("#sourcesView");
  const viewButtons = Array.from(document.querySelectorAll("[data-view]"));
  const telegramTokenInput = document.querySelector("#telegramTokenInput");
  const telegramSourceStatus = document.querySelector("#telegramSourceStatus");
  const telegramSourceNote = document.querySelector("#telegramSourceNote");
  const emailSourceStatus = document.querySelector("#emailSourceStatus");
  const emailSourceNote = document.querySelector("#emailSourceNote");
  const emailSpoolPath = document.querySelector("#emailSpoolPath");
  const folderSpoolPath = document.querySelector("#folderSpoolPath");
  const connectTelegramButton = document.querySelector("#connectTelegramButton");
  const testTelegramButton = document.querySelector("#testTelegramButton");
  const chainTelegramButton = document.querySelector("#chainTelegramButton");
  const connectEmailButton = document.querySelector("#connectEmailButton");
  const testEmailButton = document.querySelector("#testEmailButton");
  const chainEmailButton = document.querySelector("#chainEmailButton");
  const sourceChainButtons = Array.from(
    document.querySelectorAll("[data-source-chain]")
  );

  function setView(view) {
    dispatcherView.hidden = view !== "dispatcher";
    sourcesView.hidden = view !== "sources";
    for (const button of viewButtons) {
      button.classList.toggle("selected", button.dataset.view === view);
    }
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || "request_failed");
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function markStatus(element, statusClass, text) {
    element.classList.remove("neutral", "wait", "stop");
    element.classList.add(statusClass);
    element.textContent = text;
  }

  function showDraft(draft) {
    document.body.dataset.missionDraft = "created";
    document.body.dataset.runtimeStarted = "false";
    document.body.dataset.obsidianWrites = "0";
    if (draft) {
      draftId.textContent = draft.id;
      draftGoal.textContent = draft.goal;
    }
    contractDraft.hidden = false;
    runtimeStatus.textContent = "Runtime остановлен";
    footerState.textContent =
      "Черновик mission contract создан. Исполнение и запись ждут отдельного разрешения.";
    acceptButton.disabled = true;
    acceptButton.textContent = "Черновик создан";

    proof.mission_contract_draft_visible = true;
    proof.human_gate_accept_clicked = true;
    proof.runtime_started = false;
    proof.obsidian_writes = 0;
    proof.blocked_reason = "MISSION_CONTRACT_DRAFT_ONLY";
    return proof;
  }

  function showMissionResult(payload) {
    document.body.dataset.localMission = "completed";
    missionResult.hidden = false;
    missionRunId.textContent = payload.mission_run.id;
    missionFolder.textContent = payload.obsidian_bridge.mission_folder;
    artifactCount.textContent = String(payload.obsidian_bridge.artifact_count);
    missionSummary.textContent = payload.mission_run.result.summary;
    runtimeStatus.textContent = "Local runtime завершен";
    runtimeStatus.classList.remove("stop");
    runtimeStatus.classList.add("neutral");
    obsidianStatus.textContent = `Sandbox writes ${payload.obsidian_bridge.artifact_count}`;
    footerState.textContent =
      "Локальная миссия завершена. Артефакты записаны в sandbox Obsidian bridge.";
    startMissionButton.disabled = true;
    startMissionButton.textContent = "Локальная миссия завершена";

    proof.local_mission_completed = true;
    proof.local_runtime_started = true;
    proof.runtime_scope = payload.mission_run.runtime.scope;
    proof.obsidian_writes = payload.obsidian_bridge.artifact_count;
    proof.mission_folder = payload.obsidian_bridge.mission_folder;
    proof.mission_run_id = payload.mission_run.id;
    return proof;
  }

  function renderCard(card) {
    selectedInboxItem.dataset.eventId = card.event_id;
    inboxTitle.textContent = card.summary.includes("договор")
      ? "Проверка договора"
      : card.title;
    inboxMeta.textContent = `${card.source.sender.display_name} - ${card.source.received_at.slice(0, 16).replace("T", " ")}`;
    inboxSummary.textContent = card.summary;
    decisionTitle.textContent = card.title;
    sourceValue.textContent = `${card.source.channel} / ${card.source.sender.display_name}`;
    summaryValue.textContent = card.summary;
    suggestedActionValue.textContent = "Подготовить черновик mission contract";
    inboxCounter.textContent = "1";
    contractDraft.hidden = true;
    missionResult.hidden = true;
    acceptButton.disabled = false;
    acceptButton.innerHTML = '<span aria-hidden="true">✓</span> Подтвердить черновик';
    startMissionButton.disabled = false;
    startMissionButton.innerHTML = '<span aria-hidden="true">▶</span> Запустить локальную миссию';
    runtimeStatus.textContent = "Runtime остановлен";
    runtimeStatus.classList.remove("neutral");
    runtimeStatus.classList.add("stop");
    obsidianStatus.textContent = "Obsidian 0";
  }

  async function seedFromLocalApi() {
    if (!window.location.protocol.startsWith("http")) {
      return;
    }

    const response = await fetch("/api/demo/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const payload = await response.json();
    renderCard(payload.decision_card);
    if (payload.mission_contract_draft) {
      showDraft(payload.mission_contract_draft);
    }
    proof.api_mode = true;
    proof.local_api_seeded = true;
    proof.dispatch_event_id = payload.dispatch_event.id;
  }

  async function acceptDraft() {
    const eventId = selectedInboxItem.dataset.eventId;
    if (window.location.protocol.startsWith("http") && eventId) {
      const response = await fetch(`/dispatch/events/${eventId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "accept",
          decided_by: "human_demo",
          note: "Demo acceptance for local proof only",
          decided_at: "2026-08-02T10:06:00.000Z",
        }),
      });
      const payload = await response.json();
      proof.api_mode = true;
      proof.local_api_decision_posted = true;
      proof.mission_contract_draft_id = payload.mission_contract_draft.id;
      return showDraft(payload.mission_contract_draft);
    }

    return showDraft();
  }

  async function startMission() {
    const eventId = selectedInboxItem.dataset.eventId;
    if (!window.location.protocol.startsWith("http") || !eventId) {
      footerState.textContent =
        "Запуск локальной миссии доступен только через local dev server.";
      return proof;
    }

    const response = await fetch(`/dispatch/events/${eventId}/mission/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approved: true,
        approved_by: "human_demo",
        approved_at: "2026-08-02T10:10:00.000Z",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      proof.local_mission_error = payload.error || "unknown_error";
      footerState.textContent =
        "Локальная миссия не запущена: " + proof.local_mission_error;
      return proof;
    }
    proof.local_api_mission_start_posted = true;
    return showMissionResult(payload);
  }

  async function postTelegramDemo() {
    const response = await fetch("/api/telegram/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: Date.now(),
        message: {
          message_id: Date.now(),
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1001, type: "private" },
          from: {
            id: 1001,
            first_name: "Demo",
            last_name: "Sender",
            username: "demo_sender",
          },
          text: "Проверь договор и собери пакет документов",
        },
      }),
    });
    const payload = await response.json();
    renderCard(payload.decision_card);
    proof.last_trigger = "telegram";
    proof.local_api_seeded = true;
    proof.dispatch_event_id = payload.dispatch_event.id;
  }

  async function postEmailDemo() {
    await fetch("/api/email/demo", { method: "POST" });
    const response = await fetch("/api/email/poll", { method: "POST" });
    const payload = await response.json();
    if (payload.items.length > 0) {
      const item = payload.items[payload.items.length - 1];
      renderCard(item.decision_card);
      proof.last_trigger = "email";
      proof.local_api_seeded = true;
      proof.dispatch_event_id = item.dispatch_event.id;
    }
  }

  async function loadSourceStatus() {
    const status = await fetchJson("/api/sources/status");
    markStatus(
      telegramSourceStatus,
      status.telegram.connected ? "neutral" : "wait",
      status.telegram.connected ? "Подключен" : "Не подключен"
    );
    telegramSourceNote.textContent = status.telegram.connected
      ? `Bot: ${status.telegram.bot?.username || "проверен"}`
      : "Token хранится только в памяти локального процесса.";
    markStatus(
      emailSourceStatus,
      status.email.connected ? "neutral" : "wait",
      status.email.connected ? "Spool подключен" : "Не подключен"
    );
    emailSpoolPath.value = status.email.spool_dir || "";

    for (const source of ["whatsapp", "webhook", "folder", "bitrix24"]) {
      const statusElement = document.querySelector(`#${source}SourceStatus`);
      if (statusElement && status[source]) {
        markStatus(
          statusElement,
          status[source].connected ? "neutral" : "wait",
          status[source].connected ? "Локальный вход готов" : "Не подключен"
        );
      }
    }

    if (folderSpoolPath) {
      folderSpoolPath.value = status.folder?.spool_dir || "";
    }
  }

  async function connectTelegram() {
    try {
      const token = telegramTokenInput.value.trim();
      const result = await fetchJson("/api/sources/telegram/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      telegramTokenInput.value = "";
      markStatus(telegramSourceStatus, "neutral", "Подключен");
      telegramSourceNote.textContent = `Bot: ${result.bot.username || result.bot.first_name}`;
      proof.telegram_source_connected = true;
    } catch (error) {
      markStatus(telegramSourceStatus, "stop", "Ошибка");
      telegramSourceNote.textContent = error.payload?.error || error.message;
    }
  }

  async function testTelegram() {
    try {
      const result = await fetchJson("/api/sources/telegram/test", {
        method: "POST",
      });
      markStatus(telegramSourceStatus, "neutral", "Проверен");
      telegramSourceNote.textContent = `Bot: ${result.bot.username || result.bot.first_name}`;
    } catch (error) {
      markStatus(telegramSourceStatus, "stop", "Не подключен");
      telegramSourceNote.textContent = error.payload?.error || error.message;
    }
  }

  async function connectEmail() {
    const result = await fetchJson("/api/sources/email/connect", {
      method: "POST",
    });
    markStatus(emailSourceStatus, "neutral", "Spool подключен");
    emailSpoolPath.value = result.spool_dir;
    emailSourceNote.textContent = "Email spool готов принимать JSON-письма.";
  }

  async function testEmail() {
    const result = await fetchJson("/api/sources/email/test", {
      method: "POST",
    });
    markStatus(emailSourceStatus, "neutral", "Проверен");
    emailSourceNote.textContent = `Тестовое письмо создано: ${result.file_path}`;
  }

  async function fullChain(source) {
    const result = await fetchJson("/api/sources/full-chain-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const statusElement =
      document.querySelector(`#${source}SourceStatus`) ||
      (source === "telegram" ? telegramSourceStatus : emailSourceStatus);
    const noteElement =
      document.querySelector(`#${source}SourceNote`) ||
      (source === "telegram" ? telegramSourceNote : emailSourceNote);
    markStatus(statusElement, "neutral", "Цепочка PASS");
    noteElement.textContent = `Mission run: ${result.mission_run.id}; artifacts: ${result.obsidian_bridge.artifact_count}`;
    proof[`${source}_source_full_chain_pass`] = true;
    proof[`${source}_source_artifact_count`] =
      result.obsidian_bridge.artifact_count;
  }

  acceptButton.addEventListener("click", acceptDraft);
  startMissionButton.addEventListener("click", startMission);
  telegramDemoButton.addEventListener("click", postTelegramDemo);
  emailDemoButton.addEventListener("click", postEmailDemo);
  for (const button of viewButtons) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  connectTelegramButton.addEventListener("click", connectTelegram);
  testTelegramButton.addEventListener("click", testTelegram);
  chainTelegramButton.addEventListener("click", () => fullChain("telegram"));
  connectEmailButton.addEventListener("click", connectEmail);
  testEmailButton.addEventListener("click", testEmail);
  chainEmailButton.addEventListener("click", () => fullChain("email"));
  for (const button of sourceChainButtons) {
    button.addEventListener("click", () => fullChain(button.dataset.sourceChain));
  }
  seedFromLocalApi().catch((error) => {
    proof.local_api_error = error.message;
    footerState.textContent =
      "Локальный API недоступен. Открыт static fallback, runtime не запущен.";
  });
  loadSourceStatus().catch((error) => {
    proof.sources_status_error = error.message;
  });

  window.__DISPATCHER_UI_PROOF__ = proof;
  window.__DISPATCHER_UI_CLICK_ACCEPT__ = acceptDraft;
  window.__DISPATCHER_UI_CLICK_START_MISSION__ = startMission;
})();
