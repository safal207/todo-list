import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

// Both versions run on ONE ORIGIN; the classic app remains the default.
// No mocked storage and no migration. Exercise real UI navigation and tasks.
const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const root = "http://127.0.0.1:8765/";
const v2 = root + "v2/";
const tasksKey = "todo-list.tasks.v1";
async function dismissWelcome(page) {
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
}
async function addTask(page, title) {
  await page.locator("#task-title").fill(title);
  await page.locator("#task-title").press("Enter");
  const task = page.locator("li.task").filter({ hasText: title });
  await task.waitFor({ state: "visible" });
  return task;
}
async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), tasksKey);
}
async function mode(page) {
  return page.locator(".version-switch").getAttribute("data-app-version");
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}

try {
  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", err => errors.push(err.message));
    try {
      // Existing user / first visit must get unchanged classic v1 by default.
      await page.goto(root, { waitUntil: "networkidle" });
      await dismissWelcome(page);
      assert.equal(await mode(page), "classic");
      assert.equal(await page.locator("#game-preview").count(), 0);
      assert.equal(await page.locator(".version-switch [aria-current=page]").textContent(), "1.0");
      assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.ui.mode.v1")), null);
      assert.ok((await overflow(page)) <= 1);

      const classic = "Классическая задача " + width;
      const firstTask = await addTask(page, classic);
      await firstTask.locator(".task-checkbox").check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      assert.equal((await stored(page)).filter(t => t.done).length, 1);
      const classicTaskID = (await stored(page)).find(t => t.title === classic)?.id;
      assert.ok(classicTaskID, "Classic task has real stable ID");
      const before = await page.evaluate(key => localStorage.getItem(key), tasksKey);

      // Genuine navigation to separate v2 runtime, not cosmetic class toggle.
      await page.locator('a[data-mode-target="game"]').click();
      await page.waitForURL(v2);
      await dismissWelcome(page);
      assert.equal(await mode(page), "game");
      assert.equal(await page.locator("#game-preview").count(), 1);
      assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.ui.mode.v1")), "game");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), tasksKey), before,
        "Opening v2 must NOT rewrite the user's classic tasks");
      assert.equal((await stored(page)).find(t => t.id === classicTaskID)?.done, true);
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 0,
        "Already-completed Classic tasks must never retroactively mint XP");
      assert.equal(await page.locator("#cloud-sync").isVisible(), false,
        "V2 cloud must stay disabled");

      // Image, styles and gamified runtime must all load from /v2/, not v1.
      assert.ok(await page.locator(".mini-hero .hero-mascot").first()
        .evaluate(el => el.complete && el.naturalWidth > 0));
      const swStatus = await page.evaluate(async () => ({
        registered: Boolean(await navigator.serviceWorker.getRegistration("./")),
        response: (await fetch("focus-pause-sw.js")).status
      }));
      assert.equal(swStatus.response, 200);
      assert.equal(swStatus.registered, false, "No worker auto-registration without opt-in");

      const gameTask = "Игровая задача " + width;
      const secondTask = await addTask(page, gameTask);
      await secondTask.locator(".task-checkbox").check();
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 20);
      const game = await page.evaluate(() => window.sdelanoGame.inspect());
      assert.deepEqual([game.xp, game.coins, game.earnedTasks], [20, 10, 1]);
      assert.equal((await stored(page)).length, 2);
      const wallet = await page.evaluate(() => localStorage.getItem("sdelano.game.v1"));
      assert.ok(wallet);
      assert.ok((await overflow(page)) <= 1);

      // Explicit Classic switch must not remove coins or reset tasks.
      await page.locator('a[data-mode-target="classic"]').click();
      await page.waitForURL(/\/\?classic=1$/);
      await dismissWelcome(page);
      assert.equal(await mode(page), "classic");
      assert.equal(await page.locator("#game-preview").count(), 0);
      assert.equal((await stored(page)).filter(t => t.done).length, 2);
      assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.game.v1")), wallet,
        "Classic mode never overwrites the game wallet");
      assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.ui.mode.v1")), "classic");

      // Classic edits to existing tasks remain visible in v2.
      const toReopen = page.locator("li.task").filter({ hasText: classic });
      if (!(await toReopen.isVisible())) {
        const toggle = page.locator("#completed-toggle");
        if (await toggle.isVisible()) await toggle.click();
      }
      const checkbox = page.locator("li.task").filter({ hasText: classic }).locator(".task-checkbox");
      await checkbox.uncheck();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      assert.equal((await stored(page)).find(t => t.id === classicTaskID)?.done, false);
      await page.locator('a[data-mode-target="game"]').click();
      await page.waitForURL(v2);
      await dismissWelcome(page);
      assert.equal((await stored(page)).find(t => t.id === classicTaskID)?.done, false);
      const returnedWallet = await page.evaluate(() => window.sdelanoGame.inspect());
      assert.deepEqual([returnedWallet.xp, returnedWallet.coins, returnedWallet.earnedTasks], [20, 10, 1],
        "Switching back must not duplicate or destroy game currency");
      assert.ok((await overflow(page)) <= 1);
      // Remember explicit game preference on later direct visits to the root.
      await page.goto(root, { waitUntil: "domcontentloaded" });
      await page.waitForURL(v2);
      await page.locator('a[data-mode-target="classic"]').click();
      await page.waitForURL(/\/\?classic=1$/);
      assert.equal(await mode(page), "classic");
      await page.goto(root, { waitUntil: "networkidle" });
      assert.equal(await mode(page), "classic",
        "An explicit return to v1 must win over the stored v2 preference");

      assert.deepEqual(errors, [], "Page errors: " + errors.join(", "));
      console.log("Dual-mode data-preservation QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
}
