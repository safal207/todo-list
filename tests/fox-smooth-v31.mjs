import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts", { recursive: true });

try {
  for (const width of [320, 390, 1280]) {
    const reduced = width === 390;
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: reduced ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto("http://127.0.0.1:8765/fox-phone-preview.html?stage=master", {
        waitUntil: "networkidle"
      });
      await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
      await page.evaluate(() => {
        window.__foxSounds = [];
        const play = window.taskFeedback.play;
        window.taskFeedback.play = function (kind) {
          window.__foxSounds.push(kind);
          return play.call(this, kind);
        };
      });
      await page.locator("#phone-qa-complete").click();
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 2710);
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.equal(await page.locator(".mini-hero .fox-evolution-figure").getAttribute("data-fox-stage"), "master");
      assert.equal(await page.locator("#fox-evolution-notice").getAttribute("data-fox-ceremony-stage"), "master");

      if (reduced) {
        assert.equal(await page.locator(".fox-ceremony-previous").count(), 0);
        assert.equal(await page.locator(".fox-ceremony-sparks > span").count(), 0);
        const animation = await page.locator(".fox-ceremony-portrait").evaluate(el =>
          getComputedStyle(el, "::before").animationName);
        assert.equal(animation, "none");
      } else {
        assert.equal(await page.locator(".fox-ceremony-previous[data-from=hero]").count(), 1,
          "Master must cross-fade from previous Hero painting");
        assert.equal(await page.locator(".fox-ceremony-sparks > span").count(), 6);
        const duration = await page.locator(".fox-ceremony-portrait").evaluate(el =>
          getComputedStyle(el, "::before").animationDuration);
        assert.ok(parseFloat(duration) <= .85, "Transition should be brief: " + duration);
        const glow = await page.locator(".mini-hero .fox-evolution-halo").evaluate(el =>
          getComputedStyle(el).animationName);
        assert.match(glow, /sdelano-fox-gold-pulse/,
          "Keep the golden glow that the reviewer loved");
      }

      await page.waitForFunction(() =>
        window.__foxSounds.includes("level"), null, { timeout: 2000 });
      assert.deepEqual(await page.evaluate(() => window.__foxSounds),
        ["complete", "level"], "Age unlock must not stack coin and XP melodies");
      assert.deepEqual(await page.evaluate(() => ({
        xp: window.sdelanoGame.inspect().xp,
        coins: window.sdelanoGame.inspect().coins,
        storage: Object.keys(localStorage)
      })), { xp: 2710, coins: 10, storage: [] });

      await page.waitForTimeout(1150);
      assert.equal(await page.locator(".fox-ceremony-previous").count(), 0);
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
      await page.screenshot({
        path: "artifacts/fox-smooth-v31-" + engine + "-" + width + ".png",
        fullPage: true
      });
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false,
        "Reload must never repeat an already earned stage");
      assert.deepEqual(errors, []);
      console.log("Fox natural movement QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
