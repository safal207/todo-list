(() => {
  "use strict";
  // No storage or network calls. State lives only in the current page.
  const demo = window.__sdelanoPhoneDemo;
  const game = window.sdelanoGame;
  const complete = document.querySelector("#phone-qa-complete");
  const again = document.querySelector("#phone-qa-again");
  const result = document.querySelector("#phone-qa-result");
  const soundButton = document.querySelector("#feedback-toggle");
  if (!demo || !game || !complete || !again || !result || !soundButton) return;

  for (const link of document.querySelectorAll("[data-preview-stage]")) {
    if (link.dataset.previewStage === demo.chosen) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  soundButton.addEventListener("click", () => {
    const next = !window.taskFeedback.isEnabled();
    window.taskFeedback.setEnabled(next);
    soundButton.textContent = "Отклик: " + (next ? "вкл" : "выкл");
    soundButton.setAttribute("aria-pressed", String(next));
    if (next) window.taskFeedback.play("tap");
  });

  complete.addEventListener("click", () => {
    if (complete.disabled) return;
    const oldLevel = game.inspect().level;
    window.taskFeedback.play("complete");
    demo.wallet.xp += 20;
    demo.wallet.coins += 10;
    const newLevel = game.inspect().level;

    // These are exactly the existing visual listeners in the full app.
    // No real grant is created, committed or transmitted.
    window.dispatchEvent(new Event("sdelano:game-changed"));
    window.dispatchEvent(new CustomEvent("sdelano:reward-earned", {
      detail: { xp: 20, coins: 10, levelUp: newLevel > oldLevel ? newLevel : 0 }
    }));

    result.textContent = "Ура! В демо +20 XP и +10 монет. Рост: " +
      document.querySelector("#fox-evolution-stage")?.textContent + ".";
    document.querySelector("#phone-qa-sample .phone-qa-check").textContent = "✓";
    complete.disabled = true;
    complete.textContent = "Готово! Лисёнок вырос";
  });

  again.addEventListener("click", () => {
    // Full reload resets the in-memory stage guard, not a persisted wallet.
    location.reload();
  });
})();
