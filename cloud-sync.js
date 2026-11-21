(() => {
  "use strict";

  const config = window.SDELANO_CLOUD_CONFIG;
  const section = document.querySelector("#cloud-sync");
  // Do not add third-party scripts, auth requests or tracking to local-only users.
  if (!section || !config?.url || !config?.publishableKey) return;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url) ||
      !config.publishableKey.startsWith("sb_publishable_")) {
    console.error("Сделано: invalid public Supabase configuration");
    return;
  }

  section.hidden = false;
  const backup = window.sdelanoBackup;
  const merger = window.sdelanoSyncMerge;
  const email = document.querySelector("#cloud-email");
  const signIn = document.querySelector("#cloud-signin");
  const signOut = document.querySelector("#cloud-signout");
  const syncNow = document.querySelector("#cloud-sync-now");
  const authActions = document.querySelector("#cloud-auth-actions");
  const signedIn = document.querySelector("#cloud-signed-in");
  const status = document.querySelector("#cloud-status");
  let client = null;
  let user = null;
  let running = false;
  let rerun = false;
  let timer = 0;
  let pausedConflict = false;

  function message(text, isError = false) {
    status.textContent = text;
    status.dataset.error = String(isError);
  }
  function baselineKey(id) { return "sdelano.cloud.baseline.v1." + id; }

  function getLocal() {
    let tasks;
    try {
      tasks = JSON.parse(localStorage.getItem("todo-list.tasks.v1") || "[]");
    } catch {
      throw new Error("Локальный список повреждён. Восстанови его перед синхронизацией.");
    }
    const achievements = {
      firstWin: localStorage.getItem("sdelano.first-win.v1") === "1",
      threeSteps: localStorage.getItem("sdelano.three-steps.v1") === "1",
      record: Math.max(0, Number(localStorage.getItem("sdelano.milestone.record.v1")) || 0)
    };
    return JSON.parse(backup.create(tasks, achievements));
  }
  function getBaseline(id) {
    try {
      const stored = localStorage.getItem(baselineKey(id));
      return stored ? backup.parse(stored) : null;
    } catch {
      throw new Error("История синхронизации недоступна. Скачай резервную копию перед повторной попыткой.");
    }
  }
  function validateCloud(payload) {
    return backup.parse(JSON.stringify(payload));
  }
  function snap(tasks, achievements) {
    return JSON.parse(backup.create(tasks, achievements));
  }
  function getCurrentSessionName() {
    const name = user?.email;
    return typeof name === "string" ? name : "аккаунт";
  }
  function renderAuth() {
    const active = Boolean(user);
    authActions.hidden = active;
    signedIn.hidden = !active;
    if (active) document.querySelector("#cloud-account").textContent = getCurrentSessionName();
    syncNow.disabled = !active || running;
    signOut.disabled = !active || running;
  }

  function applyLocal(snapshot, id) {
    // The cloud copy is already committed. If local storage is full,
    // NEVER partially write or silently overwrite the user's current tasks.
    const raw = JSON.stringify(snapshot.tasks);
    const original = localStorage.getItem("todo-list.tasks.v1");
    const checkpoint = {
      "sdelano.first-win.v1": localStorage.getItem("sdelano.first-win.v1"),
      "sdelano.three-steps.v1": localStorage.getItem("sdelano.three-steps.v1"),
      "sdelano.milestone.record.v1": localStorage.getItem("sdelano.milestone.record.v1"),
      [baselineKey(id)]: localStorage.getItem(baselineKey(id))
    };
    try {
      localStorage.setItem("todo-list.tasks.v1", raw);
      localStorage.setItem("sdelano.first-win.v1", snapshot.achievements.firstWin ? "1" : "0");
      localStorage.setItem("sdelano.three-steps.v1", snapshot.achievements.threeSteps ? "1" : "0");
      localStorage.setItem("sdelano.milestone.record.v1", String(snapshot.achievements.record));
      localStorage.setItem(baselineKey(id), JSON.stringify(snapshot));
    } catch {
      // Best-effort rollback; never claim a successful sync if rollback also fails.
      try {
        if (original === null) localStorage.removeItem("todo-list.tasks.v1");
        else localStorage.setItem("todo-list.tasks.v1", original);
        for (const [k,v] of Object.entries(checkpoint)) {
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k,v);
        }
      } catch { /* Warn: browser storage may be unavailable. */ }
      throw new Error("Облако обновлено, но устройство не сохранило данные. Не очищай браузер; проверь место и повтори.");
    }
    window.dispatchEvent(new Event("sdelano:cloud-applied"));
  }

  // An origin-wide lock serializes cloud work with existing local task writes.
  async function withTaskLock(action) {
    if (navigator.locks?.request) {
      return navigator.locks.request("todo-list.tasks.v1", action);
    }
    return action();
  }

  async function runOnce() {
    if (!user || !navigator.onLine) {
      message("Нет подключения. Локальные задачи доступны; синхронизация возобновится онлайн.");
      return;
    }
    await withTaskLock(async () => {
      const session = await client.auth.getUser();
      if (session.error || session.data.user?.id !== user.id) {
        throw new Error("Сеанс входа истёк. Войди снова.");
      }
      const local = getLocal();
      const base = getBaseline(user.id);
      // Up to three retries if another device updates the same cloud revision.
      for (let attempt = 0; attempt < 3; attempt++) {
        const read = await client.from("sdelano_sync_v1")
          .select("revision,snapshot").eq("user_id", user.id).maybeSingle();
        if (read.error) throw new Error("Не удалось прочитать облако: " + read.error.message);
        const record = read.data;
        const remote = record ? validateCloud(record.snapshot) : snap([], {
          firstWin: false, threeSteps: false, record: 0
        });
        const result = merger.merge(local, remote, base);
        if (result.conflicts.length) {
          pausedConflict = true;
          message("Найдены разные изменения в " + result.conflicts.length +
            " задачах. Синхронизация приостановлена, чтобы ничего не потерять. " +
            "Сохрани JSON-копии с обоих устройств и согласуй изменения.", true);
          return;
        }
        const combined = snap(result.tasks, result.achievements);
        if (merger.sameSnapshot(combined, remote)) {
          applyLocal(combined, user.id);
          message("Все задачи актуальны на этом устройстве и в облаке.");
          return;
        }

        const wrote = record
          ? await client.from("sdelano_sync_v1")
            .update({ snapshot: combined, revision: record.revision + 1,
              updated_at: new Date().toISOString() })
            .eq("user_id", user.id).eq("revision", record.revision)
            .select("revision")
          : await client.from("sdelano_sync_v1")
            .insert({ user_id: user.id, snapshot: combined, revision: 1 })
            .select("revision");
        if (wrote.error) {
          // 23505: concurrent first insert. Treat it as a revision race.
          if (wrote.error.code === "23505") continue;
          throw new Error("Не удалось записать в облако: " + wrote.error.message);
        }
        if (!wrote.data?.length) continue; // Compare-and-swap lost; retry.
        applyLocal(combined, user.id);
        message("Синхронизировано. Изменения доступны на других устройствах этого аккаунта.");
        return;
      }
      throw new Error("Другое устройство меняло данные одновременно. Повтори синхронизацию.");
    });
  }

  async function sync() {
    if (!user || running || pausedConflict) {
      if (running) rerun = true;
      return;
    }
    running = true;
    renderAuth();
    try { await runOnce(); }
    catch (error) { message(error.message || "Ошибка синхронизации", true); }
    finally {
      running = false;
      renderAuth();
      if (rerun) {
        rerun = false;
        scheduleSync(600);
      }
    }
  }
  function scheduleSync(delay = 1500) {
    if (!user || pausedConflict) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void sync(); }, delay);
  }

  async function init() {
    try {
      // Version pinned; dynamic import happens ONLY after a valid configured URL.
      const sdk = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.1/+esm");
      client = sdk.createClient(config.url.replace(/\/$/, ""), config.publishableKey, {
        auth: {
          flowType: "pkce", persistSession: true, autoRefreshToken: true,
          detectSessionInUrl: true, storageKey: "sdelano.cloud.auth.v1"
        }
      });
      client.auth.onAuthStateChange((_event, session) => {
        if (_event === "SIGNED_OUT") {
          user = null;
          pausedConflict = false;
          renderAuth();
          message("Выход выполнен. Локальные задачи остались на устройстве.");
        } else if (session?.user && _event === "SIGNED_IN") {
          // Avoid calling Supabase asynchronously inside its auth event callback.
          setTimeout(() => void refreshUser(), 0);
        }
      });
      await refreshUser();
    } catch (error) {
      message("Сервис синхронизации недоступен: " + (error.message || "ошибка загрузки"), true);
    }
  }
  async function refreshUser() {
    if (!client) return;
    const res = await client.auth.getUser();
    user = res.error ? null : res.data.user;
    pausedConflict = false;
    renderAuth();
    if (user) {
      message("Выполнен вход. Проверяем обновления...");
      scheduleSync(0);
    } else {
      message("Войди по ссылке из письма, чтобы синхронизировать задачи.");
    }
  }

  signIn.addEventListener("click", async () => {
    const address = email.value.trim();
    if (!email.checkValidity() || !address) {
      email.reportValidity();
      return;
    }
    if (!client) { message("Сервис входа ещё не готов.", true); return; }
    signIn.disabled = true;
    try {
      const res = await client.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: location.origin + location.pathname }
      });
      if (res.error) throw res.error;
      message("Письмо отправлено. Открой ссылку в этом же браузере.");
    } catch (error) {
      message("Не получилось отправить письмо: " + error.message, true);
    } finally { signIn.disabled = false; }
  });
  signOut.addEventListener("click", async () => {
    if (!client) return;
    const res = await client.auth.signOut();
    if (res.error) message("Не удалось выйти: " + res.error.message, true);
    else {
      user = null; pausedConflict = false;
      renderAuth(); message("Ты вышел из аккаунта. Локальные задачи сохранены.");
    }
  });
  syncNow.addEventListener("click", () => {
    pausedConflict = false;
    void sync();
  });
  window.addEventListener("sdelano:tasks-changed", () => scheduleSync());
  window.addEventListener("sdelano:achievements-changed", () => scheduleSync());
  window.addEventListener("online", () => scheduleSync(100));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSync(100);
  });
  setInterval(() => { if (!document.hidden) scheduleSync(100); }, 30000);
  void init();
})();
