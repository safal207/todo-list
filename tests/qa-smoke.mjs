import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const origin = "http://127.0.0.1:8765";
const errors = [];
mkdirSync("artifacts", { recursive: true });

for (const [width, height] of [[390, 844], [320, 700], [1280, 800]]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__vibrationEvents = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value(pattern) { window.__vibrationEvents.push(pattern); return true; }
    });
  });
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#page-heading").textContent(), "Список задач");
    assert.equal(await page.locator(".startup-brand").count(), 1);
    assert.equal(await page.locator("#start-button").count(), 0);
    assert.equal(await page.locator("#feedback-toggle").textContent(), "Отклик: вкл");
    assert.equal(await page.locator("#task-form").isVisible(), true);

    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      formTop: document.querySelector("#task-form").getBoundingClientRect().top
    }));
    assert.ok(layout.scroll <= layout.width + 1, "Horizontal overflow: " + JSON.stringify(layout));
    assert.ok(layout.formTop < height, "Form below the fold: " + JSON.stringify(layout));
    await page.screenshot({ path: "artifacts/tasks-" + width + ".png", fullPage: true });

    const label = "QA smoke " + width;
    await page.locator("#task-title").fill(label);
    await page.locator("#task-form button[type=submit]").click();
    const task = page.locator("li.task").filter({ hasText: label });
    assert.equal(await task.count(), 1);
    const started = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(started.done, false);
    assert.ok(started.startedAt > 0 && started.elapsedMs === 0, "Timer starts when task is added");
    await page.waitForTimeout(1250);
    assert.match((await task.locator(".task-clock").textContent()).trim(), /Время идёт · 00:00:0[1-9]/);
    await page.screenshot({ path: "artifacts/tasks-populated-" + width + ".png", fullPage: true });

    await task.locator(".task-checkbox").check();
    assert.equal((await page.locator("#percentage").textContent()).trim(), "100%");
    const completed = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(completed.done, true);
    assert.equal(completed.startedAt, null);
    assert.ok(completed.elapsedMs >= 1000, "Elapsed time saved on completion");
    assert.match((await task.locator(".task-clock").textContent()).trim(), /^Готово за /);
    assert.ok(await page.evaluate(() => window.__vibrationEvents.length) >= 2, "Haptic calls on add and complete");

    await page.locator('button[data-filter="done"]').click();
    assert.equal(await task.isVisible(), true);
    await page.reload({ waitUntil: "networkidle" });
    const restored = page.locator("li.task").filter({ hasText: label });
    assert.equal(await restored.locator(".task-checkbox").isChecked(), true);
    const frozen = (await restored.locator(".task-clock").textContent()).trim();
    await page.waitForTimeout(1250);
    assert.equal((await restored.locator(".task-clock").textContent()).trim(), frozen);

    await page.locator("#feedback-toggle").click();
    assert.equal(await page.locator("#feedback-toggle").textContent(), "Отклик: выкл");
    const mutedCount = await page.evaluate(() => window.__vibrationEvents.length);
    await page.locator('button[data-filter="all"]').click();
    assert.equal(await page.evaluate(() => window.__vibrationEvents.length), mutedCount);
    await page.locator("#feedback-toggle").click();

    await restored.locator(".task-checkbox").uncheck();
    const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(reopened.done, false);
    assert.ok(reopened.startedAt > completed.doneAt);
    assert.equal(reopened.elapsedMs, completed.elapsedMs);
    assert.equal((await page.locator("#percentage").textContent()).trim(), "0%");
    await restored.locator(".delete-button").click();
    assert.equal(await page.locator("li.task").count(), 0);

    // Migration: old lists are preserved; we never invent durations for historical completions.
    await page.evaluate(() => {
      const longAgo = Date.now() - (86400000 + 2 * 3600000 + 3 * 60000);
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
        { title: "Legacy active", done: false },
        { title: "Legacy done", done: true },
        { title: "Long task", done: false, elapsedMs: 0, startedAt: longAgo }
      ]));
    });
    await page.reload({ waitUntil: "networkidle" });
    const legacy = page.locator("li.task").filter({ hasText: "Legacy done" });
    assert.match((await legacy.locator(".task-clock").textContent()).trim(), /время неизвестно/);
    const long = page.locator("li.task").filter({ hasText: "Long task" });
    await long.locator(".task-checkbox").check();
    assert.match((await long.locator(".task-clock").textContent()).trim(), /1 д 2 ч 3 мин/);
    const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1")));
    assert.ok(migrated[0].startedAt > 0 && migrated[0].elapsedMs === 0);

    const oldPage = await page.goto(origin + "/goals/", { waitUntil: "domcontentloaded" });
    assert.equal(oldPage.status(), 404, "Old Big Goal page is removed");
    assert.equal(pageErrors.length, 0, "JS errors: " + pageErrors.join("; "));
    console.log("PASS " + width + "x" + height + ": responsive layout, timers, feedback, legacy storage, removed goals");
  } catch (error) {
    errors.push(width + "x" + height + ": " + (error.stack || error.message));
    console.error("FAIL " + width + "x" + height + ": " + error.message);
    await page.screenshot({ path: "artifacts/failed-" + width + ".png", fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
