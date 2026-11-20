(() => {
  "use strict";

  const STORAGE_KEY = "sdelano.goals.v1";
  const VIEWS = ["path", "kanban", "gantt", "matrix"];
  const DAY = 24 * 60 * 60 * 1000;
  const templates = window.goalTemplates;
  const horizons = [
    { id: "day", label: "День" },
    { id: "week", label: "Неделя" },
    { id: "month", label: "Месяц" },
    { id: "quarter", label: "Квартал" },
    { id: "half", label: "Полгода" },
    { id: "year", label: "Год" },
    { id: "5y", label: "5 лет" },
    { id: "10y", label: "10 лет" },
    { id: "20y", label: "20 лет" },
    { id: "30y", label: "30 лет" },
    { id: "50y", label: "50 лет" },
  ];
  const areas = [
    { id: "work", label: "Работа и бизнес" },
    { id: "finance", label: "Финансы" },
    { id: "home", label: "Дом" },
    { id: "relationships", label: "Семья и отношения" },
    { id: "education", label: "Образование" },
    { id: "health", label: "Здоровье" },
    { id: "personal", label: "Личное развитие" },
    { id: "other", label: "Другое" },
  ];
  const horizonMonths = { month: 1, quarter: 3, half: 6, year: 12, "5y": 60, "10y": 120, "20y": 240, "30y": 360, "50y": 600 };
  const templateAreas = {
    business: "work", investors: "work", home: "home", savings: "finance",
    family: "relationships", relationship: "relationships", english: "education",
  };

  function getTemplate(id) {
    return templates.find((template) => template.id === id) ?? null;
  }

  function normalize(value) {
    return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  }

  function suggestTemplate(title) {
    const text = normalize(typeof title === "string" ? title : "");
    let best = getTemplate("custom");
    let bestScore = 0;

    for (const template of templates) {
      const matching = template.keywords.filter((keyword) => text.includes(normalize(keyword)));
      const score = matching.reduce((sum, keyword) => sum + keyword.length, 0);
      if (score > bestScore) {
        best = template;
        bestScore = score;
      }
    }

    return best;
  }

  function dateKey(time = Date.now()) {
    const date = new Date(time);
    if (!Number.isFinite(date.getTime())) return "";

    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function startOfDay(time, offset = 0) {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date.getTime();
  }

  function endOfDay(time) {
    return startOfDay(time, 1) - 1;
  }

  function parseDate(value) {
    const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return NaN;

    const [, year, month, day] = match;
    const date = new Date(0);
    date.setFullYear(Number(year), Number(month) - 1, Number(day));
    date.setHours(0, 0, 0, 0);
    const time = date.getTime();
    return dateKey(time) === value ? time : NaN;
  }

  function getDeadline(goal) {
    return endOfDay(parseDate(goal.deadline));
  }

  function defaultDeadline(horizonId, now = Date.now()) {
    if (horizonId === "day") return dateKey(now);
    if (horizonId === "week") return dateKey(startOfDay(now, 7));
    if (!Object.hasOwn(horizonMonths, horizonId)) return "";

    const date = new Date(now);
    const day = date.getDate();
    const targetMonth = date.getMonth() + horizonMonths[horizonId];
    date.setMonth(targetMonth + 1, 0);
    date.setDate(Math.min(day, date.getDate()));
    return dateKey(date.getTime());
  }

  function inferHorizon(dueDate, now = Date.now()) {
    if (!Number.isFinite(parseDate(dueDate)) || !dateKey(now)) return "month";
    return horizons.find(({ id }) => dueDate <= defaultDeadline(id, now))?.id ?? "50y";
  }

  function recommendArea(templateId) {
    return Object.hasOwn(templateAreas, templateId) ? templateAreas[templateId] : "other";
  }

  function titleText(value, maxLength) {
    return typeof value === "string" ? Array.from(value.trim()).slice(0, maxLength).join("") : "";
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function reflectionText(values) {
    return {
      smallStep: titleText(values.smallStep, 240),
      win: titleText(values.win, 240),
      takeaway: titleText(values.takeaway, 240),
    };
  }

  function cleanProof(value) {
    if (!isRecord(value)) return null;
    const id = titleText(value.id, 120);
    const name = titleText(value.name, 255);
    return id && name ? { id, name } : null;
  }

  function cleanEvent(value) {
    if (!isRecord(value) || !["goal", "task"].includes(value.kind) ||
        !Number.isFinite(value.at) || !dateKey(value.at)) return null;
    const title = titleText(value.title, 200);
    const action = titleText(value.action, 80);
    const goalId = titleText(value.goalId, 120) || null;
    return title && action ? { kind: value.kind, goalId, title, action, at: value.at } : null;
  }

  function record(state, kind, goalId, title, action, now = Date.now()) {
    const event = cleanEvent({ kind, goalId, title, action, at: now });
    if (!event) return false;
    if (!Array.isArray(state.history)) state.history = [];
    state.history.push(event);
    return true;
  }

  function goalPlacement(templateId, dueDate, now, options) {
    const fields = isRecord(options) ? options : {};
    return {
      horizon: horizons.some(({ id }) => id === fields.horizon)
        ? fields.horizon : inferHorizon(dueDate, now),
      area: areas.some(({ id }) => id === fields.area)
        ? fields.area : recommendArea(templateId),
      parentId: titleText(fields.parentId, 120) || null,
    };
  }

  function cleanGoal(value) {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
        !Number.isFinite(value.createdAt) || !dateKey(value.createdAt)) return null;

    const title = titleText(value.title, 120);
    const template = getTemplate(value.templateId);
    const deadline = getDeadline(value);
    if (!title || !template || !Number.isFinite(deadline) || deadline < value.createdAt) return null;

    const steps = {};
    for (const step of template.steps) {
      const saved = value.steps?.[step.id];
      if (!isRecord(saved)) continue;

      const data = {};
      if (typeof saved.important === "boolean") data.important = saved.important;
      if (saved.status === "doing" && !step.choices) data.status = saved.status;
      if (saved.status === "done") {
        const validChoice = step.choices?.some((choice) => choice.value === saved.selection);
        if (!step.choices || validChoice) {
          data.status = "done";
          if (validChoice) data.selection = saved.selection;
          const evidence = titleText(saved.evidence, 500);
          if (evidence) data.evidence = evidence;
          const proof = cleanProof(saved.proof);
          if (proof && !step.choices) data.proof = proof;
          if (Number.isFinite(saved.completedAt) && dateKey(saved.completedAt)) {
            data.completedAt = saved.completedAt;
          }
        }
      }
      steps[step.id] = data;
    }

    const reflects = {};
    if (isRecord(value.reflects)) {
      for (const [key, entry] of Object.entries(value.reflects)) {
        if (!Number.isFinite(parseDate(key)) || !isRecord(entry)) continue;
        const retained = reflectionText(entry);
        if (Object.values(retained).some(Boolean)) reflects[key] = retained;
      }
    }

    const placement = goalPlacement(template.id, value.deadline, value.createdAt, value);
    if (placement.parentId === value.id) placement.parentId = null;
    return {
      id: value.id,
      title,
      templateId: template.id,
      createdAt: value.createdAt,
      deadline: value.deadline,
      ...placement,
      steps,
      reflects,
    };
  }

  function load() {
    const empty = { goals: [], selectedId: null, view: "path", history: [] };
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
      if (!isRecord(saved) || !Array.isArray(saved.goals)) return empty;

      const goals = saved.goals.map(cleanGoal).filter(Boolean);
      const goalIds = new Set(goals.map((goal) => goal.id));
      for (const goal of goals) {
        if (goal.parentId && !goalIds.has(goal.parentId)) goal.parentId = null;
      }
      const selected = goals.find((goal) => goal.id === saved.selectedId);
      return {
        goals,
        selectedId: selected?.id ?? goals[0]?.id ?? null,
        view: VIEWS.includes(saved.view) ? saved.view : "path",
        history: Array.isArray(saved.history) ? saved.history.map(cleanEvent).filter(Boolean) : [],
      };
    } catch {
      return empty;
    }
  }

  function save(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function createGoal(value, templateId, dueDate, now = Date.now(), options) {
    const title = titleText(value, 120);
    const template = templateId ? getTemplate(templateId) : suggestTemplate(title);
    const deadline = endOfDay(parseDate(dueDate));
    if (!title || !template || !Number.isFinite(now) || !dateKey(now) ||
        !Number.isFinite(deadline) || deadline < now) return null;

    return {
      id: window.crypto?.randomUUID?.() ?? now.toString(36) + "-" + Math.random().toString(36).slice(2),
      title,
      templateId: template.id,
      createdAt: now,
      deadline: dueDate,
      ...goalPlacement(template.id, dueDate, now, options),
      steps: {},
      reflects: {},
    };
  }

  function dependencies(step) {
    return step.when ? [...new Set([...(step.after ?? []), step.when.step])] : step.after ?? [];
  }

  function visibleSteps(goal, template) {
    const byId = new Map(template.steps.map((step) => [step.id, step]));

    function isVisible(step, visited = new Set()) {
      if (!step.when) return true;
      if (visited.has(step.id)) return false;
      visited.add(step.id);
      const decision = byId.get(step.when.step);
      const record = goal.steps[step.when.step];
      return Boolean(
        decision && record?.status === "done" && record.selection === step.when.value &&
        isVisible(decision, visited),
      );
    }

    return template.steps.filter((step) => isVisible(step));
  }

  function getPlan(goal, now = Date.now()) {
    const template = goal && getTemplate(goal.templateId);
    if (!template) return [];

    const visible = visibleSteps(goal, template);
    const ids = new Set(visible.map((step) => step.id));
    const deadline = getDeadline(goal);
    const firstDay = startOfDay(goal.createdAt);
    const targetDay = startOfDay(deadline);
    const span = Math.round((targetDay - firstDay) / DAY);
    const dueDates = new Map(visible.map((step) => {
      const offset = Math.max(0, Math.ceil((span + 1) * step.until) - 1);
      return [step.id, endOfDay(startOfDay(firstDay, offset))];
    }));
    const urgentThrough = endOfDay(startOfDay(now, 3));

    return visible.map((step) => {
      const record = goal.steps[step.id] ?? {};
      const required = dependencies(step);
      const available = required.every((id) => ids.has(id) && goal.steps[id]?.status === "done");
      const dueAt = dueDates.get(step.id);
      const startDays = required
        .filter((id) => dueDates.has(id))
        .map((id) => startOfDay(dueDates.get(id), 1));
      const plannedStart = Math.max(goal.createdAt, ...startDays);
      const startAt = Math.min(plannedStart, Math.max(goal.createdAt, startOfDay(dueAt)));

      return {
        ...step,
        status: available ? record.status ?? "ready" : "waiting",
        selection: record.selection ?? null,
        evidence: record.evidence ?? "",
        proof: record.proof ?? null,
        completedAt: record.completedAt ?? null,
        important: record.important ?? step.important,
        urgent: dueAt <= urgentThrough,
        startAt,
        dueAt,
      };
    });
  }

  function clearProgress(goal, id) {
    const template = getTemplate(goal.templateId);
    const affected = new Set([id]);
    for (const stepId of affected) {
      for (const step of template.steps) {
        if (dependencies(step).includes(stepId)) affected.add(step.id);
      }
    }

    for (const stepId of affected) {
      const important = goal.steps[stepId]?.important;
      if (typeof important === "boolean") {
        goal.steps[stepId] = { important };
      } else {
        delete goal.steps[stepId];
      }
    }
  }

  function act(goal, stepId, action, value, now = Date.now()) {
    const step = getPlan(goal, now).find((item) => item.id === stepId);
    if (!step || !dateKey(now)) return false;

    const record = goal.steps[stepId] ?? {};
    const actionable = step.status === "ready" || step.status === "doing";

    switch (action) {
      case "importance":
        if (typeof value !== "boolean") return false;
        goal.steps[stepId] = { ...record, important: value };
        break;
      case "start":
        if (step.status !== "ready" || step.choices) return false;
        goal.steps[stepId] = { ...record, status: "doing" };
        break;
      case "done": {
        if (!actionable || step.choices) return false;
        const evidence = isRecord(value) ? value.evidence : value;
        const proof = isRecord(value) ? cleanProof(value.proof) : null;
        goal.steps[stepId] = {
          ...record,
          status: "done",
          completedAt: now,
          evidence: titleText(evidence, 500),
          ...(proof ? { proof } : {}),
        };
        break;
      }
      case "choose":
        if (!actionable || !step.choices?.some((choice) => choice.value === value)) return false;
        goal.steps[stepId] = { ...record, status: "done", completedAt: now, selection: value };
        break;
      case "reopen":
        if (step.status !== "doing" && step.status !== "done") return false;
        clearProgress(goal, stepId);
        break;
      default:
        return false;
    }

    return true;
  }

  function setDeadline(goal, dueDate, now = Date.now()) {
    const deadline = endOfDay(parseDate(dueDate));
    if (!Number.isFinite(deadline) || deadline < Math.max(now, goal.createdAt)) return false;
    goal.deadline = dueDate;
    return true;
  }

  function setReflection(goal, values, now = Date.now()) {
    const today = dateKey(now);
    if (!today || !isRecord(values)) return false;

    const entry = reflectionText(values);
    if (Object.values(entry).some(Boolean)) {
      goal.reflects[today] = entry;
    } else {
      delete goal.reflects[today];
    }
    return true;
  }

  function getStreak(goal, now = Date.now()) {
    if (!dateKey(now)) return 0;

    const dates = new Set(Object.keys(goal.reflects));
    for (const step of getPlan(goal, now)) {
      if (step.status === "done" && Number.isFinite(step.completedAt)) {
        dates.add(dateKey(step.completedAt));
      }
    }

    let day = startOfDay(now);
    if (!dates.has(dateKey(day))) day = startOfDay(day, -1);

    let streak = 0;
    while (dates.has(dateKey(day))) {
      streak += 1;
      day = startOfDay(day, -1);
    }
    return streak;
  }

  window.goalCore = {
    getTemplate, suggestTemplate, load, save, createGoal, getPlan, act,
    setDeadline, getDeadline, dateKey, setReflection, getStreak,
    horizons, areas, recommendArea, defaultDeadline, inferHorizon, record,
  };
})();
