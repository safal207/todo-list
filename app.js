"use strict";

const STORAGE_KEY = "todo-list.tasks.v1";
const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const list = document.querySelector("#tasks");
const template = document.querySelector("#task-template");
const emptyState = document.querySelector("#empty-state");
const progress = document.querySelector("#progress");
const percentage = document.querySelector("#percentage");
const summary = document.querySelector("#progress-summary");
const storageNote = document.querySelector("#storage-note");
const storageWarning = document.querySelector("#storage-warning");

function setStorageWarning(visible) {
  storageNote.hidden = visible;
  storageWarning.hidden = !visible;
}

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored)
      ? stored.filter((task) => typeof task?.title === "string" && typeof task.done === "boolean")
      : [];
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

function updateProgress() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.done).length;
  const ratio = total > 0 ? Math.round((completed / total) * 100) : 0;

  emptyState.hidden = total > 0;
  progress.value = ratio;
  percentage.textContent = `${ratio}%`;
  summary.textContent = `Выполнено ${completed} из ${total}`;
}

function appendTask(task) {
  const row = template.content.firstElementChild.cloneNode(true);
  const checkbox = row.querySelector(".task-checkbox");
  const deleteButton = row.querySelector(".delete-button");

  row.querySelector(".task-title").textContent = task.title;
  checkbox.checked = task.done;
  deleteButton.setAttribute("aria-label", `Удалить задачу «${task.title}»`);
  deleteButton.title = "Удалить задачу";

  checkbox.addEventListener("change", () => {
    task.done = checkbox.checked;
    saveTasks();
    updateProgress();
  });

  deleteButton.addEventListener("click", () => {
    const neighbor = row.nextElementSibling ?? row.previousElementSibling;
    tasks.splice(tasks.indexOf(task), 1);
    row.remove();
    saveTasks();
    updateProgress();
    (neighbor?.querySelector(".task-checkbox") ?? titleInput).focus();
  });

  list.append(row);
}

titleInput.addEventListener("input", () => titleInput.setCustomValidity(""));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();

  if (!title) {
    titleInput.setCustomValidity("Введите название задачи.");
    titleInput.reportValidity();
    return;
  }

  const task = { title, done: false };
  tasks.push(task);
  appendTask(task);
  saveTasks();
  updateProgress();
  form.reset();
  titleInput.focus();
});

tasks.forEach(appendTask);
updateProgress();
