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
  const progress = document.querySelector("#phone-review-step");
  const prevButton = document.querySelector("#phone-review-prev");
  const nextButton = document.querySelector("#phone-review-next");
  const shareButton = document.querySelector("#phone-review-share");
  const finishBanner = document.querySelector("#phone-review-finish");
  const finishText = document.querySelector("#phone-review-finish-text");
  const editButton = document.querySelector("#phone-review-edit");
  const nav = document.querySelector(".phone-review-nav");
  const fields = [...panel.querySelectorAll(".phone-review-field")];
  if (!demo || !complete || !panel || !copyButton || !note || !status ||
      !output || !outputLabel || !progress || !prevButton || !nextButton ||
      !shareButton || !finishBanner || !finishText || !editButton || !nav ||
      fields.length !== 5) return;
  let activeQuestion = 0;
  let finished = false;
  shareButton.hidden = typeof navigator.share !== "function";
  function showQuestion() {
    fields.forEach((field, index) => {
      field.hidden = finished || index !== activeQuestion;
    });
    progress.textContent = "Вопрос " + (activeQuestion + 1) + " из " + fields.length;
    progress.hidden = finished;
    nav.hidden = finished;
    finishBanner.hidden = !finished;
    prevButton.hidden = activeQuestion === 0;
    nextButton.hidden = false;
    nextButton.textContent = activeQuestion === fields.length - 1
      ? "Завершить оценку" : "Следующий вопрос";
    if (finished) {
      const count = [...panel.querySelectorAll(".phone-review-field input:checked")].length;
      finishText.textContent = count > 0
        ? "Выставлено оценок: " + count + " из 5. Скопируй отзыв или выбери «Поделиться через телефон»."
        : "Оценок пока нет. Нажми «Изменить оценки», чтобы поставить хотя бы одну.";
    }
  }
  prevButton.addEventListener("click", () => {
    activeQuestion = Math.max(0, activeQuestion - 1);
    showQuestion();
  });
  nextButton.addEventListener("click", () => {
    if (activeQuestion === fields.length - 1) {
      finished = true;
      showQuestion();
      update();
      finishBanner.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
      return;
    }
    activeQuestion = Math.min(fields.length - 1, activeQuestion + 1);
    showQuestion();
  });
  editButton.addEventListener("click", () => {
    finished = false;
    activeQuestion = 0;
    showQuestion();
    update();
  });

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
    // Ratings can be copied even when the demo was already watched on
    // another device or page. Mark an unplayed demo explicitly in the text.
    return questions.some(([key]) => selected(key) !== null);
  }
  function update() {
    copyButton.disabled = !reviewReady();
    shareButton.disabled = !reviewReady();
    if (copyButton.disabled) {
      status.textContent = "Поставь хотя бы одну оценку, чтобы скопировать отзыв.";
    } else if (!complete.disabled) {
      status.textContent = "Оценки готовы. Превращение в этой вкладке ещё не запускалось — можешь посмотреть его или сразу скопировать отзыв.";
    } else {
      status.textContent = "Готово к копированию. Отзыв никуда не отправится автоматически.";
    }
    output.hidden = true;
    outputLabel.hidden = true;
  }

  function formatReview() {
    const lines = ["Fox Evolution v3 — отзыв о мобильном демо",
      "Открытая стадия: " + stageNames[demo.chosen],
      "Просмотр в этой вкладке: " + (complete.disabled ? "да" : "не запускался")];
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

  shareButton.addEventListener("click", async () => {
    if (!reviewReady() || typeof navigator.share !== "function") return;
    try {
      // Native share sheet only from an explicit user gesture. No default
      // recipient or automatic post: the user chooses the destination.
      await navigator.share({ title: "Сделано · Fox Evolution", text: formatReview() });
      status.textContent = "Меню телефона закрыто. Отправка зависит только от твоего выбора.";
    } catch (error) {
      status.textContent = error?.name === "AbortError"
        ? "Поделиться отменено. Отзыв не отправлен автоматически."
        : "Не удалось открыть меню. Используй «Скопировать отзыв».";
    }
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
    activeQuestion = 0;
    finished = false;
    showQuestion();
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
