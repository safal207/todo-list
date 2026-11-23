(() => {
  "use strict";
  // Cosmetic reaction after a new, verified reward; never modifies XP or tasks.
  const fox = document.querySelector(".mini-hero .fox-evolution-figure");
  const game = window.sdelanoGame;
  const evolution = window.sdelanoFoxEvolution;
  if (!fox || !game || !evolution) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const CLASS = "fox-microreaction--nod";
  let priorXp = game.inspect().xp;
  let stopTimer = null;
  function clear() {
    if (stopTimer !== null) clearTimeout(stopTimer);
    stopTimer = null;
    fox.classList.remove(CLASS);
  }
  function earned(event) {
    const xp = event.detail?.xp;
    if (!Number.isSafeInteger(xp) || xp <= 0) return;
    const wallet = game.inspect();
    if (!wallet.available) return;
    const actualDelta = wallet.xp - priorXp;
    priorXp = wallet.xp;
    if (actualDelta < xp || wallet.xp < xp) return;
    // v3.1 growth ceremony owns stage-unlock events; do not layer effects.
    if (evolution.stageForXp(wallet.xp - xp).id !== evolution.stageForXp(wallet.xp).id) return;
    if (document.hidden || reduced.matches || !fox.getClientRects().length) return;
    if (stopTimer !== null) return; // No interruptions or queued loops.
    fox.classList.add(CLASS);
    stopTimer = setTimeout(clear, 620);
  }
  window.addEventListener("sdelano:reward-earned", earned);
  window.addEventListener("sdelano:focus-earned", earned);
  window.addEventListener("storage", event => {
    if (event.key === game.key || event.key === null) {
      priorXp = game.inspect().xp;
      clear();
    }
  });
  window.addEventListener("pagehide", clear);
})();