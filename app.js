"use strict";

const STORAGE_KEY = "todo-list.tasks.v1";
const TASK_HISTORY_KEY = "sdelano.tasks.history.v1";
const FIRST_WIN_KEY = "sdelano.first-win.v1";
const THREE_STEPS_KEY = "sdelano.three-steps.v1";
const MILESTONE_RECORD_KEY = "sdelano.milestone.record.v1";
const BREAK_KEY = "sdelano.break.v1";
const MILESTONE_GOALS = [1, 3, 5, 10];
const RETURN_AFTER_MS = 24 * 60 * 60 * 1000;
const clock = window.taskClock;
const feedback = window.taskFeedback;
const analytics = window.sdelanoAnalytics;
let needsTaskMigration = false;
let needsRecovery = false;
let unsavedTasks = false;
let savedTaskSnapshot = null;
let taskStorageReadable = true;
const taskViews = new Map();
const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const timerHint = document.querySelector("#timer-hint");
const completionHint = document.querySelector("#completion-hint")?.textContent.trim();
const list = document.querySelector("#tasks");
const completedGroup = document.querySelector("#completed-group");
const completedList = document.querySelector("#completed-tasks");
const completedCount = document.querySelector("#completed-count");
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
const milestoneRecordLabel = document.querySelector("#milestone-record");
const milestoneSteps = [...document.querySelectorAll("#milestone-track li[data-goal]")];
const milestoneNextProgress = document.querySelector("#milestone-next-progress");
const milestoneNextLabel = document.querySelector("#milestone-next-label");
const firstStepGuide = document.querySelector("#first-step-guide");
const firstStepLabel = document.querySelector("#first-step-label");
const firstStepTitle = document.querySelector("#first-step-title");
const firstStepDetail = document.querySelector("#first-step-detail");
const firstStepCta = document.querySelector("#first-step-cta");
const firstWinCard = document.querySelector("#first-win-card");
const firstWinDetail = document.querySelector("#first-win-detail");
const firstWinNext = document.querySelector("#first-win-next");
const firstWinShare = document.querySelector("#first-win-share");
const threeStepsCard = document.querySelector("#three-steps-card");
const threeStepsNext = document.querySelector("#three-steps-next");
const threeStepsShare = document.querySelector("#three-steps-share");
const shareProgressButton = document.querySelector("#share-progress");
const nextStep = document.querySelector("#next-step");
const nextDetail = document.querySelector("#next-detail");
const nextAction = document.querySelector("#next-action");
const nextActionButton = document.querySelector("#next-action-button");
const nextBreak = document.querySelector("#next-break");
const storageNote = document.querySelector("#storage-note");
const storageWarning = document.querySelector("#storage-warning");
const feedbackToggle = document.querySelector("#feedback-toggle");
let activeFilter = "all";
const taskPanel = document.querySelector(".task-panel");
const pendingChanges = new Set();

const unavailableMessage = storageWarning.textContent;
const recoveryMessage = "Не удалось прочитать весь список. При сохранении оставим копию исходных данных.";

function setStorageWarning(visible, message = unavailableMessage) {
  if (visible) storageWarning.textContent = message;
  storageNote.hidden = visible;
  storageWarning.hidden = !visible;
}

function readTaskSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    taskStorageReadable = false;
    setStorageWarning(true);
    return savedTaskSnapshot;
  }
}

function newTaskId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
}

function decodeTasks(raw) {
  savedTaskSnapshot = raw;
  needsTaskMigration = false;
  needsRecovery = false;
  if (raw === null) return [];
  let stored;
  try { stored = JSON.parse(raw); } catch { /* Preserve the original on the next save. */ }
  if (!Array.isArray(stored)) {
    needsRecovery = true;
    setStorageWarning(true, recoveryMessage);
    return [];
  }
  const reservedIds = new Set(stored.map(task => task?.id));
  const ids = new Set();
  const valid = [];
  for (const [index, task] of stored.entries()) {
    if (typeof task?.title !== "string" || typeof task.done !== "boolean") {
      needsRecovery = true;
      continue;
    }
    const normalized = clock.normalize(task);
    if (typeof task.id !== "string" || !task.id || ids.has(task.id)) {
      // Two tabs opening the same old list must assign the same row identities.
      let id = "legacy-" + index;
      while (reservedIds.has(id)) id += "-";
      normalized.id = id;
    }
    ids.add(normalized.id);
    if (normalized.id !== task.id || normalized.elapsedMs !== task.elapsedMs ||
        normalized.startedAt !== task.startedAt || normalized.doneAt !== task.doneAt) {
      needsTaskMigration = true;
    }
    valid.push(normalized);
  }
  setStorageWarning(needsRecovery, recoveryMessage);
  return valid;
}

const tasks = decodeTasks(readTaskSnapshot());

