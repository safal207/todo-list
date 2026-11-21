"use strict";

(() => {
  const storageKey = "sdelano.pilot.results.v1";
  const codes = Array.from({ length: 10 }, (_, n) => "T" + String(n + 1).padStart(2, "0"));
  const header = "Тест «Сделано» / анонимный результат";
  const fields = [
    ["Код", "code"],
    ["Новый пользователь", "newUser"],
    ["Создал задачу", "created"],
    ["Завершил задачу", "completed"],
    ["Вернулся на следующий календарный день", "d1"]
  ];
  const input = document.querySelector("#reports-input");
  const feedback = document.querySelector("#import-feedback");
  const participants = document.querySelector("#participants");
  let reports = {};

  function parseReport(raw) {
    const lines = raw.trim().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== header) throw new Error("Не найден заголовок отчёта «Сделано».");
    const data = {};
    for (const [label, key] of fields) {
      const prefix = label + ":";
      const matches = lines.filter(line => line.startsWith(prefix));
      if (matches.length !== 1) throw new Error("Поле «" + label + "» отсутствует или повторяется.");
      data[key] = matches[0].slice(prefix.length).trim();
    }
    if (!codes.includes(data.code)) throw new Error("Неизвестный код " + data.code + ". Допустимы T01–T10.");
    for (const key of ["newUser", "created", "completed"]) {
      if (!["да", "нет"].includes(data[key])) throw new Error("Неожиданное значение в отчёте " + data.code + ".");
      data[key] = data[key] === "да";
    }
    if (!["да", "нет", "проверим завтра"].includes(data.d1)) {
      throw new Error("Некорректный D1 в отчёте " + data.code + ".");
    }
    if (data.completed && !data.created) {
      throw new Error("Отчёт " + data.code + ": выполненная задача без создания. Проверь исходный текст.");
    }
    const commentLines = lines.filter(line => line.startsWith("Комментарий (добровольно):"));
    if (commentLines.length > 1) throw new Error("Повторяется комментарий " + data.code + ".");
    const comment = commentLines.length ? commentLines[0].slice("Комментарий (добровольно):".length).trim() : "";
    data.comment = comment === "нет" ? "" : comment.slice(0, 500);
    return data;
  }

  function parseMany(raw) {
    const chunks = raw.trim().split(/(?=^Тест «Сделано» \/ анонимный результат\s*$)/gm).filter(x => x.trim());
    if (!chunks.length || chunks.length > 10) throw new Error("Вставь от 1 до 10 отчётов.");
    return chunks.map(parseReport);
  }

  function validStored(row, code) {
    return row && row.code === code && typeof row.newUser === "boolean" &&
      typeof row.created === "boolean" && typeof row.completed === "boolean" &&
      !(row.completed && !row.created) && ["да", "нет", "проверим завтра"].includes(row.d1) &&
      typeof row.comment === "string";
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      for (const code of codes) {
        if (validStored(data[code], code)) reports[code] = { ...data[code], comment: data[code].comment.slice(0, 500) };
      }
    } catch {
      feedback.textContent = "Ранее сохранённые данные не прочитаны. Они не были удалены.";
      feedback.classList.add("error");
    }
  }

  function percent(success, total) {
    return total ? Math.round(success * 100 / total) + "%" : "—";
  }

  function render() {
    const rows = codes.map(code => reports[code]).filter(Boolean);
    const fresh = rows.filter(row => row.newUser);
    const resolvedD1 = fresh.filter(row => row.d1 !== "проверим завтра");
    document.querySelector("#reports-count").textContent = rows.length + "/10";
    document.querySelector("#created-rate").textContent = percent(fresh.filter(row => row.created).length, fresh.length);
    document.querySelector("#completed-rate").textContent = percent(fresh.filter(row => row.completed).length, fresh.length);
    document.querySelector("#d1-rate").textContent = percent(resolvedD1.filter(row => row.d1 === "да").length, resolvedD1.length);
    document.querySelector("#created-denominator").textContent = fresh.filter(row => row.created).length + " из " + fresh.length + " новых с отчётом";
    document.querySelector("#completed-denominator").textContent = fresh.filter(row => row.completed).length + " из " + fresh.length + " новых с отчётом";
    document.querySelector("#d1-denominator").textContent = resolvedD1.filter(row => row.d1 === "да").length + " из " + resolvedD1.length + " новых с известным D1";
    const pending = fresh.length - resolvedD1.length;
    document.querySelector("#quality-note").textContent = rows.length
      ? "Нет отчётов: " + (10 - rows.length) + ". Повторно участвовали: " + (rows.length - fresh.length) +
        ". D1 ещё ожидается: " + pending + "."
      : "Пока нет данных. Пригласи добровольцев и добавь их отчёты.";
    participants.replaceChildren();
    for (const code of codes) {
      const li = document.createElement("li");
      li.className = "person";
      const name = document.createElement("strong");
      name.textContent = code;
      li.append(name);
      const row = reports[code];
      if (!row) {
        const status = document.createElement("span");
        status.className = "pending";
        status.textContent = "Ожидается отчёт";
        li.append(status);
      } else {
        const state = document.createElement("span");
        state.textContent = row.newUser ? "Новый участник" : "Пользовался ранее (вне конверсии)";
        const created = document.createElement("span");
        created.textContent = "Задача: " + (row.created ? "создана" : "не создана") +
          " · " + (row.completed ? "выполнена" : "не выполнена");
        const d1 = document.createElement("span");
        d1.textContent = "D1: " + row.d1;
        li.append(state, created, d1);
        if (row.comment) {
          const comment = document.createElement("small");
          comment.textContent = "Отзыв: " + row.comment;
          li.append(comment);
        }
      }
      participants.append(li);
    }
  }

  function say(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle("error", error);
  }

  document.querySelector("#import-reports").addEventListener("click", () => {
    let batch;
    try {
      batch = parseMany(input.value);
    } catch (error) {
      say(error.message, true);
      return;
    }
    const next = { ...reports };
    let added = 0;
    let updated = 0;
    for (const row of batch) {
      if (next[row.code]) updated += 1;
      else added += 1;
      next[row.code] = row;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      say("Не удалось сохранить отчёты в браузере. Данные не изменены.", true);
      return;
    }
    reports = next;
    input.value = "";
    say("Добавлено: " + added + ". Обновлено: " + updated + ". Сохранено только на этом устройстве.");
    render();
  });

  document.querySelector("#copy-results").addEventListener("click", async () => {
    const rows = codes.map(code => reports[code]).filter(Boolean);
    const fresh = rows.filter(row => row.newUser);
    const known = fresh.filter(row => row.d1 !== "проверим завтра");
    const report = [
      "Сделано — исследование 10 участников (отчёты присланы добровольно)",
      "Отчётов: " + rows.length + "/10; новых: " + fresh.length,
      "Создали задачу: " + fresh.filter(row => row.created).length + "/" + fresh.length,
      "Завершили задачу: " + fresh.filter(row => row.completed).length + "/" + fresh.length,
      "D1 возврат: " + known.filter(row => row.d1 === "да").length + "/" + known.length +
        "; ожидают уточнения: " + (fresh.length - known.length),
      "Отсутствующие отчёты не учитывались как неуспех.",
      "Результаты не являются статистически значимыми."
    ].join("\n");
    const output = document.querySelector("#results-export");
    const label = document.querySelector("#export-label");
    output.value = report;
    try {
      await navigator.clipboard.writeText(report);
      label.hidden = true;
      output.hidden = true;
      say("Сводка скопирована. Можно вставить в сообщение.");
    } catch {
      label.hidden = false;
      output.hidden = false;
      output.focus();
      output.select();
      say("Скопируй сводку вручную из поля ниже.");
    }
  });

  document.querySelector("#clear-results").addEventListener("click", () => {
    if (!Object.keys(reports).length) return;
    if (!window.confirm("Удалить все локальные отчёты пилота? Действие нельзя отменить.")) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      say("Браузер не позволил очистить сохранённые отчёты.", true);
      return;
    }
    reports = {};
    render();
    say("Локальные отчёты очищены.");
  });

  load();
  render();
})();