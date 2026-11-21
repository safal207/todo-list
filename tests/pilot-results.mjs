import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const errors = [];

function report(code, { newUser = true, created = true, completed = true,
  d1 = "проверим завтра", comment = "нет" } = {}) {
  return [
    "Тест «Сделано» / анонимный результат",
    "Код: " + code,
    "Новый пользователь: " + (newUser ? "да" : "нет"),
    "Создал задачу: " + (created ? "да" : "нет"),
    "Завершил задачу: " + (completed ? "да" : "нет"),
    "Вернулся на следующий календарный день: " + d1,
    "Комментарий (добровольно): " + comment
  ].join("\n");
}

for (const width of [320, 390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 850 } });
  const page = await context.newPage();
  try {
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin + "/pilot/results/", { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "Результаты пилота — Сделано");
    assert.equal(await page.locator("#reports-count").textContent(), "0/10");
    assert.equal(await page.locator("#created-rate").textContent(), "—");
    assert.equal(await page.locator("#completed-rate").textContent(), "—");
    assert.equal(await page.locator("#d1-rate").textContent(), "—");
    assert.equal(await page.locator("#participants li").count(), 10);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      "Dashboard must not overflow horizontally at " + width);

    await page.locator("#reports-input").fill([
      report("T01", { comment: "<img src=x onerror=alert(1)>" }),
      report("T02", { newUser: false, completed: false, d1: "нет" })
    ].join("\n\n"));
    await page.locator("#import-reports").click();
    assert.match(await page.locator("#import-feedback").textContent(), /Добавлено: 2/);
    assert.equal(await page.locator("#reports-count").textContent(), "2/10");
    assert.equal(await page.locator("#created-rate").textContent(), "100%");
    assert.equal(await page.locator("#completed-rate").textContent(), "100%");
    assert.equal(await page.locator("#d1-rate").textContent(), "—",
      "Pending D1 and existing users must be excluded from D1 denominator");
    assert.equal(await page.locator("#participants li").nth(0).locator("img").count(), 0,
      "User comment is text, not HTML");
    assert.match(await page.locator("#quality-note").textContent(), /Повторно участвовали: 1/);

    await page.locator("#reports-input").fill(report("T11"));
    await page.locator("#import-reports").click();
    assert.match(await page.locator("#import-feedback").textContent(), /Неизвестный код/);
    assert.equal(await page.locator("#reports-count").textContent(), "2/10",
      "Invalid input must not mutate saved reports");

    await page.locator("#reports-input").fill([
      report("T01", { d1: "да", comment: "Стало понятнее" }),
      report("T03", { created: false, completed: false, d1: "нет" })
    ].join("\n\n"));
    await page.locator("#import-reports").click();
    assert.match(await page.locator("#import-feedback").textContent(), /Добавлено: 1\. Обновлено: 1/);
    assert.equal(await page.locator("#reports-count").textContent(), "3/10");
    assert.equal(await page.locator("#created-rate").textContent(), "50%");
    assert.equal(await page.locator("#completed-rate").textContent(), "50%");
    assert.equal(await page.locator("#d1-rate").textContent(), "50%");
    assert.match(await page.locator("#created-denominator").textContent(), /1 из 2/);
    assert.match(await page.locator("#completed-denominator").textContent(), /1 из 2/);
    assert.match(await page.locator("#d1-denominator").textContent(), /1 из 2/);

    await page.reload();
    assert.equal(await page.locator("#reports-count").textContent(), "3/10",
      "Results must survive page reload in same browser");
    assert.equal(await page.locator("#d1-rate").textContent(), "50%");
    await page.locator("#copy-results").click();
    const summary = await page.locator("#results-export").inputValue();
    assert.match(summary, /D1 возврат: 1\/2/);
    assert.equal(summary.includes("Стало понятнее"), false,
      "Summary contains aggregated stats, no raw comments");
    assert.match(summary, /Отсутствующие отчёты не учитывались как неуспех/);

    // An incorrect report must fail atomically even if the preceding report is valid.
    await page.locator("#reports-input").fill([
      report("T04", { created: false, completed: false, d1: "нет" }),
      report("T05", { created: false, completed: true, d1: "да" })
    ].join("\n\n"));
    await page.locator("#import-reports").click();
    assert.match(await page.locator("#import-feedback").textContent(), /выполненная задача без создания/);
    assert.equal(await page.locator("#reports-count").textContent(), "3/10");

    page.once("dialog", dialog => dialog.dismiss());
    await page.locator("#clear-results").click();
    assert.equal(await page.locator("#reports-count").textContent(), "3/10");
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#clear-results").click();
    assert.equal(await page.locator("#reports-count").textContent(), "0/10");
    await page.reload();
    assert.equal(await page.locator("#reports-count").textContent(), "0/10");
    console.log("PASS " + engine + " " + width + ": anonymous pilot aggregate, pending D1, exclusions, safety, persistence");
  } catch (error) {
    errors.push(width + ": " + (error.stack ?? error.message));
  } finally {
    await context.close();
  }
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