function loadLastTaskActivity() {
  const lastTaskTime = tasks.reduce((latest, task) =>
    Math.max(latest, task.startedAt ?? 0, task.doneAt ?? 0), 0);
  try {
    const history = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? "[]");
    const lastAction = Array.isArray(history) ? history.at(-1)?.at : null;
    return Number.isFinite(lastAction) ? Math.max(lastTaskTime, lastAction) : lastTaskTime;
  } catch {
    return lastTaskTime;
  }
}
let lastTaskActivity = loadLastTaskActivity();

function saveAchievement(key, value) {
  if (!taskStorageReadable) return;
  try { localStorage.setItem(key, value); }
  catch { /* Keep the achievement in memory for this session. */ }
}

// Do not award "first victory" again to returning or legacy users. The
// history check also covers a completed task which was reopened or deleted.
function hadFirstWinBefore() {
  if (milestoneRecord >= 1 || tasks.some((task) => task.done)) {
    saveAchievement(FIRST_WIN_KEY, "1");
    return true;
  }
  try {
    if (localStorage.getItem(FIRST_WIN_KEY) === "1") return true;
    const history = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? "[]");
    return Array.isArray(history) && history.some((event) => event?.action === "done");
  } catch {
    return false;
  }
}
let milestoneRecord = loadMilestoneRecord();

// Count three separate completed tasks, not three toggles of one checkbox.
// The stored award survives reopened/deleted tasks and is never replayed.
function hadThreeStepsBefore() {
  if (milestoneRecord >= 3 || tasks.filter((task) => task.done).length >= 3) {
    saveAchievement(THREE_STEPS_KEY, "1");
    return true;
  }
  try {
    return localStorage.getItem(THREE_STEPS_KEY) === "1";
  } catch {
    return false;
  }
}
let threeStepsAchieved = hadThreeStepsBefore();
let firstWinAchieved = threeStepsAchieved || hadFirstWinBefore();
let firstWinVisible = false;
let threeStepsVisible = false;
let recentCompletion = null;
let onBreak = false;
try {
  onBreak = firstWinAchieved && sessionStorage.getItem(BREAK_KEY) === "1";
} catch { /* The break can still be used in memory. */ }

// Keep a personal best: reopening or deleting a task should not take away
// achievements. Count distinct currently finished rows, never toggle events.
function loadMilestoneRecord() {
  try {
    const value = Number(localStorage.getItem(MILESTONE_RECORD_KEY));
    return Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : 0;
  } catch {
    return 0;
  }
}

function saveTasks() {
  if (!taskStorageReadable) return;
  try {
    // A quota failure must never replace the original with a partial list.
    if (needsRecovery) {
      localStorage.setItem(STORAGE_KEY + ".recovery." + newTaskId(), savedTaskSnapshot);
      needsRecovery = false;
    }
    const raw = JSON.stringify(tasks);
    localStorage.setItem(STORAGE_KEY, raw);
    savedTaskSnapshot = raw;
    needsTaskMigration = false;
    unsavedTasks = false;
    setStorageWarning(false);
  } catch {
    unsavedTasks = true;
    setStorageWarning(true);
  }
}

function syncStoredTasks() {
  if (!taskStorageReadable) return;
  const raw = readTaskSnapshot();
  if (raw === savedTaskSnapshot) return;
  if (unsavedTasks) {
    // Retain this tab's unsaved edits and the other tab's newer saved list.
    taskStorageReadable = false;
    setStorageWarning(true);
    return;
  }
  const focused = document.activeElement;
  const focusedId = focused?.closest("li.task")?.dataset.taskId;
  const focusDelete = focused?.classList.contains("delete-button");
  const fresh = decodeTasks(raw);
  tasks.length = 0;
  list.replaceChildren();
  completedList.replaceChildren();
  taskViews.clear();
  for (const task of fresh) {
    tasks.push(task);
    appendTask(task);
  }
  firstWinVisible = false;
  threeStepsVisible = false;
  recentCompletion = null;
  if (!tasks.length) activeFilter = "all";
  milestoneRecord = Math.max(milestoneRecord, loadMilestoneRecord());
  threeStepsAchieved ||= hadThreeStepsBefore();
  firstWinAchieved ||= threeStepsAchieved || hadFirstWinBefore();
  lastTaskActivity = loadLastTaskActivity();
  updateProgress();
  updateList();
  if (focusedId) {
    const view = taskViews.get(focusedId);
    const visible = view && (view.task.done ? completedGroup.open : !list.hidden);
    const next = visible ? view.row.querySelector(focusDelete ? ".delete-button" : ".task-checkbox") :
      filterButtons.find(button => tasks.length && button.dataset.filter === activeFilter) ?? titleInput;
    next.focus({ preventScroll: true });
  }
}

