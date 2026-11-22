(() => {
  "use strict";
  // Voluntary in-page review. Never submits, stores or transmits any feedback.
  const demo = window.__sdelanoPhoneDemo;
  const complete = document.querySelector("#phone-qa-complete");
  const panel = document.querySelector("#phone-qa-review");
  const copyButton = document.querySelector("#phone-review-copy");
  const note = document.querySelector("#phone-review-note");
  const status = document.querySelector("#phone-review-status");
  const output = document.querySelector("#phone-review-output");
  const outputLabel = document.querySelector("#phone-review-output-label");
  if (!demo || !complete || !panel || !copyButton || !note || !status ||
      !output || !outputLabel) return;

  const questions = Object.freeze([
    ["look", "Внешний вид и размер"],
    ["spark", "Золотая вспышка"],
    ["sound", "Звук"],
    ["joy", "Радость от превращения"],
    ["focus", "Не отвлекает от дел"]
  ]);
  const stageNames = Object.freeze({
    student: "Ученик", hero: "Герой", master: "Мастер"
  });

  function selected(name) {
    return panel.querySelector('input[name="review-' + name + '"]:checked')?.value || null;
  }
  function reviewReady() {
    return complete.disabled && questions.some(([key]) => selected(key) !== null);
  }
  function update() {
    copyButton.disabled = !reviewReady();
    if (copyButton.disabled) {
      status.textContent = complete.disabled ?
        "Поставь хотя бы одну оценку. Остальные вопросы можно пропустить." :
        "Сначала посмотри превращение и поставь хотя бы одну оценку.";
    } else {
      status.textContent = "Готово к копированию. Отзыв никуда не отправится автоматически.";
    }
    output.hidden = true;
    outputLabel.hidden = true;
  }

  function formatReview() {
    const lines = ["Fox Evolution v3 — отзыв о мобильном демо",
      "Открытая стадия: " + stageNames[demo.chosen]];
    for (const [key, label] of questions) {
      const score = selected(key);
      lines.push(label + ": " + (score ? score + "/5" : "не оценено"));
    }
    const comment = note.value.trim().replace(/\s+/g, " ");
    if (comment) lines.push("Что улучшить: " + comment);
    lines.push("Демонстрация. Результаты не сохранялись и не отправлялись автоматически.");
    return lines.join("\n");
  }

  panel.addEventListener("change", update);
  complete.addEventListener("click", update);
  note.addEventListener("input", () => {
    output.hidden = true;
    outputLabel.hidden = true;
  });

  copyButton.addEventListener("click", async () => {
    if (!reviewReady()) { update(); return; }
    const text = formatReview();
    output.value = text;
    // The manual fallback is immediately available even if the browser
    // leaves a clipboard permission prompt unanswered for a while.
    output.hidden = false;
    outputLabel.hidden = false;
    status.textContent = "Текст готов. Пробуем скопировать; при необходимости скопируй его ниже.";
    let timeoutId = null;
    try {
      if (navigator.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("clipboard-timeout")), 1400);
          })
        ]);
        output.hidden = true;
        outputLabel.hidden = true;
        status.textContent = "Отзыв скопирован. Вставь его в наш чат — автоматически ничего не отправлено.";
        return;
      }
    } catch { /* Clipboard may be denied or stalled. Manual text remains ready. */ }
    finally { if (timeoutId !== null) clearTimeout(timeoutId); }
    output.focus();
    output.select();
    status.textContent = "Доступ к буферу закрыт. Текст выделен ниже — скопируй вручную.";
  });

  function resetVoluntaryReview() {
    for (const radio of panel.querySelectorAll('input[type="radio"]')) radio.checked = false;
    note.value = "";
    output.value = "";
    output.hidden = true;
    outputLabel.hidden = true;
    panel.open = false;
    update();
  }
  // Firefox and other browsers may restore form values natively on reload
  // even without localStorage. Explicitly discard voluntary feedback on
  // both page exit and re-entry, including bfcache restoration.
  window.addEventListener("pagehide", resetVoluntaryReview);
  window.addEventListener("pageshow", resetVoluntaryReview);
  resetVoluntaryReview();
})();
