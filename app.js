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
let needsClockMigration = false;
let taskStorageReadable = true;
const clockUpdates = new Map();
const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const timerHint = document.querySelector("#timer-hint");
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
const firstWinDismiss = document.querySelector("#first-win-dismiss");
const threeStepsCard = document.querySelector("#three-steps-card");
const threeStepsBadge = document.querySelector("#three-steps-badge");
const threeStepsNext = document.querySelector("#three-steps-next");
const threeStepsShare = document.querySelector("#three-steps-share");
const threeStepsDismiss = document.querySelector("#three-steps-dismiss");
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

function setStorageWarning(visible) {
  storageNote.hidden = visible;
  storageWarning.hidden = !visible;
}

function loadTasks() {
  let saved;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    taskStorageReadable = false;
    setStorageWarning(true);
    return [];
  }
  try {
    const stored = JSON.parse(saved);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((task) => typeof task?.title === "string" && typeof task.done === "boolean")
      .map((task) => {
        const normalized = clock.normalize(task);
        if (normalized.elapsedMs !== task.elapsedMs || normalized.startedAt !== task.startedAt ||
            normalized.doneAt !== task.doneAt) {
          needsClockMigration = true;
        }
        return normalized;
      });
  } catch {
    setStorageWarning(true);
    return [];
  }
}

const tasks = loadTasks();

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
  if (tasks.some((task) => task.done)) {
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
let firstWinAchieved = hadFirstWinBefore();
let firstWinVisible = false;

// Count three separate completed tasks, not three toggles of one checkbox.
// The stored award survives reopened/deleted tasks and is never replayed.
function hadThreeStepsBefore() {
  if (tasks.filter((task) => task.done).length >= 3) {
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
let milestoneRecord = loadMilestoneRecord();

function saveTasks() {
  if (!taskStorageReadable) return;
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
  const percent = total ? Math.floor((done / total) * 100) : 0;
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
  const percent = Math.floor((done / total) * 100);
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
if (new URLSearchParams(location.search).get("utm_source") === "progress_share") {
  analytics?.startReferral();
}
initSharedAchievement();

function recordTaskActivity(task, action) {
  lastTaskActivity = Date.now();
  if (!taskStorageReadable) return;
  try {
    const saved = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? "[]");
    const history = Array.isArray(saved) ? saved : [];
    history.push({ title: task.title, action, at: lastTaskActivity });
    localStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(history.slice(-300)));
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

for (const button of [firstWinDismiss, threeStepsDismiss, nextBreak]) {
  button?.addEventListener("click", () => {
    feedback.play("tap");
    clearCompletion();
    setBreak(true);
    updateProgress();
    nextActionButton.focus();
  });
}

function renderThreeSteps() {
  threeStepsCard.hidden = !threeStepsVisible;
  threeStepsBadge.hidden = !threeStepsAchieved || threeStepsVisible;
}

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

  milestoneRecordLabel.textContent = "Рекорд: " + milestoneRecord;
  milestoneNextProgress.max = nextGoal ?? 10;
  milestoneNextProgress.value = Math.min(milestoneRecord, nextGoal ?? 10);
  if (!nextGoal) {
    milestoneNextLabel.textContent = "Все 4 этапа открыты! Продолжай в своём темпе.";
    return;
  }
  const remaining = nextGoal - milestoneRecord;
  const units = remaining % 10 === 1 && remaining % 100 !== 11 ? "шаг" :
    remaining % 10 >= 2 && remaining % 10 <= 4 &&
      (remaining % 100 < 12 || remaining % 100 > 14) ? "шага" : "шагов";
  milestoneNextLabel.textContent = "До цели " + nextGoal + " — ещё " +
    remaining + " " + units + ".";
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
    updateList();
  }
  const index = tasks.indexOf(nextTask);
  const row = list.children[index];
  const checkbox = row?.querySelector(".task-checkbox");
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
  if (nextBreak) nextBreak.hidden = recentCompletion === null;
  shareProgressButton.parentElement.hidden = onBreak;
  const pending = tasks.find((task) => !task.done);
  const rewardAction = pending ? "К следующему делу" : "Записать ещё одно дело";
  firstWinNext.textContent = rewardAction;
  threeStepsNext.textContent = rewardAction;
  if (timerHint) {
    const justCompleted = Boolean(firstWinVisible || threeStepsVisible || recentCompletion);
    timerHint.toggleAttribute("data-completion", justCompleted);
    if (justCompleted) {
      timerHint.textContent = pending ?
        `Отличная работа! Готово ${completed} из ${total}. Бери следующее дело.` :
        "Все дела сделаны! Прогресс 100%.";
    } else {
      timerHint.textContent = pending ? "Закончишь дело — поставь галочку." : "Таймер начнётся сразу.";
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
      "На дело ушло " + clock.humanText(recentCompletion.elapsedMs) + "." :
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
  renderThreeSteps();
  renderMilestones(completed);
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
  const updateClock = () => {
    const display = clock.display(task);
    if (timeLabel.textContent !== display) timeLabel.textContent = display;
  };
  clockUpdates.set(task, updateClock);
  row.classList.toggle("task-finished", task.done);
  updateClock();

  row.querySelector(".task-title").textContent = task.title;
  checkbox.setAttribute("aria-label", task.title);
  checkbox.checked = task.done;
  deleteButton.setAttribute("aria-label", `Удалить задачу «${task.title}»`);
  deleteButton.title = "Удалить задачу";

  checkbox.addEventListener("change", () => {
    const now = Date.now();
    const keyboardFocus = checkbox.matches(":focus-visible");
    const newFirstWin = checkbox.checked && !firstWinAchieved;
    let newThreeSteps = false;
    clearCompletion();
    if (checkbox.checked) {
      clock.finish(task, now);
      analytics?.taskCompleted(task.createdFromInvite === true);
      const completedNow = tasks.filter((entry) => entry.done).length;
      activeFilter = completedNow < tasks.length ? "active" : "done";
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
            "Твоё первое дело готово за " + clock.humanText(task.elapsedMs) + "." :
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
      feedback.play("reopen");
      row.classList.remove("task-celebrate");
    }
    row.classList.toggle("task-finished", task.done);
    updateClock();
    saveTasks();
    recordTaskActivity(task, task.done ? "done" : "reopen");
    updateProgress();
    updateList();
    if (task.done) {
      focusAfterRemoval(list.querySelector(".task-checkbox:not(:checked)"));
      if (!keyboardFocus && matchMedia("(max-width: 47rem)").matches) {
        timerHint?.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    } else if (row.hidden) {
      focusAfterRemoval(visibleNeighborCheckbox(row));
    }
  });

  deleteButton.addEventListener("click", () => {
    feedback.play("remove");
    clearCompletion();
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
  if (analytics?.taskCreated()) task.createdFromInvite = true;
  feedback.play("add");
  clearCompletion();
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
  if (!document.hidden) {
    updateClocks();
    updateProgress();
  }
});