function changeTasks(action) {
  const apply = () => { syncStoredTasks(); action(); };
  let locks;
  try { locks = navigator.locks; } catch { /* Some embedded views deny storage APIs. */ }
  if (!taskStorageReadable || !locks) {
    apply();
    return;
  }
  // Re-read under the same origin lock in every tab, including during migration.
  const commit = () => {
    if (!pendingChanges.delete(commit)) return;
    try { apply(); }
    finally { if (!pendingChanges.size) taskPanel.removeAttribute("aria-busy"); }
  };
  pendingChanges.add(commit);
  taskPanel.setAttribute("aria-busy", "true");
  let entered = false;
  void locks.request(STORAGE_KEY, () => {
    entered = true;
    commit();
  }).catch(error => {
    if (entered) throw error;
    commit(); // A browser that denies locks can still edit the local list.
  });
}

// Navigation can cancel a queued lock before the browser dispatches its callback.
window.addEventListener("pagehide", () => {
  for (const commit of pendingChanges) commit();
});

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

function clearCompletion() {
  firstWinVisible = false;
  threeStepsVisible = false;
  recentCompletion = null;
  if (onBreak) setBreak(false);
}

function setBreak(active) {
  onBreak = active;
  try {
    if (active) sessionStorage.setItem(BREAK_KEY, "1");
    else sessionStorage.removeItem(BREAK_KEY);
  } catch { /* Keep the current state in memory. */ }
}

// Viral referral: share aggregate counts only, with a recipient-facing CTA.
const SHARE_URL = "https://safal207.github.io/todo-list/invite/";
const shareDialog = document.querySelector("#share-dialog");
const shareClose = document.querySelector("#share-close");
const shareNative = document.querySelector("#share-native");
const shareCopy = document.querySelector("#share-copy");
const shareTelegram = document.querySelector("#share-telegram");
const shareWhatsApp = document.querySelector("#share-whatsapp");
const shareReadyText = document.querySelector("#share-ready-text");
const shareImageNative = document.querySelector("#share-image-native");
const shareManual = document.querySelector("#share-manual");
const shareFeedback = document.querySelector("#share-feedback");
const shareEmptyAction = document.querySelector("#share-empty-action");
const shareActions = document.querySelector("#share-actions");
const shareCreateTask = document.querySelector("#share-create-task");
const sharePercent = document.querySelector("#share-preview-percentage");
const shareSummary = document.querySelector("#share-preview-summary");
const sharedAchievement = document.querySelector("#shared-achievement");
const sharedHeading = document.querySelector("#shared-achievement-heading");
const sharedDetail = document.querySelector("#shared-achievement-detail");
const sharedStart = document.querySelector("#shared-start");
const sharePosterPreview = document.querySelector("#share-poster-preview");
const shareImageDownload = document.querySelector("#share-image-download");
let preparedShare = null;
let preparedPosterFile = null;
let posterPreviewURL = null;
let posterRequest = 0;

function syncImageShareButton() {
  let supported = false;
  try {
    supported = Boolean(preparedPosterFile &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [preparedPosterFile] }));
  } catch { /* Some WebViews throw from canShare. Download remains available. */ }
  shareImageNative.hidden = !supported;
}

function resetPosterPreview() {
  if (posterPreviewURL) URL.revokeObjectURL(posterPreviewURL);
  posterPreviewURL = null;
  preparedPosterFile = null;
  sharePosterPreview.src = "assets/share-step-1-v2.jpg";
  sharePosterPreview.alt = "ШАГ: запиши первую задачу — твой ход!";
  shareImageDownload.href = "assets/share-step-1-v2.jpg";
  shareImageDownload.download = "sdelano-shag-1.jpg";
  shareImageDownload.textContent = "Скачать общий постер";
  syncImageShareButton();
}

function usePersonalPoster(file, data) {
  if (posterPreviewURL) URL.revokeObjectURL(posterPreviewURL);
  posterPreviewURL = URL.createObjectURL(file);
  preparedPosterFile = file;
  sharePosterPreview.src = posterPreviewURL;
  sharePosterPreview.alt = "ШАГ: выполнено " + data.done + " из " + data.total +
    " задач, " + data.percent + "%. Твой ход — запиши первую задачу.";
  shareImageDownload.href = posterPreviewURL;
  shareImageDownload.download = file.name;
  shareImageDownload.textContent = "Скачать карточку JPG";
  syncImageShareButton();
}

// Prepare before tapping Share: Web Share requires a user gesture, and an
// asynchronous image generation inside the click can lose transient activation.
async function preparePersonalPoster(data, request) {
  try {
    const file = await window.achievementPoster.create({ done: data.done, total: data.total });
    if (request !== posterRequest) return; // Do not attach a stale result.
    usePersonalPoster(file, data);
  } catch {
    if (request !== posterRequest) return;
    // A real image remains shareable on devices without canvas JPEG support.
    try {
      const response = await fetch("assets/share-step-1-v2.jpg");
      if (!response.ok) return;
      const blob = await response.blob();
      if (request !== posterRequest) return;
      preparedPosterFile = new File([blob], "sdelano-shag-1.jpg", { type: "image/jpeg" });
      syncImageShareButton();
      shareFeedback.textContent = "Персональная картинка недоступна. Можно отправить общий постер.";
    } catch {
      shareFeedback.textContent = "Картинка недоступна. Поделись ссылкой или текстом.";
    }
  }
}

