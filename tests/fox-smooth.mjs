import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const base = "http://127.0.0.1:8765/fox-phone-preview.html?stage=master";
mkdirSync("artifacts", { recursive: true });

try {
  for (const width of [320, 390, 1280]) {
    const reduced = width === 390;
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: reduced ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", err => errors.push(err.message));
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
      await page.evaluate(() => {
        window.__smoothFoxSound = [];
        const originalPlay = window.taskFeedback.play;
        window.taskFeedback.play = kind => {
          window.__smoothFoxSound.push(kind);
          return originalPlay(kind);
        };
      });
      const before = await page.evaluate(() => window.sdelanoGame.inspect());
      assert.equal(before.xp, 2690);
      assert.equal(before.coins, 0);
      assert.equal(await page.locator(".mini-hero .fox-evolution-figure")
        .getAttribute("data-fox-stage"), "hero");

      await page.locator("#phone-qa-complete").click();
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 2710);
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 10);
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.equal(await page.locator(".mini-hero .fox-evolution-figure")
        .getAttribute("data-fox-stage"), "master");

      const sparkCount = await page.locator(".fox-ceremony-sparks > span").count();
      if (reduced) {
        assert.equal(sparkCount, 0, "Reduced motion should show the age without moving sparks");
        assert.equal(await page.locator(".fox-ceremony-previous").count(), 0);
      } else {
        assert.equal(sparkCount, 6, "The revised effect uses six restrained sparkles");
        const old = page.locator(".mini-hero .fox-ceremony-previous");
        assert.equal(await old.count(), 1, "Old hero image must fade into master");
        assert.equal(await old.getAttribute("data-from"), "hero");
        const motion = await old.evaluate(el => ({
          name: getComputedStyle(el).animationName,
          duration: getComputedStyle(el).animationDuration
        }));
        assert.match(motion.name, /sdelano-fox-ceremony-crossfade/);
        assert.ok(parseFloat(motion.duration) < 1, "Age change should finish smoothly in under one second");
      }

      await page.waitForFunction(() =>
        window.__smoothFoxSound?.includes("level"), null, { timeout: 3500 });
      const sounds = await page.evaluate(() => window.__smoothFoxSound);
      assert.deepEqual(sounds, ["complete", "level"],
        "Only task completion and one quieter level melody, not stacked coin and XP cues");
      await page.waitForTimeout(1150);
      assert.equal(await page.locator(".fox-ceremony-previous").count(), 0,
        "Old-age overlay must be removed after the crossfade");
      assert.equal(await page.locator(".fox-ceremony-sparks").count(), 0,
        "Sparkles must not persist over task content");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1,
        "No horizontal overflow on " + width);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [],
        "The demo must never persist wallet or feedback");
      await page.screenshot({
        path: "artifacts/fox-smooth-" + engine + "-" + width + "-master.png",
        fullPage: true
      });

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false,
        "Reload must never replay a stage unlock");
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 2690);
      assert.deepEqual(errors, [], "No browser errors: " + errors.join(" | "));
      console.log("Smooth Fox Master QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally { await browser.close(); }
