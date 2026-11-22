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

  // Opt-in qualitative scores are private to this browser until copied by the
  // participant. Do not include task titles, wallet identifiers or usernames.
  const ratingsKey = "sdelano.pilot.ratings.v1";
  const easeField = document.querySelector("#pilot-ease");
  const delightField = document.querySelector("#pilot-delight");
  document.querySelector("#pilot-delight-question").hidden = !data.completed;
  const validRating = value => Number.isSafeInteger(value) && value >= 1 && value <= 5 ? value : null;
  let ratings = { code: data.code, ease: null, delight: null };
  try {
    const stored = JSON.parse(localStorage.getItem(ratingsKey) || "null");
    if (stored?.code === data.code) {
      ratings = {
        code: data.code, ease: validRating(stored.ease),
        delight: validRating(stored.delight)
      };
    }
  } catch { /* Optional feedback must not block the task report. */ }
  easeField.value = ratings.ease === null ? "" : String(ratings.ease);
  delightField.value = ratings.delight === null ? "" : String(ratings.delight);
  function saveRatings() {
    ratings = {
      code: data.code,
      ease: validRating(Number(easeField.value)) || null,
      delight: data.completed ? (validRating(Number(delightField.value)) || null) : null
    };
    try { localStorage.setItem(ratingsKey, JSON.stringify(ratings)); }
    catch { /* Controls still hold the choices for this session. */ }
  }
  easeField.addEventListener("change", saveRatings);
  delightField.addEventListener("change", saveRatings);
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
      "Лёгкость начала (1–5): " + (ratings.ease ?? "—"),
      "Приятность награды (1–5): " + (data.completed ? (ratings.delight ?? "—") : "—"),
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
