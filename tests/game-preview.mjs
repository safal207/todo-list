import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browserType = { chromium, firefox, webkit }[engine];
const browser = await browserType.launch({ headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE });

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, reducedMotion: width === 390 ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
      });

      const panel = page.locator("#game-preview");
      assert.equal(await panel.isVisible(), true, "Resource preview must be visible");
      assert.equal(await page.locator("#game-preview-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#game-preview-details").isVisible(), false);
      assert.deepEqual(await panel.locator(".game-resource-amount").allTextContents(), ["0", "0 XP", "5/5"]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, "Resource bar must not cause horizontal overflow at " + width + "px");

      await page.locator("#game-preview-toggle").click();
      assert.equal(await page.locator("#game-preview-toggle").getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#game-preview-details").isVisible(), true);

      await page.evaluate(() => {
        window.__gameSounds = [];
        const original = window.taskFeedback.play;
        window.taskFeedback.play = kind => {
          window.__gameSounds.push(kind);
          return original(kind);
        };
      });
      const before = await page.evaluate(() => ({
        tasks: localStorage.getItem("todo-list.tasks.v1"),
        game: localStorage.getItem("sdelano.game.v1")
      }));
      await page.locator("#game-preview-try").click();
      assert.match(await page.locator("#game-preview-feedback").textContent(), /Только звук и анимация.*баланс не изменён/);
      assert.ok((await page.evaluate(() => window.__gameSounds)).includes("reward"), "Demo must use the reward sound");
      const after = await page.evaluate(() => ({
        tasks: localStorage.getItem("todo-list.tasks.v1"),
        game: localStorage.getItem("sdelano.game.v1")
      }));
      assert.deepEqual(after, before, "Preview must never mutate task or economy storage");

      if (width === 390) {
        const animated = await page.locator("#game-preview").evaluate(el =>
          getComputedStyle(el.querySelector(".game-resource--coins .game-resource-icon")).animationName);
        assert.equal(animated, "none", "Reduced motion must not animate resources");
      }

      await page.locator("#task-title").fill("Завершить игровую QA-проверку");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      assert.match(await page.locator("#progress-summary").textContent(), /1 из 1/);
      assert.deepEqual(await panel.locator(".game-resource-amount").allTextContents(), ["10", "20 XP", "5/5"],
        "New completed task must grant base XP, coins and first-of-day bonus");
      assert.deepEqual(errors, [], "No page errors: " + errors.join(", "));
      console.log("Game preview QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
