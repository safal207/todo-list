"use strict";

const core = window.goalCore;
const language = window.goalLanguage;
const rewards = window.goalRewards;
const { t } = language;
const templates = window.goalTemplates;
const state = core.load();
const element = (id) => document.getElementById(id);
const launch = element("goal-launch");
const workspace = element("goal-workspace");
const goalForm = element("goal-form");
const goalTitle = element("goal-title");
const goalDate = element("goal-date");
const horizonSelect = element("goal-horizon");
const areaSelect = element("goal-area");
const parentSelect = element("goal-parent");
const templateOptions = element("template-options");
const viewButtons = element("view-buttons");
const planContent = element("plan-content");
const reflectionForm = element("reflection-form");
const dialog = element("evidence-dialog");
const evidenceNote = element("evidence-note");
const evidenceFile = element("evidence-file");
const evidenceConfirm = element("confirm-evidence");
const proofError = element("proof-error");
const goalSelect = element("goal-select");
const portfolio = window.createGoalPortfolio(state, selectGoal);

const statusNames = {
  waiting: ["Ожидает", "Waiting"], ready: ["Доступно", "Ready"],
  doing: ["В работе", "In progress"], done: ["Готово", "Done"],
};

const descriptions = {
  path: ["Следуйте зависимостям. Подтверждённый этап открывает следующие карточки.", "Follow the dependencies. Confirming a milestone unlocks the next steps."],
  kanban: ["Та же цель по состояниям. Нажмите «Начать», чтобы перенести карточку в работу.", "The same plan by status. Choose Start to move a card into progress."],
  gantt: ["Плановые даты рассчитываются от начала цели до выбранного срока. Нажмите на этап, чтобы открыть карточку.", "Planned dates run from goal creation to the chosen deadline. Select a step to open its card."],
  matrix: ["Срочные шаги подходят к сроку в ближайшие три дня или уже просрочены. Важность можно менять в карточке.", "Urgent steps are due within three days or overdue. Change importance on the card."],
};

const shortDate = { format: (date) => language.formatDate(date, { day: "numeric", month: "short" }) };
const fullDate = { format: (date) => language.formatDate(date, { day: "numeric", month: "long", year: "numeric" }) };
const dayWord = new Intl.PluralRules("ru-RU");
let templateChoice = "auto";
let insertedTitle = "";
let dateEdited = false;
let evidenceStepId;
let focusStepId;
let allDone = false;
let reflectionTime;
let messageTimeout;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className) {
  const control = make("button", className, label);
  control.type = "button";
  return control;
}

function activeGoal() {
  return state.goals.find((item) => item.id === state.selectedId);
}

function selectGoal(id, focus = true) {
  state.selectedId = id;
  save();
  showGoal(focus);
}

function planFor(goal) {
  return language.displayPlan(goal.templateId, core.getPlan(goal));
}

function save() {
  const saved = core.save(state);
  element("goal-storage-warning").hidden = saved;
  return saved;
}

function announce(text) {
  const message = element("action-status");
  message.textContent = text;
  clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => { message.textContent = ""; }, 4200);
}

function estimatedDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return core.dateKey(date.getTime());
}

function builderTemplate() {
  const template = templateChoice === "auto"
    ? core.suggestTemplate(goalTitle.value)
    : core.getTemplate(templateChoice);
  return language.displayTemplate(template);
}

function setOptions(select, options, selected = select.value) {
  select.replaceChildren(...options.map(([name, value]) => new Option(name, value)));
  if (options.some(([, value]) => value === selected)) select.value = selected;
}

function renderClassification() {
  setOptions(horizonSelect, [[t("По сроку", "From deadline"), "auto"], ...core.horizons.map(({ id }) => [language.horizonLabel(id), id])]);
  setOptions(areaSelect, [[t("По шаблону", "From template"), "auto"], ...core.areas.map(({ id }) => [language.areaLabel(id), id])]);
  setOptions(parentSelect, [[t("Самостоятельная цель", "Standalone goal"), ""], ...state.goals.map((goal) => [goal.title, goal.id])]);
}

