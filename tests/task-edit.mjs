import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const key = "todo-list.tasks.v1";
const errors = [];
mkdirSync("artifacts", { recursive: true });

async function settle(page) {
  await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
}
async function add(page, title) {
  await page.locator("#task-title").fill(title);
  await page.locator("#task-form button[type='submit']").click();
  await settle(page);
}
async function edit(page, row, title) {
  await row.locator(".edit-button").click();
  await row.locator(".task-edit-input").fill(title);
  await row.locator(".task-edit-save").click();
  await settle(page);
}
async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
}

for (const [width, height] of [[320, 700], [390, 844], [1280, 800]]) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin);
    await page.locator("#welcome-start").click();
    await add(page, "Не менять время");
    const row = page.locator("li.task").first();
    const before = (await stored(page))[0];
    assert.ok(before.id, "Task has stable ID");
    assert.ok(before.startedAt > 0);
    assert.equal(before.done, false);
    const editButton = row.getByRole("button", { name: "Изменить название задачи «Не менять время»" });
    assert.equal(await editButton.isVisible(), true);
    const rect = await editButton.boundingBox();
    assert.ok(rect.width >= 44 && rect.height >= 44, "Touch edit target must be at least 44 px");

    await editButton.click();
    assert.equal(await row.locator(".task-edit-form").isVisible(), true);
    assert.equal(await row.locator(".task-label").isVisible(), false);
    assert.equal(await row.locator(".delete-button").isVisible(), false);
    assert.equal(await row.locator(".task-edit-input").evaluate(el => document.activeElement === el), true);
    await row.locator(".task-edit-input").fill("Отменённое изменение");
    await row.locator(".task-edit-input").press("Escape");
    assert.equal(await row.locator(".task-edit-form").isVisible(), false);
    assert.equal(await editButton.evaluate(el => document.activeElement === el), true);
    assert.equal((await stored(page))[0].title, "Не менять время");

    await row.locator(".edit-button").click();
    await row.locator(".task-edit-input").fill("   ");
    await row.locator(".task-edit-save").click();
    assert.equal(await row.locator(".task-edit-form").isVisible(), true,
      "Whitespace-only task name must remain in editor");
    assert.equal((await stored(page))[0].title, "Не менять время");
    await row.locator(".task-edit-input").fill("   Переделанное дело   ");
    await row.locator(".task-edit-input").press("Enter");
    await settle(page);
    assert.equal(await row.locator(".task-title").textContent(), "Переделанное дело");
    assert.equal(await row.locator(".task-edit-form").isVisible(), false);
    assert.equal(await row.locator(".task-checkbox").getAttribute("aria-label"), "Переделанное дело");
    assert.match(await row.locator(".delete-button").getAttribute("aria-label"), /Переделанное дело/);
    assert.match(await row.locator(".edit-button").getAttribute("aria-label"), /Переделанное дело/);
    const after = (await stored(page))[0];
    for (const field of ["id", "done", "elapsedMs", "startedAt", "doneAt"]) {
      assert.deepEqual(after[field], before[field], "Editing must preserve task " + field);
    }
    assert.equal(await page.locator("#percentage").textContent(), "0%");
    assert.match(await row.locator(".task-clock").textContent(), /Время идёт/);

    await page.reload();
    const persisted = page.locator("li.task").first();
    assert.equal(await persisted.locator(".task-title").textContent(), "Переделанное дело");
    assert.equal((await stored(page))[0].id, before.id);
    await persisted.locator(".task-checkbox").check();
    await settle(page);
    const completed = (await stored(page))[0];
    assert.equal(completed.done, true);
    assert.ok(completed.elapsedMs >= 0);
    assert.equal(await page.locator("#percentage").textContent(), "100%");
    const completedRecord = await page.locator("#milestone-record").textContent();

    await edit(page, persisted, "Готовое переименованное дело");
    const renamedCompleted = (await stored(page))[0];
    for (const field of ["id", "done", "elapsedMs", "startedAt", "doneAt"]) {
      assert.deepEqual(renamedCompleted[field], completed[field],
        "Completed task " + field + " must survive editing");
    }
    assert.equal(await page.locator("#percentage").textContent(), "100%");
    assert.equal(await page.locator("#milestone-record").textContent(), completedRecord);
    assert.equal(await persisted.locator(".task-checkbox").isChecked(), true);
    await page.locator("#share-progress").click();
    assert.ok(!(await page.locator("#share-ready-text").inputValue()).includes("Готовое переименованное дело"),
      "Sharing must never reveal edited task titles");
    await page.locator("#share-close").click();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.equal(scroll, true, "Editing must fit width " + width);
    await page.screenshot({ path: "artifacts/edit-task-" + width + ".png" });
    console.log("PASS task edit " + engine + " " + width + "x" + height);
  } catch (error) {
    errors.push(width + "x" + height + ": " + (error.stack ?? error.message));
  } finally {
    await context.close();
  }
}

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
try {
  const a = await context.newPage();
  await a.goto(origin);
  await a.locator("#welcome-start").click();
  await add(a, "Original task");
  const row = a.locator("li.task").first();
  const id = (await stored(a))[0].id;
  const originalStartedAt = (await stored(a))[0].startedAt;
  await row.locator(".edit-button").click();
  await row.locator(".task-edit-input").fill("My unsaved draft");

  const b = await context.newPage();
  await b.goto(origin + "/?utm_source=progress_share");
  await add(b, "Other tab task");
  await a.waitForFunction(() => document.querySelectorAll("li.task").length === 2);
  assert.equal(await row.locator(".task-edit-input").inputValue(), "My unsaved draft",
    "Storage updates must not erase unsaved draft");
  assert.equal(await row.locator(".task-edit-input").evaluate(el => document.activeElement === el), true);
  await row.locator(".task-edit-save").click();
  await settle(a);
  let current = (await stored(a)).find(t => t.id === id);
  assert.equal(current.title, "My unsaved draft");
  assert.equal(current.startedAt, originalStartedAt);
  assert.ok((await stored(a)).some(t => t.title === "Other tab task"),
    "Saving an edit must not lose a task created in another tab");

  await row.locator(".edit-button").click();
  await row.locator(".task-edit-input").fill("My second draft");
  const remoteRow = b.locator("li.task").filter({ hasText: "My unsaved draft" });
  await edit(b, remoteRow, "Remote updated title");
  await a.waitForFunction(() => document.querySelector("li.task .task-title")?.textContent === "Remote updated title");
  assert.equal(await row.locator(".task-edit-input").inputValue(), "My second draft");
  await row.locator(".task-edit-save").click();
  await settle(a);
  assert.equal((await stored(a)).find(t => t.id === id).title, "Remote updated title",
    "Concurrent edit conflict cannot silently overwrite remote title");
  assert.equal(await row.locator(".task-edit-form").isVisible(), true);
  const validation = await row.locator(".task-edit-input").evaluate(el => el.validationMessage);
  assert.match(validation, /другой вкладке/);
  await row.locator(".task-edit-input").fill("Reviewed title");
  await row.locator(".task-edit-save").click();
  await settle(a);
  current = (await stored(a)).find(t => t.id === id);
  assert.equal(current.title, "Reviewed title");
  assert.equal(current.startedAt, originalStartedAt);

  await row.locator(".edit-button").click();
  await row.locator(".task-edit-input").fill("Will not resurrect");
  await b.waitForFunction(() => document.querySelector("li.task .task-title")?.textContent === "Reviewed title");
  await b.locator("li.task").filter({ hasText: "Reviewed title" }).locator(".delete-button").click();
  await settle(b);
  await a.waitForFunction(() => document.querySelectorAll("li.task").length === 1);
  assert.ok(!(await stored(a)).some(t => t.id === id), "Externally deleted tasks stay deleted");
} catch (error) {
  errors.push("concurrent editing: " + (error.stack ?? error.message));
} finally {
  await context.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
