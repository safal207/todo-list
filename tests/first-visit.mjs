import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const tasksKey = "todo-list.tasks.v1";
const errors = [];
browser.on("context", context => context.on("page", page =>
  page.on("pageerror", error => errors.push(error.message))));
mkdirSync("artifacts", { recursive: true });

async function settle(page) {
  await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
}
async function add(page, title) {
  await page.locator("#task-title").fill(title);
  await page.locator("#task-form button").click();
  await settle(page);
}

try {
  for (const [width, height] of [[320, 700], [390, 844], [667, 320], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const welcome = page.getByRole("dialog", { name: "Сделаем!" });
    await welcome.waitFor();
    const art = await welcome.evaluate(el => {
      const rect = selector => el.querySelector(selector).getBoundingClientRect();
      const button = rect("button");
      return {
        ordered: rect(".welcome-spark").right <= rect(".welcome-fox").left &&
          rect(".welcome-fox").right <= rect(".welcome-heart").left,
        fits: button.height >= 44 && button.bottom <= innerHeight && button.left >= 0 &&
          el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
        motion: getComputedStyle(el.querySelector(".welcome-fox")).animationName
      };
    });
    assert.deepEqual(art, { ordered: true, fits: true, motion: "none" });
    await welcome.locator("img").evaluate(image => image.decode());
    await page.screenshot({ path: "artifacts/welcome-" + width + ".png" });
    if (width === 320) {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#page-heading").evaluate(el => document.activeElement === el), true);
    } else if (width === 667) {
      await welcome.waitFor({ state: "hidden", timeout: 5500 });
      assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), false);
    } else {
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true);
    }
    assert.equal(await welcome.isVisible(), false);
    await page.reload();
    assert.equal(await welcome.isVisible(), false);
    await page.goto(origin + "/?welcome=1");
    await welcome.waitFor();
    assert.equal(new URL(page.url()).search, "");
    await page.reload();
    assert.equal(await welcome.isVisible(), false);
    await page.close();
  }

  // The first arrival through a friend's invitation should go straight to the form.
  const friend = await browser.newPage();
  await friend.goto(origin + "/invite/?r=29-50");
  assert.match(await friend.locator("#friend-score").innerText(), /58%/);
  await friend.locator("#start-own").click();
  assert.equal(await friend.locator("#welcome").isVisible(), false);
  await add(friend, "Дело друга");
  await friend.evaluate(() => localStorage.setItem("sdelano.tasks.history.v1",
    JSON.stringify([{ action: "created", at: Date.now(), title: "Удалённое старое дело" }])));
  await friend.locator(".task-checkbox").check();
  await settle(friend);
  assert.equal(await friend.evaluate(() => sdelanoAnalytics.summary().referralConversion), 1);
  assert.equal(await friend.evaluate(() =>
    JSON.parse(localStorage.getItem("sdelano.tasks.history.v1")).every(event => !("title" in event))), true);
  await friend.close();

  const legacy = await browser.newPage();
  await legacy.goto(origin + "/invite/");
  await legacy.evaluate(key => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(Array.from({ length: 50 }, (_, n) =>
      ({ title: "Личное дело " + n, done: n < 29 }))));
  }, tasksKey);
  await legacy.goto(origin);
  assert.equal(await legacy.locator("#welcome").isVisible(), false);
  assert.equal(await legacy.locator("#percentage").innerText(), "58%");
  await legacy.locator("#share-progress").click();
  await legacy.waitForFunction(() => document.querySelector("#share-image-download").download.endsWith("29-of-50.jpg"));
  assert.equal(await legacy.locator("#share-preview-percentage").innerText(), "58%");
  assert.match(await legacy.locator("#share-poster-preview").getAttribute("alt"), /58%/);
  assert.match(await legacy.locator("#share-ready-text").inputValue(), /58%/);
  await legacy.evaluate(key => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(["a", "b", "c"].map(title => ({ title, done: false }))));
    localStorage.setItem("sdelano.milestone.record.v1", "10");
  }, tasksKey);
  await legacy.reload();
  for (const title of ["a", "b", "c"]) {
    await legacy.getByRole("checkbox", { name: title, exact: true }).check();
    await settle(legacy);
    assert.equal(await legacy.locator("#first-win-card").isVisible(), false);
    assert.equal(await legacy.locator("#three-steps-card").isVisible(), false);
  }
  assert.match(await legacy.locator("#milestone-record").innerText(), /10$/);
  await legacy.close();

  // Keep an exact recoverable copy before replacing unreadable or partially valid data.
  for (const raw of ['[{"title":"Исходное дело"', '{"futureVersion":2}',
    '[{"title":"Старая задача","done":false},null]']) {
    const page = await browser.newPage();
    await page.goto(origin + "/invite/");
    await page.evaluate(([key, raw]) => localStorage.setItem(key, raw), [tasksKey, raw]);
    await page.goto(origin);
    assert.equal(await page.locator("#storage-warning").isVisible(), true);
    assert.equal(await page.locator("#welcome").isVisible(), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), tasksKey), raw);
    await add(page, "Новая задача");
    const backups = await page.evaluate(key => Object.keys(localStorage)
      .filter(name => name.startsWith(key + ".recovery.")).map(name => localStorage.getItem(name)), tasksKey);
    assert.deepEqual(backups, [raw]);
    await page.reload();
    assert.equal(await page.getByRole("checkbox", { name: "Новая задача" }).count(), 1);
    if (raw.includes("Старая задача")) {
      assert.equal(await page.getByRole("checkbox", { name: "Старая задача" }).count(), 1);
    }
    await page.close();
  }

  // A failed backup must leave the original untouched and the UI usable in memory.
  const full = await browser.newPage();
  await full.addInitScript(key => {
    localStorage.setItem(key, "bad-json");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name.startsWith(key + ".recovery.")) throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, name, value);
    };
  }, tasksKey);
  await full.goto(origin);
  await add(full, "В этой вкладке");
  assert.equal(await full.getByRole("checkbox", { name: "В этой вкладке" }).count(), 1);
  assert.equal(await full.locator("#storage-warning").isVisible(), true);
  assert.equal(await full.evaluate(key => localStorage.getItem(key), tasksKey), "bad-json");
  await full.close();

  const quick = await browser.newPage();
  await quick.goto(origin);
  await quick.locator("#welcome-start").click();
  await quick.locator("#task-title").fill("Перед обновлением");
  await Promise.all([
    quick.waitForEvent("load"),
    quick.evaluate(() => {
      document.querySelector("#task-form").requestSubmit();
      location.reload();
    })
  ]);
  await quick.getByRole("checkbox", { name: "Перед обновлением" }).waitFor();
  await quick.close();

  const context = await browser.newContext();
  const a = await context.newPage();
  await a.goto(origin);
  await a.locator("#welcome-start").click();
  const b = await context.newPage();
  await b.goto(origin);
  await Promise.all([add(a, "Одинаковое имя"), add(b, "Одинаковое имя")]);
  for (const page of [a, b]) await page.locator("li.task").nth(1).waitFor();
  const ids = await a.locator("li.task").evaluateAll(rows => rows.map(row => row.dataset.taskId));
  assert.equal(new Set(ids).size, 2);
  await Promise.all([
    a.locator("li.task").first().locator(".task-checkbox").check(),
    b.locator("li.task").last().locator(".delete-button").click()
  ]);
  await Promise.all([settle(a), settle(b)]);
  await a.reload();
  await b.reload();
  for (const page of [a, b]) {
    assert.deepEqual(await page.locator("li.task").evaluateAll(rows =>
      rows.map(row => [row.dataset.taskId, row.querySelector("input").checked])), [[ids[0], true]]);
    assert.equal(await page.locator("#percentage").innerText(), "100%");
  }
  await context.close();
  assert.deepEqual(errors, []);
  console.log(engine + ": first visit, referral, recovery, historic awards and concurrent tabs passed");
} finally {
  await browser.close();
}