function progressShareData() {
  const total = tasks.length;
  const done = tasks.reduce((sum, task) => sum + Number(task.done), 0);
  const percent = total ? Math.floor(done * 100 / total) : 0;
  const text = `В «Сделано» готово ${done} из ${total} дел (${percent}%). Твой ход! Запиши задачу.`;
  const link = new URL(SHARE_URL);
  link.searchParams.set("r", `${done}-${total}`);
  return { title: "Мой результат — Сделано", text, url: link.toString(), percent, done, total };
}

function closeShareDialog() {
  if (typeof shareDialog.close === "function" && shareDialog.open) shareDialog.close();
  else shareDialog.removeAttribute("open");
}

function openShareDialog() {
  analytics?.track("share_opened");
  feedback.play("tap");
  shareFeedback.textContent = "";
  shareManual.open = false;
  const request = ++posterRequest;
  resetPosterPreview();
  preparedShare = tasks.length > 0 ? progressShareData() : null;
  if (preparedShare) void preparePersonalPoster(preparedShare, request);
  const { percent = 0, done = 0, total = 0 } = preparedShare ?? {};
  sharePercent.textContent = `${percent}%`;
  shareSummary.textContent = `Выполнено ${done} из ${total}`;
  shareEmptyAction.hidden = Boolean(preparedShare);
  shareActions.hidden = !preparedShare;
  if (preparedShare) {
    const readyText = `${preparedShare.text}\n\n${preparedShare.url}`;
    shareReadyText.value = readyText;
    shareNative.hidden = typeof navigator.share !== "function";
    const telegramLink = new URL("https://t.me/share/url");
    telegramLink.searchParams.set("url", preparedShare.url);
    telegramLink.searchParams.set("text", preparedShare.text);
    shareTelegram.href = telegramLink.toString();
    const whatsAppLink = new URL("https://wa.me/");
    whatsAppLink.searchParams.set("text", readyText);
    shareWhatsApp.href = whatsAppLink.toString();
  }
  if (typeof shareDialog.showModal === "function") shareDialog.showModal();
  else shareDialog.setAttribute("open", "");
  shareClose.focus();
}

shareProgressButton.addEventListener("click", openShareDialog);
shareClose.addEventListener("click", closeShareDialog);
shareCreateTask.addEventListener("click", () => {
  feedback.play("tap");
  closeShareDialog();
  titleInput.scrollIntoView({ block: "center" });
  titleInput.focus({ preventScroll: true });
});
shareDialog.addEventListener("click", (event) => {
  if (event.target === shareDialog) closeShareDialog();
});
shareNative.addEventListener("click", async () => {
  if (!preparedShare || typeof navigator.share !== "function") return;
  analytics?.track("share_action");
  feedback.play("tap");
  try {
    await navigator.share({
      title: preparedShare.title, text: preparedShare.text, url: preparedShare.url
    });
    shareFeedback.textContent = "Ссылка передана в меню отправки.";
  } catch (error) {
    shareFeedback.textContent = error?.name === "AbortError" ? "Отправка отменена." :
      "Системная отправка недоступна. Выбери Telegram, WhatsApp или скопируй текст.";
  }
});
shareImageNative.addEventListener("click", async () => {
  if (!preparedShare || !preparedPosterFile || typeof navigator.share !== "function") return;
  analytics?.track("share_action");
  feedback.play("tap");
  // Include the URL in text for services which drop the separate 'url' field
  // when sharing a media file as a Telegram photo/caption.
  const attachment = {
    title: "Сделано — твой ход!",
    text: `${preparedShare.text}\n\n${preparedShare.url}`,
    files: [preparedPosterFile]
  };
  try {
    await navigator.share(attachment);
    shareFeedback.textContent = "Изображение передано в меню отправки.";
  } catch (error) {
    shareFeedback.textContent = error?.name === "AbortError" ? "Отправка отменена." :
      "Браузер не передал фото. Скачай картинку ниже и прикрепи её в Telegram.";
  }
});

shareCopy.addEventListener("click", async () => {
  if (!preparedShare) return;
  analytics?.track("share_action");
  feedback.play("tap");
  const text = shareReadyText.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      shareFeedback.textContent = "Приглашение и ссылка скопированы!";
      return;
    }
  } catch { /* Clipboard permission can be denied by some WebViews. */ }
  shareManual.open = true;
  shareReadyText.focus();
  shareReadyText.select();
  try {
    if (document.execCommand("copy")) {
      shareFeedback.textContent = "Приглашение и ссылка скопированы!";
      return;
    }
  } catch { /* Keep the text selected for manual copying. */ }
  shareFeedback.textContent = "Текст выделен. Выбери «Копировать» в меню телефона.";
});
for (const provider of [shareTelegram, shareWhatsApp]) {
  provider.addEventListener("click", () => {
    analytics?.track("share_action");
    feedback.play("tap");
  });
}
shareImageDownload.addEventListener("click", () => analytics?.track("share_action"));

