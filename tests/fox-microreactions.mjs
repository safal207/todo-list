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
      viewport: { width, height: 844 }, reducedMotion: reduced ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
      });
      const fox = page.locator(".mini-hero .fox-evolution-figure");
      assert.equal(await fox.count(), 1);
      await page.waitForTimeout(800);
      assert.equal(await fox.evaluate(el => el.classList.contains("fox-microreaction--nod")),
        false, "No autonomous attention-seeking reaction");
      await page.locator("#task-title").fill("Завершить полезное дело");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 20);
      if (reduced) {
        assert.equal(await fox.evaluate(el => el.classList.contains("fox-microreaction--nod")),
          false, "Reduced motion disables reaction");
      } else {
        await page.waitForFunction(() => document.querySelector(
          ".mini-hero .fox-evolution-figure.fox-microreaction--nod"
        ), null, { timeout: 2000 });
        assert.match(await fox.evaluate(el => getComputedStyle(el).animationName),
          /sdelano-fox-micro-nod/);
      }
      assert.deepEqual(await page.evaluate(() => ({
        xp: window.sdelanoGame.inspect().xp, coins: window.sdelanoGame.inspect().coins,
        foxKeys: Object.keys(localStorage).filter(key => key.startsWith("sdelano.fox"))
      })), { xp: 20, coins: 10, foxKeys: [] });
      await page.waitForTimeout(800);
      assert.equal(await fox.evaluate(el => el.classList.contains("fox-microreaction--nod")), false);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("sdelano:reward-earned",
        { detail: { xp: 20, coins: 10, taskId: "replay" } })));
      assert.equal(await fox.evaluate(el => el.classList.contains("fox-microreaction--nod")),
        false, "Replayed event without a new grant must not animate");
      await page.screenshot({
        path: "artifacts/fox-microreactions-" + engine + "-" + width + ".png", fullPage: true
      });
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await fox.evaluate(el => el.classList.contains("fox-microreaction--nod")),
        false, "Reload must not animate");
      assert.deepEqual(errors, []);
      console.log("Fox earned-action microreaction QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }