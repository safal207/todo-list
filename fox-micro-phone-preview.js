(() => {
  "use strict";
  // The phone demo holds XP in memory only: no storage, account, or real reward.
  const demo = window.__sdelanoPhoneDemo;
  const game = window.sdelanoGame;
  const button = document.querySelector("#phone-qa-micro");
  const result = document.querySelector("#phone-qa-micro-result");
  if (!demo || !game || !button || !result) return;

  button.addEventListener("click", () => {
    if (button.disabled) return;
    const before = game.inspect();
    demo.wallet.xp += 5; // Confirmed focus reward is simulated only.
    const after = game.inspect();
    window.dispatchEvent(new Event("sdelano:game-changed"));
    window.dispatchEvent(new CustomEvent("sdelano:focus-earned", {
      detail: { xp: 5, energy: after.energy,
        levelUp: after.level > before.level ? after.level : 0 }
    }));
    button.disabled = true;
    result.textContent = "Фокус завершён (демо): +5 XP. Один короткий кивок, без звука, монет и повторяющихся анимаций.";
  });
})();
