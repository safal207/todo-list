"use strict";

const STORAGE_KEY = "todo-list.tasks.v1";
const TASK_HISTORY_KEY = "sdelano.tasks.history.v1";
const clock = window.taskClock;
const feedback = window.taskFeedback;
let needsClockMigration = false;
const clockUpdates = new Map();
const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const list = document.querySelector("#tasks");
const template = document.querySelector("#task-template");
const emptyState = document.querySelector("#empty-state");
const filteredEmpty = document.querySelector("#filtered-empty");
const filteredMessage = document.querySelector("#filtered-message");
const filterGroup = document.querySelector("#filter-group");
const filterButtons = [...filterGroup.querySelectorAll("button[data-filter]")];
const sampleButton = document.querySelector("#sample-button");
const clearFilterButton = document.querySelector("#clear-filter");
const progressPanel = document.querySelector("#progress-panel");
const progress = document.querySelector("#progress");
const percentage = document.querySelector("#percentage");
const summary = document.querySelector("#progress-summary");
const shareProgressButton = document.querySelector("#share-progress");
const nextStep = document.querySelector("#next-step");
const nextDetail = document.querySelector("#next-detail");
const storageNote = document.querySelector("#storage-note");
const storageWarning = document.querySelector("#storage-warning");
const feedbackToggle = document.querySelector("#feedback-toggle");
const toast = document.querySelector("#task-toast");
let toastTimeout;
let activeFilter = "all";

function setStorageWarning(visible) {
  storageNote.hidden = visible;
  storageWarning.hidden = !visible;
}

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((task) => typeof task?.title === "string" && typeof task.done === "boolean")
      .map((task) => {
        if (!("elapsedMs" in task) || (!task.done && !Number.isFinite(task.startedAt))) {
          needsClockMigration = true;
        }
        return clock.normalize(task);
      });
  } catch {
    setStorageWarning(true);
    return [];
  }
}

const tasks = loadTasks();

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    setStorageWarning(false);
  } catch {
    setStorageWarning(true);
  }
}

if (needsClockMigration) saveTasks();

function renderFeedbackToggle() {
  const enabled = feedback.isEnabled();
  feedbackToggle.setAttribute("aria-pressed", String(enabled));
  feedbackToggle.textContent = enabled ? "Отклик: вкл" : "Отклик: выкл";
}
renderFeedbackToggle();
feedbackToggle.addEventListener("click", () => {
  feedback.setEnabled(!feedback.isEnabled());
  renderFeedbackToggle();
});

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function announceDone(task) {
  showToast("Отлично! " + clock.display(task) + " ✦");
}

// Share only aggregate counts. Never include task titles, their duration,
// timestamps or localStorage; recipients start with their own empty list.
const SHARE_URL = "https://safal207.github.io/todo-list/";

function progressShareData() {
  const total = tasks.length;
  const done = tasks.reduce((sum, task) => sum + Number(task.done), 0);
  const percent = total ? Math.floor((done / total) * 100) : 0;
  const headline = total === done ? "Все задачи закрыты!" :
    done === 0 ? "Я начал(а) двигаться к цели!" : "Меньше «потом». Больше «готово»!";
  const text = `${headline}\nМой прогресс в «Сделано»: ${percent}% — ${done} из ${total} задач выполнено.\n\nХватит кормить задачи «завтраками». Жми и делай!`;
  return { title: "Мой прогресс — Сделано", text, url: SHARE_URL };
}

async function copyProgress(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Clipboard API can be blocked. Try the selection fallback. */ }
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch {}
  field.remove();
  return copied;
}

shareProgressButton.addEventListener("click", async () => {
  if (tasks.length === 0) return;
  feedback.play("tap");
  const data = progressShareData();
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      showToast("Прогрессом поделились! ✦");
      return;
    } catch (error) {
      // Closing a native share sheet is not an error and must not copy data.
      if (error?.name === "AbortError") return;
    }
  }
  const copied = await copyProgress(`${data.text}\n\n${data.url}`);
  showToast(copied ? "Прогресс и ссылка скопированы! ✦" :
    "Не удалось скопировать. Разрешите доступ к буферу обмена.");
});

function recordTaskActivity(task, action) {
  try {
    const saved = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? "[]");
    const history = Array.isArray(saved) ? saved : [];
    history.push({ title: task.title, action, at: Date.now() });
    localStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(history.slice(-300)));
  } catch { /* The list is usable with unavailable history. */ }
}

function updateProgress() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.done).length;
  const ratio = total > 0 ? Math.floor((completed * 100) / total) : 0;
  const status = `Выполнено ${completed} из ${total}`;

  if (total === 0) {
    progressPanel.dataset.stage = "first";
    nextStep.textContent = "Добавьте первую задачу";
    nextDetail.textContent = "Запишите одно дело, с которого хотите начать.";
  } else if (completed === total) {
    progressPanel.dataset.stage = "done";
    nextStep.textContent = "Всё сделано!";
    nextDetail.textContent = "Появится новое дело — добавьте его в список.";
  } else {
    progressPanel.dataset.stage = "working";
    nextStep.textContent = completed === 0 ? "Выполните первую задачу" : "Возьмитесь за следующее дело";
    nextDetail.textContent = "Когда закончите, поставьте галочку рядом с задачей.";
  }

  shareProgressButton.disabled = total === 0;
  shareProgressButton.title = total === 0 ? "Добавьте задачу, чтобы поделиться прогрессом" :
    "Поделиться процентом и количеством готовых задач";
  progress.value = ratio;
  percentage.textContent = `${ratio}%`;
  if (summary.textContent !== status) {
    summary.textContent = status;
  }
}

