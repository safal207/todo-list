(() => {
  "use strict";

  const panel = document.querySelector("#game-preview");
  const toggle = document.querySelector("#game-preview-toggle");
  const details = document.querySelector("#game-preview-details");
  const tryButton = document.querySelector("#game-preview-try");
  const status = document.querySelector("#game-preview-feedback");
  const coins = document.querySelector("#game-coins");
  const xp = document.querySelector("#game-xp");
  const levelChip = document.querySelector("#game-level-chip");
  const levelLabel = document.querySelector("#game-level-label");
  const levelCounter = document.querySelector("#game-level-counter");
  const levelProgress = document.querySelector("#game-level-progress");
  const game = window.sdelanoGame;
  if (!panel || !toggle || !details || !tryButton || !status || !game || !coins || !xp) return;

  let animationTimer = null;
  let rewardTimer = null;

  function refresh() {
    const data = game.inspect();
    coins.querySelector(".game-resource-amount").textContent = String(data.coins);
    coins.setAttribute("aria-label", "Монеты: " + data.coins);
    xp.querySelector(".game-resource-amount").textContent = data.xp + " XP";
    xp.setAttribute("aria-label", "Опыт: " + data.xp + " XP");
    levelChip.textContent = String(data.level);
    levelLabel.textContent = "Уровень " + data.level;
    const current = data.xp - data.levelStart;
    const required = data.levelEnd - data.levelStart;
    levelCounter.textContent = current + " / " + required + " XP";
    levelProgress.max = required;
    levelProgress.value = current;
    panel.classList.toggle("game-preview--unavailable", !data.available);
    if (!data.available) {
      status.textContent = "Награды недоступны: " + data.error;
      tryButton.disabled = true;
    } else {
      tryButton.disabled = false;
    }
  }

  function celebrate() {
    if (animationTimer !== null) clearTimeout(animationTimer);
    panel.classList.remove("game-preview--celebrate");
    void panel.offsetWidth;
    panel.classList.add("game-preview--celebrate");
    animationTimer = setTimeout(() => {
      panel.classList.remove("game-preview--celebrate");
      animationTimer = null;
    }, 1300);
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    details.hidden = !expanded;
    window.taskFeedback?.play("tap");
  });

  tryButton.addEventListener("click", () => {
    celebrate();
    status.textContent = "Только звук и анимация — баланс не изменён.";
    window.taskFeedback?.play("reward");
  });

  window.addEventListener("sdelano:reward-earned", event => {
    const { xp: gainedXP, coins: gainedCoins } = event.detail;
    refresh();
    celebrate();
    status.textContent = "Получено +" + gainedXP + " XP и +" + gainedCoins + " монет!";
    // The existing task-complete sound plays first.
    if (rewardTimer !== null) clearTimeout(rewardTimer);
    rewardTimer = setTimeout(() => {
      window.taskFeedback?.play("coins");
      rewardTimer = null;
    }, 250);
  });
  window.addEventListener("sdelano:game-error", event => {
    panel.classList.add("game-preview--unavailable");
    status.textContent = "Награды недоступны: " + event.detail.message;
  });
  window.addEventListener("sdelano:game-changed", refresh);
  window.addEventListener("storage", event => {
    if (event.key === game.key || event.key === null) refresh();
  });
  refresh();
})();