// Links contain a snapshot, never the sender's task names or private storage.
function initSharedAchievement() {
  const params = new URLSearchParams(location.search);
  const parseCount = (value) => /^\d{1,4}$/.test(value ?? "") ? Number(value) : NaN;
  const done = parseCount(params.get("done"));
  const total = parseCount(params.get("total"));
  if (params.get("share") !== "1" || !Number.isInteger(total) ||
      total < 1 || total > 9999 || !Number.isInteger(done) || done > total) return;
  const percent = Math.floor(done * 100 / total);
  sharedHeading.textContent = `У друга уже ${percent}% дел закрыто. Твой ход!`;
  sharedDetail.textContent = `${done} из ${total} задач выполнено. Запиши свою первую задачу — отсчёт начнётся сразу. Сделаешь дело — увидишь результат.`;
  sharedAchievement.hidden = false;
  analytics?.openReferral();
}
sharedStart.addEventListener("click", () => {
  analytics?.startReferral();
  feedback.play("tap");
  titleInput.scrollIntoView({ block: "center", behavior: "smooth" });
  titleInput.focus({ preventScroll: true });
});
analytics?.track("task_list_viewed");
initSharedAchievement();
if (sharedAchievement.hidden && new URLSearchParams(location.search).get("utm_source") === "progress_share") {
  analytics?.startReferral();
}

function recordTaskActivity(action) {
  lastTaskActivity = Date.now();
  if (!taskStorageReadable) return;
  try {
    const saved = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? "[]");
    const history = Array.isArray(saved) ? saved.slice(-299)
      .filter(event => typeof event?.action === "string" && Number.isFinite(event.at))
      .map(({ action, at }) => ({ action, at })) : [];
    history.push({ action, at: lastTaskActivity });
    localStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(history));
  } catch { /* The list is usable with unavailable history. */ }
}

function renderFirstStep(returning) {
  firstStepGuide.hidden = firstWinAchieved;
  firstWinCard.hidden = !firstWinVisible;
  if (firstWinAchieved) return;
  if (returning) {
    firstStepLabel.textContent = "ТВОЯ ЗАДАЧА";
    firstStepTitle.textContent = "Продолжи своё дело";
    firstStepDetail.textContent = "Поставь галочку, когда закончишь.";
    firstStepCta.textContent = "К задаче";
    return;
  }
  const hasTask = tasks.length > 0;
  firstStepLabel.textContent = hasTask ? "МИССИЯ 2 ИЗ 2" : "МИССИЯ 1 ИЗ 2";
  firstStepTitle.textContent = hasTask ? "Закрой первую задачу" : "Запиши одно небольшое дело";
  firstStepDetail.textContent = hasTask ?
    "Поставь галочку, когда закончишь." :
    "Например, собрать рюкзак.";
  firstStepCta.textContent = hasTask ? "Перейти к задаче" : "Записать первый шаг";
}

firstStepCta.addEventListener("click", () => {
  feedback.play("tap");
  if (tasks.length === 0) {
    titleInput.focus();
    return;
  }
  // The unfinished checkbox might be hidden under the Done filter.
  if (activeFilter === "done") {
    activeFilter = "all";
    updateList();
  }
  list.querySelector(".task-checkbox:not(:checked)")?.focus();
});
firstWinNext.addEventListener("click", () => {
  firstWinVisible = false;
  updateProgress();
  focusNextStep();
});
firstWinShare.addEventListener("click", openShareDialog);

threeStepsNext.addEventListener("click", () => {
  threeStepsVisible = false;
  updateProgress();
  focusNextStep();
});
threeStepsShare.addEventListener("click", openShareDialog);

nextBreak.addEventListener("click", () => {
  if (onBreak) {
    clearCompletion();
    updateProgress();
    focusNextStep();
    return;
  }
  feedback.play("tap");
  clearCompletion();
  setBreak(true);
  updateProgress();
  (progressPanel.open ? nextActionButton : nextBreak).focus();
});

