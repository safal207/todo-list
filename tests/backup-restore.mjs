import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const errors = [];
const storageKey = "todo-list.tasks.v1";

async function settle(page) {
  await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
}
async function add(page, title) {
  await page.locator("#task-title").fill(title);
  await page.locator('#task-form button[type="submit"]').click();
  await settle(page);
}
async function stored(page) {
  return await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), storageKey);
}
async function importFile(page, content) {
  await page.locator("#backup-file").setInputFiles({
    name: "my-sdelano-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(content)
  });
}
async function openBackup(page) {
  await page.locator("#backup-tools summary").click();
}

for (const width of [320, 390, 1280]) {
  const sourceContext = await browser.newContext({ viewport: { width, height: 850 }, acceptDownloads: true });
  const targetContext = await browser.newContext({ viewport: { width, height: 850 } });
  try {
    const source = await sourceContext.newPage();
    source.on("pageerror", error => errors.push("source " + error.message));
    await source.goto(origin);
    await source.locator("#welcome-start").click();
    await add(source, "Моё личное дело");
    await add(source, "Вторая задача");
    const original = await stored(source);
    await source.getByRole("checkbox", { name: "Моё личное дело" }).check();
    await settle(source);
    const afterComplete = await stored(source);
    const record = await source.locator("#milestone-record").textContent();
    assert.match(record, /1$/);
    assert.equal(await source.locator("#percentage").textContent(), "50%");

    await openBackup(source);
    assert.equal(await source.locator("#backup-download").isVisible(), true);
    const [download] = await Promise.all([
      source.waitForEvent("download"),
      source.locator("#backup-download").click()
    ]);
    assert.match(download.suggestedFilename(), /^sdelano-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const bytes = await readFile(await download.path());
    const exportText = bytes.toString("utf8");
    const exported = JSON.parse(exportText);
    assert.equal(exported.format, "sdelano-task-backup");
    assert.equal(exported.version, 1);
    assert.equal(exported.tasks.length, 2);
    assert.equal(exported.achievements.firstWin, true);
    assert.equal(exported.achievements.record, 1);
    assert.equal(exported.tasks[0].title, "Моё личное дело");

    const fresh = await targetContext.newPage();
    fresh.on("pageerror", error => errors.push("target " + error.message));
    await fresh.goto(origin);
    await fresh.locator("#welcome-start").click();
    await openBackup(fresh);
    assert.equal(await fresh.locator("#backup-preview").isVisible(), false);

    await importFile(fresh, "{broken json");
    assert.match(await fresh.locator("#backup-status").textContent(), /корректным JSON/);
    assert.equal(await fresh.locator("#backup-preview").isVisible(), false);
    assert.equal((await stored(fresh)).length, 0);

    await importFile(fresh, JSON.stringify({ ...exported, version: 999 }));
    assert.match(await fresh.locator("#backup-status").textContent(), /Неподдерживаемая/);
    assert.equal((await stored(fresh)).length, 0);

    await importFile(fresh, JSON.stringify({
      ...exported, tasks: [exported.tasks[0], { ...exported.tasks[0] }]
    }));
    assert.match(await fresh.locator("#backup-status").textContent(), /повторяются/);
    assert.equal((await stored(fresh)).length, 0);

    await importFile(fresh, JSON.stringify({
      ...exported, tasks: [{ ...exported.tasks[0], title: "   " }]
    }));
    assert.match(await fresh.locator("#backup-status").textContent(), /Некорректные данные задачи/);
    assert.equal((await stored(fresh)).length, 0);

    await importFile(fresh, exportText);
    assert.equal(await fresh.locator("#backup-preview").isVisible(), true);
    assert.match(await fresh.locator("#backup-preview-summary").textContent(), /Новых для добавления: 2/);
    await fresh.locator("#backup-cancel").click();
    assert.equal(await fresh.locator("#backup-preview").isVisible(), false);
    assert.equal((await stored(fresh)).length, 0);

    await importFile(fresh, exportText);
    await fresh.locator("#backup-import").click();
    await settle(fresh);
    const restored = await stored(fresh);
    assert.equal(restored.length, 2);
    for (let i = 0; i < 2; i++) {
      for (const field of ["id", "title", "done", "elapsedMs", "startedAt", "doneAt"]) {
        assert.deepEqual(restored[i][field], afterComplete[i][field],
          "Restore preserves task property " + field);
      }
    }
    assert.equal(await fresh.locator("#percentage").textContent(), "50%");
    assert.equal(await fresh.locator("#milestone-record").textContent(), record);
    assert.match(await fresh.locator("#backup-status").textContent(), /Восстановлено: 2/);
    assert.equal(await fresh.locator(".task-checkbox:checked").count(), 1);

    await importFile(fresh, exportText);
    assert.match(await fresh.locator("#backup-preview-summary").textContent(), /Уже есть в списке: 2/);
    await fresh.locator("#backup-import").click();
    await settle(fresh);
    assert.equal((await stored(fresh)).length, 2, "Repeated restore must not duplicate tasks");
    assert.match(await fresh.locator("#backup-status").textContent(), /Восстановлено: 0/);
    await add(fresh, "Новое дело на втором устройстве");
    const extra = (await stored(fresh))[2];
    await importFile(fresh, exportText);
    await fresh.locator("#backup-import").click();
    await settle(fresh);
    assert.equal((await stored(fresh)).length, 3);
    assert.deepEqual((await stored(fresh))[2], extra, "Local task survives merge restore");
    assert.equal(await fresh.locator("#percentage").textContent(), "33%");

    // A storage failure must not replace or alter the current list.
    const newer = { ...exported,
      tasks: [...exported.tasks, {
        id: "backup-extra-id", title: "Extra from failed backup",
        done: false, elapsedMs: 0, startedAt: Date.now(), doneAt: null
      }] };
    await importFile(fresh, JSON.stringify(newer));
    await fresh.evaluate(key => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) {
        if (name === key) throw new DOMException("Quota exceeded", "QuotaExceededError");
        return originalSet.call(this, name, value);
      };
      window.__restoreStorageSet = () => { Storage.prototype.setItem = originalSet; };
    }, storageKey);
    await fresh.locator("#backup-import").click();
    await settle(fresh);
    assert.match(await fresh.locator("#backup-status").textContent(), /Не хватает места/);
    assert.equal((await stored(fresh)).length, 3);
    await fresh.evaluate(() => window.__restoreStorageSet());

    await fresh.reload();
    assert.equal((await stored(fresh)).length, 3, "Imported items survive reload");
    assert.equal(await fresh.locator("#percentage").textContent(), "33%");
    assert.equal(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true, "Backup UI fits screen width " + width);

    console.log("PASS " + engine + " " + width + ": export, validation, merge, progress, timer, errors");
  } catch (error) {
    errors.push(width + ": " + (error.stack ?? error.message));
  } finally {
    await sourceContext.close();
    await targetContext.close();
  }
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