function horizonIndex(id) {
  return core.horizons.findIndex((entry) => entry.id === id);
}

function updateBuilder() {
  const template = builderTemplate();
  for (const control of templateOptions.children) {
    control.setAttribute("aria-pressed", String(control.dataset.template === templateChoice));
  }
  const parent = state.goals.find((goal) => goal.id === parentSelect.value);
  goalDate.max = parent?.deadline ?? "";
  if (!dateEdited) {
    const suggested = horizonSelect.value === "auto" ? estimatedDate(template.days) : core.defaultDeadline(horizonSelect.value);
    goalDate.value = parent && suggested > parent.deadline ? parent.deadline : suggested;
  }
  element("template-hint").textContent = templateChoice === "auto"
    ? t(`По названию выбран план «${template.title}». Срок можно изменить.`, `Suggested plan: ${template.title}. You can adjust the deadline.`)
    : `${template.description} ${t("Срок можно изменить.", "You can adjust the deadline.")}`;
}

function addTemplateOption(id, title, category) {
  const option = button("", "template-card");
  option.dataset.template = id;
  option.append(make("span", "template-category", category), make("strong", "", title));
  templateOptions.append(option);
}

function renderTemplateOptions() {
  templateOptions.replaceChildren();
  addTemplateOption("auto", t("По названию цели", "From the goal title"), t("Автоподбор", "Auto-match"));
  for (const template of templates.map(language.displayTemplate)) {
    addTemplateOption(template.id, template.title, template.category);
  }
}

templateOptions.addEventListener("click", (event) => {
  const option = event.target.closest("button[data-template]");
  if (!option) return;
  templateChoice = option.dataset.template;
  if (!goalTitle.value.trim() || goalTitle.value === insertedTitle) {
    insertedTitle = ["auto", "custom"].includes(templateChoice) ? "" : builderTemplate().title;
    goalTitle.value = insertedTitle;
  }
  goalTitle.setCustomValidity("");
  updateBuilder();
});

goalTitle.addEventListener("input", () => {
  goalTitle.setCustomValidity("");
  updateBuilder();
});
goalDate.addEventListener("change", () => {
  dateEdited = Boolean(goalDate.value);
  goalDate.setCustomValidity("");
  parentSelect.setCustomValidity("");
});
horizonSelect.addEventListener("change", () => {
  dateEdited = false;
  goalDate.setCustomValidity("");
  parentSelect.setCustomValidity("");
  updateBuilder();
});
parentSelect.addEventListener("change", () => {
  parentSelect.setCustomValidity("");
  goalDate.setCustomValidity("");
  updateBuilder();
});

function showBuilder(focus = true, parent) {
  portfolio.close();
  workspace.hidden = true;
  launch.hidden = false;
  element("back-to-goal").hidden = !activeGoal();
  goalForm.reset();
  goalTitle.setCustomValidity("");
  goalDate.setCustomValidity("");
  parentSelect.setCustomValidity("");
  templateChoice = "auto";
  insertedTitle = "";
  dateEdited = false;
  goalDate.min = core.dateKey();
  renderTemplateOptions();
  renderClassification();
  horizonSelect.value = parent ? "day" : "auto";
  areaSelect.value = parent?.area ?? "auto";
  parentSelect.value = parent?.id ?? "";
  updateBuilder();
  if (focus) goalTitle.focus();
}

goalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!goalTitle.value.trim()) {
    goalTitle.setCustomValidity(t("Введите цель.", "Enter a goal."));
    goalTitle.reportValidity();
    return;
  }
  const template = builderTemplate();
  const horizon = horizonSelect.value === "auto" ? core.inferHorizon(goalDate.value) : horizonSelect.value;
  const parent = state.goals.find((item) => item.id === parentSelect.value);
  if (parent && (horizonIndex(horizon) >= horizonIndex(parent.horizon) || goalDate.value > parent.deadline)) {
    parentSelect.setCustomValidity(t("У подцели должен быть более короткий горизонт и срок не позже родительской цели.", "A subgoal needs a shorter time horizon and a deadline no later than its parent's."));
    parentSelect.reportValidity();
    return;
  }
  const options = { horizon, area: areaSelect.value === "auto" ? core.recommendArea(template.id) : areaSelect.value, parentId: parent?.id ?? null };
  const goal = core.createGoal(goalTitle.value, template.id, goalDate.value, Date.now(), options);
  if (!goal) {
    goalDate.setCustomValidity(t("Выберите сегодняшнюю или будущую дату.", "Choose today or a future date."));
    goalDate.reportValidity();
    return;
  }
  state.goals.push(goal);
  state.selectedId = goal.id;
  state.view = "path";
  core.record(state, "goal", goal.id, goal.title, "created");
  save();
  showGoal(true);
  announce(t("План создан. Отсчёт начался.", "Plan created. The countdown has started."));
});

function updateTimer() {
  const goal = activeGoal();
  if (!goal || workspace.hidden) return;
  const timer = element("goal-timer");
  const remaining = core.getDeadline(goal) - Date.now();
  let value = t("Срок прошёл", "Past deadline");
  if (allDone) {
    value = t("Маршрут пройден", "Plan complete");
  } else if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, "0")).join(":");
    value = days ? t(`${days} дн. · ${clock}`, `${days} d · ${clock}`) : clock;
  }
  timer.dataset.overdue = String(!allDone && remaining <= 0);
  if (timer.textContent !== value) timer.textContent = value;
}

function renderProgress(goal, plan) {
  const count = plan.filter((step) => step.status === "done").length;
  allDone = plan.length > 0 && count === plan.length;
  const progress = element("goal-progress");
  progress.max = Math.max(plan.length, 1);
  progress.value = count;
  element("goal-summary").dataset.complete = String(allDone);
  element("goal-count").textContent = t(`Выполнено ${count} из ${plan.length}`, `Completed ${count} of ${plan.length}`);
  element("goal-complete").hidden = !allDone;
  element("deadline-label").textContent = fullDate.format(core.getDeadline(goal));
  element("deadline-heading").textContent = allDone ? t("Срок", "Deadline") : t("До срока", "Time remaining");
  updateTimer();
}

function renderStreak(goal) {
  const streak = core.getStreak(goal);
  const label = element("streak-label");
  label.hidden = streak === 0;
  const suffix = { one: "день", few: "дня", many: "дней" }[dayWord.select(streak)];
  label.textContent = t(`Серия действий · ${streak} ${suffix ?? "дней"}`, `Activity streak · ${streak} ${streak === 1 ? "day" : "days"}`);
}

function renderFocus(plan) {
  const next = plan.find((step) => step.status === "doing")
    ?? plan.filter((step) => step.status === "ready")
      .sort((first, second) => Number(second.important) - Number(first.important) || first.dueAt - second.dueAt)[0];
  focusStepId = next?.id;
  element("focus-button").hidden = !next;
  element("focus-step").textContent = next?.title ?? t("Маршрут завершён", "Plan complete");
  element("focus-result").textContent = next ? `${t("Результат", "Outcome")} · ${next.result}` : t("Запишите, что помогло дойти до результата.", "Write down what helped you get here.");
}

function actionButton(label, action, step) {
  const control = button(label, action === "done" || action === "start" ? "primary-button compact-button" : "quiet-button");
  control.dataset.action = action;
  control.setAttribute("aria-label", `${label} — ${step.title}`);
  return control;
}

