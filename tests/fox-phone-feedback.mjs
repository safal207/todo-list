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
    if (width === 390) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async data => { window.__nativeSharedReview = data; }
        });
      });
    }
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
      assert.equal(await page.locator(".phone-review-field:visible").count(), 1,
        "Only one question should take vertical space on a phone");
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 1 из 5/);
      assert.equal(await page.locator("#phone-review-actions").isVisible(), false,
        "Comment and share controls must not crowd the individual question");
      await page.locator('input[name="review-look"][value="5"]').check();
      assert.equal(await page.locator("#phone-review-copy").isEnabled(), true,
        "Users who already watched the animation can share rated feedback without replaying");
      assert.match(await page.locator("#phone-review-status").textContent(),
        /Превращение в этой вкладке ещё не запускалось/);
      await page.locator("#phone-qa-complete").click();
      assert.equal(await page.locator("#phone-review-copy").isEnabled(), true,
        "At least one completed stage and one score may be copied");
      await page.locator("#phone-review-next").click();
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 2 из 5/);
      await page.locator('input[name="review-spark"][value="4"]').check();
      await page.locator("#phone-review-next").click();
      await page.locator("#phone-review-next").click();
      await page.locator("#phone-review-next").click();
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 5 из 5/);
      await page.locator('input[name="review-focus"][value="3"]').check();
      assert.equal(await page.locator(".phone-review-field:visible").count(), 1);
      // Measure the active question BEFORE finishing the wizard: the finish
      // screen intentionally hides all questions and their touch targets.
      const minTapHeight = await page.locator(".phone-review-field:visible .phone-review-scale label span")
        .first().evaluate(el => el.getBoundingClientRect().height);
      assert.ok(minTapHeight >= 44, "Touch targets must be at least 44px high");
      await page.locator("#phone-review-prev").click();
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 4 из 5/);
      await page.locator("#phone-review-next").click();
      assert.equal(await page.locator("#phone-review-next").textContent(), "Завершить оценку");
      await page.locator("#phone-review-next").click();
      assert.equal(await page.locator("#phone-review-finish").isVisible(), true,
        "Last question must visibly finish the review");
      assert.equal(await page.locator("#phone-review-actions").isVisible(), true,
        "Copy, comment and share are available at completion");
      assert.match(await page.locator("#phone-review-finish-text").textContent(), /3 из 5/);
      assert.equal(await page.locator(".phone-review-field:visible").count(), 0,
        "Completion must replace question navigation instead of stopping abruptly");
      assert.equal(await page.locator(".phone-review-nav").isVisible(), false);
      await page.locator("#phone-review-edit").click();
      assert.equal(await page.locator("#phone-review-actions").isVisible(), false,
        "Editing hides the finish-only controls again");
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 1 из 5/);
      assert.equal(await page.locator('input[name="review-look"][value="5"]').isChecked(), true);
      for (let i = 0; i < 4; i++) await page.locator("#phone-review-next").click();
      await page.locator("#phone-review-next").click();
      assert.equal(await page.locator("#phone-review-finish").isVisible(), true);
      await page.locator("#phone-review-note").fill("Искры красивые, но размер можно увеличить.");
      if (width === 390) {
        assert.equal(await page.locator("#phone-review-share").isVisible(), true);
        assert.equal(await page.locator("#phone-review-share").isEnabled(), true);
        await page.locator("#phone-review-share").click();
        const shared = await page.evaluate(() => window.__nativeSharedReview);
        assert.match(shared?.text || "", /Открытая стадия: Герой/);
        assert.match(shared?.text || "", /Золотая вспышка: 4\/5/);
        assert.equal(shared?.title, "Сделано · Fox Evolution");
      }
      if (width === 320) {
        // Simulate a privacy-restricted mobile browser with no Clipboard API.
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
        });
      }
      await page.locator("#phone-review-copy").click();
      const text = await page.locator("#phone-review-output").inputValue();
      assert.match(text, /Fox Evolution v3 — отзыв/);
      assert.match(text, /Просмотр в этой вкладке: да/);
      assert.match(text, new RegExp("Открытая стадия: " + label));
      assert.match(text, /Внешний вид и размер: 5\/5/);
      assert.match(text, /Золотая вспышка: 4\/5/);
      assert.match(text, /Звук: не оценено/);
      assert.match(text, /Радость от превращения: не оценено/);
      assert.match(text, /Не отвлекает от дел: 3\/5/);
      assert.match(text, /Искры красивые, но размер можно увеличить/);
      await page.waitForFunction(() =>
        /Отзыв скопирован|Доступ к буферу закрыт/.test(
          document.querySelector("#phone-review-status")?.textContent || ""
        ), null, { timeout: 5000 });
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
      assert.match(await page.locator("#phone-review-step").textContent(), /Вопрос 1 из 5/);
      assert.equal(await page.locator(".phone-review-field:visible").count(), 1);
      assert.deepEqual(errors, [], "JavaScript errors: " + errors.join(" | "));
      console.log("Phone feedback QA passed:", engine, width, stage);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
