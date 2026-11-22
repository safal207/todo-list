(() => {
  "use strict";

  const game = window.sdelanoGame;
  const shop = document.querySelector("#game-shop");
  const balance = document.querySelector("#game-shop-balance");
  const message = document.querySelector("#game-shop-message");
  const cards = [...document.querySelectorAll(".game-shop-card[data-item]")];
  if (!game || !shop || !balance || !message || cards.length !== 4) return;
  let busy = false;
  let burstTimer = null;

  const owned = (data, id) => data.purchases.includes(id);
  const equipped = (data, id) => {
    const eq = data.equipped;
    if (id === "scarf" || id === "glasses") return Boolean(eq[id]);
    if (id === "cosmic") return eq.theme === "cosmic";
    if (id === "sparkle") return eq.victory === "sparkle";
    return false;
  };

  function applyAppearance(data) {
    const body = document.body;
    body.dataset.gameScarf = data.available && data.equipped.scarf ? "on" : "off";
    body.dataset.gameGlasses = data.available && data.equipped.glasses ? "on" : "off";
    body.dataset.gameTheme = data.available ? data.equipped.theme : "default";
    body.dataset.gameVictory = data.available ? data.equipped.victory : "default";
  }

  function refresh() {
    const data = game.inspect();
    applyAppearance(data);
    balance.textContent = data.available ? data.coins + " монет" : "Недоступно";
    for (const card of cards) {
      const id = card.dataset.item;
      const item = game.catalog.find(x => x.id === id);
      const button = card.querySelector(".game-shop-action");
      const note = card.querySelector(".game-shop-card-status");
      if (!item || !button || !note) continue;
      const has = owned(data, id);
      const active = equipped(data, id);
      card.dataset.owned = String(has);
      card.dataset.equipped = String(active);
      if (!data.available) {
        button.disabled = true;
        button.textContent = "Недоступно";
        note.textContent = "Проверь сохранение наград";
      } else if (has) {
        button.disabled = busy;
        button.textContent = active ? "Снять" : "Применить";
        note.textContent = active ? "Сейчас используется" : "Уже в коллекции";
      } else {
        const short = Math.max(0, item.price - data.coins);
        button.disabled = busy || short > 0;
        button.textContent = short ? "Нужно ещё " + short : "Купить · " + item.price;
        note.textContent = "Цена: " + item.price + " монет";
      }
    }
    if (!data.available) message.textContent = "Магазин недоступен: " + data.error;
  }

  shop.addEventListener("click", async event => {
    const button = event.target.closest(".game-shop-action");
    if (!button || busy || button.disabled || !shop.contains(button)) return;
    const id = button.closest(".game-shop-card")?.dataset.item;
    if (!game.catalog.some(item => item.id === id)) return;
    const data = game.inspect();
    if (!data.available) return;
    busy = true;
    refresh();
    try {
      const result = owned(data, id) ?
        await game.equipItem(id, !equipped(data, id)) :
        await game.buyItem(id);
      if (result.success) {
        const item = game.catalog.find(entry => entry.id === id);
        message.textContent = result.coins ?
          "Куплено: " + item.name + " за " + result.coins + " монет. Добавлено в коллекцию!" :
          (result.equipped ? "Применено: " : "Снято: ") + item.name + ".";
        window.taskFeedback?.play(result.coins ? "reward" : "tap");
      } else {
        const errors = {
          "already-owned": "Этот предмет уже куплен.",
          "insufficient": "Не хватает монет. Выполняй задачи, чтобы накопить.",
          "not-owned": "Сначала купи этот предмет.",
          "storage-error": "Покупка не сохранена. Проверь место в браузере.",
          "lock-error": "Не получилось завершить операцию. Повтори попытку."
        };
        message.textContent = errors[result.reason] || "Операция не выполнена.";
      }
    } catch {
      message.textContent = "Не получилось обновить коллекцию.";
    } finally {
      busy = false;
      refresh();
    }
  });

  function sparkle() {
    if (document.body.dataset.gameVictory !== "sparkle" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = document.querySelector(".mini-hero");
    if (!host) return;
    host.querySelector(".game-victory-burst")?.remove();
    if (burstTimer !== null) clearTimeout(burstTimer);
    const burst = document.createElement("div");
    burst.className = "game-victory-burst";
    burst.setAttribute("aria-hidden", "true");
    for (let n = 0; n < 8; n++) {
      const star = document.createElement("span");
      star.textContent = n % 2 ? "✧" : "✦";
      star.style.left = (17 + n * 10) + "%";
      star.style.animationDelay = (n * 50) + "ms";
      burst.append(star);
    }
    host.append(burst);
    burstTimer = setTimeout(() => {
      burst.remove();
      burstTimer = null;
    }, 1500);
  }

  window.addEventListener("sdelano:game-changed", refresh);
  window.addEventListener("sdelano:reward-earned", sparkle);
  window.addEventListener("sdelano:focus-earned", sparkle);
  window.addEventListener("storage", event => {
    if (event.key === game.key || event.key === null) refresh();
  });
  refresh();
})();