function renderMilestones(completed) {
  const currentBest = Math.max(completed,
    firstWinAchieved ? 1 : 0,
    threeStepsAchieved ? 3 : 0);
  if (currentBest > milestoneRecord) {
    milestoneRecord = currentBest;
    saveAchievement(MILESTONE_RECORD_KEY, String(milestoneRecord));
  }

  const nextGoal = MILESTONE_GOALS.find((goal) => milestoneRecord < goal);
  for (const item of milestoneSteps) {
    const goal = Number(item.dataset.goal);
    const earned = milestoneRecord >= goal;
    item.classList.toggle("is-earned", earned);
    item.classList.toggle("is-next", nextGoal === goal);
    const goalWord = goal === 1 ? "шаг" : goal === 3 ? "шага" : "шагов";
    item.setAttribute("aria-label", goal + " " + goalWord + ": " +
      (earned ? "достигнуто" : nextGoal === goal ? "следующая цель" : "впереди"));
    if (goal === nextGoal) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  }

  milestoneRecordLabel.textContent = `Рекорд списка — ${milestoneRecord}`;
  milestoneNextProgress.hidden = nextGoal === undefined;
  if (nextGoal === undefined) {
    milestoneNextLabel.textContent = "Все 4 этапа открыты.";
    return;
  }
  milestoneNextProgress.max = nextGoal;
  milestoneNextProgress.value = completed;
  const remaining = nextGoal - completed;
  const units = remaining === 1 ? "дело" : remaining <= 4 ? "дела" : "дел";
  milestoneNextLabel.textContent = `До отметки ${nextGoal} — ещё ${remaining} ${units}.`;
}

// Context-aware continuation: never create or complete a task without a click.
function focusNextStep() {
  feedback.play("tap");
  const nextTask = tasks.find((task) => !task.done);
  if (!nextTask) {
    titleInput.scrollIntoView({ block: "center", behavior: "auto" });
    titleInput.focus({ preventScroll: true });
    return;
  }
  // Completed-only filters may hide the very task we want to suggest.
  if (activeFilter === "done") {
    activeFilter = "active";
    completedGroup.open = false;
    updateList();
  }
  const checkbox = taskViews.get(nextTask.id)?.row.querySelector(".task-checkbox");
  if (!checkbox) return;
  checkbox.scrollIntoView({ block: "center", behavior: "auto" });
  checkbox.focus({ preventScroll: true });
}
nextActionButton.addEventListener("click", () => {
  if (recentCompletion || onBreak) {
    clearCompletion();
    updateProgress();
  }
  focusNextStep();
});

function updateProgress() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.done).length;
  const ratio = total > 0 ? Math.floor((completed * 100) / total) : 0;
  const status = `Выполнено ${completed} из ${total}`;

  if (total === 0) {
    progressPanel.dataset.stage = "first";
  } else if (completed === total) {
    progressPanel.dataset.stage = "done";
  } else {
    progressPanel.dataset.stage = "working";
  }

  // Show one completion card with the action that matches the remaining list.
  nextAction.hidden = !firstWinAchieved || firstWinVisible || threeStepsVisible;
  nextAction.toggleAttribute("data-completion", recentCompletion !== null);
  nextAction.toggleAttribute("data-break", onBreak);
  const justCompleted = Boolean(firstWinVisible || threeStepsVisible || recentCompletion);
  nextBreak.hidden = !justCompleted && !(onBreak && !progressPanel.open);
  shareProgressButton.parentElement.hidden = onBreak || firstWinVisible || threeStepsVisible;
  const pending = tasks.find((task) => !task.done);
  nextBreak.textContent = onBreak ? (pending ? "Вернуться к делу" : "К списку задач") : "Передохнуть";
  const rewardAction = pending ? "К следующему делу" : "Записать ещё одно дело";
  firstWinNext.textContent = rewardAction;
  threeStepsNext.textContent = rewardAction;
  if (timerHint) {
    timerHint.toggleAttribute("data-completion", justCompleted);
    if (onBreak) {
      timerHint.textContent = "Передышка. Продолжай, когда захочешь.";
    } else if (justCompleted) {
      let praise = "Отличная работа!";
      if (firstWinVisible) praise = "Первый шаг сделан!";
      else if (threeStepsVisible) praise = "Три дела сделаны!";
      else if (recentCompletion) praise = recentCompletion.heading;
      timerHint.textContent = pending ?
        `${praise} Готово ${completed} из ${total}.` :
        "Все дела сделаны! Прогресс 100%.";
    } else {
      timerHint.textContent = pending ?
        (completionHint ?? "После галочки покажем следующее дело.") : "Таймер начнётся сразу.";
    }
  }
  const returning = Boolean(pending && lastTaskActivity > 0 &&
    Date.now() - lastTaskActivity >= RETURN_AFTER_MS);
  if (onBreak) {
    nextStep.textContent = "Передышка";
    nextDetail.textContent = "Что помогло тебе закончить дело?";
    nextActionButton.textContent = pending ? "Вернуться к делу" : "К списку задач";
  } else if (recentCompletion) {
    nextStep.textContent = recentCompletion.heading;
    nextDetail.textContent = recentCompletion.elapsedMs >= 1000 ?
      "Дело было открыто " + clock.humanText(recentCompletion.elapsedMs) + "." :
      "Ещё одно дело готово.";
    nextActionButton.textContent = rewardAction;
  } else if (pending) {
    nextStep.textContent = returning ? "Продолжи своё дело" : "В работе";
    nextDetail.textContent = "Следующее дело — «" + pending.title + "».";
    nextActionButton.textContent = returning ? "К задаче" : "Перейти к следующей задаче";
  } else {
    nextStep.textContent = total > 0 ? "Все дела закрыты!" : "Новый день — новый шаг";
    nextDetail.textContent = total > 0 ?
      "Если есть ещё дело, запиши его. Никакой спешки." :
      "Готов к следующему делу? Запиши его, когда захочешь.";
    nextActionButton.textContent = "Записать новую задачу";
  }

  shareProgressButton.title = total === 0 ? "Открой и начни первую задачу" :
    "Поделиться результатом и пригласить друга";
  progress.value = ratio;
  percentage.textContent = `${ratio}%`;
  if (summary.textContent !== status) {
    summary.textContent = status;
  }
  renderFirstStep(returning);
  threeStepsCard.hidden = !threeStepsVisible;
  renderMilestones(completed);
}

