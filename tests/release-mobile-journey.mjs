import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

// E2E release journey, isolated per browser context and per viewport.
// A READY focus-session fixture represents already-completed 15 visible
// minutes. It does not replace real elapsed-time, suspension or resume tests.
const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await { chromium, firefox, webkit }[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const root = "http://127.0.0.1:8765/";
const wallet = page => page.evaluate(() => window.sdelanoGame.inspect());
mkdirSync("artifacts", { recursive: true });

async function enter(page) {
  await page.goto(root, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open)
      document.querySelector("#welcome-start")?.click();
  });
}
async function expand(page, toggle, detail) {
  if (await page.locator(toggle).getAttribute("aria-expanded") === "false") {
    await page.locator(toggle).click();
  }
  if (detail && !(await page.locator(detail).evaluate(el => el.open))) {
    await page.locator(detail + " summary").click();
  }
}

try {
  for (const width of [320, 390]) {
    const sourceContext = await browser.newContext({
      viewport: { width, height: 844 }, reducedMotion: width === 390 ? "reduce" : "no-preference",
      acceptDownloads: true
    });
    const targetContext = await browser.newContext({
      viewport: { width, height: 844 }, reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const source = await sourceContext.newPage();
    const target = await targetContext.newPage();
    const errors = [];
    source.on("pageerror", e => errors.push("source: " + e.message));
    target.on("pageerror", e => errors.push("target: " + e.message));
    try {
      await enter(source);
      assert.equal((await wallet(source)).coins, 0);
      assert.equal((await wallet(source)).xp, 0);
      assert.equal(await source.locator("#cloud-sync").isVisible(), false,
        "Cloud must stay opt-in and disabled without configuration");

      const expected = [
        [20, 10], [30, 15], [55, 30], [65, 35],
        [75, 40], [85, 45], [95, 50]
      ];
      for (let i = 0; i < 7; i++) {
        const title = "Сквозная QA задача " + (i + 1);
        await source.locator("#task-title").fill(title);
        await source.locator("#task-title").press("Enter");
        const row = source.locator("li.task").filter({ hasText: title });
        await row.locator(".task-checkbox").check();
        const [xp, coins] = expected[i];
        await source.waitForFunction(({ xp, coins }) => {
          const state = window.sdelanoGame.inspect();
          return state.xp === xp && state.coins === coins;
        }, { xp, coins });
        assert.equal((await wallet(source)).earnedTasks, i + 1,
          "A real saved completion creates exactly one task grant");
      }
      assert.equal(await source.locator("li.task").count(), 7);
      assert.equal(await source.locator("#percentage").textContent(), "100%");

      await expand(source, "#game-preview-toggle", "#game-shop");
      const card = source.locator('.game-shop-card[data-item="scarf"]');
      assert.equal(await card.getAttribute("data-owned"), "false");
      await card.locator(".game-shop-action").click();
      await source.waitForFunction(() => document.querySelector(
        '.game-shop-card[data-item="scarf"]')?.dataset.owned === "true");
      let data = await wallet(source);
      assert.deepEqual([data.xp, data.coins, data.purchases.length], [95, 0, 1]);
      assert.equal(data.equipped.scarf, true);
      const replayBuy = await source.evaluate(() => window.sdelanoGame.buyItem("scarf"));
      assert.equal(replayBuy.success, false);
      assert.equal(replayBuy.reason, "already-owned");
      assert.equal((await wallet(source)).coins, 0);

      const focus = await source.evaluate(async () => {
        const game = window.sdelanoGame;
        const id = "release-candidate-earned-focus";
        sessionStorage.setItem(game.focusKey, JSON.stringify({
          id, elapsedMs: game.focusMs, status: "ready"
        }));
        const earned = await game.claimFocus(id);
        const replay = await game.claimFocus(id);
        return { earned, replay };
      });
      assert.equal(focus.earned.awarded, true);
      assert.equal(focus.replay.awarded, false);
      assert.equal(focus.replay.reason, "already-awarded");
      data = await wallet(source);
      assert.deepEqual([data.xp, data.coins, data.energy, data.purchases.length],
        [100, 0, 4, 1]);
      await source.screenshot({
        path: "artifacts/release-journey-source-" + engine + "-" + width + ".png",
        fullPage: true
      });

      // Reload must preserve all economic operations and must not earn more XP.
      await source.reload({ waitUntil: "networkidle" });
      data = await wallet(source);
      assert.deepEqual([data.xp, data.coins, data.energy, data.purchases.length],
        [100, 0, 4, 1]);
      assert.equal(data.earnedTasks, 7);

      // Use the real user download control, then import into a separate browser.
      await source.evaluate(() => {
        const progress = document.querySelector("#progress-toggle");
        if (progress?.getAttribute("aria-expanded") === "false") progress.click();
      });
      await expand(source, "#progress-toggle", "#backup-tools");
      const [download] = await Promise.all([
        source.waitForEvent("download"),
        source.locator("#backup-download").click()
      ]);
      const exported = await readFile(await download.path(), "utf8");
      const archive = JSON.parse(exported);
      assert.equal(archive.version, 2);
      assert.equal(archive.tasks.length, 7);
      assert.equal(archive.game.purchases.length, 1);
      assert.equal(archive.game.grants.filter(g => g.key.startsWith("focus:")).length, 1);

      await enter(target);
      await target.evaluate(() => {
        const progress = document.querySelector("#progress-toggle");
        if (progress?.getAttribute("aria-expanded") === "false") progress.click();
      });
      await expand(target, "#progress-toggle", "#backup-tools");
      await target.locator("#backup-file").setInputFiles({
        name: "release-journey.json", mimeType: "application/json",
        buffer: Buffer.from(exported)
      });
      await target.locator("#backup-preview").waitFor({ state: "visible" });
      await target.locator("#backup-import").click();
      await target.locator("#backup-status")
        .filter({ hasText: "Игровые монеты" }).waitFor();
      const restored = await wallet(target);
      assert.deepEqual(
        [restored.xp, restored.coins, restored.energy, restored.purchases.length, restored.earnedTasks],
        [100, 0, 4, 1, 7],
        "Task, focus, purchase and wallet all survive cross-browser-profile restore"
      );
      assert.equal(restored.equipped.scarf, true);
      assert.equal(await target.locator("li.task").count(), 7);
      await target.reload({ waitUntil: "networkidle" });
      assert.equal((await wallet(target)).xp, 100);
      assert.equal((await wallet(target)).purchases.length, 1);
      assert.ok(await target.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1),
      "No horizontal overflow after wallet restore");
      await target.screenshot({
        path: "artifacts/release-journey-restored-" + engine + "-" + width + ".png",
        fullPage: true
      });
      assert.deepEqual(errors, []);
      console.log("Release candidate mobile golden journey passed:", engine, width);
    } finally {
      await sourceContext.close();
      await targetContext.close();
    }
  }
} finally {
  await browser.close();
}
