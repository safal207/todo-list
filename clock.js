(() => {
  "use strict";

  // We measure elapsed wall-clock time while a task is in progress.
  // Time is paused on completion and resumes if the task is reopened.
  const validTime = (value) => Number.isFinite(value) && value > 0;
  const validDuration = (value) => Number.isFinite(value) && value >= 0;

  function normalize(task, now = Date.now()) {
    const timed = validDuration(task.elapsedMs);
    return {
      ...task,
      elapsedMs: timed ? task.elapsedMs : (task.done ? null : 0),
      startedAt: task.done ? null : (validTime(task.startedAt) ? task.startedAt : now),
      doneAt: task.done && validTime(task.doneAt) ? task.doneAt : null
    };
  }

  function create(title, now = Date.now()) {
    return { title, done: false, elapsedMs: 0, startedAt: now, doneAt: null };
  }

  function elapsed(task, now = Date.now()) {
    const previous = validDuration(task.elapsedMs) ? task.elapsedMs : 0;
    return previous + (!task.done && validTime(task.startedAt)
      ? Math.max(0, now - task.startedAt) : 0);
  }

  function finish(task, now = Date.now()) {
    task.elapsedMs = elapsed(task, now);
    task.startedAt = null;
    task.doneAt = now;
    task.done = true;
  }

  function reopen(task, now = Date.now()) {
    task.elapsedMs = validDuration(task.elapsedMs) ? task.elapsedMs : 0;
    task.startedAt = now;
    task.doneAt = null;
    task.done = false;
  }

  function clockText(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const two = (number) => String(number).padStart(2, "0");
    return (days > 0 ? days + " д " : "") + two(hours) + ":" + two(minutes) + ":" + two(rest);
  }

  function humanText(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const parts = [];
    if (days) parts.push(days + " д");
    if (hours) parts.push(hours + " ч");
    if (minutes) parts.push(minutes + " мин");
    if (days === 0 && hours === 0 && rest) parts.push(rest + " сек");
    return parts.length ? parts.join(" ") : "0 сек";
  }

  function display(task, now = Date.now()) {
    if (task.done) {
      return task.elapsedMs === null
        ? "Готово · время неизвестно"
        : "Готово за " + humanText(task.elapsedMs);
    }
    return "Время идёт · " + clockText(elapsed(task, now));
  }

  window.taskClock = { normalize, create, elapsed, finish, reopen, display, clockText, humanText };
})();
