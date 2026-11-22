(() => {
  "use strict";

  // A brief celebration of a REAL stage earned in fox-evolution.js.
  // Pure presentation: no writes to localStorage, tasks, grants or purchases.
  const banner = document.querySelector("#fox-evolution-notice");
  const hero = document.querySelector(".mini-hero");
  if (!banner || !hero || !window.sdelanoFoxEvolution) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const allowed = new Set(["student", "hero", "master"]);
  let burst = null;
  let burstTimer = null;
  let latestStage = null;

  function clearBurst() {
    if (burstTimer !== null) clearTimeout(burstTimer);
    burstTimer = null;
    burst?.remove();
    burst = null;
    hero.classList.remove("fox-ceremony--cheer");
  }

  function celebrate(event) {
    const { stage, name, level } = event.detail || {};
    if (!allowed.has(stage) || typeof name !== "string" ||
        !Number.isSafeInteger(level) || level < 3) return;
    const actual = window.sdelanoFoxEvolution.stageForLevel(
      window.sdelanoGame?.inspect().level
    );
    if (actual?.id !== stage || latestStage === stage) return;
    latestStage = stage;

    banner.dataset.foxCeremonyStage = stage;
    banner.classList.add("fox-ceremony-banner");
    const portrait = document.createElement("span");
    portrait.className = "fox-ceremony-portrait";
    portrait.setAttribute("aria-hidden", "true");
    const oldFox = document.createElement("img");
    oldFox.src = "assets/fox-mascot.webp";
    oldFox.alt = "";
    oldFox.width = 58;
    oldFox.height = 58;
    portrait.append(oldFox);

    const copy = document.createElement("span");
    copy.className = "fox-ceremony-copy";
    const title = document.createElement("strong");
    title.textContent = "Твой лисёнок вырос — " + name + "!";
    const subtitle = document.createElement("small");
    subtitle.textContent = "Открыта новая стадия · Уровень " + level;
    copy.append(title, subtitle);
    // Preserve existing role=status, aria-live=polite, and timer from v1.
    banner.replaceChildren(portrait, copy);

    clearBurst();
    if (reduced.matches || document.hidden) return;

    // A contained, non-interactive joy burst: never covers the task form.
    burst = document.createElement("span");
    burst.className = "fox-ceremony-sparks";
    burst.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 9; i++) {
      const sparkle = document.createElement("span");
      sparkle.textContent = i % 2 ? "✧" : "✦";
      sparkle.style.setProperty("--fox-spark-left", (14 + i * 9) + "%");
      sparkle.style.setProperty("--fox-spark-delay", (i * 47) + "ms");
      sparkle.style.setProperty("--fox-spark-drift", ((i % 2 ? -1 : 1) * (11 + i * 3)) + "px");
      burst.append(sparkle);
    }
    hero.append(burst);
    hero.classList.add("fox-ceremony--cheer");
    burstTimer = setTimeout(clearBurst, 1650);
  }

  window.addEventListener("sdelano:fox-evolved", celebrate);
  window.addEventListener("pagehide", clearBurst);
})();