function updateList() {
  for (const button of filterButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter));
  }

  let visibleCount = 0;
  for (const row of list.children) {
    const done = row.querySelector(".task-checkbox").checked;
    row.hidden = activeFilter !== "all" && done !== (activeFilter === "done");
    if (!row.hidden) {
      visibleCount += 1;
    }
  }

  list.hidden = visibleCount === 0;
  filterGroup.hidden = tasks.length === 0;
  emptyState.hidden = tasks.length > 0;
  filteredEmpty.hidden = tasks.length === 0 || visibleCount > 0;
  if (!filteredEmpty.hidden) {
    filteredMessage.textContent = activeFilter === "done" ? "Выполненных задач пока нет" : "Все задачи выполнены";
  }
}

function visibleNeighborCheckbox(row) {
  const rows = [...list.children];
  const index = rows.indexOf(row);
  const neighbor = rows.slice(index + 1).find((item) => !item.hidden)
    ?? rows.slice(0, index).reverse().find((item) => !item.hidden);
  return neighbor?.querySelector(".task-checkbox");
}

function focusAfterRemoval(neighbor) {
  const selectedFilter = filterButtons.find((button) => button.dataset.filter === activeFilter);
  const fallback = tasks.length > 0 ? selectedFilter : titleInput;
  (neighbor ?? fallback ?? titleInput).focus();
}

function appendTask(task) {
  const row = template.content.firstElementChild.cloneNode(true);
  const checkbox = row.querySelector(".task-checkbox");
  const deleteButton = row.querySelector(".delete-button");
  const timeLabel = row.querySelector(".task-clock");
  const updateClock = () => { timeLabel.textContent = clock.display(task); };
  clockUpdates.set(task, updateClock);
  row.classList.toggle("task-finished", task.done);
  updateClock();

  row.querySelector(".task-title").textContent = task.title;
  checkbox.checked = task.done;
  deleteButton.setAttribute("aria-label", `Удалить задачу «${task.title}»`);
  deleteButton.title = "Удалить задачу";

  checkbox.addEventListener("change", () => {
    const now = Date.now();
    if (checkbox.checked) {
      clock.finish(task, now);
      feedback.play("complete");
      row.classList.remove("task-celebrate");
      void row.offsetWidth;
      row.classList.add("task-celebrate");
      announceDone(task);
    } else {
      clock.reopen(task, now);
      feedback.play("reopen");
      row.classList.remove("task-celebrate");
    }
    row.classList.toggle("task-finished", task.done);
    updateClock();
    saveTasks();
    recordTaskActivity(task, task.done ? "done" : "reopen");
    updateProgress();
    updateList();
    if (row.hidden) {
      focusAfterRemoval(visibleNeighborCheckbox(row));
    }
  });

  deleteButton.addEventListener("click", () => {
    feedback.play("remove");
    const neighbor = visibleNeighborCheckbox(row);
    clockUpdates.delete(task);
    tasks.splice(tasks.indexOf(task), 1);
    row.remove();
    saveTasks();
    recordTaskActivity(task, "delete");
    updateProgress();
    if (tasks.length === 0) {
      activeFilter = "all";
    }
    updateList();
    focusAfterRemoval(neighbor);
  });

  list.append(row);
  return checkbox;
}

function addTask(title) {
  const task = clock.create(title);
  feedback.play("add");
  tasks.push(task);
  const checkbox = appendTask(task);
  if (activeFilter === "done") {
    activeFilter = "all";
  }
  saveTasks();
  recordTaskActivity(task, "created");
  updateProgress();
  updateList();
  return checkbox;
}

sampleButton.addEventListener("click", () => addTask("Запланировать главное дело").focus());

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    feedback.play("tap");
    activeFilter = button.dataset.filter;
    updateList();
  });
}

clearFilterButton?.addEventListener("click", () => {
  feedback.play("tap");
  activeFilter = "all";
  updateList();
  filterButtons.find((button) => button.dataset.filter === activeFilter)?.focus();
});

titleInput.addEventListener("input", () => titleInput.setCustomValidity(""));
titleInput.addEventListener("pointerdown", () => feedback.play("tap"));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();

  if (!title) {
    titleInput.setCustomValidity("Введите название задачи.");
    titleInput.reportValidity();
    return;
  }

  addTask(title);
  form.reset();
  titleInput.focus();
});

tasks.forEach(appendTask);
updateProgress();
updateList();

function updateClocks() {
  for (const update of clockUpdates.values()) update();
}
setInterval(updateClocks, 250);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateClocks();
});
