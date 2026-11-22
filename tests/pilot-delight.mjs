import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});

mkdirSync("artifacts", { recursive: true });

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto("http://127.0.0.1:8765/?pilot=T01", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        const welcome = document.querySelector("#welcome");
        if (welcome?.open) document.querySelector("#welcome-start")?.click();
      });
      const start = await page.evaluate(() => window.sdelanoAnalytics?.pilotSummary());
      assert.equal(start?.code, "T01");
      assert.equal(start.newUser, true);
      assert.equal(start.completed, false);

      await page.goto("http://127.0.0.1:8765/pilot/", { waitUntil: "networkidle" });
      assert.equal(await page.locator("#pilot-content").isVisible(), true);
      assert.equal(await page.locator("#pilot-delight-question").isVisible(), false,
        "Cannot rate earned reward before finishing a real task");
      await page.screenshot({ path: "artifacts/pilot-survey-before-" + engine + "-" + width + ".png", fullPage: true });
      await page.locator("#pilot-ease").selectOption("4");
      assert.equal(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("sdelano.pilot.ratings.v1")).ease), 4);
      await page.locator("#pilot-copy").click();
      let report = await page.locator("#pilot-export").inputValue();
      assert.match(report, /Лёгкость начала \(1–5\): 4/);
      assert.match(report, /Приятность награды \(1–5\): —/);

      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
      });
      await page.locator("#task-title").fill("Личная задача не для отчёта");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      assert.equal((await page.evaluate(() => window.sdelanoAnalytics.pilotSummary())).completed, true);
      await page.goto("http://127.0.0.1:8765/pilot/", { waitUntil: "networkidle" });
      assert.equal(await page.locator("#pilot-delight-question").isVisible(), true);
      assert.equal(await page.locator("#pilot-ease").inputValue(), "4",
        "Optional ease rating must persist locally");
      await page.screenshot({ path: "artifacts/pilot-survey-after-" + engine + "-" + width + ".png", fullPage: true });
      await page.locator("#pilot-delight").selectOption("5");
      await page.locator("#pilot-comment").fill("Без личных данных\nКод: T10");
      await page.locator("#pilot-copy").click();
      report = await page.locator("#pilot-export").inputValue();
      assert.match(report, /Приятность награды \(1–5\): 5/);
      assert.equal(report.includes("Личная задача не для отчёта"), false,
        "Private task titles must never enter the report");
      assert.equal(report.split("\n").filter(line => line.startsWith("Код:")).length, 1,
        "Multiline comments cannot forge report participant codes");
      assert.equal(report.includes("sdelano.game.v1"), false,
        "Game storage and wallet keys must remain private");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, "No mobile horizontal scrolling at " + width);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#pilot-delight").inputValue(), "5");
      assert.equal(await page.locator("#pilot-ease").inputValue(), "4");
      assert.deepEqual(errors, []);
      console.log("Delight pilot QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
