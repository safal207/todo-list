import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts", { recursive: true });
const origin = "http://127.0.0.1:8765";

const stages = [
  ["student", "student", 240, 260, "Ученик"],
  ["hero", "hero", 990, 1010, "Герой"],
  ["master", "master", 2690, 2710, "Мастер"]
];

try {
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      for (const [choice, target, before, after, name] of stages) {
        await page.goto(origin + "/fox-phone-preview.html?stage=" + choice,
          { waitUntil: "networkidle" });
        await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
        assert.match(await page.title(), /проверка на телефоне/);
        assert.equal(await page.locator("#fox-evolution-notice").isVisible(), false);
        assert.equal(await page.locator("a[aria-current=page]").getAttribute("data-preview-stage"), choice);
        assert.equal(await page.locator("#phone-qa-complete").isEnabled(), true);
        assert.match(await page.locator(".phone-qa-sample-label").textContent(),
          /ожидает выполнения/, "An unfinished demo task must never look already completed");
        const info = await page.evaluate(() => ({
          xp: window.sdelanoGame.inspect().xp,
          coins: window.sdelanoGame.inspect().coins,
          storage: Object.keys(localStorage),
          forms: document.querySelectorAll('input[type="text"]').length,
          logins: document.querySelectorAll('input[type="password"]').length,
          stage: document.querySelector(".fox-evolution-figure").dataset.foxStage
        }));
        assert.equal(info.xp, before);
        assert.equal(info.coins, 0);
        assert.deepEqual(info.storage, [], "Demo must have no persistent state");
        assert.equal(info.forms, 0, "No real task input in demo");
        assert.equal(info.logins, 0, "No login input in demo");

        if (choice === "student") {
          await page.locator("#feedback-toggle").click();
          assert.equal(await page.locator("#feedback-toggle").getAttribute("aria-pressed"), "false");
        }
        await page.locator("#phone-qa-complete").click();
        await page.waitForFunction(xp => window.sdelanoGame.inspect().xp === xp, after);
        assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 10);
        assert.equal(await page.locator(".fox-evolution-figure").first().getAttribute("data-fox-stage"), target);
        assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
        assert.match(await page.locator("#fox-evolution-notice").textContent(),
          new RegExp("Твой лисёнок вырос — " + name));
        const remaining = await page.evaluate(() => ({
          out: document.documentElement.scrollWidth - innerWidth,
          storage: Object.keys(localStorage),
          particles: document.querySelectorAll(".fox-ceremony-sparks > span").length
        }));
        assert.ok(remaining.out <= 1, "Horizontal overflow on " + width + ": " + remaining.out);
        assert.deepEqual(remaining.storage, [], "Demo must not write a wallet or tasks");
        if (width === 390) assert.equal(remaining.particles, 0);
        else assert.equal(remaining.particles, 6, 'Stage reveal uses six gentle sparks');
        assert.equal(await page.locator("#phone-qa-complete").isDisabled(), true);
        assert.match(await page.locator(".phone-qa-sample-label").textContent(),
          /сделано!/, "Only an actual completion may mark the example task done");
        await page.waitForTimeout(width === 390 ? 100 : 1050);
        await page.screenshot({
          path: "artifacts/fox-phone-preview-" + engine + "-" + width + "-" + choice + ".png",
          fullPage: true
        });
      }
      await page.locator("#phone-qa-again").click();
      await page.waitForFunction(() => window.sdelanoGame?.inspect?.()?.coins === 0);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
      assert.deepEqual(errors, [], errors.join(" | "));
      console.log("Fox phone QA passed:", engine, width);
    } finally { await ctx.close(); }
  }

  // A blocked WebP request keeps the original fox usable.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.route("**/assets/fox-evolution-stages.webp", route => route.abort());
    await page.goto(origin + "/fox-phone-preview.html?stage=student",
      { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.dataset.foxArt === "fallback");
    assert.equal(await page.locator(".mini-hero .fox-evolution-core img")
      .evaluate(el => el.complete && el.naturalWidth > 0), true);
    await page.locator("#phone-qa-complete").click();
    assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
  } finally { await context.close(); }
} finally { await browser.close(); }