function card(step, plan, compact = false) {
  const article = make("article", compact ? "step-card compact-card" : "step-card");
  article.dataset.stepId = step.id;
  article.dataset.status = step.status;
  const top = make("div", "step-top");
  const title = make("h3", "", step.title);
  title.tabIndex = -1;
  top.append(title, make("span", "step-status", t(...statusNames[step.status])));
  article.append(top);

  if (!compact) article.append(make("p", "step-description", step.description));
  article.append(make("p", "step-result", `${t("Результат", "Outcome")} · ${step.result}`));

  const meta = make("div", "step-meta");
  meta.append(make("span", "step-date", `${t("До", "By")} ${shortDate.format(step.dueAt)}`));
  const importance = actionButton(step.important ? t("Важное", "Important") : t("Обычное", "Standard"), "importance", step);
  importance.className = "importance-button";
  importance.setAttribute("aria-label", `${t("Важность", "Importance")} — ${step.title}`);
  importance.setAttribute("aria-pressed", String(step.important));
  meta.append(importance);
  article.append(meta);

  if (step.status === "waiting") {
    const dependencyNames = (step.after ?? []).map((id) => plan.find((item) => item.id === id))
      .filter((item) => item && item.status !== "done").map((item) => item.title);
    const detail = dependencyNames.length
      ? `${t("Сначала выполните:", "Complete first:")} ${dependencyNames.join(", ")}.`
      : t("Откроется после предыдущего решения.", "This unlocks after the previous decision.");
    article.append(make("p", "muted dependency", detail));
    return article;
  }

  const actions = make("div", "step-actions");
  if (step.status === "done") {
    const selection = step.choices?.find((choice) => choice.value === step.selection);
    if (selection) article.append(make("p", "confirmed-result", `${t("Выбрано", "Selected")} · ${selection.label}`));
    if (step.evidence) article.append(make("p", "confirmed-result", `${t("Подтверждение", "Evidence")} · ${step.evidence}`));
    if (step.proof) actions.append(actionButton(t("Открыть пруф", "View proof"), "proof", step));
    actions.append(actionButton(selection ? t("Изменить выбор", "Change choice") : t("Вернуть в работу", "Reopen"), "reopen", step));
  } else if (step.choices) {
    article.dataset.decision = "true";
    for (const choice of step.choices) {
      const control = actionButton(choice.label, "choose", step);
      control.dataset.choice = choice.value;
      actions.append(control);
    }
  } else {
    if (step.status === "ready") actions.append(actionButton(t("Начать", "Start"), "start", step));
    actions.append(actionButton(t("Подтвердить", "Confirm"), "done", step));
  }
  article.append(actions);
  return article;
}

function renderPath(plan) {
  const list = make("ol", "route-list");
  for (const [index, step] of plan.entries()) {
    const item = make("li", "route-item");
    const marker = make("span", "route-marker", step.status === "done" ? "✓" : String(index + 1));
    marker.setAttribute("aria-hidden", "true");
    marker.dataset.status = step.status;
    item.append(marker, card(step, plan));
    list.append(item);
  }
  return list;
}

function renderGroups(plan, groups, className) {
  const grid = make("div", className);
  for (const [title, includes, empty, tone] of groups) {
    const members = plan.filter(includes);
    const group = make("section", "plan-group");
    group.dataset.tone = tone;
    const heading = make("div", "group-heading");
    heading.append(make("h3", "", title), make("span", "group-count", String(members.length)));
    group.append(heading);
    if (members.length === 0) group.append(make("p", "muted group-empty", empty));
    for (const step of members) group.append(card(step, plan, true));
    grid.append(group);
  }
  return grid;
}

function renderKanban(plan) {
  return renderGroups(plan, [
    [t("К выполнению", "To do"), (step) => ["waiting", "ready"].includes(step.status), t("Здесь будут следующие шаги.", "Upcoming steps appear here."), "sand"],
    [t("В работе", "In progress"), (step) => step.status === "doing", t("Начните доступный шаг.", "Start a ready step."), "lilac"],
    [t("Готово", "Done"), (step) => step.status === "done", t("Здесь появятся подтверждённые шаги.", "Confirmed steps appear here."), "lime"],
  ], "kanban-grid");
}

