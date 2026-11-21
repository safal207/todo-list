"use strict";

const data = window.sdelanoAnalytics?.pilotSummary();
const absent = document.querySelector("#pilot-absent");
const content = document.querySelector("#pilot-content");
if (!data) {
  absent.hidden = false;
} else {
  content.hidden = false;
  const reportField = (id, label, value) => {
    document.querySelector(id).textContent = label + (value ? "да" : "нет");
  };
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
  const dayStarted = data.startedOn === today;
  const d1Status = data.returnedD1 ? "да" : dayStarted ? "проверим завтра" : "нет";
  document.querySelector("#pilot-code").textContent = data.code;
  reportField("#pilot-created", "Создал первое дело: ", data.created);
  reportField("#pilot-completed", "Выполнил первое дело: ", data.completed);
  document.querySelector("#pilot-returned").textContent = "Вернулся на следующий день: " + d1Status;
  document.querySelector("#pilot-eligibility").textContent = data.newUser
    ? "Новый пользователь для этого теста"
    : "Сервис уже использовался в этом браузере: результат не включать в расчёт активации новых пользователей";

  const exportField = document.querySelector("#pilot-export");
  const label = document.querySelector("#pilot-fallback-label");
  const feedback = document.querySelector("#pilot-feedback");
  document.querySelector("#pilot-copy").addEventListener("click", async () => {
    const comment = document.querySelector("#pilot-comment").value.trim();
    const report = [
      "Тест «Сделано» / анонимный результат",
      "Код: " + data.code,
      "Новый пользователь: " + (data.newUser ? "да" : "нет"),
      "Создал задачу: " + (data.created ? "да" : "нет"),
      "Завершил задачу: " + (data.completed ? "да" : "нет"),
      "Вернулся на следующий календарный день: " + d1Status,
      "Комментарий (добровольно): " + (comment || "нет")
    ].join("\n");
    exportField.value = report;
    try {
      await navigator.clipboard.writeText(report);
      feedback.textContent = "Отчёт скопирован. Отправь его исследователю.";
      exportField.hidden = true;
      label.hidden = true;
    } catch {
      exportField.hidden = false;
      label.hidden = false;
      exportField.focus();
      exportField.select();
      feedback.textContent = "Скопируй текст из поля ниже и отправь исследователю.";
    }
  });
}
