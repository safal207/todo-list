(() => {
  "use strict";

  const databaseName = "sdelano-goal-proofs";
  const storeName = "images";
  const maxBytes = 5 * 1024 * 1024;
  const mimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

  function failure(code) {
    return Object.assign(new Error(code), { code });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(failure("unavailable"));
        return;
      }

      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onerror = () => reject(failure("unavailable"));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function withStore(mode, useStore) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = useStore(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(failure("unavailable"));
      });
    } catch {
      throw failure("unavailable");
    } finally {
      database.close();
    }
  }

  async function checkImage(file) {
    if (!(file instanceof Blob) || !mimeTypes.has(file.type)) throw failure("invalid-type");
    if (file.size > maxBytes) throw failure("too-large");

    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const startsWith = (signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
    const signatures = {
      "image/png": () => startsWith([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/jpeg": () => startsWith([255, 216, 255]),
      "image/webp": () => startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8),
    };
    if (!signatures[file.type]()) throw failure("invalid-image");

    const imageUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
    } catch {
      throw failure("invalid-image");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function saveProof(file) {
    await checkImage(file);
    const id = window.crypto.randomUUID?.() ?? Array.from(window.crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    const name = Array.from(file.name?.trim() || "proof").slice(0, 120).join("");
    const image = file.slice(0, file.size, file.type);
    await withStore("readwrite", (store) => store.add(image, id));
    return { id, name };
  }

  async function readProof(id) {
    return (await withStore("readonly", (store) => store.get(id))) ?? null;
  }

  async function discardProof(id) {
    await withStore("readwrite", (store) => store.delete(id));
  }

  function scoreFor(state) {
    const counts = { steps: 0, proofs: 0, routes: 0 };
    for (const goal of state.goals) {
      const plan = window.goalCore.getPlan(goal);
      const completed = plan.filter((step) => step.status === "done");
      counts.steps += completed.length;
      counts.proofs += completed.filter((step) => step.evidence || step.proof).length;
      if (plan.length > 0 && completed.length === plan.length) counts.routes += 1;
    }
    return { ...counts, points: counts.steps * 10 + counts.proofs * 5 + counts.routes * 20 };
  }

  function node(tag, className, value) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = value;
    return item;
  }

  function renderRewards(state, labels) {
    const panel = document.querySelector("#rewards-panel");
    if (!panel) return;

    const { lang, t } = labels;
    const score = scoreFor(state);
    const format = new Intl.NumberFormat(lang === "en" ? "en" : "ru");
    const ranks = [
      { min: 0, name: t("Старт", "Starting out") },
      { min: 30, name: t("Набираю темп", "Building momentum") },
      { min: 80, name: t("Держу курс", "On track") },
      { min: 160, name: t("На высоте", "At the summit") },
    ];
    const rankIndex = ranks.filter((rank) => score.points >= rank.min).length - 1;
    const rank = ranks[rankIndex];
    const next = ranks[rankIndex + 1];

    const heading = node("h2", "", t("Баллы и награды", "Points and rewards"));
    heading.id = "rewards-heading";
    const totals = node("div", "reward-score-line");
    totals.append(node("strong", "reward-score", format.format(score.points)), node("span", "", t("баллов", "points")));
    const rankLabel = node("p", "reward-rank", `${t("Ранг", "Rank")} · ${rank.name}`);
    const remaining = next
      ? t(`До следующего ранга · ${format.format(next.min - score.points)}`, `${format.format(next.min - score.points)} to the next rank`)
      : t("Высший ранг открыт", "Highest rank unlocked");
    const explanation = node("p", "reward-rule", t("Шаг +10 · Пруф +5 · Маршрут +20", "Step +10 · Proof +5 · Route +20"));

    const badges = node("ul", "reward-badges");
    const milestones = [
      [score.steps > 0, t("Первый шаг", "First step"), t("Подтвердите один шаг.", "Confirm one step.")],
      [score.proofs > 0, t("Есть пруф", "Proof collected"), t("Добавьте пруф к шагу.", "Add proof to a step.")],
      [score.routes > 0, t("Маршрут пройден", "Route complete"), t("Пройдите все шаги цели.", "Complete all steps of a goal.")],
    ];
    for (const [earned, title, hint] of milestones) {
      const badge = node("li", "reward-badge");
      badge.dataset.earned = String(earned);
      badge.append(node("strong", "", title), node("span", "", earned ? t("Получено", "Earned") : hint));
      badges.append(badge);
    }

    panel.setAttribute("aria-labelledby", heading.id);
    panel.dataset.score = String(score.points);
    panel.dataset.rank = String(rankIndex + 1);
    panel.replaceChildren(heading, totals, rankLabel, node("p", "muted reward-next", remaining), explanation, badges);
  }

  window.goalRewards = { saveProof, readProof, discardProof, renderRewards };
})();