function renderMatrix(plan) {
  const open = plan.filter((step) => step.status !== "done");
  return renderGroups(open, [
    [t("Важно и срочно", "Important & urgent"), (step) => step.important && step.urgent, t("Сюда попадут важные шаги с близким сроком.", "Important steps with near deadlines go here."), "peach"],
    [t("Важно, срок дальше", "Important, less urgent"), (step) => step.important && !step.urgent, t("Здесь можно запланировать важные шаги.", "Plan important upcoming steps here."), "lilac"],
    [t("Срочно, менее важно", "Urgent, less important"), (step) => !step.important && step.urgent, t("Срочных шагов в этом квадранте пока нет.", "No urgent steps in this quadrant yet."), "sand"],
    [t("Меньше приоритета", "Lower priority"), (step) => !step.important && !step.urgent, t("Здесь будут несрочные шаги с меньшей важностью.", "Less important steps without close deadlines go here."), "stone"],
  ], "matrix-grid");
}

function renderGantt(goal, plan) {
  const chart = make("div", "gantt-chart");
  const start = goal.createdAt;
  const deadline = core.getDeadline(goal);
  const duration = Math.max(deadline - start, 1);
  const todayPercent = Math.min(100, Math.max(0, (Date.now() - start) / duration * 100));
  const dates = make("div", "gantt-dates");
  dates.append(make("span", "", shortDate.format(start)), make("span", "", shortDate.format(deadline)));
  chart.append(dates);
  const list = make("ul", "gantt-list");
  for (const step of plan) {
    const row = make("li", "gantt-row");
    row.dataset.stepId = step.id;
    const heading = make("div", "gantt-step");
    const control = button(step.title, "gantt-title");
    control.dataset.action = "open";
    heading.append(control, make("span", "muted", `${shortDate.format(step.startAt)} – ${shortDate.format(step.dueAt)} · ${t(...statusNames[step.status])}`));
    const track = make("div", "gantt-track");
    track.setAttribute("aria-hidden", "true");
    const startPercent = Math.min(100, Math.max(0, (step.startAt - start) / duration * 100));
    const endPercent = Math.min(100, Math.max(startPercent, (step.dueAt - start) / duration * 100));
    const bar = make("span", "gantt-bar");
    bar.dataset.status = step.status;
    bar.style.left = `${startPercent}%`;
    bar.style.width = `${endPercent - startPercent}%`;
    const today = make("span", "gantt-today");
    today.style.left = `${todayPercent}%`;
    track.append(bar, today);
    row.append(heading, track);
    list.append(row);
  }
  chart.append(list);
  return chart;
}

function renderPlan(goal, plan) {
  for (const control of viewButtons.children) {
    control.setAttribute("aria-pressed", String(control.dataset.view === state.view));
  }
  element("plan-description").textContent = t(...descriptions[state.view]);
  const views = {
    path: () => renderPath(plan),
    kanban: () => renderKanban(plan),
    gantt: () => renderGantt(goal, plan),
    matrix: () => renderMatrix(plan),
  };
  planContent.replaceChildren(views[state.view]());
}

function updateGoal() {
  const goal = activeGoal();
  const plan = planFor(goal);
  renderProgress(goal, plan);
  renderFocus(plan);
  renderStreak(goal);
  renderPlan(goal, plan);
  rewards.renderRewards(state, language);
  portfolio.render();
}

function renderReflection(goal, now = Date.now()) {
  reflectionTime = now;
  const entry = goal.reflects[core.dateKey(now)] ?? {};
  element("reflection-date").textContent = fullDate.format(now);
  for (const name of ["smallStep", "win", "takeaway"]) {
    reflectionForm.elements[name].value = entry[name] ?? "";
  }
}

