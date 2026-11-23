(() => {
  "use strict";

  // Fox growth is a VIEW derived exclusively from the existing verified XP
  // ledger. It never writes to the wallet, purchases, tasks or cloud storage.
  const game = window.sdelanoGame;
  const portrait = document.querySelector("#fox-evolution-stage");
  const nextLabel = document.querySelector("#fox-evolution-next");
  const progress = document.querySelector("#fox-evolution-progress");
  const notice = document.querySelector("#fox-evolution-notice");
  const figures = [...document.querySelectorAll(".fox-evolution-figure")];
  const roadmap = [...document.querySelectorAll(".fox-evolution-milestone")];
  if (!game || !portrait || !nextLabel || !progress || !notice || !figures.length ||
      !game.threshold) return;

  const STAGES = Object.freeze([
    Object.freeze({ id: "cub", name: "Малыш", minLevel: 1 }),
    Object.freeze({ id: "student", name: "Ученик", minLevel: 3 }),
    Object.freeze({ id: "hero", name: "Герой", minLevel: 6 }),
    Object.freeze({ id: "master", name: "Мастер", minLevel: 10 })
  ]);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let timer = null;
  let currentStage = null;
  let lastCelebratedStage = 0;

  function stageForLevel(level) {
    const number = Number.isSafeInteger(level) && level >= 1 ? level : 1;
    let result = STAGES[0];
    for (const stage of STAGES) {
      if (number < stage.minLevel) break;
      result = stage;
    }
    return result;
  }

  function stageForXp(xp) {
    if (!Number.isSafeInteger(xp) || xp < 0) return STAGES[0];
    // Keep the same threshold formula and 100-level cap as game.js.
    let level = 1;
    while (level < 100 && xp >= game.threshold(level + 1)) level++;
    return stageForLevel(level);
  }

  function render() {
    const wallet = game.inspect();
    const stage = wallet.available ? stageForLevel(wallet.level) : STAGES[0];
    const index = STAGES.indexOf(stage);
    currentStage = stage;
    for (const figure of figures) {
      figure.dataset.foxStage = stage.id;
      figure.dataset.foxMood = wallet.available && wallet.energy === 0 ? "resting" : "ready";
    }
    portrait.textContent = stage.name + " · LVL " + (wallet.available ? wallet.level : "—");
    for (const milestone of roadmap) {
      const selected = milestone.dataset.stage === stage.id;
      milestone.dataset.current = String(selected);
      milestone.dataset.unlocked = String(STAGES.findIndex(x => x.id === milestone.dataset.stage) <= index);
      if (selected) milestone.setAttribute("aria-current", "step");
      else milestone.removeAttribute("aria-current");
    }
    if (!wallet.available) {
      nextLabel.textContent = "Рост временно недоступен: игровые награды не читаются.";
      progress.hidden = true;
      return;
    }
    const next = STAGES[index + 1];
    if (!next) {
      nextLabel.textContent = "Максимальная стадия открыта. Лисёнок продолжает получать XP.";
      progress.hidden = true;
    } else {
      const from = game.threshold(stage.minLevel);
      const to = game.threshold(next.minLevel);
      progress.hidden = false;
      progress.max = to - from;
      progress.value = Math.max(0, Math.min(to - from, wallet.xp - from));
      const left = Math.max(0, to - wallet.xp);
      nextLabel.textContent = "До «" + next.name + "» — ещё " + left + " XP";
      progress.setAttribute("aria-label", "Прогресс роста лисёнка до стадии " + next.name);
    }
  }

  function reward(event) {
    const earned = event.detail?.xp;
    if (!Number.isSafeInteger(earned) || earned <= 0) return;
    const wallet = game.inspect();
    if (!wallet.available || wallet.xp < earned) return;
    const previous = stageForXp(wallet.xp - earned);
    const after = stageForLevel(wallet.level);
    const nextIndex = STAGES.indexOf(after);
    if (nextIndex <= STAGES.indexOf(previous) || nextIndex <= lastCelebratedStage) return;
    // Browser-session-only guard: repeated delivery must never show a second
    // ceremony. Do not create a separate persisted growth wallet or streak.
    lastCelebratedStage = nextIndex;
    render();
    notice.hidden = false;
    notice.textContent = "Твой лисёнок вырос! Теперь он — " + after.name + ".";
    for (const figure of figures) figure.classList.remove("fox-evolution--grown");
    if (!reduced.matches && !document.hidden) {
      // Re-trigger the growth effect once, only for actual XP award events.
      void figures[0].offsetWidth;
      for (const figure of figures) figure.classList.add("fox-evolution--grown");
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      notice.hidden = true;
      for (const figure of figures) figure.classList.remove("fox-evolution--grown");
      timer = null;
    }, 2800);
    // Presentation-only signal, emitted solely for an actual newly earned
    // stage. Consumers must not mutate XP, tasks, purchases or wallet.
    window.dispatchEvent(new CustomEvent("sdelano:fox-evolved", {
      detail: { stage: after.id, name: after.name, level: wallet.level, from: previous.id }
    }));
  }

  window.addEventListener("sdelano:game-changed", render);
  window.addEventListener("sdelano:reward-earned", reward);
  window.addEventListener("sdelano:focus-earned", reward);
  window.addEventListener("storage", event => {
    if (event.key === game.key || event.key === null) render();
  });
  window.addEventListener("pagehide", () => {
    if (timer !== null) clearTimeout(timer);
  });
  render();

  window.sdelanoFoxEvolution = Object.freeze({
    stageForLevel,
    stageForXp,
    stages: STAGES
  });
})();
