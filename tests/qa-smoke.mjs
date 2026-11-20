import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const origin = "http://127.0.0.1:8765";
const failures = [];

for (const [width, height] of [[390, 844], [320, 700], [1280, 800]]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    assert.equal(await page.locator("#page-heading").textContent(), "Список задач");
    assert.equal(await page.locator(".site-header .goal-entry").count(), 0);
    assert.equal(await page.locator("#start-button").count(), 0);
    assert.equal(await page.locator("#task-form").isVisible(), true);

    const layout = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      formTop: document.querySelector("#task-form").getBoundingClientRect().top,
      heroBottom: document.querySelector(".hero").getBoundingClientRect().bottom
    }));
    assert.ok(layout.scrollWidth <= layout.viewportWidth + 1,
      `Horizontal overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.formTop < height,
      `Task form is below the fold: ${JSON.stringify(layout)}`);

    const label = `QA smoke ${width}`;
    await page.locator("#task-title").fill(label);
    await page.locator("#task-form button[type=submit]").click();
    const task = page.locator("li.task").filter({ hasText: label });
    assert.equal(await task.count(), 1);

    await task.locator(".task-checkbox").check();
    assert.equal((await page.locator("#percentage").textContent()).trim(), "100%");
    await page.locator('button[data-filter="done"]').click();
    assert.equal(await task.isVisible(), true);

    await page.reload({ waitUntil: "networkidle" });
    const restored = page.locator("li.task").filter({ hasText: label });
    assert.equal(await restored.count(), 1);
    assert.equal(await restored.locator(".task-checkbox").isChecked(), true);

    await restored.locator(".task-checkbox").uncheck();
    assert.equal((await page.locator("#percentage").textContent()).trim(), "0%");
    await restored.locator(".delete-button").click();
    assert.equal(await page.locator("li.task").count(), 0);
    assert.equal(pageErrors.length, 0, `JS errors: ${pageErrors.join("; ")}`);

    await page.goto(origin + "/goals/", { waitUntil: "networkidle" });
    assert.equal(await page.locator("#launch-heading").isVisible(), true);
    console.log(`PASS ${width}x${height}: layout, CRUD, progress, persistence, goal page`);
  } catch (error) {
    failures.push(`${width}x${height}: ${error.stack || error.message}`);
    console.error(`FAIL ${width}x${height}: ${error.message}`);
    await page.screenshot({ path: `/tmp/qa-failure-${width}.png`, fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
}
