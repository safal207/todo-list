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
  const alertButton = document.querySelector("#game-focus-alert-toggle");
  const alertDetail = document.querySelector("#game-focus-alert-detail");
  if (!game || !section || !energy || !energyNext || !timer || !startButton ||
      !pauseButton || !resumeButton || !cancelButton || !claimButton ||
      !status || !alertButton || !alertDetail) return;

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


  // Local system notification on one earned-action session's auto-pause.
  // No remote push, subscriptions, automatic permission prompts or reminders.
  const ALERT_KEY = "sdelano.focus.pause-alerts.v1";
  const ALERT_TAG = "sdelano-focus-paused";
  // raw.githack.com and gist.githack.com host many unrelated projects.
  // Never ask for origin-wide notification permission on shared previews.
  const sharedPreviewHost = /^(?:raw|gist)\.githack\.com$/i.test(location.hostname);
  const supported = () => !sharedPreviewHost && window.isSecureContext &&
    typeof window.Notification !== "undefined" && "serviceWorker" in navigator;
  let alertsOn = false;
  let notificationRegistration = null;
  let notificationEpoch = 0;
  try { alertsOn = localStorage.getItem(ALERT_KEY) === "on"; } catch {}

  function showAlertSettings(message = "") {
    const available = supported();
    const denied = available && window.Notification.permission === "denied";
    alertButton.disabled = !available || denied;
    alertButton.setAttribute("aria-pressed", String(alertsOn && available && !denied));
    alertButton.textContent = "Уведомление о паузе: " +
      (alertsOn && available && !denied ? "вкл" : "выкл");
    alertDetail.textContent = message || (sharedPreviewHost
      ? "В общем предпросмотре разрешения отключены ради безопасности. Проверь уведомление на собственном домене."
      : !available
      ? "Системные уведомления здесь недоступны; паузу и время покажем на странице."
      : denied ? "Уведомления запрещены в настройках браузера."
      : alertsOn ? "Один тихий сигнал при сворачивании — без повторных напоминаний."
      : "Необязательно. Разрешение спросим только после нажатия.");
  }

  async function getNotificationRegistration() {
    if (notificationRegistration?.active) return notificationRegistration;
    const registration = await navigator.serviceWorker.register("./focus-pause-sw.js", {
      scope: "./"
    });
    notificationRegistration = registration.active
      ? registration : await navigator.serviceWorker.ready;
    if (!notificationRegistration?.active) throw new Error("Worker not active");
    return notificationRegistration;
  }

  function closePauseNotification() {
    notificationEpoch++;
    if (!notificationRegistration?.getNotifications) return;
    void notificationRegistration.getNotifications({ tag: ALERT_TAG })
      .then(items => items.forEach(item => item.close()))
      .catch(() => {});
  }

  function alertOnAutoPause(id, left) {
    if (!alertsOn || !supported() ||
        window.Notification.permission !== "granted") return;
    const epoch = ++notificationEpoch;
    void (async () => {
      const registration = await getNotificationRegistration();
      if (epoch !== notificationEpoch || !document.hidden || !alertsOn ||
          session?.id !== id || session.status !== "paused" ||
          window.Notification.permission !== "granted") return;
      await registration.showNotification("Фокус на паузе", {
        body: "Осталось " + left + ". Продолжи, когда будет удобно.",
        tag: ALERT_TAG, renotify: false, silent: true, requireInteraction: false,
        icon: new URL("assets/fox-mascot.webp", document.baseURI).href
      });
    })().catch(() => { /* On-page status remains available. */ });
  }

  alertButton.addEventListener("click", async () => {
    if (alertsOn) {
      alertsOn = false;
      try { localStorage.setItem(ALERT_KEY, "off"); } catch {}
      closePauseNotification();
      showAlertSettings();
      return;
    }
    if (!supported() || window.Notification.permission === "denied") {
      showAlertSettings("Браузер не разрешает уведомления. Фокус продолжит работать.");
      return;
    }
    alertButton.disabled = true;
    try {
      // Request directly inside a click handler (required by mobile browsers).
      const permission = window.Notification.permission === "granted"
        ? "granted" : await window.Notification.requestPermission();
      if (permission !== "granted") {
        showAlertSettings("Разрешение не дано. Фокус работает без уведомлений.");
        return;
      }
      await getNotificationRegistration();
      alertsOn = true;
      try { localStorage.setItem(ALERT_KEY, "on"); } catch {}
      showAlertSettings();
    } catch {
      alertsOn = false;
      showAlertSettings("Не удалось включить системные уведомления в этом браузере.");
    } finally {
      alertButton.disabled = !supported() ||
        window.Notification.permission === "denied";
    }
  });
  showAlertSettings();
  // The browser may suspend a backgrounded page before an asynchronous
  // worker registration finishes. After a prior explicit opt-in, prepare
  // the existing notification worker while the tab is still visible.
  // This never requests permission or sends a notification by itself.
  if (alertsOn && supported() &&
      window.Notification.permission === "granted") {
    void getNotificationRegistration().catch(() => {
      showAlertSettings("Браузер пока не готов показывать уведомления о паузе.");
    });
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

  function pause(reason, autoPaused = false) {
    if (!session || session.status !== "running") return;
    advance();
    if (session.status === "running") {
      session.status = "paused";
      lastTick = null;
      saveSession();
    }
    const remaining = formatRemaining(LIMIT - session.elapsedMs);
    if (reason) status.textContent = reason + " Осталось " + remaining + ".";
    render();
    if (autoPaused && session.status === "paused") {
      alertOnAutoPause(session.id, remaining);
    }
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
    closePauseNotification();
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
    closePauseNotification();
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
      closePauseNotification();
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
    if (document.hidden) pause("Сессия на паузе, пока вкладка скрыта.", true);
    else { closePauseNotification(); refreshEnergy(); render(); }
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