function updateList() {
  for (const button of filterButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter));
  }

  const active = list.childElementCount;
  const done = completedList.childElementCount;
  list.hidden = activeFilter === "done" || active === 0;
  completedGroup.hidden = done === 0;
  completedCount.textContent = String(done);
  if (!done) completedGroup.open = false;
  filterGroup.hidden = tasks.length === 0;
  emptyState.hidden = tasks.length > 0;
  const noMatch = (activeFilter === "done" && done === 0) || (activeFilter === "active" && active === 0);
  filteredEmpty.hidden = !tasks.length || !noMatch;
  if (!filteredEmpty.hidden) {
    filteredMessage.textContent = activeFilter === "done" ? "Выполненных задач пока нет" : "Все задачи выполнены";
  }
}

function visibleNeighborCheckbox(row) {
  return (row.nextElementSibling ?? row.previousElementSibling)?.querySelector(".task-checkbox");
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
  const updateClock = () => {
    const display = clock.display(task);
    if (timeLabel.textContent !== display) timeLabel.textContent = display;
  };
  taskViews.set(task.id, { task, row, updateClock });
  row.classList.toggle("task-finished", task.done);
  updateClock();

  row.querySelector(".task-title").textContent = task.title;
  checkbox.setAttribute("aria-label", task.title);
  checkbox.checked = task.done;
  deleteButton.setAttribute("aria-label", `Удалить задачу «${task.title}»`);
  deleteButton.title = "Удалить задачу";

  row.dataset.taskId = task.id;
  checkbox.addEventListener("change", () => {
    const checked = checkbox.checked;
    const keyboardFocus = checkbox.matches(":focus-visible");
    changeTasks(() => {
      const current = taskViews.get(task.id);
      if (!current) return;
      current.row.querySelector(".task-checkbox").checked = checked;
      if (current.task.done !== checked) toggleTask(current.task, current.row, checked, keyboardFocus);
    });
  });
  deleteButton.addEventListener("click", () => changeTasks(() => {
    const current = taskViews.get(task.id);
    if (current) removeTask(current.task, current.row);
  }));
  (task.done ? completedList : list).append(row);
  return checkbox;
}

function toggleTask(task, row, checked, keyboardFocus) {
  const now = Date.now();
  const newFirstWin = checked && !firstWinAchieved;
  let newThreeSteps = false;
  clearCompletion();
  if (checked) {
    clock.finish(task, now);
    analytics?.taskCompleted(task.createdFromInvite === true);
    const completedNow = tasks.filter((entry) => entry.done).length;
    activeFilter = completedNow < tasks.length ? "active" : "done";
    completedGroup.open = false;
    newThreeSteps = !threeStepsAchieved && completedNow >= 3;
    feedback.play("complete");
    row.classList.remove("task-celebrate");
    void row.offsetWidth;
    row.classList.add("task-celebrate");
    if (newThreeSteps) {
      threeStepsAchieved = true;
      threeStepsVisible = true;
      saveAchievement(THREE_STEPS_KEY, "1");
    } else if (newFirstWin) {
      firstWinAchieved = true;
      firstWinVisible = true;
      if (firstWinDetail) {
        firstWinDetail.textContent = task.elapsedMs >= 1000 ?
          "Дело было открыто " + clock.humanText(task.elapsedMs) + "." :
          "Твоё первое дело готово.";
      }
      saveAchievement(FIRST_WIN_KEY, "1");
    } else {
      const milestone = MILESTONE_GOALS.includes(completedNow) && completedNow > milestoneRecord;
      recentCompletion = {
        heading: milestone ? completedNow + " дел сделано!" : "Сделано!",
        elapsedMs: task.elapsedMs
      };
    }
  } else {
    clock.reopen(task, now);
    if (activeFilter === "done") {
      activeFilter = "active";
      completedGroup.open = false;
    }
    feedback.play("reopen");
    row.classList.remove("task-celebrate");
  }
  row.classList.toggle("task-finished", task.done);
  const group = task.done ? completedList : list;
  const following = tasks.slice(tasks.indexOf(task) + 1).find(entry => entry.done === task.done);
  group.insertBefore(row, following ? taskViews.get(following.id).row : null);
  taskViews.get(task.id).updateClock();
  saveTasks();
  recordTaskActivity(task.done ? "done" : "reopen");
  updateProgress();
  updateList();
  if (task.done) {
    focusAfterRemoval(list.querySelector(".task-checkbox:not(:checked)"));
    if (!keyboardFocus && matchMedia("(max-width: 47rem)").matches) {
      timerHint?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  } else {
    row.querySelector(".task-checkbox").focus();
  }
}

function removeTask(task, row) {
  feedback.play("remove");
  clearCompletion();
  const neighbor = visibleNeighborCheckbox(row);
  taskViews.delete(task.id);
  tasks.splice(tasks.indexOf(task), 1);
  row.remove();
  saveTasks();
  recordTaskActivity("delete");
  updateProgress();
  if (!tasks.length) activeFilter = "all";
  else if (activeFilter === "done" && !completedList.childElementCount) activeFilter = "active";
  updateList();
  focusAfterRemoval(neighbor);
}

function addTask(title) {
  const task = clock.create(title);
  task.id = newTaskId();
  if (analytics?.taskCreated()) task.createdFromInvite = true;
  feedback.play("add");
  clearCompletion();
  tasks.push(task);
  const checkbox = appendTask(task);
  if (activeFilter === "done") {
    activeFilter = "all";
  }
  saveTasks();
  recordTaskActivity("created");
  updateProgress();
  updateList();
  return checkbox;
}

sampleButton.addEventListener("click", () => changeTasks(() => addTask("Запланировать главное дело").focus()));

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    feedback.play("tap");
    activeFilter = button.dataset.filter;
    if (activeFilter !== "all") completedGroup.open = activeFilter === "done" && completedList.childElementCount > 0;
    updateList();
  });
}

