(() => {
  "use strict";

  // Purely visual effects. The game ledger is always the source of truth.
  // Never change localStorage, grant XP or spend energy from animation code.
  const panel = document.querySelector("#game-preview");
  const coin = document.querySelector("#game-coins");
  const xp = document.querySelector("#game-xp");
  const energy = document.querySelector("#game-energy");
  const demo = document.querySelector("#game-preview-try");
  const game = window.sdelanoGame;
  if (!panel || !coin || !xp || !energy || !game) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const layer = document.createElement("span");
  layer.className = "game-juice-layer";
  layer.setAttribute("aria-hidden", "true");
  panel.append(layer);

  let coinFrame = 0;
  let xpFrame = 0;
  let energyFrame = 0;
  let lastEnergy = null;
  let hasUserGesture = false;
  let fxTimeout = null;
  document.addEventListener("pointerdown", () => { hasUserGesture = true; }, { once: true, passive: true });
  document.addEventListener("keydown", () => { hasUserGesture = true; }, { once: true });

  const amount = (item) => item.querySelector(".game-resource-amount");
  const energyValue = () => {
    const number = Number.parseInt(amount(energy)?.textContent || "", 10);
    return Number.isFinite(number) ? number : null;
  };

  function animateCount(item, start, end, suffix, frameName) {
    const el = amount(item);
    if (!el) return;
    if (frameName === "coin") cancelAnimationFrame(coinFrame);
    else if (frameName === "xp") cancelAnimationFrame(xpFrame);
    else cancelAnimationFrame(energyFrame);

    // The final balance is read from sdelanoGame, not calculated from DOM.
    if (motion.matches || document.hidden || start === end) {
      el.textContent = end + suffix;
      return;
    }
    const duration = 480;
    let firstTime = null;
    const tick = time => {
      if (firstTime === null) firstTime = time;
      const t = Math.min(1, (time - firstTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const number = Math.round(start + (end - start) * ease);
      el.textContent = number + suffix;
      if (t < 1) {
        const id = requestAnimationFrame(tick);
        if (frameName === "coin") coinFrame = id;
        else if (frameName === "xp") xpFrame = id;
        else energyFrame = id;
      } else {
        el.textContent = end + suffix;
      }
    };
    const id = requestAnimationFrame(tick);
    if (frameName === "coin") coinFrame = id;
    else if (frameName === "xp") xpFrame = id;
    else energyFrame = id;
  }

  function resourcePosition(item) {
    const origin = panel.getBoundingClientRect();
    const icon = item.querySelector(".game-resource-icon")?.getBoundingClientRect();
    if (!icon) return null;
    return { x: icon.left + icon.width / 2 - origin.left,
      y: icon.top + icon.height / 2 - origin.top };
  }

  function makeParticle(kind, pos, index) {
    const piece = document.createElement("span");
    piece.className = "game-juice-particle game-juice-particle--" + kind;
    piece.style.left = pos.x + "px";
    piece.style.top = pos.y + "px";
    piece.style.setProperty("--juice-i", index);
    const arc = index - 1.5;
    piece.style.setProperty("--juice-x", (arc * (kind === "coin" ? 24 : 31)) + "px");
    piece.style.setProperty("--juice-y", (-18 - (index % 2) * 17) + "px");
    piece.style.animationDelay = (index * 50) + "ms";
    if (kind === "coin") {
      const graphic = coin.querySelector(".game-resource-icon svg")?.cloneNode(true);
      if (graphic) piece.append(graphic);
    } else {
      piece.textContent = index % 2 ? "✦" : "✧";
    }
    layer.append(piece);
  }

  function makeLabel(item, message, kind) {
    const pos = resourcePosition(item);
    if (!pos) return;
    const label = document.createElement("span");
    label.className = "game-juice-label game-juice-label--" + kind;
    label.style.left = pos.x + "px";
    label.style.top = pos.y + "px";
    label.textContent = message;
    layer.append(label);
  }

  function clearAfterAnimation() {
    if (fxTimeout !== null) clearTimeout(fxTimeout);
    fxTimeout = setTimeout(() => {
      layer.replaceChildren();
      fxTimeout = null;
    }, 1450);
  }

  function burst(kind, item, message) {
    if (motion.matches || document.hidden) return;
    const pos = resourcePosition(item);
    if (!pos) return;
    if (kind === "coin" || kind === "xp") {
      for (let i = 0; i < 4; i++) makeParticle(kind, pos, i);
    }
    if (message) makeLabel(item, message, kind);
    item.classList.remove("game-resource--pop");
    void item.offsetWidth;
    item.classList.add("game-resource--pop");
    clearAfterAnimation();
  }

  function celebrate(coinsEarned, xpEarned, levelUp, isDemo = false) {
    const current = game.inspect();
    if (!current.available) return;
    layer.replaceChildren();
    if (!isDemo && coinsEarned > 0) {
      animateCount(coin, Math.max(0, current.coins - coinsEarned), current.coins, "", "coin");
    }
    if (!isDemo && xpEarned > 0) {
      animateCount(xp, Math.max(0, current.xp - xpEarned), current.xp, " XP", "xp");
    }
    if (coinsEarned > 0) burst("coin", coin, "+" + coinsEarned + " монет");
    if (xpEarned > 0) burst("xp", xp, "+" + xpEarned + " XP");
    if (levelUp && !motion.matches) {
      panel.classList.add("game-juice--level-up");
      setTimeout(() => panel.classList.remove("game-juice--level-up"), 900);
    }
  }

  window.addEventListener("sdelano:reward-earned", event => {
    const detail = event.detail || {};
    celebrate(detail.coins || 0, detail.xp || 0, detail.levelUp || 0);
  });
  window.addEventListener("sdelano:focus-earned", event => {
    const detail = event.detail || {};
    celebrate(0, detail.xp || 0, detail.levelUp || 0);
  });
  demo?.addEventListener("click", () => celebrate(5, 10, 0, true));

  // Recharge is detected from real energy counter updates, not timers we own.
  // No unsolicited sound on initial load or when the tab becomes visible.
  const observer = new MutationObserver(() => {
    const next = energyValue();
    if (next === null) return;
    if (lastEnergy !== null && next > lastEnergy && !document.hidden) {
      burst("energy", energy, "+" + (next - lastEnergy) + " заряд");
      if (hasUserGesture) window.taskFeedback?.play("energy");
    }
    lastEnergy = next;
  });
  observer.observe(amount(energy), { childList: true, characterData: true, subtree: true });
  lastEnergy = energyValue();
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    cancelAnimationFrame(coinFrame);
    cancelAnimationFrame(xpFrame);
    cancelAnimationFrame(energyFrame);
    if (fxTimeout !== null) clearTimeout(fxTimeout);
  });
})();
