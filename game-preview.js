(() => {
  "use strict";

  // PR 1 is strictly visual: no task rewards, balances, or economy storage.
  const panel = document.querySelector("#game-preview");
  const toggle = document.querySelector("#game-preview-toggle");
  const details = document.querySelector("#game-preview-details");
  const tryButton = document.querySelector("#game-preview-try");
  const status = document.querySelector("#game-preview-feedback");
  if (!panel || !toggle || !details || !tryButton || !status) return;

  let animationTimer = null;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    details.hidden = !expanded;
    window.taskFeedback?.play("tap");
  });

  tryButton.addEventListener("click", () => {
    if (animationTimer !== null) clearTimeout(animationTimer);
    panel.classList.remove("game-preview--celebrate");
    // Re-trigger the CSS effect on consecutive explicit demo clicks.
    void panel.offsetWidth;
    panel.classList.add("game-preview--celebrate");
    status.textContent = "Демо: +5 монет и +10 XP. Твой настоящий баланс не изменился.";
    window.taskFeedback?.play("reward");
    animationTimer = setTimeout(() => {
      panel.classList.remove("game-preview--celebrate");
      animationTimer = null;
    }, 1300);
  });
})();
