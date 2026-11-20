(() => {
  "use strict";

  const staticCopy = {
    "Список задач": "To-do list",
    "Сделано, список задач": "Sdelano, to-do list",
    "Большая цель": "Big Goal",
    "Большая цель.": "Big goal.",
    "Первый шаг.": "First step.",
    "Разделы приложения": "App sections",
    "Язык": "Language",
    "Запишите цель и срок. Получите маршрут с этапами, решениями и понятным результатом каждого шага.": "Set a goal and a deadline. Get a plan with milestones, decisions and a clear outcome for each step.",
    "Составьте план": "Build your plan",
    "Вернуться к плану": "Back to plan",
    "Моя цель": "My goal",
    "Срок": "Deadline",
    "Горизонт": "Time horizon",
    "Сфера": "Area",
    "Подцель для": "Subgoal of",
    "Шаблон плана": "Plan template",
    "Создать план и запустить отсчёт": "Create plan and start countdown",
    "Мои цели": "My goals",
    "+ Новая цель": "+ New goal",
    "+ Подцель": "+ Subgoal",
    "Карта и история": "Map and history",
    "Карта целей": "Goal map",
    "Вид карты целей": "Goal map view",
    "Граф": "Graph",
    "Таблица": "Table",
    "История целей": "Goal history",
    "История задач": "Task history",
    "Выполненные шаги": "Completed steps",
    "Маршрут завершён! Все шаги выполнены.": "Plan complete! Every step is confirmed.",
    "До срока": "Time remaining",
    "Изменить срок": "Change deadline",
    "Новая дата": "New date",
    "Сохранить срок": "Save deadline",
    "Маршрут": "Your plan",
    "Вид плана": "Plan view",
    "Карточки": "Cards",
    "Канбан": "Kanban",
    "Гант": "Gantt",
    "Матрица": "Matrix",
    "Награды и рейтинг": "Rewards and rank",
    "Следующий шаг": "Next step",
    "Открыть карточку": "Open step",
    "Сводка для партнёра": "Partner update",
    "6 минут на себя": "Six-minute check-in",
    "3 минуты утром · Главное дело сегодня": "3 minutes in the morning · One thing for today",
    "3 минуты вечером · Что получилось?": "3 minutes in the evening · What went well?",
    "Что поможет завтра?": "What will help tomorrow?",
    "Сохранить заметку": "Save check-in",
    "Сохранение недоступно. Изменения могут исчезнуть после обновления страницы.": "Storage is unavailable. Changes may be lost when you reload.",
    "Цели и заметки сохраняются в этом браузере.": "Goals and notes are saved in this browser.",
    "Как устроены методики": "Methods behind the app",
    "Подтвердить шаг": "Confirm step",
    "Что получилось?": "What did you achieve?",
    "Необязательно": "Optional",
    "Фото или скриншот": "Photo or screenshot",
    "до 5 МБ": "up to 5 MB",
    "Отмена": "Cancel",
    "Закрыть": "Close",
    "Подтверждение шага": "Step evidence",
    "Изображение, прикреплённое к шагу": "Image attached to this step",
    "Цель, срок, прогресс и следующий шаг": "Goal, deadline, progress and next step",
    "Копировать": "Copy",
    "Поделиться": "Share",
    "Поделиться в соцсетях": "Share on social media",
    "Например, провести разговор на английском": "For example, have a conversation in English",
  };

  const controls = document.getElementById("language-controls");
  let current;
  try { current = localStorage.getItem("sdelano.goals.lang"); } catch { /* Use the default. */ }
  const param = new URLSearchParams(location.search).get("lang");
  if (param === "ru" || param === "en") current = param;
  current = current === "en" ? "en" : "ru";

  const copy = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const original = node.nodeValue;
    const translated = staticCopy[original.trim()];
    if (typeof translated === "string") copy.push([node, original, original.replace(original.trim(), translated)]);
  }
  const attributes = [...document.querySelectorAll("[aria-label], [placeholder], img[alt]")]
    .flatMap((element) => ["aria-label", "placeholder", "alt"].flatMap((key) => {
      const original = element.getAttribute(key);
      return typeof staticCopy[original] === "string" ? [[element, key, original, staticCopy[original]]] : [];
    }));

  function t(ru, en) { return current === "en" ? en : ru; }
  function formatDate(value, options) { return new Intl.DateTimeFormat(t("ru-RU", "en-GB"), options).format(value); }
  function displayTemplate(template) {
    const english = window.goalTemplatesEn?.[template.id];
    return current === "en" && english ? { ...template, title: english.title, category: english.category, description: english.description } : template;
  }
  function displayPlan(templateId, plan) {
    const english = window.goalTemplatesEn?.[templateId]?.steps;
    if (current !== "en" || !english) return plan;
    return plan.map((step) => {
      const translation = english[step.id];
      if (!translation) return step;
      return {
        ...step,
        title: translation.title,
        description: translation.description,
        result: translation.result,
        choices: step.choices?.map((choice) => ({ ...choice, label: translation.choices?.[choice.value] ?? choice.label })),
      };
    });
  }

  const horizonEn = {
    day: "Day", week: "Week", month: "Month", quarter: "3 months", half: "6 months",
    year: "1 year", "5y": "5 years", "10y": "10 years", "20y": "20 years", "30y": "30 years", "50y": "50 years",
  };
  const areaEn = {
    work: "Work & business", finance: "Money", home: "Home", relationships: "Relationships",
    education: "Learning", health: "Health", personal: "Personal", other: "Other",
  };
  function horizonLabel(id) {
    return t(window.goalCore.horizons.find((item) => item.id === id)?.label ?? "", horizonEn[id] ?? "");
  }
  function areaLabel(id) {
    return t(window.goalCore.areas.find((item) => item.id === id)?.label ?? "", areaEn[id] ?? "");
  }

  function render() {
    document.documentElement.lang = current;
    document.title = t("Большая цель — Сделано", "Big Goal — Sdelano");
    for (const [node, ru, en] of copy) {
      if (node.isConnected) node.nodeValue = t(ru, en);
    }
    for (const [element, key, ru, en] of attributes) element.setAttribute(key, t(ru, en));
    for (const button of controls.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.language === current));
    }
  }

  for (const template of window.goalTemplates) {
    template.keywords.push(...(window.goalTemplatesEn?.[template.id]?.keywords ?? []));
  }
  window.goalLanguage = { get lang() { return current; }, t, formatDate, displayTemplate, displayPlan, horizonLabel, areaLabel };

  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-language]");
    if (!button || button.dataset.language === current) return;
    current = button.dataset.language;
    try { localStorage.setItem("sdelano.goals.lang", current); } catch { /* Language remains active during this visit. */ }
    if (param) {
      try {
        const url = new URL(location.href);
        url.searchParams.set("lang", current);
        history.replaceState(null, "", url);
      } catch { /* The local language preference is still active. */ }
    }
    render();
    document.dispatchEvent(new Event("goal-languagechange"));
  });
  render();
})();
