(() => {
  "use strict";

  const standaloneKey = "sdelano.tasks.history.v1";

  window.createGoalPortfolio = function createGoalPortfolio(state, selectGoal) {
    const core = window.goalCore;
    const language = window.goalLanguage;
    const { t } = language;
    const panel = document.getElementById("portfolio");
    const body = document.getElementById("portfolio-body");
    const opener = document.getElementById("open-portfolio");
    const modes = document.getElementById("portfolio-views");
    let mode = "graph";

    function make(tag, text, className) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }

    function goalButton(goal) {
      const control = make("button", goal.title, "portfolio-goal");
      control.type = "button";
      control.dataset.goalId = goal.id;
      return control;
    }

    function brief(goal) {
      const plan = core.getPlan(goal);
      const done = plan.filter((step) => step.status === "done").length;
      return t(`${done} из ${plan.length}`, `${done} of ${plan.length}`);
    }

    function graph() {
      const children = new Map();
      const ids = new Set(state.goals.map((goal) => goal.id));
      for (const goal of state.goals) {
        const parent = ids.has(goal.parentId) && goal.id !== goal.parentId ? goal.parentId : null;
        const siblings = children.get(parent) ?? [];
        siblings.push(goal);
        children.set(parent, siblings);
      }
      const visited = new Set();
      function paint(goals) {
        const list = make("ul", undefined, "goal-tree");
        for (const goal of goals) {
          if (visited.has(goal.id)) continue;
          visited.add(goal.id);
          const item = make("li", undefined, "goal-tree-item");
          const branch = make("div", undefined, "tree-card");
          branch.dataset.selected = String(goal.id === state.selectedId);
          const labels = `${language.horizonLabel(goal.horizon)} · ${language.areaLabel(goal.area)} · ${brief(goal)}`;
          branch.append(goalButton(goal), make("span", labels, "muted"));
          item.append(branch);
          const descendants = children.get(goal.id);
          if (descendants?.length) item.append(paint(descendants));
          list.append(item);
        }
        return list;
      }
      const root = paint(children.get(null) ?? []);
      const recovered = state.goals.filter((goal) => !visited.has(goal.id));
      if (recovered.length) root.append(...paint(recovered).children);
      return root;
    }

    function table() {
      const wrapper = make("div", undefined, "portfolio-table-wrap");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("aria-label", t("Таблица целей", "Goal table"));
      const output = make("table", undefined, "portfolio-table");
      const heading = output.createTHead().insertRow();
      for (const text of [t("Цель", "Goal"), t("Горизонт", "Time horizon"), t("Сфера", "Area"), t("Срок", "Deadline"), t("Прогресс", "Progress"), t("Родительская цель", "Parent goal")]) {
        const header = make("th", text);
        header.scope = "col";
        heading.append(header);
      }
      const rows = output.createTBody();
      for (const goal of [...state.goals].sort((a, b) => a.deadline.localeCompare(b.deadline))) {
        const row = rows.insertRow();
        row.insertCell().append(goalButton(goal));
        for (const text of [
          language.horizonLabel(goal.horizon),
          language.areaLabel(goal.area),
          language.formatDate(core.getDeadline(goal), { dateStyle: "medium" }),
          brief(goal),
          state.goals.find((item) => item.id === goal.parentId)?.title ?? "—",
        ]) {
          row.insertCell().textContent = text;
        }
      }
      wrapper.append(output);
      return wrapper;
    }

    function standalone() {
      try {
        const rows = JSON.parse(localStorage.getItem(standaloneKey) ?? "[]");
        return Array.isArray(rows) ? rows.filter((item) => typeof item?.title === "string" && Number.isFinite(item.at) && typeof item.action === "string") : [];
      } catch {
        return [];
      }
    }

    function eventTitle(action) {
      const values = {
        created: t("Создано", "Created"),
        deadline: t("Срок изменён", "Deadline changed"),
        finished: t("Маршрут завершён", "Plan complete"),
        resumed: t("Маршрут открыт", "Plan reopened"),
        start: t("Взято в работу", "Started"),
        done: t("Подтверждено", "Confirmed"),
        choose: t("Решение принято", "Decision made"),
        reopen: t("Возвращено в работу", "Reopened"),
        delete: t("Удалено", "Deleted"),
      };
      return values[action] ?? t("Обновлено", "Updated");
    }

    function history(kind) {
      const entries = state.history.filter((entry) => entry.kind === kind);
      if (kind === "task") entries.push(...standalone());
      entries.sort((a, b) => b.at - a.at);
      if (!entries.length) return make("p", t("Записи появятся по мере работы.", "Your activity will appear here."), "muted");
      const list = make("ol", undefined, "activity-list");
      for (const entry of entries) {
        const item = make("li");
        const goal = state.goals.find((item) => item.id === entry.goalId);
        const when = language.formatDate(entry.at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const details = [eventTitle(entry.action), when];
        if (kind === "task") details.push(goal?.title ?? t("Список задач", "To-do list"));
        item.append(make("strong", entry.title), make("span", details.join(" · "), "muted"));
        list.append(item);
      }
      return list;
    }

    function render() {
      if (panel.hidden) return;
      for (const tab of modes.querySelectorAll("button")) {
        tab.setAttribute("aria-pressed", String(tab.dataset.portfolio === mode));
      }
      const content = {
        graph, table, goals: () => history("goal"), tasks: () => history("task"),
      };
      body.replaceChildren(content[mode]());
    }

    function close() {
      panel.hidden = true;
      opener.setAttribute("aria-expanded", "false");
    }

    opener.addEventListener("click", () => {
      if (!panel.hidden) {
        close();
        return;
      }
      panel.hidden = false;
      opener.setAttribute("aria-expanded", "true");
      render();
      document.getElementById("portfolio-heading").focus();
    });

    modes.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-portfolio]");
      if (!button) return;
      mode = button.dataset.portfolio;
      render();
    });

    body.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-goal-id]");
      if (!button) return;
      close();
      selectGoal(button.dataset.goalId);
    });

    window.addEventListener("storage", (event) => {
      if (event.key === standaloneKey && mode === "tasks") render();
    });

    return { render, close };
  };
})();
