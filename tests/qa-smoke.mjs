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
    assert.equal(await page.locator(".site-header .brand-icon").evaluate((el) => getComputedStyle(el).animationName), "brand-check");
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
    assert.match(shareZeroText, /0% — 0 из 1 задач выполнено/);
    assert.ok(!shareZeroText.includes(label), "Private task title must not be shared");
    assert.equal(await page.locator("#share-preview-percentage").textContent(), "0%");
    const telegram = new URL(await page.locator("#share-telegram").getAttribute("href"));
    const whatsApp = new URL(await page.locator("#share-whatsapp").getAttribute("href"));
    const referralURL = new URL(telegram.searchParams.get("url"));
    assert.equal(referralURL.searchParams.get("share"), "1");
    assert.equal(referralURL.searchParams.get("done"), "0");
    assert.equal(referralURL.searchParams.get("total"), "1");
    assert.equal(referralURL.searchParams.get("utm_campaign"), "telegram_invite_v1");
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
    assert.match(shareZero.text, /0% — 0 из 1 задач выполнено/);
    assert.match(shareZero.url, /\/invite\/\?share=1/);
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
    assert.match(photoPayload.text, /\/invite\/\?share=1/);
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

    await task.locator(".task-checkbox").check();
    assert.equal(await page.locator("#first-step-guide").isVisible(), false);
    assert.equal(await page.locator("#first-win-card").isVisible(), true);
    assert.match(await page.locator("#first-win-title").textContent(), /Первый шаг сделан!/);
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
    assert.match((await task.locator(".task-clock").textContent()).trim(), /^Готово за /);
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
    assert.match(shareFull, /100% — 1 из 1 задач выполнено/);
    assert.match(shareFull, /Все задачи закрыты/);
    assert.ok(!shareFull.includes(label), "Do not share private task title");
    await page.locator("#share-close").click();

    // Partial progress must reflect the entire list, regardless of the filter.
    await page.locator("#task-title").fill("Private extra " + width);
    await page.locator("#task-form button[type=submit]").click();
    assert.equal(await page.locator("#percentage").textContent(), "50%");
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
    assert.equal(await page.locator('button[data-filter="all"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("li.task").count(), 2);
    await page.screenshot({ path: "artifacts/next-step-" + width + ".png", fullPage: true });
    await page.locator("#share-progress").click();
    await page.waitForFunction(() =>
      document.querySelector("#share-image-download")?.download === "sdelano-progress-1-of-2.jpg");
    assert.match(await page.locator("#share-poster-preview").getAttribute("alt"), /1 из 2.*50%/);
    const shareHalf = await page.locator("#share-ready-text").inputValue();
    assert.match(shareHalf, /50% — 1 из 2 задач выполнено/);
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
    assert.equal(await recipient.locator("h1").textContent(), "Твой ход. Начни с одной задачи!");
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
    assert.match(await recipient.locator("#start-own").getAttribute("href"), /\/todo-list\/\?utm_source=progress_share/);
    await recipient.goto(origin + "/", { waitUntil: "networkidle" });
    assert.equal(await recipient.locator("li.task").count(), 0, "Recipient starts with independent tasks");
    await recipient.locator("#task-title").fill("Recipient task");
    await recipient.locator("#task-form button[type=submit]").click();
    assert.equal(await recipient.locator("li.task").count(), 1);
    await recipient.goto(origin + "/invite/?done=9999&total=2", { waitUntil: "networkidle" });
    assert.match(await recipient.locator("#friend-score").textContent(),
      /Друг поделился результатом/, "Invalid share URL cannot inject a fake result");
    await recipientContext.close();
    await page.locator("li.task").filter({ hasText: "Private extra " + width })
      .locator(".delete-button").click();
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
    assert.match(copiedText, /100% — 1 из 1 задач выполнено/);
    assert.match(copiedText, /share=1/);
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

    await restored.locator(".task-checkbox").uncheck();
    const reopened = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(reopened.done, false);
    assert.ok(reopened.startedAt > completed.doneAt);
    assert.equal(reopened.elapsedMs, completed.elapsedMs);
    assert.equal((await page.locator("#percentage").textContent()).trim(), "0%");
    assert.equal(await page.locator("#next-action-button").textContent(), "Перейти к следующей задаче",
      "Reopening a task must re-evaluate the next action");
    await restored.locator(".delete-button").click();
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
    const legacy = page.locator("li.task").filter({ hasText: "Legacy done" });
    assert.match((await legacy.locator(".task-clock").textContent()).trim(), /время неизвестно/);
    const long = page.locator("li.task").filter({ hasText: "Long task" });
    await long.locator(".task-checkbox").check();
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
    assert.equal(await page.locator("#first-step-guide").isVisible(), false,
      "A user who completed a task before must not see onboarding again");
    await page.locator(".task-checkbox").check();
    assert.equal(await page.locator("#first-win-card").isVisible(), false,
      "A historical completion must suppress the new-user first win");
    // Dismissal should preserve normal navigation and remove the card from tab order.
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
        { title: "Fresh onboarding test", done: false }
      ]));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".task-checkbox").check();
    await page.locator("#first-win-dismiss").click();
    assert.equal(await page.locator("#first-win-card").isVisible(), false);
    assert.equal(await page.locator("#share-progress").evaluate(el => document.activeElement === el), true);

    // Achievement #3: three different completed tasks (not one task checked thrice).
    const awardContext = await browser.newContext({ viewport: { width, height } });
    try {
      const award = await awardContext.newPage();
      const awardErrors = [];
      award.on("pageerror", (error) => awardErrors.push(error.message));
      await award.goto(origin, { waitUntil: "networkidle" });
      await award.evaluate(() => localStorage.clear());
      await award.reload({ waitUntil: "networkidle" });
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#three-steps-badge").isVisible(), false);
      for (let n = 1; n <= 3; n++) {
        const name = "Private QA milestone " + width + "-" + n;
        await award.locator("#task-title").fill(name);
        await award.locator('#task-form button[type="submit"]').click();
        const item = award.locator("li.task").nth(n - 1);
        assert.match(await item.textContent(), new RegExp(name));
        await item.locator(".task-checkbox").check();
        if (n === 1) {
          assert.equal(await award.locator("#first-win-card").isVisible(), true,
            "First victory still works independently");
        } else if (n === 2) {
          assert.equal(await award.locator("#three-steps-card").isVisible(), false,
            "Two steps must not unlock the award");
          assert.equal(await award.locator("#three-steps-badge").isVisible(), false);
        }
      }
      assert.equal(await award.locator("#three-steps-card").isVisible(), true);
      assert.match(await award.locator("#three-steps-title").textContent(), /3 ШАГА СДЕЛАНО/);
      assert.equal(await award.locator("#first-win-card").isVisible(), false,
        "The third-step card replaces first-win rather than stacking celebrations");
      assert.equal(await award.locator("#next-action").isVisible(), false,
        "Do not stack three competing CTAs");
      assert.equal(await award.locator("#three-steps-badge").isVisible(), false,
        "Compact award is shown after the celebration");
      assert.equal(await award.locator("#task-toast").evaluate(el =>
        el.classList.contains("is-visible")), false,
        "A prior completion toast must not cover the milestone award");
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
      assert.match(awardShare, /3 из 3 задач выполнено/);
      assert.ok(!awardShare.includes("Private QA milestone"),
        "Sharing the milestone must not disclose task names");
      await award.locator("#share-close").click();
      await award.locator("#three-steps-next").click();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true);
      assert.equal(await award.locator("#task-title").evaluate(el => document.activeElement === el), true);
      assert.equal(await award.locator("li.task").count(), 3,
        "Next button must not create a new task");
      assert.equal(await award.locator("#next-action").isVisible(), true);

      const third = award.locator("li.task").nth(2).locator(".task-checkbox");
      await third.uncheck();
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true,
        "Earned awards persist when a task is reopened");
      await third.check();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false,
        "Rechecking the same task must not trigger the award twice");
      await award.reload({ waitUntil: "networkidle" });
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true,
        "Earned achievement survives reload");
      await award.locator("li.task").nth(2).locator(".delete-button").click();
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true,
        "Deleting a completed task must not revoke an earned milestone");

      // Three pre-existing finished tasks should earn the compact badge
      // without a misleading newly-unlocked celebration.
      await award.evaluate(() => {
        localStorage.clear();
        localStorage.setItem("todo-list.tasks.v1", JSON.stringify([
          { title: "Legacy award one", done: true },
          { title: "Legacy award two", done: true },
          { title: "Legacy award three", done: true }
        ]));
      });
      await award.reload({ waitUntil: "networkidle" });
      assert.equal(await award.locator("#three-steps-card").isVisible(), false,
        "Old achievements should not replay on page load");
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true);

      // Toggling one single task repeatedly does not count as 3 distinct tasks.
      await award.evaluate(() => localStorage.clear());
      await award.reload({ waitUntil: "networkidle" });
      await award.locator("#task-title").fill("Only one task");
      await award.locator('#task-form button[type="submit"]').click();
      const oneTask = award.locator("li.task .task-checkbox");
      await oneTask.check();
      await award.locator("#first-win-dismiss").click();
      await oneTask.uncheck();
      await oneTask.check();
      await oneTask.uncheck();
      await oneTask.check();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#three-steps-badge").isVisible(), false);
      assert.equal(await award.evaluate(() => localStorage.getItem("sdelano.three-steps.v1")), null);
      // New third distinct task: dismiss should leave a usable next-step button.
      for (let n = 2; n <= 3; n++) {
        await award.locator("#task-title").fill("Distinct task " + n);
        await award.locator('#task-form button[type="submit"]').click();
        await award.locator("li.task").nth(n - 1).locator(".task-checkbox").check();
      }
      assert.equal(await award.locator("#three-steps-card").isVisible(), true);
      await award.locator("#three-steps-dismiss").click();
      assert.equal(await award.locator("#three-steps-card").isVisible(), false);
      assert.equal(await award.locator("#three-steps-badge").isVisible(), true);
      assert.equal(await award.locator("#next-action-button").evaluate(el => document.activeElement === el), true);
      assert.equal(awardErrors.length, 0, "Milestone JS errors: " + awardErrors.join("; "));
    } finally {
      await awardContext.close();
    }

    const oldPage = await page.goto(origin + "/goals/", { waitUntil: "domcontentloaded" });
    assert.equal(oldPage.status(), 404, "Old Big Goal page is removed");
    assert.equal(pageErrors.length, 0, "JS errors: " + pageErrors.join("; "));
    console.log("PASS " + width + "x" + height +
      ": three-step achievement, contextual upsell, tripwire first-win, responsive layout, timers, referral sharing, legacy storage, removed goals");
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
