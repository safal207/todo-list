import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const url = "http://127.0.0.1:8765/fox-phone-preview.html?stage=student";
const selector = ".mini-hero .fox-evolution-figure.fox-microreaction--nod";

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
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
      assert.equal(await page.locator("#phone-qa-micro").isVisible(), true);
      assert.equal(await page.locator(selector).count(), 0,
        "No autonomous nod on page load");
      const initial = await page.evaluate(() => {
        const wallet = window.sdelanoGame.inspect();
        return [wallet.xp, wallet.coins, Object.keys(localStorage).length];
      });
      assert.deepEqual(initial, [240, 0, 0]);
      await page.evaluate(() => {
        // Spy on the existing feedback API, not AudioContext internals.
        window.__foxDemoPlayed = [];
        const play = window.taskFeedback.play;
        window.taskFeedback.play = function(kind) {
          window.__foxDemoPlayed.push(kind);
          return play.call(this, kind);
        };
      });
      await page.locator("#phone-qa-micro").click();
      assert.deepEqual(await page.evaluate(() => window.__foxDemoPlayed), ["xp"],
        "Exactly one existing earned-XP sound; no extra microreaction audio layer");
      assert.equal(await page.locator("#phone-qa-micro").isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => {
        const wallet = window.sdelanoGame.inspect();
        return [wallet.xp, wallet.coins, Object.keys(localStorage).length];
      }), [245, 0, 0]);
      assert.equal(await page.locator(selector).count(), reduced ? 0 : 1);
      if (!reduced) {
        assert.match(await page.locator(selector).evaluate(el =>
          getComputedStyle(el).animationName), /sdelano-fox-micro-nod/);
        assert.equal(await page.locator(selector).evaluate(el =>
          getComputedStyle(el).animationDuration), "0.6s");
      }
      await page.screenshot({ path: "artifacts/fox-micro-phone-nod-" +
        engine + "-" + width + ".png", fullPage: true });
      await page.waitForTimeout(730);
      assert.equal(await page.locator(selector).count(), 0,
        "A completed nod must not replay on its own");

      // A second demo run, with a stage unlock immediately after focus.
      await page.reload({ waitUntil: "networkidle" });
      const sequential = await page.evaluate(() => {
        const micro = document.querySelector("#phone-qa-micro");
        const complete = document.querySelector("#phone-qa-complete");
        micro.click();
        const nodBefore = Boolean(document.querySelector(
          ".mini-hero .fox-evolution-figure.fox-microreaction--nod"));
        complete.click();
        return {
          nodBefore, nodAfter: Boolean(document.querySelector(
            ".mini-hero .fox-evolution-figure.fox-microreaction--nod")),
          wallet: [window.sdelanoGame.inspect().xp, window.sdelanoGame.inspect().coins],
          stage: document.querySelector(".mini-hero .fox-evolution-figure").dataset.foxStage
        };
      });
      assert.equal(sequential.nodBefore, !reduced);
      assert.equal(sequential.nodAfter, false,
        "An immediately subsequent stage unlock cancels an active nod");
      assert.deepEqual(sequential.wallet, [265, 10]);
      assert.equal(sequential.stage, "student");
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.equal(await page.locator(".fox-ceremony-sparks > span").count(), reduced ? 0 : 6);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator(selector).count(), 0);
      assert.equal(await page.locator("#phone-qa-micro").isEnabled(), true);
      assert.deepEqual(errors, []);
      console.log("Fox microreaction phone demo QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
