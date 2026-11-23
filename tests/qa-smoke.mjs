import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browserType = { chromium, firefox, webkit }[engine];
const browser = await browserType.launch({
  headless: true,
  executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const errors = [];
mkdirSync("artifacts", { recursive: true });

async function editTask(control, action = "click") {
  await control[action]();
  await control.page().locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
}

async function showProgress(page) {
  await page.evaluate(() => {
    const toggle = document.querySelector("#progress-toggle");
    if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
  });
}

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
    // Welcome can auto-close while WebKit finishes networkidle and layout.
    // Enter only if the dialog is still open; never wait on a hidden button.
    await page.evaluate(() => {
      const welcome = document.querySelector("#welcome");
      if (welcome?.open) document.querySelector("#welcome-start")?.click();
    });
    await showProgress(page);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#progress-toggle").getAttribute("aria-expanded"), "false",
      "Returning to the app starts with a compact progress bar");
    assert.equal(await page.locator("#progress-details").isVisible(), false);
    assert.equal(await page.locator("#progress-summary").isVisible(), true);
    assert.equal(await page.locator("#share-progress").isVisible(), true,
      "Share button must stay visible even when progress details are collapsed");
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-dialog").isVisible(), true);
    await page.locator("#share-close").click();
    const progressAboveTasks = await page.evaluate(() =>
      document.querySelector("#progress-panel").getBoundingClientRect().bottom <=
      document.querySelector(".task-section").getBoundingClientRect().top + 1);
    assert.equal(progressAboveTasks, true, "Progress must be directly above the task list");
    await showProgress(page);
    assert.equal(await page.locator("#progress-details").isVisible(), true);
    assert.equal(await page.title(), "Хватит кормить задачи «завтраками». Сделано!");
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute("content"),
      "Хватит кормить задачи «завтраками». Сделано!");
    assert.match(await page.locator('meta[property="og:description"]').getAttribute("content"),
      /Меньше «потом». Больше «готово». Жми и делай!/);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute("content"),
      "https://safal207.github.io/todo-list/");
    // Social crawlers must receive a stable raster OG image with a visible CTA.
    const sharePoster = "https://safal207.github.io/todo-list/assets/share-step-1-v2.jpg";
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), sharePoster);
    assert.equal(await page.locator('meta[property="og:image:secure_url"]').getAttribute("content"), sharePoster);
    assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute("content"), sharePoster);
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute("content"), "summary_large_image");
    assert.equal(await page.locator('meta[property="og:image:type"]').getAttribute("content"), "image/jpeg");
    assert.equal(await page.locator('meta[property="og:image:width"]').getAttribute("content"), "1200");
    assert.equal(await page.locator('meta[property="og:image:height"]').getAttribute("content"), "630");
    assert.match(await page.locator('meta[property="og:image:alt"]').getAttribute("content"), /ЗАПИШИ ЗАДАЧУ/);
    if (width === 390) {
      const posterResponse = await page.request.get(origin + "/assets/share-step-1-v2.jpg");
      assert.equal(posterResponse.status(), 200, "Poster must be published as a real file");
      assert.match(posterResponse.headers()["content-type"] ?? "", /^image\/jpeg/);
      const posterBytes = await posterResponse.body();
      assert.ok(posterBytes.length > 100000, "Poster should not be empty");
      assert.equal(posterBytes.subarray(0, 2).toString("hex"), "ffd8");
      assert.ok(posterBytes.length < 500000, "Compact preview for Telegram");
    }
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://safal207.github.io/todo-list/");
    assert.equal(await page.locator("#page-heading").textContent(), "Список задач");
    assert.equal(await page.locator(".site-header .brand-icon").count(), 1);
    assert.equal(await page.locator(".mini-hero p:not(.flavor-kicker)").textContent(), "Одно дело — одна победа. Прожарим?");
    assert.equal(await page.locator(".flavor-kicker").textContent(), "Дела со вкусом");
    const mascot = page.locator(".hero-mascot");
    assert.ok(await mascot.evaluate(img => img.complete && img.naturalWidth > 0), "The fox mascot image must load");
    assert.equal(await mascot.evaluate(img => getComputedStyle(img).animationName), "mascot-hello");
    assert.equal(await page.locator("#start-button").count(), 0);
    assert.equal(await page.locator("#feedback-toggle").textContent(), "Отклик: вкл");
    assert.equal(await page.locator("#task-form").isVisible(), true);
    assert.equal(await page.locator("#share-progress").isEnabled(), true,
      "Sharing action should never appear broken/disabled");
    // Tripwire: the new user starts with one small, achievable step.
    assert.equal(await page.locator("#first-step-guide").isVisible(), true);
    assert.match(await page.locator("#first-step-label").textContent(), /МИССИЯ 1 ИЗ 2/);
    assert.equal(await page.locator("#first-win-card").isVisible(), false);
    assert.equal(await page.locator("#next-action").isVisible(), false,
      "New users should see only the first mission, not competing upsells");
    await page.locator("#first-step-cta").click();
    assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true);
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-dialog").isVisible(), true);
    assert.equal(await page.locator("#share-empty-action").isVisible(), true);
    assert.equal(await page.locator("#share-actions").isVisible(), false);
    await page.locator("#share-create-task").click();
    assert.equal(await page.locator("#share-dialog").isVisible(), false);
    assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true);
    assert.match(await page.locator("#share-progress-hint").textContent(), /Личные задачи останутся у тебя/);

    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      heroBottom: document.querySelector(".mini-hero").getBoundingClientRect().bottom,
      formTop: document.querySelector("#task-form").getBoundingClientRect().top,
      formBottom: document.querySelector("#task-form").getBoundingClientRect().bottom
    }));
    assert.ok(layout.scroll <= layout.width + 1, "Horizontal overflow: " + JSON.stringify(layout));
    assert.ok(layout.heroBottom <= layout.formTop && layout.formBottom <= height,
      "The start panel and complete add form must fit on the first screen: " + JSON.stringify(layout));
    await page.screenshot({ path: "artifacts/tasks-" + width + ".png", fullPage: true });

    const label = "QA smoke " + width;
    await page.locator("#task-title").fill(label);
    await editTask(page.locator("#task-form button[type=submit]"));
    const task = page.locator("li.task").filter({ hasText: label });
    assert.equal(await task.count(), 1);
    assert.match(await page.locator("#first-step-label").textContent(), /МИССИЯ 2 ИЗ 2/);
    assert.match(await page.locator("#first-step-title").textContent(), /Закрой первую задачу/);
    assert.equal(await page.locator("#next-action").isVisible(), false);
    // Even if the active task is hidden by the Done filter, CTA must reveal and focus it.
    await page.locator('button[data-filter="done"]').click();
    await page.locator("#first-step-cta").click();
    assert.equal(await task.isVisible(), true);
    assert.equal(await task.locator(".task-checkbox").evaluate(el => document.activeElement === el), true);
    await page.locator("#share-progress").click();
    const shareZeroText = await page.locator("#share-ready-text").inputValue();
    assert.match(shareZeroText, /0 из 1 дел \(0%\)/);
    assert.ok(!shareZeroText.includes(label), "Private task title must not be shared");
    assert.equal(await page.locator("#share-preview-percentage").textContent(), "0%");
    assert.equal(await page.getByRole("link", { name: "Ссылка в Telegram" }).isVisible(), true);
    const telegram = new URL(await page.locator("#share-telegram").getAttribute("href"));
    const whatsApp = new URL(await page.locator("#share-whatsapp").getAttribute("href"));
    const referralURL = new URL(telegram.searchParams.get("url"));
    assert.equal(referralURL.search, "?r=0-1");
    assert.equal(referralURL.pathname, "/todo-list/invite/",
      "Telegram shares must use a new canonical OG page, not the cached homepage");
    assert.match(whatsApp.searchParams.get("text"), /Твой ход!/);
    assert.ok(!telegram.toString().includes(encodeURIComponent(label)));
    await page.locator("#share-close").click();

    await page.evaluate(() => {
      window.__shares = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => { window.__shares.push(payload); }
      });
    });
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-native").isVisible(), true);
    await page.locator("#share-native").click();
    const shareZero = await page.evaluate(() => window.__shares[0]);
    assert.match(shareZero.text, /0 из 1 дел \(0%\)/);
    assert.equal(shareZero.url, referralURL.href);
    assert.ok(!JSON.stringify(shareZero).includes(label), "Native share must hide task name");
    await page.locator("#share-close").click();

    // Android fallback: send actual JPEG bytes as a native photo attachment,
    // independent of Telegram's cached link preview.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true, value: (data) => Boolean(data.files?.length)
      });
    });
    await page.locator("#share-progress").click();
    await page.waitForFunction(() => !document.querySelector("#share-image-native").hidden);
    const downloadLink = page.locator("#share-image-download");
    await page.waitForFunction(() =>
      document.querySelector("#share-image-download")?.download === "sdelano-progress-0-of-1.jpg");
    assert.match(await downloadLink.getAttribute("href"), /^blob:/);
    assert.equal(await downloadLink.getAttribute("download"), "sdelano-progress-0-of-1.jpg");
    const posterZero = await page.evaluate(async () => {
      const img = document.querySelector("#share-poster-preview");
      await img.decode();
      const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
      const checksum = bytes.reduce((sum, value, i) => (sum + value * (i % 311 + 1)) % 2147483647, 0);
      return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        size: bytes.length, first: bytes[0], second: bytes[1], checksum, alt: img.alt };
    });
    assert.equal(posterZero.naturalWidth, 1200);
    assert.equal(posterZero.naturalHeight, 630);
    assert.ok(posterZero.size > 5000, "Generated JPG must be nonempty");
    assert.equal(posterZero.first, 0xff);
    assert.equal(posterZero.second, 0xd8);
    assert.match(posterZero.alt, /0 из 1/);
    const ctaRight = await page.evaluate(async () => {
      const prototype = CanvasRenderingContext2D.prototype;
      const fillText = prototype.fillText;
      let right;
      prototype.fillText = function (text, x, ...args) {
        if (text === "ЗАПИШИ ЗАДАЧУ") {
          right = (x + this.measureText(text).actualBoundingBoxRight) / this.canvas.width;
        }
        return fillText.call(this, text, x, ...args);
      };
      try {
        await window.achievementPoster.create({ done: 1, total: 1 });
        return right;
      } finally {
        prototype.fillText = fillText;
      }
    });
    assert.ok(ctaRight < 0.75, "Poster CTA clears Telegram's bottom-right timestamp");
    assert.ok(!(await page.evaluate(async () => {
      try { await window.achievementPoster.create({ done: 2, total: 1 }); return true; }
      catch { return false; }
    })), "Invalid progress must be rejected");
    await page.locator("#share-image-native").click();
    const photoPayload = await page.evaluate(() => {
      const event = window.__shares.at(-1);
      return { fileCount: event.files?.length, type: event.files?.[0]?.type,
        fileSize: event.files?.[0]?.size, fileName: event.files?.[0]?.name,
        text: event.text };
    });
    assert.equal(photoPayload.fileCount, 1);
    assert.equal(photoPayload.type, "image/jpeg");
    assert.ok(photoPayload.fileSize > 5000);
    assert.equal(photoPayload.fileName, "sdelano-progress-0-of-1.jpg");
    assert.ok(photoPayload.text.endsWith(referralURL.href), "Photo caption contains the short link");
    assert.ok(!photoPayload.text.includes(label), "Photo caption must hide private task names");
    await page.locator("#share-close").click();
    const started = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(started.done, false);
    assert.ok(started.startedAt > 0 && started.elapsedMs === 0, "Timer starts when task is added");
    await page.waitForFunction(() => {
      const value = document.querySelector("li.task .task-clock")?.textContent || "";
      return /^Время идёт · (?:[0-9]+ д )?[0-9]{2}:[0-9]{2}:(?:0[1-9]|[1-9][0-9])$/.test(value);
    }, null, { timeout: 3500 });
    await page.screenshot({ path: "artifacts/tasks-populated-" + width + ".png", fullPage: true });

    await editTask(task.locator(".task-checkbox"), "check");
    assert.equal(await page.locator("#first-step-guide").isVisible(), false);
    assert.equal(await page.locator("#first-win-card").isVisible(), true);
    assert.match(await page.locator("#first-win-title").textContent(), /Первый шаг сделан!/);
    assert.match(await page.locator("#first-win-detail").textContent(), /Дело было открыто/);
    assert.equal(await page.locator("#next-action").isVisible(), false,
      "A visible first victory must not compete with the next-step upsell");
    assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.first-win.v1")), "1");
    const firstWinLayout = await page.evaluate(() => ({
      viewport: window.innerWidth, full: document.documentElement.scrollWidth
    }));
    assert.ok(firstWinLayout.full <= firstWinLayout.viewport + 1,
      "First win card must not cause horizontal scroll");
    await page.screenshot({ path: "artifacts/first-win-" + width + ".png", fullPage: true });
    await page.locator("#first-win-share").click();
    assert.equal(await page.locator("#share-dialog").isVisible(), true,
      "First-win share button must reuse the existing referral flow");
    await page.locator("#share-close").click();
    await page.locator("#first-win-next").click();
    assert.equal(await page.locator("#first-win-card").isVisible(), false);
    assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true,
      "Next step CTA must focus the input instead of adding a fake task");
    assert.equal(await page.locator("li.task").count(), 1,
      "Next step CTA must not create tasks automatically");
    assert.equal(await page.locator("#next-action").isVisible(), true);
    assert.equal(await page.locator("#next-action-button").textContent(), "Записать новую задачу");
    await page.locator("#next-action-button").click();
    assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator("li.task").count(), 1,
      "Upsell CTA must not add a task without user's action");
    assert.equal((await page.locator("#percentage").textContent()).trim(), "100%");
    const completed = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(completed.done, true);
    assert.equal(completed.startedAt, null);
    assert.ok(completed.elapsedMs >= 1000, "Elapsed time saved on completion");
    assert.match((await task.locator(".task-clock").textContent()).trim(), /^Готово · было открыто /);
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-preview-percentage").textContent(), "100%");
    await page.waitForFunction(() =>
      document.querySelector("#share-image-download")?.download === "sdelano-progress-1-of-1.jpg");
    const posterFull = await page.evaluate(async () => {
      const img = document.querySelector("#share-poster-preview");
      await img.decode();
      const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
      return { checksum: bytes.reduce((sum, value, i) =>
        (sum + value * (i % 311 + 1)) % 2147483647, 0), alt: img.alt };
    });
    assert.notEqual(posterFull.checksum, posterZero.checksum,
      "Achievement JPG must change with real completion data");
    assert.match(posterFull.alt, /1 из 1.*100%/);
    const shareFull = await page.locator("#share-ready-text").inputValue();
    assert.match(shareFull, /1 из 1 дел \(100%\)\. Твой ход! Запиши задачу\./);
    assert.ok(!shareFull.includes(label), "Do not share private task title");
    await page.locator("#share-close").click();

    // Partial progress must reflect the entire list, regardless of the filter.
    await page.locator("#task-title").fill("Private extra " + width);
    await editTask(page.locator("#task-form button[type=submit]"));
    assert.equal(await page.locator("#percentage").textContent(), "50%");
    // In focus mode, completed rows can be tucked away and reopened independently.
    const completedToggle = page.locator("#completed-toggle");
    assert.equal(await completedToggle.isVisible(), true);
    assert.match(await completedToggle.textContent(), /Показать выполненные · 1/);
    assert.equal(await task.isVisible(), false, "Completed tasks are folded by default");
    await completedToggle.click();
    assert.equal(await completedToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await task.isVisible(), true);
    await completedToggle.click();
    assert.equal(await completedToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await task.isVisible(), false);
    assert.equal(await page.locator("#next-action").isVisible(), true);
    assert.equal(await page.locator("#next-action-button").textContent(), "Перейти к следующей задаче");
    assert.match(await page.locator("#next-detail").textContent(), /Private extra/);
    await page.locator('button[data-filter="done"]').click();
    assert.equal(await page.locator("li.task").filter({ hasText: "Private extra " + width }).isVisible(), false);
    await page.locator("#next-action-button").click();
    const nextCheckbox = page.locator("li.task").filter({ hasText: "Private extra " + width })
      .locator(".task-checkbox");
    assert.equal(await nextCheckbox.isVisible(), true,
      "CTA must reveal a task hidden by the completed-only filter");
    assert.equal(await nextCheckbox.evaluate(el => document.activeElement === el), true);
    assert.equal(await nextCheckbox.isChecked(), false,
      "Upsell must never mark a task complete on the user's behalf");
    assert.equal(await page.locator('button[data-filter="active"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("li.task").count(), 2);
    await page.screenshot({ path: "artifacts/next-step-" + width + ".png", fullPage: true });
    await page.locator("#share-progress").click();
    await page.waitForFunction(() =>
      document.querySelector("#share-image-download")?.download === "sdelano-progress-1-of-2.jpg");
    assert.match(await page.locator("#share-poster-preview").getAttribute("alt"), /1 из 2.*50%/);
    const shareHalf = await page.locator("#share-ready-text").inputValue();
    assert.match(shareHalf, /1 из 2 дел \(50%\)/);
    assert.ok(!shareHalf.includes("Private extra"));
    const shareLink = new URL((await page.locator("#share-telegram").getAttribute("href")));
    const receiverUrl = shareLink.searchParams.get("url");
    await page.locator("#share-close").click();

    // Referral upsell: the recipient sees the 50% result and their own blank list.
    const recipientContext = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: width < 600
    });
    const recipient = await recipientContext.newPage();
    await recipient.goto(origin + "/invite/" + new URL(receiverUrl).search, { waitUntil: "networkidle" });
    await showProgress(recipient);
    assert.equal(await recipient.locator("h1").textContent(), "Твой ход. Запиши одну задачу!");
    assert.equal(await recipient.locator('meta[property="og:url"]').getAttribute("content"),
      "https://safal207.github.io/todo-list/invite/");
    assert.equal(await recipient.locator('link[rel="canonical"]').getAttribute("href"),
      "https://safal207.github.io/todo-list/invite/");
    assert.equal(await recipient.locator('meta[property="og:image"]').getAttribute("content"),
      "https://safal207.github.io/todo-list/assets/share-step-1-v2.jpg");
    assert.match(await recipient.locator("#friend-score").textContent(), /1 из 2 задач \(50%\)/);
    assert.equal(await recipient.locator("img").getAttribute("src"), "../assets/share-step-1-v2.jpg");
    // Regression: Telegram's mobile webview previously magnified the poster and
    // clipped its text. Keep the *whole* image inside a bounded, visible frame.
    const posterLayout = await recipient.locator(".poster-frame img").evaluate((img) => {
      const box = img.getBoundingClientRect();
      const frame = img.parentElement.getBoundingClientRect();
      return {
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        width: box.width, height: box.height, bottom: box.bottom,
        frameWidth: frame.width, fit: getComputedStyle(img).objectFit,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
      };
    });
    assert.equal(posterLayout.naturalWidth, 1200, "Invite poster should load");
    assert.equal(posterLayout.naturalHeight, 630, "Invite poster should retain its dimensions");
    assert.equal(posterLayout.fit, "contain", "Image must never use cover cropping");
    assert.ok(posterLayout.width <= posterLayout.frameWidth + 1, "Poster wider than frame");
    assert.ok(posterLayout.height <= Math.min(posterLayout.viewportHeight * 0.35, 300) + 2,
      "Poster should be capped to avoid a giant zoomed image on a phone");
    assert.ok(posterLayout.scrollWidth <= posterLayout.viewportWidth + 1,
      "Invite poster causes horizontal overflow");
    assert.ok(posterLayout.bottom < posterLayout.viewportHeight * 0.8,
      "Entire poster should remain near the top of the first screen");
    assert.equal(await recipient.locator("#start-own").isVisible(), true);
    await recipient.screenshot({ path: "artifacts/referral-" + width + ".png", fullPage: true });
    assert.ok(!(await recipient.locator("body").textContent()).includes(label),
      "Recipient must not see the sender's task titles");
    await recipient.locator("#start-own").click();
    assert.equal(new URL(recipient.url()).searchParams.get("utm_source"), "progress_share");
    assert.equal(new URL(recipient.url()).searchParams.get("utm_campaign"), "telegram_invite_v1");
    assert.equal(await recipient.locator("li.task").count(), 0, "Recipient starts with independent tasks");
    await recipient.locator("#task-title").fill("Recipient task");
    await editTask(recipient.locator("#task-form button[type=submit]"));
    assert.equal(await recipient.locator("li.task").count(), 1);
    await editTask(recipient.locator(".task-checkbox"), "check");
    await recipient.reload();
    await showProgress(recipient);
    assert.equal(await recipient.locator(".task-checkbox").isChecked(), true,
      "The invited friend's first completion persists");
    await recipient.locator('button[data-filter="done"]').click();
    await editTask(recipient.locator(".task-checkbox"), "uncheck");
    await recipient.locator('button[data-filter="active"]').click();
    await editTask(recipient.locator(".task-checkbox"), "check");
    const funnel = await recipient.evaluate(() => window.sdelanoAnalytics.summary());
    for (const event of ["referral_opened", "referral_started", "referral_task_created",
      "referral_task_completed"]) {
      assert.equal(funnel.events[event], 1, "The funnel counts each step once");
    }
    assert.equal(funnel.referralConversion, 1);
    await recipient.goto(origin + "/invite/?share=1&done=1&total=2", { waitUntil: "networkidle" });
    await showProgress(recipient);
    assert.match(await recipient.locator("#friend-score").textContent(), /1 из 2 задач \(50%\)/,
      "Older shared links still display the result");
    await recipient.goto(origin + "/invite/?r=9999-2", { waitUntil: "networkidle" });
    await showProgress(recipient);
    assert.match(await recipient.locator("#friend-score").textContent(),
      /Друг поделился результатом/, "Invalid share URL cannot inject a fake result");
    await recipientContext.close();
    await editTask(page.locator("li.task").filter({ hasText: "Private extra " + width }).locator(".delete-button"));
    assert.equal(await page.locator("#percentage").textContent(), "100%");
    assert.equal(await page.locator("#next-action-button").textContent(), "Записать новую задачу",
      "Deleting the pending task must re-evaluate the next best action");

    // Explicit copy button with working clipboard, no native share dependency.
    await page.evaluate(() => {
      window.__copiedText = "";
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value) => { window.__copiedText = value; } }
      });
    });
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-native").isVisible(), false);
    await page.locator("#share-copy").click();
    await page.waitForFunction(() => window.__copiedText.includes("https://safal207.github.io/todo-list/"));
    const copiedText = await page.evaluate(() => window.__copiedText);
    assert.match(copiedText, /1 из 1 дел \(100%\)/);
    assert.match(copiedText, /\/invite\/\?r=1-1$/);
    assert.ok(!copiedText.includes(label), "Copied text must not contain private task name");
    assert.match(await page.locator("#share-feedback").textContent(), /скопированы/);
    assert.equal(await page.locator("#share-manual").evaluate(el => el.open), false,
      "Long text should be collapsed to keep dialog compact on phones");
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth, width: document.documentElement.scrollWidth
    }));
    assert.ok(overflow.width <= overflow.viewport + 1, "Share dialog causes overflow");
    assert.equal(await page.locator("#share-image-download").isVisible(), true);
    await page.screenshot({ path: "artifacts/share-progress-" + width + ".png", fullPage: true });

    // Reproduce blocked clipboard in embedded Android/WebView browsers.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: async () => { throw new Error("Blocked"); } }
      });
      document.execCommand = () => false;
    });
    await page.locator("#share-copy").click();
    assert.equal(await page.locator("#share-manual").evaluate(el => el.open), true,
      "Manual fallback must expose selectable text");
    assert.match(await page.locator("#share-feedback").textContent(), /Текст выделен/);
    await page.screenshot({ path: "artifacts/share-fallback-" + width + ".png", fullPage: true });
    await page.locator("#share-close").click();
    assert.ok(await page.evaluate(() => window.__vibrationEvents.length) >= 2, "Haptic calls on add and complete");

    await page.locator('button[data-filter="done"]').click();
    assert.equal(await task.isVisible(), true);
    await page.reload({ waitUntil: "networkidle" });
    await showProgress(page);
    const restored = page.locator("li.task").filter({ hasText: label });
    assert.equal(await restored.locator(".task-checkbox").isChecked(), true);
    assert.equal(await page.locator("#first-step-guide").isVisible(), false,
      "Mission must not restart for a returning user");
    assert.equal(await page.locator("#first-win-card").isVisible(), false,
      "One-time victory must not pop up again on reload");
    assert.equal(await page.locator("#next-action").isVisible(), true,
      "Returning users keep a gentle next-step action after reload");
    const frozen = (await restored.locator(".task-clock").textContent()).trim();
    await page.waitForTimeout(1250);
    assert.equal((await restored.locator(".task-clock").textContent()).trim(), frozen);

    await page.locator("#feedback-toggle").click();
    assert.equal(await page.locator("#feedback-toggle").textContent(), "Отклик: выкл");
    const mutedCount = await page.evaluate(() => window.__vibrationEvents.length);
    await page.locator('button[data-filter="all"]').click();
    assert.equal(await page.evaluate(() => window.__vibrationEvents.length), mutedCount);
    await page.locator("#feedback-toggle").click();

    await editTask(restored.locator(".task-checkbox"), "uncheck");
    const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(reopened.done, false);
    assert.ok(reopened.startedAt > completed.doneAt);
    assert.equal(reopened.elapsedMs, completed.elapsedMs);
    assert.equal((await page.locator("#percentage").textContent()).trim(), "0%");
    assert.equal(await page.locator("#next-action-button").textContent(), "Перейти к следующей задаче",
      "Reopening a task must re-evaluate the next action");
    await editTask(restored.locator(".delete-button"));
    assert.equal(await page.locator("li.task").count(), 0);
    assert.equal(await page.locator("#next-action").isVisible(), true);
    await page.locator("#next-action-button").click();
    assert.equal(await page.locator("#task-title").evaluate(el => document.activeElement === el), true,
      "After deleting every task, returning users can still start again");
    assert.equal(await page.locator("#share-progress").isEnabled(), true,
      "Empty state remains an actionable entry point");

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
    await showProgress(page);
    const legacy = page.locator("li.task").filter({ hasText: "Legacy done" });
    assert.match((await legacy.locator(".task-clock").textContent()).trim(), /время неизвестно/);
    const long = page.locator("li.task").filter({ hasText: "Long task" });
    await editTask(long.locator(".task-checkbox"), "check");
    assert.match((await long.locator(".task-clock").textContent()).trim(), /1 д 2 ч 3 мин/);
    const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1")));
    assert.ok(migrated[0].startedAt > 0 && migrated[0].elapsedMs === 0);

    // Legacy histories, even when all tasks were reopened, must not get fake first-win rewards.
    await page.evaluate(() => {
      localStorage.removeItem("sdelano.first-win.v1");
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
        { title: "Reopened historical task", done: false }
      ]));
      localStorage.setItem("sdelano.tasks.history.v1", JSON.stringify([
        { action: "done", at: Date.now() - 100000 }
      ]));
    });
    await page.reload({ waitUntil: "networkidle" });
    await showProgress(page);
    assert.equal(await page.locator("#first-step-guide").isVisible(), false,
      "A user who completed a task before must not see onboarding again");
    await editTask(page.locator(".task-checkbox"), "check");
    assert.equal(await page.locator("#first-win-card").isVisible(), false,
      "A historical completion must suppress the new-user first win");
    // Taking a break replaces the reward with a quiet return action.
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
        { title: "Fresh onboarding test", done: false }
      ]));
    });
    await page.reload({ waitUntil: "networkidle" });
    await showProgress(page);
    await editTask(page.locator(".task-checkbox"), "check");
    await page.locator("#next-break").click();
    assert.equal(await page.locator("#first-win-card").isVisible(), false);
    assert.equal(await page.locator("#next-step").textContent(), "Передышка");
    assert.equal(await page.locator("#next-action-button").evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator("#share-progress").isVisible(), true,
      "Sharing stays available even while taking a break");

    // Achievement #3: three different completed tasks (not one task checked thrice).
    const awardContext = await browser.newContext({ viewport: { width, height } });
    try {
      const award = await awardContext.newPage();
      const record = award.locator("#milestone-record");
      const goalHint = award.locator("#milestone-next-label");
      const goalProgress = award.locator("#milestone-next-progress");
      const thirdMilestone = award.locator('#milestone-track li[data-goal="3"].is-earned');
      const awardErrors = [];
      award.on("pageerror", (error) => awardErrors.push(error.message));
      await award.goto(origin, { waitUntil: "networkidle" });
      await showProgress(award);
      await award.locator("#welcome-start").click();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#progress-heading").textContent(), "Прогресс списка");
      assert.equal(await record.textContent(), "Рекорд списка — 0");
      assert.equal(await award.locator('#milestone-track li.is-earned').count(), 0);
      assert.equal(await award.locator('#milestone-track li.is-next').getAttribute("data-goal"), "1");
      assert.equal(await goalHint.textContent(), "До отметки 1 — ещё 1 дело.");
      assert.deepEqual(await goalProgress.evaluate(el =>
        ({ value: el.value, max: el.max })), { value: 0, max: 1 });
      for (let n = 1; n <= 3; n++) {
        const name = "Private QA milestone " + width + "-" + n;
        await award.locator("#task-title").fill(name);
        await editTask(award.locator('#task-form button[type="submit"]'));
        const item = award.locator("li.task").nth(n - 1);
        assert.match(await item.textContent(), new RegExp(name));
        await editTask(item.locator(".task-checkbox"), "check");
        assert.equal(await record.textContent(), "Рекорд списка — " + n);
        if (n === 1) {
          assert.equal(await award.locator('#milestone-track li.is-earned').count(), 1);
          assert.equal(await award.locator('#milestone-track li.is-next').getAttribute("data-goal"), "3");
          assert.deepEqual(await goalProgress.evaluate(el =>
            ({ value: el.value, max: el.max })), { value: 1, max: 3 });
          assert.equal(await award.locator("#first-win-card").isVisible(), true,
            "First victory still works independently");
        } else if (n === 2) {
          assert.equal(await award.locator('#milestone-track li.is-earned').count(), 1);
          assert.equal(await goalHint.textContent(), "До отметки 3 — ещё 1 дело.");
          assert.equal(await award.locator("#three-steps-card").isVisible(), false,
            "Two steps must not unlock the award");
        }
      }
      assert.equal(await award.locator("#three-steps-card").isVisible(), true);
      assert.equal(await award.locator('#milestone-track li.is-earned').count(), 2);
      assert.equal(await award.locator('#milestone-track li.is-next').getAttribute("data-goal"), "5");
      assert.equal(await goalHint.textContent(), "До отметки 5 — ещё 2 дела.");
      assert.match(await award.locator("#three-steps-title").textContent(), /3 ШАГА СДЕЛАНО/);
      assert.equal(await award.locator("#first-win-card").isVisible(), false,
        "The third-step card replaces first-win rather than stacking celebrations");
      assert.equal(await award.locator("#next-action").isVisible(), false,
        "Do not stack three competing CTAs");
      assert.equal(await award.evaluate(() => localStorage.getItem("sdelano.three-steps.v1")), "1");
      assert.equal(await award.locator("li.task").count(), 3);
      const awardLayout = await award.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth
      }));
      assert.ok(awardLayout.scroll <= awardLayout.width + 1,
        "Third-step reward must not create horizontal overflow");
      await award.screenshot({ path: "artifacts/three-steps-" + width + ".png", fullPage: true });
      await award.locator("#three-steps-share").click();
      assert.equal(await award.locator("#share-dialog").isVisible(), true);
      const awardShare = await award.locator("#share-ready-text").inputValue();
      assert.match(awardShare, /3 из 3 дел \(100%\)/);
      assert.ok(!awardShare.includes("Private QA milestone"),
        "Sharing the milestone must not disclose task names");
      await award.locator("#share-close").click();
      await award.locator("#three-steps-next").click();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await thirdMilestone.isVisible(), true);
      assert.equal(await award.locator("#three-steps-badge").count(), 0,
        "The roadmap shows the earned milestone without a duplicate badge");
      assert.equal(await award.locator("#task-title").evaluate(el => document.activeElement === el), true);
      assert.equal(await award.locator("li.task").count(), 3,
        "Next button must not create a new task");
      assert.equal(await award.locator("#next-action").isVisible(), true);

      const third = award.locator("li.task").nth(2).locator(".task-checkbox");
      await editTask(third, "uncheck");
      assert.equal(await record.textContent(), "Рекорд списка — 3",
        "Reopening a task must not erase an earned milestone");
      assert.equal(await thirdMilestone.isVisible(), true,
        "Earned awards persist when a task is reopened");
      assert.equal(await goalHint.textContent(), "До отметки 5 — ещё 3 дела.");
      assert.deepEqual(await goalProgress.evaluate(el =>
        ({ value: el.value, max: el.max })), { value: 2, max: 5 });
      await award.locator('button[data-filter="active"]').click();
      await editTask(third, "check");
      assert.equal(await award.locator("#three-steps-card").isVisible(), false,
        "Rechecking the same task must not trigger the award twice");
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await thirdMilestone.isVisible(), true,
        "Earned achievement survives reload");
      await award.locator('button[data-filter="done"]').click();
      await editTask(award.locator("li.task").nth(2).locator(".delete-button"));
      assert.equal(await record.textContent(), "Рекорд списка — 3");
      assert.equal(await thirdMilestone.isVisible(), true,
        "Deleting a completed task must not revoke an earned milestone");
      assert.equal(await goalHint.textContent(), "До отметки 5 — ещё 3 дела.");

      // Restore the third milestone from legacy tasks without replaying its celebration.
      await award.evaluate(() => {
        localStorage.clear();
        localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
          { title: "Legacy award one", done: true },
          { title: "Legacy award two", done: true },
          { title: "Legacy award three", done: true }
        ]));
      });
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      assert.equal(await award.locator("#three-steps-card").isVisible(), false,
        "Old achievements should not replay on page load");
      assert.equal(await thirdMilestone.isVisible(), true);
      assert.equal(await award.evaluate(() => localStorage.getItem("sdelano.milestone.record.v1")), "3",
        "Legacy completed tasks must seed the durable milestone record");

      // Move from 3 -> 5 -> 10 and make sure old achievements do not replay.
      for (let n = 4; n <= 10; n++) {
        await award.locator("#task-title").fill("Roadmap QA private " + n);
        await editTask(award.locator('#task-form button[type="submit"]'));
        await editTask(award.locator("li.task").nth(n - 1).locator(".task-checkbox"), "check");
        assert.equal(await record.textContent(), "Рекорд списка — " + n);
        if (n === 5 || n === 10) {
          assert.equal(await award.locator("#next-step").textContent(), n + " дел сделано!");
          assert.equal(await award.locator("#next-action[data-completion]").isVisible(), true);
        }
        if (n === 5) {
          assert.equal(await award.locator('#milestone-track li.is-earned').count(), 3);
          assert.equal(await award.locator('#milestone-track li.is-next').getAttribute("data-goal"), "10");
          assert.deepEqual(await goalProgress.evaluate(el =>
            ({ value: el.value, max: el.max })), { value: 5, max: 10 });
          await award.screenshot({ path: "artifacts/milestone-5-" + width + ".png", fullPage: true });
        }
      }
      assert.equal(await award.locator('#milestone-track li.is-earned').count(), 4);
      assert.equal(await award.locator('#milestone-track li.is-next').count(), 0);
      assert.equal(await goalHint.textContent(), "Все 4 этапа открыты.");
      assert.equal(await goalProgress.isVisible(), false);
      assert.equal(await award.locator("#three-steps-card").isVisible(), false,
        "Five- and ten-step milestones should not replay a three-step popup");
      assert.equal(await award.evaluate(() => localStorage.getItem("sdelano.milestone.record.v1")), "10");
      const roadmapWidth = await award.evaluate(() => ({
        viewport: innerWidth, actual: document.documentElement.scrollWidth
      }));
      assert.ok(roadmapWidth.actual <= roadmapWidth.viewport + 1,
        "Milestone roadmap must not cause horizontal scrolling");
      await award.screenshot({ path: "artifacts/milestone-10-" + width + ".png", fullPage: true });
      const tenth = award.locator("li.task").nth(9);
      await editTask(tenth.locator(".task-checkbox"), "uncheck");
      assert.equal(await record.textContent(), "Рекорд списка — 10",
        "Personal best survives task reopen");
      await award.locator('button[data-filter="active"]').click();
      await editTask(tenth.locator(".delete-button"));
      assert.equal(await record.textContent(), "Рекорд списка — 10",
        "Personal best survives task deletion");
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      assert.equal(await record.textContent(), "Рекорд списка — 10",
        "Milestones must survive reload");
      assert.equal(await award.locator('#milestone-track li.is-earned').count(), 4);

      // A migrated legacy first/third win stays earned even if old tasks are removed.
      await award.evaluate(() => {
        localStorage.clear();
        localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
          { title: "Old success one", done: true },
          { title: "Old success two", done: true },
          { title: "Old success three", done: true }
        ]));
      });
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      await award.locator('button[data-filter="done"]').click();
      await editTask(award.locator("li.task").nth(2).locator(".delete-button"));
      await editTask(award.locator("li.task").nth(1).locator(".delete-button"));
      await editTask(award.locator("li.task").nth(0).locator(".delete-button"));
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      assert.equal(await record.textContent(), "Рекорд списка — 3");
      assert.equal(await thirdMilestone.isVisible(), true);
      assert.equal(await goalHint.textContent(), "До отметки 5 — ещё 5 дел.");
      assert.equal(await award.locator("#first-step-guide").isVisible(), false);

      // Toggling one single task repeatedly does not count as 3 distinct tasks.
      await award.evaluate(() => {
        localStorage.clear();
        sessionStorage.removeItem("sdelano.welcome.session.v2");
      });
      await award.reload({ waitUntil: "networkidle" });
      await showProgress(award);
      await award.locator("#welcome-start").click();
      await award.locator("#task-title").fill("Only one task");
      await editTask(award.locator('#task-form button[type="submit"]'));
      const oneTask = award.locator("li.task .task-checkbox");
      await editTask(oneTask, "check");
      await award.locator("#next-break").click();
      await editTask(oneTask, "uncheck");
      await award.locator('button[data-filter="active"]').click();
      await editTask(oneTask, "check");
      await editTask(oneTask, "uncheck");
      await award.locator('button[data-filter="active"]').click();
      await editTask(oneTask, "check");
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.evaluate(() => localStorage.getItem("sdelano.three-steps.v1")), null);
      assert.equal(await record.textContent(), "Рекорд списка — 1",
        "Re-checking a single task cannot advance the record toward 3");
      assert.equal(await award.locator('#milestone-track li.is-earned').count(), 1);
      // A break closes the celebration and keeps the earned mark on the roadmap.
      for (let n = 2; n <= 3; n++) {
        await award.locator("#task-title").fill("Distinct task " + n);
        await editTask(award.locator('#task-form button[type="submit"]'));
        await editTask(award.locator("li.task").nth(n - 1).locator(".task-checkbox"), "check");
      }
      assert.equal(await award.locator("#three-steps-card").isVisible(), true);
      await award.locator("#next-break").click();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await thirdMilestone.isVisible(), true);
      assert.equal(await award.locator("#next-step").textContent(), "Передышка");
      assert.equal(await award.locator("#next-action-button").evaluate(el => document.activeElement === el), true);
      assert.equal(awardErrors.length, 0, "Milestone JS errors: " + awardErrors.join("; "));
    } finally {
      await awardContext.close();
    }

    const oldPage = await page.goto(origin + "/goals/", { waitUntil: "domcontentloaded" });
    await showProgress(page);
    assert.equal(oldPage.status(), 404, "Old Big Goal page is removed");
    assert.equal(pageErrors.length, 0, "JS errors: " + pageErrors.join("; "));
    console.log("PASS " + engine + " " + width + "x" + height +
      " : milestone roadmap 1-3-5-10, three-step achievement, contextual upsell, tripwire first-win, responsive layout, timers, referral sharing, legacy storage, removed goals");
  } catch (error) {
    errors.push(width + "x" + height + ": " + (error.stack || error.message));
    console.error("FAIL " + width + "x" + height + ": " + error.message);
    await page.screenshot({ path: "artifacts/failed-" + width + ".png", fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

for (const method of ["getItem", "setItem"]) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.addInitScript((method) => {
      const key = "todo-list.tasks.v1";
      const original = Storage.prototype[method];
      const originalGet = Storage.prototype.getItem;
      localStorage.setItem(key, JSON.stringify([{ title: "Existing task", done: false }]));
      window.__readStoredTasks = () => originalGet.call(localStorage, key);
      Storage.prototype[method] = function (name, ...args) {
        if (name === key) throw new DOMException("Storage unavailable", "SecurityError");
        return original.call(this, name, ...args);
      };
    }, method);
    await page.goto(origin);
    await showProgress(page);
    if (await page.locator("#welcome").isVisible()) {
      await page.locator("#welcome-start").click();
    }
    await page.locator("#task-title").fill("Session task");
    await editTask(page.locator("#task-form button"));
    await editTask(page.getByRole("checkbox", { name: "Session task" }), "check");
    assert.equal(await page.locator("#storage-warning").isVisible(), true);
    assert.equal(await page.evaluate(() => JSON.parse(window.__readStoredTasks())[0].title),
      "Existing task", "Unavailable task storage must keep existing tasks untouched");
  } catch (error) {
    errors.push(method + ": " + (error.stack || error.message));
  } finally {
    await context.close();
  }
}

const loopContext = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce"
});
try {
  const page = await loopContext.newPage();
  await page.goto(origin);
  await showProgress(page);
  await page.locator("#welcome-start").click();
  const input = page.locator("#task-title");
  for (const title of ["First task", "Second task", "Third task"]) {
    await input.fill(title);
    await editTask(page.locator("#task-form button"));
  }
  const first = page.getByRole("checkbox", { name: "First task", exact: true });
  const second = page.getByRole("checkbox", { name: "Second task", exact: true });
  const third = page.getByRole("checkbox", { name: "Third task", exact: true });
  const next = page.locator("#next-action-button");
  const active = page.locator('button[data-filter="active"]');
  const done = page.locator('button[data-filter="done"]');
  const hint = page.locator("#timer-hint");

  assert.match(await hint.textContent(), /После галочки покажем следующее дело/);
  assert.equal(await first.getAttribute("aria-describedby"), "completion-hint");
  await editTask(first, "tap");
  assert.equal(await active.getAttribute("aria-pressed"), "true");
  assert.equal(await first.isVisible(), false);
  assert.equal(await page.locator("li.task:visible").count(), 2);
  assert.equal(await second.evaluate(el => document.activeElement === el), true);
  assert.match(await hint.textContent(), /Отличная работа! Готово 1 из 3/);
  assert.equal(await page.locator("#first-win-next").textContent(), "К следующему делу");
  await done.click();
  await page.locator("#first-win-next").click();
  assert.equal(await active.getAttribute("aria-pressed"), "true");
  assert.equal(await second.evaluate(el => document.activeElement === el), true);
  assert.equal(await second.isChecked(), false);

  await page.locator('button[data-filter="all"]').click();
  await editTask(second, "tap");
  assert.equal(await active.getAttribute("aria-pressed"), "true");
  assert.equal(await second.isVisible(), false);
  assert.equal(await page.locator("li.task:visible").count(), 1);
  assert.equal(await third.evaluate(el => document.activeElement === el), true);
  assert.match(await hint.textContent(), /Готово 2 из 3/);
  assert.equal(await page.locator("#next-step").textContent(), "Сделано!");
  assert.equal(await page.locator("#next-action[data-completion]").isVisible(), true);
  assert.equal(await next.textContent(), "К следующему делу");
  await page.getByRole("button", { name: "Передохнуть", exact: true }).click();
  assert.equal(await page.locator("#next-step").textContent(), "Передышка");
  assert.match(await page.locator("#next-detail").textContent(), /Что помогло тебе закончить дело/);
  assert.equal(await next.textContent(), "Вернуться к делу");
  await page.reload();
  await showProgress(page);
  assert.equal(await page.locator("#next-action[data-break]").isVisible(), true);
  await next.click();
  assert.equal(await third.evaluate(el => document.activeElement === el), true);
  assert.equal(await third.isChecked(), false);
  assert.equal(await page.locator("#next-step").textContent(), "В работе");
  assert.equal(await page.locator("#share-progress").isVisible(), true);

  await editTask(third, "tap");
  assert.equal(await done.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("li.task:visible").count(), 3);
  assert.equal(await done.evaluate(el => document.activeElement === el), true);
  assert.match(await hint.textContent(), /Все дела сделаны! Прогресс 100%/);
  assert.equal(await page.locator("#progress").evaluate(el => el.value), 100);
  assert.equal(await page.locator("#three-steps-next").textContent(), "Записать ещё одно дело");
  await page.locator("#three-steps-next").click();
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator("li.task").count(), 3);

  await input.fill("Fourth task");
  await editTask(page.locator("#task-form button"));
  await editTask(page.getByRole("checkbox", { name: "Fourth task", exact: true }), "tap");
  assert.equal(await done.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#next-step").textContent(), "Сделано!");
  assert.equal(await next.textContent(), "Записать ещё одно дело");
  await next.click();
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator("li.task").count(), 4);

  // Feedback, break and the next task fit together even with a long mobile list.
  await page.evaluate(() => {
    const startedAt = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem("todo-list.tasks.v1", JSON.stringify(Array.from({ length: 8 }, (_, i) => ({
      title: "Queue task " + (i + 1), done: i === 0, elapsedMs: 0,
      startedAt: i === 0 ? null : startedAt
    }))));
  });
  await page.reload();
  await showProgress(page);
  await editTask(page.getByRole("checkbox", { name: "Queue task 2", exact: true }), "tap");
  assert.equal(await page.locator("#next-detail").textContent(), "Дело было открыто 2 ч.");
  assert.equal(await page.getByRole("button", { name: "Передохнуть", exact: true }).count(), 1);
  const visibleHandoff = await page.evaluate(() =>
    ["#timer-hint", "#next-break", "#tasks li:not([hidden])"].every(selector => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return bounds.top >= -1 && bounds.bottom <= innerHeight + 1 && bounds.height > 0;
    })
  );
  assert.equal(visibleHandoff, true, "Progress, break and the next task must fit in the mobile viewport");
} catch (error) {
  errors.push("task loop: " + (error.stack || error.message));
} finally {
  await loopContext.close();
}

const returnContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
try {
  const page = await returnContext.newPage();
  await page.goto(origin);
  await showProgress(page);
  for (const hasCompletedBefore of [false, true]) {
    await page.evaluate((hasCompletedBefore) => {
      localStorage.clear();
      const startedAt = Date.now() - 48 * 60 * 60 * 1000;
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
        { title: "Unfinished task", done: false, elapsedMs: 0, startedAt, doneAt: null }
      ]));
      if (hasCompletedBefore) localStorage.setItem("sdelano.first-win.v1", "1");
    }, hasCompletedBefore);
    await page.reload();
    await showProgress(page);
    const resume = page.getByRole("button", { name: "К задаче", exact: true });
    assert.equal(await resume.count(), 1, "Exactly one action resumes an unfinished task");
    await page.locator('button[data-filter="done"]').click();
    await resume.click();
    const task = page.getByRole("checkbox", { name: "Unfinished task" });
    assert.equal(await task.evaluate(el => document.activeElement === el), true);
    assert.equal(await task.isChecked(), false);
    await editTask(task, "check");
    assert.equal(await resume.isVisible(), false, "A completed list has no reminder");
  }
} catch (error) {
  errors.push("retention: " + (error.stack || error.message));
} finally {
  await returnContext.close();
}

const metricsContext = await browser.newContext();
try {
  const page = await metricsContext.newPage();
  await page.route(origin + "/", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>",
      '<meta name="sdelano-metrics-endpoint" content="/events"></head>');
    await route.fulfill({ response, body });
  });
  await page.route(origin + "/events", route => route.fulfill({ status: 204 }));
  await page.goto(origin + "/");
  await showProgress(page);
  await page.locator("#welcome-start").click();
  await page.locator("#task-title").fill("Private task title");
  const [request] = await Promise.all([
    page.waitForRequest(request => request.url() === origin + "/events" &&
      request.postDataJSON().event === "task_created"),
    page.locator("#task-form button").click()
  ]);
  assert.equal(request.method(), "POST");
  assert.deepEqual(request.postDataJSON(), { event: "task_created" });
} catch (error) {
  errors.push("metrics delivery: " + (error.stack || error.message));
} finally {
  await metricsContext.close();
}

