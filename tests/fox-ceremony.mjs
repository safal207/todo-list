import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const base = "http://127.0.0.1:8765/";
mkdirSync("artifacts", { recursive: true });

function seededWallet(xp) {
  const grants = [];
  for (let n = 0, remaining = xp; remaining > 0; n++) {
    const amount = Math.min(100, remaining);
    grants.push({
      key: "task:ceremony-seed-" + n,
      xp: amount, coins: 10, day: "2020-01-01", at: Date.now()
    });
    remaining -= amount;
  }
  return { version: 1, grants, excludedIds: [] };
}

async function loadAt(page, xp) {
  await page.goto(base + "invite/", { waitUntil: "domcontentloaded" });
  await page.evaluate(wallet => {
    localStorage.clear();
    localStorage.setItem("sdelano.game.v1", JSON.stringify(wallet));
  }, seededWallet(xp));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
  await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
}

try {
  for (const width of [320, 390, 1280]) {
    const reducedMotion = width === 390;
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: reducedMotion ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await loadAt(page, 240);
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false,
        "Starting near an XP threshold must not play the ceremony");
      const initial = await page.evaluate(() => {
        window.__foxCeremonyCount = 0;
        window.addEventListener("sdelano:fox-evolved", () => window.__foxCeremonyCount++);
        return {
          stage: window.sdelanoFoxEvolution.stageForLevel(window.sdelanoGame.inspect().level).id,
          xp: window.sdelanoGame.inspect().xp
        };
      });
      assert.deepEqual(initial, { stage: "cub", xp: 240 });

      if (width === 320) {
        await page.locator("#feedback-toggle").click();
        assert.equal(await page.evaluate(() => window.taskFeedback.isEnabled()), false,
          "Celebration must respect an explicit sound-off preference");
      }

      await page.locator("#task-title").fill("Маленький реальный шаг");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 260);
      const earned = await page.evaluate(() => ({
        wallet: window.sdelanoGame.inspect(),
        eventCount: window.__foxCeremonyCount,
        stage: document.querySelector(".fox-evolution-figure").dataset.foxStage,
        bannerText: document.querySelector("#fox-evolution-notice").textContent,
        bannerStage: document.querySelector("#fox-evolution-notice").dataset.foxCeremonyStage,
        sparkCount: document.querySelectorAll(".fox-ceremony-sparks > span").length,
        overflow: document.documentElement.scrollWidth - innerWidth,
        hasFoxStorage: Object.keys(localStorage).some(key => key.startsWith("sdelano.fox"))
      }));
      assert.equal(earned.wallet.xp, 260);
      assert.equal(earned.wallet.coins, 40,
        "Celebration must not create or spend real coins");
      assert.equal(earned.stage, "student");
      assert.equal(earned.eventCount, 1, "A real level crossing announces exactly one evolution");
      assert.equal(earned.bannerStage, "student");
      assert.match(earned.bannerText, /Твой лисёнок вырос — Ученик!/);
      assert.match(earned.bannerText, /Открыта новая стадия · Уровень 3/);
      assert.equal(earned.hasFoxStorage, false, "No extra evolution wallet or state");
      assert.ok(earned.overflow <= 1, "No horizontal scroll at " + width);
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.equal(await page.locator("#fox-evolution-notice").getAttribute("aria-live"), "polite");
      assert.equal(await page.locator(".fox-ceremony-portrait").count(), 1);
      const paint = await page.locator(".fox-ceremony-portrait").evaluate(el =>
        getComputedStyle(el, "::before").backgroundPositionY);
      assert.ok(Math.abs(parseFloat(paint) - 33.3333) < 0.5,
        "Celebration portrait must use the newly unlocked artwork");
      if (reducedMotion) {
        assert.equal(earned.sparkCount, 0, "No star animation when reduced motion is on");
        assert.equal(await page.locator(".fox-evolution--grown").count(), 0);
        const animation = await page.locator(".fox-ceremony-portrait").evaluate(el =>
          getComputedStyle(el, "::before").animationName);
        assert.equal(animation, "none");
      } else {
        assert.equal(earned.sparkCount, 9, "Joy burst must have nine decoration-only stars");
        const animation = await page.locator(".fox-ceremony-portrait").evaluate(el =>
          getComputedStyle(el, "::before").animationName);
        assert.match(animation, /sdelano-fox-ceremony-paint/);
      }
      await page.screenshot({
        path: "artifacts/fox-ceremony-" + engine + "-" + width + ".png",
        fullPage: true
      });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("sdelano:reward-earned", {
        detail: { xp: 20, coins: 10, levelUp: 3 }
      })));
      assert.equal(await page.evaluate(() => window.__foxCeremonyCount), 1,
        "Duplicate event must not replay a stage-unlock ceremony");
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 260);

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false,
        "Reload must not replay the stage-unlock scene");
      assert.equal(await page.locator(".fox-ceremony-sparks").count(), 0);
      assert.equal(await page.locator("#game-shop-fox").getAttribute("data-fox-stage"), "student");
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 40);
      assert.deepEqual(errors, [], "Browser JS errors: " + errors.join(" | "));
      console.log("Fox stage ceremony QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
