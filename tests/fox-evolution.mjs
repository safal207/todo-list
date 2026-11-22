import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const url = "http://127.0.0.1:8765/";
mkdirSync("artifacts", { recursive: true });

function seedWallet(xp, cosmetics = false, resting = false) {
  const grants = [];
  for (let index = 0, left = xp; left > 0; index++) {
    const amount = Math.min(100, left);
    grants.push({
      key: "task:seed-" + index, xp: amount, coins: 10,
      day: "2020-01-01", at: Date.now()
    });
    left -= amount;
  }
  const wallet = { version: 1, grants, excludedIds: [] };
  if (cosmetics) {
    wallet.purchases = [
      { id: "scarf", coins: 50, at: Date.now() },
      { id: "glasses", coins: 100, at: Date.now() }
    ];
    wallet.equipped = { scarf: true, glasses: true, theme: "default", victory: "default" };
  }
  if (resting) wallet.energy = { value: 0, updatedAt: Date.now() };
  return wallet;
}
async function openWithWallet(page, xp, cosmetics = false, resting = false) {
  await page.goto(url + "invite/", { waitUntil: "domcontentloaded" });
  await page.evaluate(wallet => localStorage.setItem("sdelano.game.v1", JSON.stringify(wallet)),
    seedWallet(xp, cosmetics, resting));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
}

try {
  const stages = [
    { xp: 0, level: 1, id: "cub", name: "Малыш", next: 250 },
    { xp: 250, level: 3, id: "student", name: "Ученик", next: 750 },
    { xp: 1000, level: 6, id: "hero", name: "Герой", next: 1700 },
    { xp: 2700, level: 10, id: "master", name: "Мастер", next: null }
  ];
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      for (const stage of stages) {
        await openWithWallet(page, stage.xp, stage.id === "master", stage.id === "hero");
        const wallet = await page.evaluate(() => window.sdelanoGame.inspect());
        assert.equal(wallet.level, stage.level);
        assert.equal(wallet.xp, stage.xp);
        const computed = await page.evaluate(() => {
          const evolution = window.sdelanoFoxEvolution;
          return {
            stages: Array.from(document.querySelectorAll(".fox-evolution-figure"),
              el => el.dataset.foxStage),
            api: evolution?.stageForLevel(window.sdelanoGame.inspect().level).id,
            count: evolution?.stages.length,
            display: document.querySelector("#fox-evolution-stage").textContent,
            progressHidden: document.querySelector("#fox-evolution-progress").hidden,
            next: document.querySelector("#fox-evolution-next").textContent,
            mood: document.querySelector("#game-shop-fox").dataset.foxMood,
            compact: document.querySelector("#game-preview-toggle").getAttribute("aria-expanded"),
            overflow: document.documentElement.scrollWidth - innerWidth,
            hasUnknownStore: Object.keys(localStorage).some(key => key.startsWith("sdelano.fox"))
          };
        });
        assert.deepEqual(computed.stages, [stage.id, stage.id, stage.id],
          "All 3 mascots must use the same stage");
        assert.equal(computed.api, stage.id);
        assert.equal(computed.count, 4);
        assert.match(computed.display, new RegExp(stage.name + " · LVL " + stage.level));
        assert.equal(computed.progressHidden, stage.id === "master");
        assert.equal(computed.compact, "false", "Task list must remain primary");
        assert.ok(computed.overflow <= 1, "No horizontal scroll at " + width + "px");
        assert.equal(computed.hasUnknownStore, false, "Fox must not maintain a second wallet");
        assert.equal(computed.mood, stage.id === "hero" ? "resting" : "ready");
        assert.equal(await page.locator(".fox-evolution-milestone[aria-current=step]").count(), 1);
        assert.equal(await page.locator(".fox-evolution-notice:not([hidden])").count(), 0,
          "Reload and imported XP must never replay an evolution ceremony");
        if (stage.id === "master") {
          assert.match(computed.next, /Максимальная стадия/);
          assert.equal(wallet.purchases.length, 2, "Purchased cosmetics must survive growth");
          assert.equal(await page.locator("body").getAttribute("data-game-scarf"), "on");
          assert.equal(await page.locator("body").getAttribute("data-game-glasses"), "on");
          assert.equal(await page.locator("#game-shop-fox .game-fox-scarf").count(), 1);
          assert.equal(await page.locator("#game-shop-fox .game-fox-glasses").count(), 1);
        } else {
          assert.match(computed.next, new RegExp("ещё " + stage.next + " XP"));
        }
        await page.locator("#game-preview-toggle").click();
        assert.equal(await page.locator(".fox-evolution-card").isVisible(), true);
        await page.locator("#game-shop summary").click();
        await page.screenshot({
          path: "artifacts/fox-evolution-" + engine + "-" + width + "-" + stage.id + ".png",
          fullPage: true
        });
      }
      assert.deepEqual(errors, [], "No browser errors: " + errors.join(" | "));
    } finally { await context.close(); }
  }

  // Crossing the stage boundary with REAL task XP triggers one celebration.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await openWithWallet(page, 240);
    assert.equal(await page.locator("#game-shop-fox").getAttribute("data-fox-stage"), "cub");
    // XP 240 corresponds to level 2 (still a cub). Real award + daily bonus = +20 XP.
    await page.locator("#task-title").fill("Первая задача нового этапа");
    await page.locator("#task-title").press("Enter");
    await page.locator(".task-checkbox").first().check();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 260);
    assert.equal(await page.locator("#game-shop-fox").getAttribute("data-fox-stage"), "student");
    assert.match(await page.locator("#fox-evolution-notice").textContent(), /Твой лисёнок вырос.+Ученик/);
    assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
    const style = await page.locator(".fox-evolution--grown .fox-evolution-core").first().evaluate(el =>
      getComputedStyle(el).animationName);
    assert.equal(style, "none", "Reduced-motion users see stage change without growth animation");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#game-shop-fox").getAttribute("data-fox-stage"), "student");
    assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false,
      "Level-up banner must not reappear on refresh");
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 260);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log("Fox evolution QA passed:", engine);
} finally { await browser.close(); }