// Product validation pilot: anonymous activation, first completion and D1 return.
// Reporting is explicitly shared by the participant; no task titles leave localStorage.
const pilotContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
try {
  const participant = await pilotContext.newPage();
  await participant.goto(origin + "/?pilot=T01");
  assert.equal(await participant.locator("#pilot-note").isVisible(), true,
    "Valid pilot invitation exposes a quiet report link");
  await participant.locator("#welcome-start").click();
  const started = await participant.evaluate(() => sdelanoAnalytics.pilotSummary());
  assert.equal(started.code, "T01");
  assert.equal(started.newUser, true);
  assert.equal(started.created, false);
  assert.equal(started.completed, false);
  assert.equal(started.returnedD1, false);

  await participant.locator("#task-title").fill("PRIVATE DO NOT EXPORT TITLE");
  await editTask(participant.locator("#task-form button"));
  assert.equal(await participant.evaluate(() => sdelanoAnalytics.pilotSummary().created), true);
  await editTask(participant.getByRole("checkbox", { name: "PRIVATE DO NOT EXPORT TITLE" }), "check");
  assert.equal(await participant.evaluate(() => sdelanoAnalytics.pilotSummary().completed), true);
  await participant.goto(origin + "/pilot/");
  assert.equal(await participant.locator("#pilot-content").isVisible(), true);
  assert.equal(await participant.locator("#pilot-code").textContent(), "T01");
  assert.match(await participant.locator("#pilot-returned").innerText(), /проверим завтра/);
  await participant.locator("#pilot-comment").fill("Было легко.");
  await participant.locator("#pilot-copy").click();
  const report = await participant.locator("#pilot-export").inputValue();
  assert.match(report, /Код: T01/);
  assert.match(report, /Новый пользователь: да/);
  assert.match(report, /Создал задачу: да/);
  assert.match(report, /Завершил задачу: да/);
  assert.match(report, /Комментарий.*Было легко/);
  assert.equal(report.includes("PRIVATE DO NOT EXPORT TITLE"), false,
    "Anonymous report must never include the task title");

  // Simulate a user returning on their next local calendar day.
  await participant.evaluate(() => {
    const key = "sdelano.pilot.v1";
    const p = JSON.parse(localStorage.getItem(key));
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    p.startedOn = [yesterday.getFullYear(), String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0")].join("-");
    localStorage.setItem(key, JSON.stringify(p));
  });
  await participant.goto(origin + "/");
  const returned = await participant.evaluate(() => sdelanoAnalytics.pilotSummary());
  assert.equal(returned.returnedD1, true);
  assert.equal(returned.code, "T01");
  assert.equal(await participant.locator("#pilot-note").isVisible(), true,
    "Pilot note persists even when returning without a code");
  await participant.goto(origin + "/?pilot=T02");
  assert.equal(await participant.evaluate(() => sdelanoAnalytics.pilotSummary().code), "T01",
    "Second code must not replace the original participant's cohort");
  await participant.goto(origin + "/pilot/");
  assert.match(await participant.locator("#pilot-returned").innerText(), /да/);
} catch (error) {
  errors.push("product pilot: " + (error.stack || error.message));
} finally {
  await pilotContext.close();
}

const noPilotContext = await browser.newContext();
try {
  const page = await noPilotContext.newPage();
  await page.goto(origin + "/?pilot=T11");
  assert.equal(await page.locator("#pilot-note").isVisible(), false,
    "Only the ten assigned codes opt into pilot measurements");
  assert.equal(await page.evaluate(() => sdelanoAnalytics.pilotSummary()), null);
  await page.goto(origin + "/pilot/");
  assert.equal(await page.locator("#pilot-absent").isVisible(), true);
  await page.goto(origin + "/invite/");
  await page.evaluate(() => localStorage.setItem("todo-list.tasks.v1",
    JSON.stringify([{ title: "Existing task", done: false }])));
  await page.goto(origin + "/?pilot=T02");
  const existing = await page.evaluate(() => sdelanoAnalytics.pilotSummary());
  assert.equal(existing.code, "T02");
  assert.equal(existing.newUser, false, "Existing users must not inflate new-user conversion");
} catch (error) {
  errors.push("pilot exclusions: " + (error.stack || error.message));
} finally {
  await noPilotContext.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
