import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts", { recursive: true });
const origin = "http://127.0.0.1:8765";

try {
  for (const [width, stage, label] of [
    [320, "student", "Ученик"],
    [390, "hero", "Герой"],
    [1280, "master", "Мастер"]
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", req => {
      if (!["GET", "HEAD"].includes(req.method())) writes.push(req.method() + " " + req.url());
    });
    try {
      await page.goto(origin + "/fox-phone-preview.html?stage=" + stage,
        { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
      assert.equal(await page.locator("#phone-qa-review").getAttribute("open"), null,
        "Review must be collapsed so the task controls remain primary");
      assert.equal(await page.locator("#phone-review-copy").isDisabled(), true);
      assert.equal(await page.locator("#phone-qa-review fieldset").count(), 5);
      assert.equal(await page.locator("#phone-qa-review input[type=radio]").count(), 25);
      await page.locator("#phone-qa-review summary").click();
      await page.locator('input[name="review-look"][value="5"]').check();
      assert.equal(await page.locator("#phone-review-copy").isDisabled(), true,
        "Review must follow a real visible transformation");
      await page.locator("#phone-qa-complete").click();
      assert.equal(await page.locator("#phone-review-copy").isEnabled(), true,
        "At least one completed stage and one score may be copied");
      await page.locator('input[name="review-spark"][value="4"]').check();
      await page.locator('input[name="review-focus"][value="3"]').check();
      await page.locator("#phone-review-note").fill("Искры красивые, но размер можно увеличить.");
      const minTapHeight = await page.locator('.phone-review-scale label span').first()
        .evaluate(el => el.getBoundingClientRect().height);
      assert.ok(minTapHeight >= 44, "Touch targets must be at least 44px high");
      if (width === 320) {
        // Simulate a privacy-restricted mobile browser with no Clipboard API.
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
        });
      }
      await page.locator("#phone-review-copy").click();
      const text = await page.locator("#phone-review-output").inputValue();
      assert.match(text, /Fox Evolution v3 — отзыв/);
      assert.match(text, new RegExp("Открытая стадия: " + label));
      assert.match(text, /Внешний вид и размер: 5\/5/);
      assert.match(text, /Золотая вспышка: 4\/5/);
      assert.match(text, /Звук: не оценено/);
      assert.match(text, /Радость от превращения: не оценено/);
      assert.match(text, /Не отвлекает от дел: 3\/5/);
      assert.match(text, /Искры красивые, но размер можно увеличить/);
      assert.match(await page.locator("#phone-review-status").textContent(),
        /Отзыв скопирован|Доступ к буферу закрыт/);
      if (width === 320) {
        assert.equal(await page.locator("#phone-review-output").isVisible(), true,
          "Manual copy fallback must be visible when clipboard access is unavailable");
        assert.equal(await page.locator("#phone-review-output").evaluate(el => el.selectionStart), 0);
      }
      assert.deepEqual(writes, [], "Review must not submit a network request");
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [],
        "Review must never save to localStorage");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1,
        "Feedback panel must not overflow at " + width);
      await page.screenshot({
        path: "artifacts/fox-phone-feedback-" + engine + "-" + width + "-" + stage + ".png",
        fullPage: true
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("#phone-qa-review summary").click();
      assert.equal(await page.locator("#phone-review-note").inputValue(), "");
      assert.equal(await page.locator('input[name="review-look"]:checked').count(), 0,
        "Ratings must disappear on reload, never persist");
      assert.equal(await page.locator("#phone-review-copy").isDisabled(), true);
      assert.deepEqual(errors, [], "JavaScript errors: " + errors.join(" | "));
      console.log("Phone feedback QA passed:", engine, width, stage);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