function showGoal(focus = false) {
  const goal = activeGoal();
  if (!goal) {
    showBuilder(focus);
    return;
  }
  launch.hidden = true;
  workspace.hidden = false;
  goalSelect.replaceChildren(...state.goals.map((item) => new Option(item.title, item.id)));
  goalSelect.value = goal.id;
  element("goal-category").textContent = `${language.areaLabel(goal.area)} · ${language.horizonLabel(goal.horizon)}`;
  element("active-heading").textContent = goal.title;
  element("new-subgoal").hidden = goal.horizon === "day" || goal.deadline < core.dateKey();
  const editor = element("deadline-editor");
  editor.open = false;
  const deadline = element("deadline-value");
  deadline.setCustomValidity("");
  deadline.min = core.dateKey();
  deadline.value = goal.deadline;
  renderReflection(goal);
  updateGoal();
  if (focus) element("active-heading").focus();
}

function focusCard(id) {
  const card = planContent.querySelector(`[data-step-id="${CSS.escape(id)}"] h3`);
  (card ?? element("plan-heading")).focus();
}

function openInPath(id) {
  state.view = "path";
  save();
  updateGoal();
  focusCard(id);
}

function wouldDiscardProgress(goal, step) {
  if (step.evidence || step.proof) return true;
  const affected = new Set([step.id]);
  for (const id of affected) {
    for (const item of core.getTemplate(goal.templateId).steps) {
      if ((item.after ?? []).includes(id) || item.when?.step === id) affected.add(item.id);
    }
  }
  return [...affected].some((id) => id !== step.id && goal.steps[id]?.status);
}

function applyAction(step, action, value) {
  const goal = activeGoal();
  const beforeComplete = allDone;
  const oldProofs = action === "reopen" ? Object.values(goal.steps).map((entry) => entry.proof?.id).filter(Boolean) : [];
  if (!core.act(goal, step.id, action, value)) return false;
  const plan = core.getPlan(goal);
  const complete = plan.length > 0 && plan.every((item) => item.status === "done");
  if (action !== "importance") core.record(state, "task", goal.id, step.title, action);
  if (complete !== beforeComplete) core.record(state, "goal", goal.id, goal.title, complete ? "finished" : "resumed");
  const saved = save();
  if (saved && oldProofs.length) {
    const kept = new Set(Object.values(goal.steps).map((entry) => entry.proof?.id));
    for (const id of oldProofs.filter((item) => !kept.has(item))) rewards.discardProof(id).catch(() => {});
  } else if (!saved && value?.proof) {
    delete goal.steps[step.id].proof;
    rewards.discardProof(value.proof.id).catch(() => {});
  }
  updateGoal();
  focusCard(step.id);
  if (action === "done" || action === "choose") {
    planContent.querySelector(`[data-step-id="${CSS.escape(step.id)}"]`)?.classList.add("just-confirmed");
    announce(allDone ? t("Маршрут завершён!", "Plan complete!") : t("Шаг подтверждён. Проверьте, что открылось дальше.", "Step confirmed. See what unlocked next."));
  }
  return true;
}

planContent.addEventListener("click", (event) => {
  const control = event.target.closest("button[data-action]");
  if (!control) return;
  const id = control.closest("[data-step-id]").dataset.stepId;
  const action = control.dataset.action;
  if (action === "open") {
    openInPath(id);
    return;
  }
  const goal = activeGoal();
  const step = planFor(goal).find((item) => item.id === id);
  if (!step) return;
  switch (action) {
    case "done":
      evidenceStepId = id;
      element("evidence-result").textContent = t(`Убедитесь, что результат получен: ${step.result}.`, `Ready to confirm this outcome? ${step.result}.`);
      evidenceNote.value = "";
      evidenceFile.value = "";
      proofError.textContent = "";
      dialog.showModal();
      evidenceNote.focus();
      break;
    case "choose":
      applyAction(step, action, control.dataset.choice);
      break;
    case "reopen":
      if (wouldDiscardProgress(goal, step) &&
          !window.confirm(t("Вернуть шаг? Подтверждение этого шага и продвижение по зависимым карточкам будут сброшены.", "Reopen this step? Its evidence and progress on dependent steps will be cleared."))) return;
      applyAction(step, action);
      break;
    case "proof":
      showProof(step);
      break;
    case "importance":
      applyAction(step, action, !step.important);
      break;
    default:
      applyAction(step, action);
  }
});

