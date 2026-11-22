import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const browserType = { chromium, firefox, webkit }[process.env.SDELANO_QA_ENGINE || "chromium"];
const browser = await browserType.launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const url = "http://127.0.0.1:8765/";

async function arrive(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
}

async function add(page, name) {
  await page.locator("#task-title").fill(name);
  await page.locator("#task-title").press("Enter");
  await page.locator(`li.task:has-text("${name}")`).waitFor();
}

async function close(page, name) {
  await page.locator(`li.task:has-text("${name}") .task-checkbox`).check();
  await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
}

async function balance(page) {
  return page.evaluate(() => window.sdelanoGame.inspect());
}

try {
  // Real rewards, daily bonuses, idempotent toggles, reload and two tabs.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await arrive(page);
    assert.equal((await balance(page)).coins, 0);
    await add(page, "Первая задача игры");
    await close(page, "Первая задача игры");
    assert.deepEqual([(await balance(page)).xp, (await balance(page)).coins], [20, 10]);

    const first = page.locator('li.task:has-text("Первая задача игры") .task-checkbox');
    await first.uncheck();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    await page.locator('[data-filter="active"]').click();
    await first.check();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    assert.deepEqual([(await balance(page)).xp, (await balance(page)).coins], [20, 10],
      "Reopening the same task must not mint another reward");

    await add(page, "Вторая задача игры");
    await close(page, "Вторая задача игры");
    await add(page, "Третья задача игры");
    await close(page, "Третья задача игры");
    assert.deepEqual([(await balance(page)).xp, (await balance(page)).coins], [55, 30],
      "Third completion should receive the daily triple bonus");
    const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem("sdelano.game.v1")));
    assert.equal(ledger.grants.length, 5);
    assert.equal(new Set(ledger.grants.map(x => x.key)).size, ledger.grants.length);

    await page.reload({ waitUntil: "networkidle" });
    assert.deepEqual([(await balance(page)).xp, (await balance(page)).coins], [55, 30],
      "Reload must preserve earned XP and coins");
    const another = await context.newPage();
    await arrive(another);
    const crossTab = await another.evaluate(() => window.sdelanoGame.awardTask(
      JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0].id));
    assert.equal(crossTab.awarded, false, "Another tab must not pay again for the same ID");
    assert.equal((await balance(another)).coins, 30);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Already completed tasks on first activation must remain excluded.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await arrive(page);
    const oldTask = {
      id: "legacy-already-done", title: "Старая выполненная задача",
      done: true, elapsedMs: 1000, startedAt: null, doneAt: Date.now()
    };
    await page.evaluate(task => {
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([task]));
      localStorage.removeItem("sdelano.game.v1");
    }, oldTask);
    await arrive(page);
    const pre = await balance(page);
    assert.equal(pre.coins, 0);
    const result = await page.evaluate(() => window.sdelanoGame.awardTask("legacy-already-done"));
    assert.equal(result.awarded, false);
    assert.equal((await balance(page)).xp, 0);
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem("sdelano.game.v1")).excludedIds))
      .includes(oldTask.id));
    await context.close();
  }

  // Import exclusion prevents minting currency from already-done external tasks.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await arrive(page);
    const result = await page.evaluate(() => {
      const row = { id: "external-done", title: "Внешнее выполненное дело", done: true,
        elapsedMs: 300, startedAt: null, doneAt: Date.now() };
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([row]));
      window.sdelanoGame.excludeCompleted([row.id]);
      return window.sdelanoGame.awardTask(row.id);
    });
    assert.equal(result.awarded, false);
    assert.equal((await balance(page)).coins, 0);
    await context.close();
  }

  // Malformed wallet must fail closed and never damage task persistence.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await arrive(page);
    await page.evaluate(() => localStorage.setItem("sdelano.game.v1", "{corrupted"));
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await balance(page)).available, false);
    await add(page, "Задачи работают без игровых наград");
    await close(page, "Задачи работают без игровых наград");
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("todo-list.tasks.v1")))[0].done, true);
    assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.game.v1")), "{corrupted",
      "Do not overwrite a corrupted economy wallet");
    await context.close();
  }

  console.log("Game economy QA passed:", process.env.SDELANO_QA_ENGINE || "chromium");
} finally {
  await browser.close();
}
