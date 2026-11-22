(() => {
  "use strict";

  // Local, non-monetary game economy. All earned grants live in one versioned
  // ledger, and each grant has a stable idempotency key.
  const KEY = "sdelano.game.v1";
  const TASKS_KEY = "todo-list.tasks.v1";
  const FOCUS_KEY = "sdelano.focus.session.v1";
  const FOCUS_MS = 15 * 60 * 1000;
  const RECHARGE_MS = 60 * 60 * 1000;
  const MAX_FOCUS_DAILY = 3;
  const MAX_ENERGY = 5;
  // Fixed catalog: cosmetic-only, no real-world currency and no random prizes.
  const CATALOG = Object.freeze([
    Object.freeze({ id: "scarf", name: "Золотой шарфик", price: 50, slot: "scarf" }),
    Object.freeze({ id: "glasses", name: "Синие очки", price: 100, slot: "glasses" }),
    Object.freeze({ id: "cosmic", name: "Космическая тема", price: 150, slot: "theme" }),
    Object.freeze({ id: "sparkle", name: "Искры победы", price: 200, slot: "victory" })
  ]);
  const shopItem = id => CATALOG.find(item => item.id === id);
  const DEFAULT_EQUIPPED = Object.freeze({
    scarf: false, glasses: false, theme: "default", victory: "default"
  });
  const shopEquipped = state => ({ ...DEFAULT_EQUIPPED, ...(state.equipped || {}) });
  const boughtIds = state => (state.purchases || []).map(purchase => purchase.id);
  const spentCoins = state => (state.purchases || []).reduce((sum, p) => sum + p.coins, 0);
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
          !/^(task:|daily:|triple:|focus:)/.test(grant.key) || keys.has(grant.key) ||
          !integer(grant.xp) || grant.xp > 100 || !integer(grant.coins) ||
          grant.coins > 50 || !validDay(grant.day) || !integer(grant.at)) {
        throw new Error("История наград недоступна. Перезапись заблокирована.");
      }
      keys.add(grant.key);
    }
    // Existing v1 wallets without an energy object remain valid.
    if (state.energy !== undefined && (!plain(state.energy) ||
        !Number.isSafeInteger(state.energy.value) || state.energy.value < 0 ||
        state.energy.value > MAX_ENERGY || !integer(state.energy.updatedAt))) {
      throw new Error("Игровая энергия повреждена. Перезапись заблокирована.");
    }
    const ids = new Set();
    for (const id of state.excludedIds) {
      if (!validId(id) || ids.has(id)) throw new Error("Список старых наград повреждён.");
      ids.add(id);
    }
    // Optional cosmetics preserve compatibility with older v1 wallets.
    if (state.purchases !== undefined) {
      if (!Array.isArray(state.purchases) || state.purchases.length > CATALOG.length)
        throw new Error("История игровых покупок повреждена.");
      const purchased = new Set();
      for (const purchase of state.purchases) {
        if (!plain(purchase) || !shopItem(purchase.id) || purchased.has(purchase.id) ||
            !integer(purchase.coins) || purchase.coins !== shopItem(purchase.id)?.price ||
            !integer(purchase.at)) throw new Error("История игровых покупок повреждена.");
        purchased.add(purchase.id);
      }
    }
    if (state.equipped !== undefined) {
      const eq = state.equipped, owned = new Set(boughtIds(state));
      if (!plain(eq) || typeof eq.scarf !== "boolean" || typeof eq.glasses !== "boolean" ||
          !["default", "cosmic"].includes(eq.theme) ||
          !["default", "sparkle"].includes(eq.victory) ||
          (eq.scarf && !owned.has("scarf")) || (eq.glasses && !owned.has("glasses")) ||
          (eq.theme === "cosmic" && !owned.has("cosmic")) ||
          (eq.victory === "sparkle" && !owned.has("sparkle"))) {
        throw new Error("Выбранное оформление недоступно. Игровая запись сохранена.");
      }
    }
    // A single wrong or manipulated value must never overflow the UI.
    const xp = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
    const coins = state.grants.reduce((sum, grant) => sum + grant.coins, 0);
    if (!integer(xp) || !integer(coins) || !integer(spentCoins(state)) ||
        spentCoins(state) > coins) throw new Error("Некорректный баланс игровых монет.");
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

  function levelFor(xp) {
    let level = 1;
    while (level < 100 && xp >= threshold(level + 1)) level++;
    return level;
  }

  function energyAt(state, now = Date.now()) {
    if (!state.energy) return { value: MAX_ENERGY, updatedAt: now, nextAt: null };
    const stored = state.energy;
    if (stored.value === MAX_ENERGY) return { value: MAX_ENERGY, updatedAt: now, nextAt: null };
    const restored = Math.min(MAX_ENERGY - stored.value,
      Math.floor(Math.max(0, now - stored.updatedAt) / RECHARGE_MS));
    const value = stored.value + restored;
    const updatedAt = value === MAX_ENERGY ? now : stored.updatedAt + restored * RECHARGE_MS;
    return { value, updatedAt, nextAt: value === MAX_ENERGY ? null : updatedAt + RECHARGE_MS };
  }

  function inspect() {
    try {
      const state = load();
      const xp = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
      const coins = state.grants.reduce((sum, grant) => sum + grant.coins, 0) - spentCoins(state);
      const level = levelFor(xp);
      failure = "";
      return { available: true, xp, coins, level, levelStart: threshold(level),
        levelEnd: threshold(level + 1), energy: energyAt(state).value,
        nextEnergyAt: energyAt(state).nextAt, maxEnergy: MAX_ENERGY,
        purchases: boughtIds(state), equipped: shopEquipped(state),
        focusToday: state.grants.filter(g => g.key.startsWith("focus:") && g.day === dayKey(Date.now())).length,
        maxFocusDaily: MAX_FOCUS_DAILY,
        earnedTasks: state.grants.filter(grant => grant.key.startsWith("task:")).length };
    } catch (error) {
      report(error);
      return { available: false, xp: 0, coins: 0, level: 1, levelStart: 0,
        levelEnd: 100, energy: MAX_ENERGY, nextEnergyAt: null, maxEnergy: MAX_ENERGY,
        focusToday: 0, maxFocusDaily: MAX_FOCUS_DAILY, error: failure,
        purchases: [], equipped: { ...DEFAULT_EQUIPPED }, earnedTasks: 0 };
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
      const beforeXP = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
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
      const levelBefore = levelFor(beforeXP);
      const levelAfter = levelFor(beforeXP + xp);
      window.dispatchEvent(new CustomEvent("sdelano:reward-earned", {
        detail: { taskId, xp, coins, levelUp: levelAfter > levelBefore ? levelAfter : 0,
          bonuses: grants.slice(1).map(grant => grant.key.split(":")[0]) }
      }));
      return { awarded: true, xp, coins };
    } catch (error) {
      report(error);
      return { awarded: false, reason: "storage-error" };
    }
  }

  // Only a completed, locally persisted 15-minute visible session may be claimed.
  // Serialize with task writes because both task completions and focus sessions
  // append events to the same local wallet.
  async function claimFocus(id) {
    if (!validId(id)) return { awarded: false, reason: "invalid" };
    const attempt = () => {
      try {
        const session = JSON.parse(sessionStorage.getItem(FOCUS_KEY) || "null");
        if (!plain(session) || session.id !== id ||
            session.status !== "ready" || !integer(session.elapsedMs) ||
            session.elapsedMs < FOCUS_MS) return { awarded: false, reason: "unfinished" };

        const state = load();
        const key = "focus:" + id;
        if (state.grants.some(grant => grant.key === key)) {
          return { awarded: false, reason: "already-awarded" };
        }
        const now = Date.now(), day = dayKey(now);
        if (state.grants.filter(g => g.key.startsWith("focus:") && g.day === day).length >= MAX_FOCUS_DAILY) {
          return { awarded: false, reason: "daily-limit" };
        }
        const energy = energyAt(state, now);
        if (!energy.value) return { awarded: false, reason: "no-energy" };
        if (state.grants.length >= MAX_EVENTS) {
          return { awarded: false, reason: "limit" };
        }
        const beforeXP = state.grants.reduce((sum, grant) => sum + grant.xp, 0);
        state.energy = {
          value: energy.value - 1,
          updatedAt: energy.value === MAX_ENERGY ? now : energy.updatedAt
        };
        state.grants.push({ key, day, at: now, xp: 5, coins: 0 });
        save(state);  // Atomic wallet commit: grant and energy debit together.
        const levelAfter = levelFor(beforeXP + 5), levelBefore = levelFor(beforeXP);
        window.dispatchEvent(new CustomEvent("sdelano:focus-earned", {
          detail: { xp: 5, energy: state.energy.value,
            levelUp: levelAfter > levelBefore ? levelAfter : 0 }
        }));
        return { awarded: true, xp: 5, energy: state.energy.value };
      } catch (error) {
        report(error);
        return { awarded: false, reason: "storage-error" };
      }
    };
    let entered = false;
    try {
      if (navigator.locks?.request) {
        return await navigator.locks.request(TASKS_KEY, () => {
          entered = true;
          return attempt();
        });
      }
    } catch (error) {
      if (entered) { report(error); return { awarded: false, reason: "lock-error" }; }
    }
    return attempt(); // Best effort for older browsers without Web Locks.
  }

  // One lock serializes purchases, equipment selection, task and focus wallet
  // writes on browsers that support Web Locks. Without locks operations remain
  // best-effort and are not a financial-grade multi-device economy.
  // Web Locks alone are insufficient on some multi-process browsers: a
  // newly granted lock may still read a stale localStorage cache. Serialize
  // purchases through a real IndexedDB readwrite transaction and compare the
  // previous committed purchase journal before writing another wallet.
  // Never fall back to unguarded purchases when IDB is unavailable.
  let shopDBPromise;
  function openShopDB() {
    if (!shopDBPromise) {
      shopDBPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          reject(new Error("IndexedDB недоступна."));
          return;
        }
        const request = indexedDB.open("sdelano.shop.guard.v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("guard", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Не удалось открыть журнал покупок."));
        request.onblocked = () => reject(new Error("Журнал покупок занят другой вкладкой."));
      }).catch(error => {
        shopDBPromise = null;
        throw error;
      });
    }
    return shopDBPromise;
  }

  function purchaseFingerprint(wallet) {
    return JSON.stringify((wallet.purchases || [])
      .map(p => [p.id, p.coins, p.at]).sort((a, b) => a[0].localeCompare(b[0])));
  }

  async function inShopTransaction(action) {
    let db;
    try { db = await openShopDB(); }
    catch (error) {
      report(error);
      return { success: false, reason: "storage-error" };
    }
    return new Promise(resolve => {
      let tx, outcome = { success: false, reason: "storage-error" };
      let before = null, written = null;
      try {
        tx = db.transaction("guard", "readwrite");
        const store = tx.objectStore("guard");
        const get = store.get("wallet");
        get.onsuccess = () => {
          try {
            before = localStorage.getItem(KEY);
            const state = load();
            if (get.result && get.result.fingerprint !== purchaseFingerprint(state)) {
              outcome = { success: false, reason: "stale-wallet" };
              return;
            }
            outcome = action();
            if (outcome.success) {
              written = localStorage.getItem(KEY);
              store.put({ id: "wallet", fingerprint: purchaseFingerprint(load()) });
            }
          } catch (error) {
            report(error);
            outcome = { success: false, reason: "storage-error" };
          }
        };
        get.onerror = () => { outcome = { success: false, reason: "storage-error" }; };
        tx.oncomplete = () => resolve(outcome);
        tx.onabort = tx.onerror = () => {
          // Only roll back our own write. Never discard a concurrent edit.
          try {
            if (written !== null && localStorage.getItem(KEY) === written) {
              if (before === null) localStorage.removeItem(KEY);
              else localStorage.setItem(KEY, before);
              window.dispatchEvent(new Event("sdelano:game-changed"));
            }
          } catch { /* Storage may be unavailable. Fail closed. */ }
          resolve({ success: false, reason: "storage-error" });
        };
      } catch (error) {
        report(error);
        resolve({ success: false, reason: "storage-error" });
      }
    });
  }

  async function withShopLock(action) {
    // Serialize with existing task/focus Web Locks where supported; IndexedDB
    // remains authoritative for cross-tab purchase coordination.
    if (navigator.locks?.request) {
      try {
        return await navigator.locks.request(TASKS_KEY, () => inShopTransaction(action));
      } catch (error) {
        report(error);
        return { success: false, reason: "lock-error" };
      }
    }
    return inShopTransaction(action);
  }

  function equipState(state, itemId, enabled) {
    const eq = shopEquipped(state);
    if (itemId === "scarf" || itemId === "glasses") eq[itemId] = enabled;
    else if (itemId === "cosmic") eq.theme = enabled ? "cosmic" : "default";
    else if (itemId === "sparkle") eq.victory = enabled ? "sparkle" : "default";
    return eq;
  }

  async function buyItem(itemId) {
    const item = shopItem(itemId);
    if (!item) return { success: false, reason: "unknown" };
    return withShopLock(() => {
      try {
        const state = load(), purchased = new Set(boughtIds(state));
        if (purchased.has(itemId)) return { success: false, reason: "already-owned" };
        const balance = state.grants.reduce((sum, grant) => sum + grant.coins, 0) - spentCoins(state);
        if (balance < item.price) return { success: false, reason: "insufficient", need: item.price - balance };
        state.purchases ||= [];
        state.purchases.push({ id: itemId, coins: item.price, at: Date.now() });
        state.equipped = equipState(state, itemId, true);
        save(state); // Purchase + debit + equipped state in the same record.
        window.dispatchEvent(new CustomEvent("sdelano:item-purchased", {
          detail: { itemId, name: item.name, coins: item.price }
        }));
        return { success: true, itemId, coins: item.price };
      } catch (error) {
        report(error);
        return { success: false, reason: "storage-error" };
      }
    });
  }

  async function equipItem(itemId, enabled = true) {
    const item = shopItem(itemId);
    if (!item) return { success: false, reason: "unknown" };
    return withShopLock(() => {
      try {
        const state = load();
        if (!boughtIds(state).includes(itemId)) return { success: false, reason: "not-owned" };
        state.equipped = equipState(state, itemId, Boolean(enabled));
        save(state);
        return { success: true, itemId, equipped: Boolean(enabled) };
      } catch (error) {
        report(error);
        return { success: false, reason: "storage-error" };
      }
    });
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
    inspect, awardTask, excludeCompleted, claimFocus, buyItem, equipItem,
    catalog: CATALOG, key: KEY, focusKey: FOCUS_KEY, focusMs: FOCUS_MS,
    rechargeMs: RECHARGE_MS, threshold
  });
})();