const cancelEvidence = element("cancel-evidence");
cancelEvidence.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", (event) => {
  if (evidenceConfirm.disabled) event.preventDefault();
});
evidenceFile.addEventListener("change", () => { proofError.textContent = ""; });
element("evidence-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (evidenceConfirm.disabled) return;
  const step = planFor(activeGoal()).find((item) => item.id === evidenceStepId);
  const evidence = evidenceNote.value;
  let proof;
  if (evidenceFile.files[0]) {
    evidenceConfirm.disabled = true;
    cancelEvidence.disabled = true;
    try {
      proof = await rewards.saveProof(evidenceFile.files[0]);
    } catch (error) {
      const errors = {
        "invalid-type": t("Выберите PNG, JPEG или WebP.", "Choose a PNG, JPEG or WebP image."),
        "too-large": t("Выберите изображение до 5 МБ.", "Choose an image up to 5 MB."),
        "invalid-image": t("Изображение повреждено. Выберите другой файл.", "The image could not be opened. Choose another file."),
      };
      proofError.textContent = errors[error.code] ?? t("Пруф не сохранился. Уберите файл или попробуйте другой.", "The proof could not be saved. Remove it or try another file.");
      return;
    } finally {
      evidenceConfirm.disabled = false;
      cancelEvidence.disabled = false;
    }
  }
  dialog.close();
  if ((!step || !applyAction(step, "done", { evidence, proof })) && proof) rewards.discardProof(proof.id).catch(() => {});
});

const proofDialog = element("proof-dialog");
const proofImage = element("proof-image");
let proofUrl;
let proofRequest = 0;
async function showProof(step) {
  const request = ++proofRequest;
  const feedback = element("proof-feedback");
  feedback.textContent = t("Загрузка…", "Loading…");
  proofDialog.showModal();
  let image;
  try { image = await rewards.readProof(step.proof.id); } catch { /* Show the empty proof state. */ }
  if (request !== proofRequest || !proofDialog.open) return;
  if (!image) {
    feedback.textContent = t("Изображение недоступно в этом браузере.", "The image is unavailable in this browser.");
    return;
  }
  proofUrl = URL.createObjectURL(image);
  proofImage.src = proofUrl;
  proofImage.hidden = false;
  feedback.textContent = step.proof.name;
}

element("close-proof").addEventListener("click", () => proofDialog.close());
proofDialog.addEventListener("close", () => {
  if (proofUrl) URL.revokeObjectURL(proofUrl);
  proofUrl = undefined;
  proofImage.hidden = true;
  proofImage.removeAttribute("src");
});

viewButtons.addEventListener("click", (event) => {
  const control = event.target.closest("button[data-view]");
  if (!control) return;
  state.view = control.dataset.view;
  save();
  updateGoal();
});

goalSelect.addEventListener("change", () => selectGoal(goalSelect.value, false));
element("new-goal").addEventListener("click", () => showBuilder());
element("new-subgoal").addEventListener("click", () => showBuilder(true, activeGoal()));
element("back-to-goal").addEventListener("click", () => showGoal(true));
element("focus-button").addEventListener("click", () => openInPath(focusStepId));

element("deadline-value").addEventListener("input", (event) => event.target.setCustomValidity(""));
element("deadline-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = activeGoal();
  const input = element("deadline-value");
  const parent = state.goals.find((item) => item.id === goal.parentId);
  const outsideParent = parent && input.value > parent.deadline;
  const overlapsChild = state.goals.some((item) => item.parentId === goal.id && item.deadline > input.value);
  if (outsideParent || overlapsChild || !core.setDeadline(goal, input.value)) {
    input.setCustomValidity(outsideParent || overlapsChild
      ? t("Выберите срок между сроком подцелей и сроком родительской цели.", "Keep this deadline after subgoals and no later than the parent goal.")
      : t("Выберите сегодняшнюю или будущую дату.", "Choose today or a future date."));
    input.reportValidity();
    return;
  }
  core.record(state, "goal", goal.id, goal.title, "deadline");
  const saved = save();
  element("deadline-editor").open = false;
  element("deadline-editor").querySelector("summary").focus();
  updateGoal();
  announce(saved ? t("Срок обновлён.", "Deadline updated.") : t("Срок изменён в текущем сеансе.", "Deadline changed for this session."));
});

reflectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = activeGoal();
  const now = Date.now();
  const today = core.dateKey(now) === core.dateKey(reflectionTime);
  const messageDate = shortDate.format(reflectionTime);
  core.setReflection(goal, Object.fromEntries(new FormData(reflectionForm)), reflectionTime);
  const saved = save();
  renderReflection(goal, now);
  renderStreak(goal);
  announce(saved ? t(`Заметка за ${today ? "сегодня" : messageDate} сохранена.`, `${today ? "Today's check-in" : `Check-in for ${messageDate}`} saved.`) : t("Заметка осталась в текущем сеансе.", "The check-in is available for this session."));
});

const shareDialog = element("share-dialog");
const shareSummary = element("share-summary");
const shareFeedback = element("share-feedback");
const shareNative = element("share-native");
const shareUrl = new URL("https://safal207.github.io/todo-list/goals/");

function shareLink(base, values) {
  const url = new URL(base);
  url.search = new URLSearchParams(values);
  return url.href;
}

element("share-progress").addEventListener("click", () => {
  const goal = activeGoal();
  const next = planFor(goal).find((item) => item.id === focusStepId);
  shareSummary.value = [
    `${t("Цель", "Goal")} · ${goal.title}`,
    `${t("Срок", "Deadline")} · ${fullDate.format(core.getDeadline(goal))}`,
    element("goal-count").textContent,
    next ? `${t("Следующий шаг", "Next step")} · ${next.title}` : t("Маршрут завершён.", "Plan complete."),
  ].join("\n");
  shareUrl.searchParams.set("lang", language.lang);
  element("share-telegram").href = shareLink("https://t.me/share/url", { url: shareUrl.href, text: shareSummary.value });
  element("share-vk").href = shareLink("https://vk.com/share.php", { url: shareUrl.href, title: shareSummary.value });
  shareNative.hidden = typeof navigator.share !== "function";
  shareFeedback.textContent = "";
  shareDialog.showModal();
});

element("close-share").addEventListener("click", () => shareDialog.close());
element("copy-share").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareSummary.value);
    shareFeedback.textContent = t("Сводка скопирована.", "Update copied.");
  } catch {
    shareSummary.focus();
    shareSummary.select();
    shareFeedback.textContent = t("Текст выделен. Скопируйте его вручную.", "Text selected. Copy it manually.");
  }
});
shareNative.addEventListener("click", async () => {
  try {
    await navigator.share({ text: shareSummary.value, url: shareUrl.href });
  } catch (error) {
    if (error.name !== "AbortError") shareFeedback.textContent = t("Выберите соцсеть или скопируйте сводку.", "Choose a social app or copy your update.");
  }
});

document.addEventListener("goal-languagechange", () => {
  goalTitle.setCustomValidity("");
  goalDate.setCustomValidity("");
  parentSelect.setCustomValidity("");
  element("action-status").textContent = "";
  if (!workspace.hidden) {
    const goal = activeGoal();
    element("goal-category").textContent = `${language.areaLabel(goal.area)} · ${language.horizonLabel(goal.horizon)}`;
    element("reflection-date").textContent = fullDate.format(reflectionTime);
    updateGoal();
  } else {
    renderTemplateOptions();
    renderClassification();
    if (insertedTitle && goalTitle.value === insertedTitle) {
      insertedTitle = builderTemplate().title;
      goalTitle.value = insertedTitle;
    }
    updateBuilder();
  }
});

if (activeGoal()) showGoal();
else showBuilder(false);
setInterval(updateTimer, 1000);
