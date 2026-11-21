(() => {
  "use strict";

  const format = "sdelano-task-backup";
  const version = 1;
  const maxBytes = 2 * 1024 * 1024;
  const maxTasks = 5000;

  function validateTask(task) {
    if (!task || typeof task !== "object" || Array.isArray(task) ||
        typeof task.id !== "string" || task.id.length < 1 || task.id.length > 150 ||
        typeof task.title !== "string" || !task.title.trim() || task.title.length > 200 ||
        typeof task.done !== "boolean" ||
        (task.elapsedMs !== null && (!Number.isSafeInteger(task.elapsedMs) || task.elapsedMs < 0)) ||
        (!task.done && (task.elapsedMs === null || !Number.isSafeInteger(task.startedAt) || task.startedAt <= 0)) ||
        (task.done && task.startedAt !== null) ||
        (task.doneAt !== null && (!Number.isSafeInteger(task.doneAt) || task.doneAt <= 0)) ||
        (!task.done && task.doneAt !== null) ||
        (task.createdFromInvite !== undefined && typeof task.createdFromInvite !== "boolean")) {
      throw new Error("Некорректные данные задачи в резервной копии.");
    }
    return {
      id: task.id, title: task.title, done: task.done,
      elapsedMs: task.elapsedMs, startedAt: task.startedAt, doneAt: task.doneAt,
      ...(task.createdFromInvite === true ? { createdFromInvite: true } : {})
    };
  }

  function validateTasks(input) {
    if (!Array.isArray(input) || input.length > maxTasks) {
      throw new Error("В копии должно быть не больше 5000 задач.");
    }
    const ids = new Set();
    return input.map(task => {
      const valid = validateTask(task);
      if (ids.has(valid.id)) throw new Error("В копии повторяются идентификаторы задач.");
      ids.add(valid.id);
      return valid;
    });
  }

  function validateAchievements(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.firstWin !== "boolean" || typeof value.threeSteps !== "boolean" ||
        !Number.isSafeInteger(value.record) || value.record < 0 || value.record > 1000000) {
      throw new Error("Некорректные достижения в резервной копии.");
    }
    return { firstWin: value.firstWin, threeSteps: value.threeSteps, record: value.record };
  }

  function create(tasks, achievements) {
    const backup = {
      format, version, exportedAt: new Date().toISOString(),
      tasks: validateTasks(tasks),
      achievements: validateAchievements(achievements)
    };
    const json = JSON.stringify(backup, null, 2);
    if (new Blob([json]).size > maxBytes) {
      throw new Error("Копия превышает 2 МБ. Сократи список перед экспортом.");
    }
    return json;
  }

  function parse(text) {
    if (typeof text !== "string" || new Blob([text]).size > maxBytes) {
      throw new Error("Размер файла превышает допустимые 2 МБ.");
    }
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error("Файл не является корректным JSON."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        payload.format !== format || payload.version !== version) {
      throw new Error("Неподдерживаемая резервная копия «Сделано».");
    }
    if (typeof payload.exportedAt !== "string" ||
        !Number.isFinite(Date.parse(payload.exportedAt))) {
      throw new Error("В файле отсутствует дата создания копии.");
    }
    return {
      exportedAt: payload.exportedAt,
      tasks: validateTasks(payload.tasks),
      achievements: validateAchievements(payload.achievements)
    };
  }

  function plan(existing, incoming) {
    const ids = new Set(existing.map(task => task.id));
    return {
      added: incoming.filter(task => !ids.has(task.id)),
      skipped: incoming.filter(task => ids.has(task.id)).length
    };
  }

  window.sdelanoBackup = Object.freeze({ create, parse, plan, maxBytes });
})();