clearFilterButton?.addEventListener("click", () => {
  feedback.play("tap");
  activeFilter = "all";
  if (!list.childElementCount) completedGroup.open = true;
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

  changeTasks(() => addTask(title));
  form.reset();
  titleInput.focus();
});

// Remember disclosure choices per tab, independently of the stored tasks.
for (const panel of [progressPanel, completedGroup]) {
  const key = "sdelano.view." + panel.id;
  try { panel.open = sessionStorage.getItem(key) === "open"; } catch { /* Keep native toggling available. */ }
  function saveChoice() {
    try { sessionStorage.setItem(key, panel.open ? "open" : "closed"); } catch { /* Use the DOM state. */ }
  }
  window.addEventListener("pagehide", saveChoice);
  panel.addEventListener("toggle", () => {
    saveChoice();
    if (panel === progressPanel) {
      updateProgress();
      return;
    }
    if (panel.open && activeFilter === "active") activeFilter = "all";
    else if (!panel.open && activeFilter === "done" && list.childElementCount) activeFilter = "active";
    updateList();
  });
}

tasks.forEach(appendTask);
updateProgress();
updateList();
if (needsTaskMigration && !needsRecovery) {
  changeTasks(() => { if (needsTaskMigration && !needsRecovery) saveTasks(); });
}
window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY || event.key === null) syncStoredTasks();
});

function greetFirstVisit() {
  const dialog = document.querySelector("#welcome");
  if (typeof dialog.showModal !== "function" || !taskStorageReadable || needsRecovery) return;

  // Skip the extra step on an invitation and for people upgrading an existing list.
  const url = new URL(location.href);
  const invited = !sharedAchievement.hidden || url.searchParams.get("utm_source") === "progress_share";
  const preview = url.searchParams.get("welcome") === "1" && !invited;
  if (preview) {
    url.searchParams.delete("welcome");
    history.replaceState(history.state, "", url);
  }
  try {
    const key = "sdelano.welcome.v1";
    if (!preview && localStorage.getItem(key) === "1") return;
    localStorage.setItem(key, "1");
  } catch { return; }
  if (invited || (!preview && (tasks.length || firstWinAchieved || lastTaskActivity || savedTaskSnapshot !== null))) return;

  const start = document.querySelector("#welcome-start");
  const heading = document.querySelector("#page-heading");
  function enter(inputRequested) {
    if (!dialog.open) return;
    dialog.close();
    (inputRequested ? titleInput : heading).focus({ preventScroll: true });
  }
  if (document.activeElement && document.activeElement !== document.body) return;
  dialog.showModal();
  start.addEventListener("click", () => enter(true), { once: true });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    enter(false);
  }, { once: true });
  const timer = setTimeout(() => enter(false), 2600);
  dialog.addEventListener("close", () => clearTimeout(timer), { once: true });
  // A restored back/forward-cache entry must never replay the greeting.
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    if (dialog.open) dialog.close();
  }, { once: true });
}
greetFirstVisit();

function updateClocks() {
  if (document.hidden) return;
  for (const { task, updateClock } of taskViews.values()) {
    if (!task.done) updateClock();
  }
}
setInterval(updateClocks, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateClocks();
    updateProgress();
  }
});
