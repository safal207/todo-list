(() => {
  "use strict";

  // Local, non-monetary game economy. All earned grants live in one versioned
  // ledger, and each grant has a stable idempotency key.
  const KEY = "sdelano.game.v1";
  const TASKS_KEY = "todo-list.tasks.v1";
  const MAX_EVENTS = 12000;
  const MAX_EXCLUDED = 12000;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const plain = value => value && typeof value === "object" && !Array.isArray(value);
  const validId = value => typeof value === "string" && value.length > 0 && value.length <= 150;
  const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  let failure = "";

  function dayKey(at) {
    const date = new Date(at);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")].join("-");
  }

  function check(state) {
    if (!plain(state) || state.version !== 1 ||
        !Array.isArray(state.grants) || state.grants.length > MAX_EVENTS ||
        !Array.isArray(state.excludedIds) || state.excludedIds.length > MAX_EXCLUDED) {
      throw new Error("Данные игровых наград повреждены. Сначала сохрани резервную копию.");
    }
    const keys = new Set();
    for (const grant of state.grants) {
      if (!plain(grant) || typeof grant.key !== "string" || grant.key.length > 170 ||
          !/^(task:|daily:|triple:)/.test(grant.key) || keys.has(grant.key) ||
          !integer(grant.xp) || grant.xp > 100 || !integer(grant.coins) ||
          grant.coins > 50 || !validDay(grant.day) || !integer(grant.at)) {
        throw new Error("История наград недоступна. Перезапись заблокирована.");
      }
      keys.add(grant.key);
    }
    const ids = new Set();
    for (const id of state.excludedIds) {
      if (!validId(id) || ids.has(id)) throw new Error("Список старых наград повреждён.");
      ids.add(id);
    }
    // A single wrong or manipulated value must never overflow the UI.
    const xp = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
    const coins = state.grants.reduce((sum, grant) => sum + grant.coins, 0);
    if (!integer(xp) || !integer(coins)) throw new Error("Некорректный баланс.");
    return state;
  }

  function taskIdsAlreadyCompleted() {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw === null) return [];
    const tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) throw new Error("Невозможно проверить старые выполненные задачи.");
    return [...new Set(tasks.filter(task => task?.done === true && validId(task?.id)).map(task => task.id))];
  }

  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return check(JSON.parse(raw));
    // The very first activation takes a baseline of *already completed*
    // tasks; old achievements are not converted into spendable currency.
    const state = { version: 1, grants: [], excludedIds: taskIdsAlreadyCompleted() };
    check(state);
    localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  function save(state) {
    check(state);
    localStorage.setItem(KEY, JSON.stringify(state));
    failure = "";
    window.dispatchEvent(new Event("sdelano:game-changed"));
  }

  function report(error) {
    failure = error?.message || "Игровые награды временно недоступны.";
    window.dispatchEvent(new CustomEvent("sdelano:game-error", { detail: { message: failure } }));
  }

  function threshold(level) {
    return 25 * (level - 1) * (level + 2);
  }

  function inspect() {
    try {
      const state = load();
      const xp = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
      const coins = state.grants.reduce((sum, grant) => sum + grant.coins, 0);
      let level = 1;
      while (level < 100 && xp >= threshold(level + 1)) level++;
      failure = "";
      return { available: true, xp, coins, level, levelStart: threshold(level),
        levelEnd: threshold(level + 1), energy: 5, maxEnergy: 5,
        earnedTasks: state.grants.filter(grant => grant.key.startsWith("task:")).length };
    } catch (error) {
      report(error);
      return { available: false, xp: 0, coins: 0, level: 1, levelStart: 0,
        levelEnd: 100, energy: 5, maxEnergy: 5, error: failure, earnedTasks: 0 };
    }
  }

  function awardTask(taskId, at = Date.now()) {
    if (!validId(taskId) || !integer(at)) return { awarded: false, reason: "invalid" };
    try {
      const savedTasks = JSON.parse(localStorage.getItem(TASKS_KEY) || "[]");
      if (!Array.isArray(savedTasks) || !savedTasks.some(t => t?.id === taskId && t.done === true)) {
        return { awarded: false, reason: "not-saved" };
      }
      const state = load();
      const key = "task:" + taskId;
      if (state.excludedIds.includes(taskId) || state.grants.some(grant => grant.key === key)) {
        return { awarded: false, reason: "already-awarded" };
      }
      const day = dayKey(at);
      const today = state.grants.filter(grant => grant.day === day && grant.key.startsWith("task:")).length;
      const grants = [{ key, day, at, xp: 10, coins: 5 }];
      if (today === 0 && !state.grants.some(grant => grant.key === "daily:" + day)) {
        grants.push({ key: "daily:" + day, day, at, xp: 10, coins: 5 });
      }
      if (today === 2 && !state.grants.some(grant => grant.key === "triple:" + day)) {
        grants.push({ key: "triple:" + day, day, at, xp: 15, coins: 10 });
      }
      if (state.grants.length + grants.length > MAX_EVENTS) {
        throw new Error("Лимит журнала наград достигнут. Экспортируй данные перед продолжением.");
      }
      state.grants.push(...grants);
      save(state); // Commit before any congratulation or sound.
      const xp = grants.reduce((sum, grant) => sum + grant.xp, 0);
      const coins = grants.reduce((sum, grant) => sum + grant.coins, 0);
      window.dispatchEvent(new CustomEvent("sdelano:reward-earned", {
        detail: { taskId, xp, coins, bonuses: grants.slice(1).map(grant => grant.key.split(":")[0]) }
      }));
      return { awarded: true, xp, coins };
    } catch (error) {
      report(error);
      return { awarded: false, reason: "storage-error" };
    }
  }

  // Completed tasks coming from a backup or another cloud device are legacy
  // for this browser's local economy. Never mint currency from imports.
  function excludeCompleted(ids) {
    if (!Array.isArray(ids) || !ids.length) return false;
    try {
      const state = load(), awarded = new Set(state.grants.filter(g => g.key.startsWith("task:")).map(g => g.key.slice(5)));
      const excluded = new Set(state.excludedIds);
      for (const id of ids) {
        if (validId(id) && !awarded.has(id)) excluded.add(id);
      }
      if (excluded.size > MAX_EXCLUDED) throw new Error("Лимит исключённых задач достигнут.");
      if (excluded.size === state.excludedIds.length) return true;
      state.excludedIds = [...excluded];
      save(state);
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function excludeCloudCompletions() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      if (raw === null) return;
      const tasks = JSON.parse(raw);
      if (Array.isArray(tasks)) excludeCompleted(tasks.filter(t => t?.done).map(t => t.id));
    } catch (error) { report(error); }
  }
  window.addEventListener("sdelano:cloud-applied", excludeCloudCompletions);

  window.sdelanoGame = Object.freeze({
    inspect, awardTask, excludeCompleted,
    key: KEY, threshold
  });
})();
