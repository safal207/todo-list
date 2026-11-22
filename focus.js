(() => {
  "use strict";

  const game = window.sdelanoGame;
  const section = document.querySelector("#game-focus");
  const energy = document.querySelector("#game-energy");
  const energyNext = document.querySelector("#game-energy-next");
  const energyProgress = document.querySelector("#game-energy-progress");
  const timer = document.querySelector("#game-focus-timer");
  const timerProgress = document.querySelector("#game-focus-progress");
  const startButton = document.querySelector("#game-focus-start");
  const pauseButton = document.querySelector("#game-focus-pause");
  const resumeButton = document.querySelector("#game-focus-resume");
  const cancelButton = document.querySelector("#game-focus-cancel");
  const claimButton = document.querySelector("#game-focus-claim");
  const status = document.querySelector("#game-focus-status");
  if (!game || !section || !energy || !energyNext || !timer || !startButton ||
      !pauseButton || !resumeButton || !cancelButton || !claimButton || !status) return;

  const LIMIT = game.focusMs;
  let lastTick = null;
  let busy = false;

  function valid(snapshot) {
    return snapshot && typeof snapshot.id === "string" &&
      snapshot.id.length > 0 && snapshot.id.length <= 150 &&
      Number.isSafeInteger(snapshot.elapsedMs) &&
      snapshot.elapsedMs >= 0 && snapshot.elapsedMs <= LIMIT &&
      ["running", "paused", "ready"].includes(snapshot.status);
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(game.focusKey);
      if (raw === null) return null;
      const snapshot = JSON.parse(raw);
      if (!valid(snapshot)) return null;
      // Reload never counts time spent away; require an explicit resume.
      return { id: snapshot.id, elapsedMs: snapshot.elapsedMs,
        status: snapshot.status === "running" ? "paused" : snapshot.status };
    } catch { return null; }
  }

  let session = restore();
  function saveSession() {
    try {
      if (session) sessionStorage.setItem(game.focusKey, JSON.stringify(session));
      else sessionStorage.removeItem(game.focusKey);
      return true;
    } catch {
      status.textContent = "Нельзя сохранить фокус-сессию в этом браузере.";
      return false;
    }
  }
  if (session) saveSession();

  function formatRemaining(ms) {
    const seconds = Math.ceil(Math.max(0, ms) / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" +
      String(seconds % 60).padStart(2, "0");
  }

  function refreshEnergy() {
    const data = game.inspect();
    energy.querySelector(".game-resource-amount").textContent = data.energy + "/" + data.maxEnergy;
    energy.setAttribute("aria-label", "Энергия: " + data.energy + " из " + data.maxEnergy);
    energyProgress.value = data.energy;
    if (!data.available) {
      energyNext.textContent = "Энергия недоступна";
      return;
    }
    if (data.nextEnergyAt !== null) {
      const minutes = Math.max(1, Math.ceil((data.nextEnergyAt - Date.now()) / 60000));
      energyNext.textContent = "До следующего заряда: " + minutes + " мин";
    } else {
      energyNext.textContent = "Полный заряд";
    }
  }

  function render() {
    const elapsed = session?.elapsedMs || 0;
    timer.textContent = formatRemaining(LIMIT - elapsed);
    timerProgress.value = elapsed;
    startButton.hidden = Boolean(session);
    pauseButton.hidden = session?.status !== "running";
    resumeButton.hidden = session?.status !== "paused";
    claimButton.hidden = session?.status !== "ready";
    cancelButton.hidden = !session;
    claimButton.disabled = busy;
    startButton.disabled = busy;
    pauseButton.disabled = busy;
    resumeButton.disabled = busy;
    cancelButton.disabled = busy;
  }

  function pause(reason) {
    if (!session || session.status !== "running") return;
    advance();
    if (session.status === "running") {
      session.status = "paused";
      lastTick = null;
      saveSession();
    }
    if (reason) status.textContent = reason;
    render();
  }

  function advance() {
    if (!session || session.status !== "running") return;
    const now = performance.now();
    if (lastTick !== null && !document.hidden) {
      session.elapsedMs = Math.min(LIMIT, session.elapsedMs + Math.max(0, now - lastTick));
    }
    lastTick = now;
    if (session.elapsedMs >= LIMIT) {
      session.elapsedMs = LIMIT;
      session.status = "ready";
      lastTick = null;
      status.textContent = "15 минут завершены! Нажми «Забрать +5 XP».";
    }
    saveSession();
    render();
  }

  function resume() {
    if (!session || document.hidden) return;
    session.status = "running";
    lastTick = performance.now();
    saveSession();
    status.textContent = "Сосредоточься на своём деле. При уходе со вкладки — пауза.";
    render();
  }

  startButton.addEventListener("click", () => {
    if (busy || session) return;
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() :
      Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    session = { id, elapsedMs: 0, status: "paused" };
    if (!saveSession()) { session = null; render(); return; }
    resume();
    window.taskFeedback?.play("tap");
  });

  pauseButton.addEventListener("click", () => {
    pause("Пауза сохранена. Продолжи, когда будешь готов.");
    window.taskFeedback?.play("tap");
  });
  resumeButton.addEventListener("click", () => {
    resume();
    window.taskFeedback?.play("tap");
  });
  cancelButton.addEventListener("click", () => {
    if (busy) return;
    session = null;
    lastTick = null;
    saveSession();
    status.textContent = "Сессия отменена. Энергия не списана.";
    window.taskFeedback?.play("tap");
    render();
  });
  claimButton.addEventListener("click", async () => {
    if (busy || session?.status !== "ready") return;
    busy = true;
    render();
    const result = await game.claimFocus(session.id);
    busy = false;
    if (result.awarded) {
      session = null;
      lastTick = null;
      saveSession();
      status.textContent = "Фокус завершён: +5 XP! Списана 1 энергия.";
      window.taskFeedback?.play("xp");
    } else {
      const descriptions = {
        "no-energy": "Энергия закончилась. Сессия сохранена, дождись восстановления.",
        "daily-limit": "Дневной лимит бонусов (3) достигнут. Сессия сохранена.",
        "already-awarded": "Награда за эту сессию уже получена.",
        "storage-error": "Не удалось сохранить награду. Проверь хранилище и повтори.",
        "lock-error": "Награда временно недоступна — попробуй ещё раз.",
        "limit": "Журнал наград заполнен.",
        "unfinished": "Сессия не завершена. Продолжи фокус."
      };
      status.textContent = descriptions[result.reason] || "Награду получить не удалось.";
      if (result.reason === "already-awarded") {
        session = null;
        saveSession();
      }
    }
    refreshEnergy();
    render();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause("Сессия на паузе, пока вкладка скрыта.");
    else { refreshEnergy(); render(); }
  });
  window.addEventListener("pagehide", () => {
    pause("Сессия сохранена. Возвращайся, когда будешь готов.");
  });
  window.addEventListener("sdelano:game-changed", refreshEnergy);
  window.addEventListener("storage", event => {
    if (event.key === game.key || event.key === null) refreshEnergy();
  });

  setInterval(() => { if (!document.hidden) advance(); }, 1000);
  setInterval(() => { if (!document.hidden) refreshEnergy(); }, 60 * 1000);
  refreshEnergy();
  render();
})();
