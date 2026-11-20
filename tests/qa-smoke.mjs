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
    assert.equal(await downloadLink.getAttribute("href"), "assets/share-step-1-v2.jpg");
    assert.equal(await downloadLink.getAttribute("download"), "sdelano-shag-1.jpg");
    await page.locator("#share-image-native").click();
    const photoPayload = await page.evaluate(() => {
      const event = window.__shares.at(-1);
      return { fileCount: event.files?.length, type: event.files?.[0]?.type,
        fileSize: event.files?.[0]?.size, text: event.text };
    });
    assert.equal(photoPayload.fileCount, 1);
    assert.equal(photoPayload.type, "image/jpeg");
    assert.ok(photoPayload.fileSize > 10000);
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
    assert.equal((await page.locator("#percentage").textContent()).trim(), "100%");
    const completed = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-list.tasks.v1"))[0]);
    assert.equal(completed.done, true);
    assert.equal(completed.startedAt, null);
    assert.ok(completed.elapsedMs >= 1000, "Elapsed time saved on completion");
    assert.match((await task.locator(".task-clock").textContent()).trim(), /^Готово за /);
    await page.locator("#share-progress").click();
    assert.equal(await page.locator("#share-preview-percentage").textContent(), "100%");
    const shareFull = await page.locator("#share-ready-text").inputValue();
    assert.match(shareFull, /100% — 1 из 1 задач выполнено/);
    assert.match(shareFull, /Все задачи закрыты/);
    assert.ok(!shareFull.includes(label), "Do not share private task title");
    await page.locator("#share-close").click();

    // Partial progress must reflect the entire list, regardless of the filter.
    await page.locator("#task-title").fill("Private extra " + width);
    await page.locator("#task-form button[type=submit]").click();
    assert.equal(await page.locator("#percentage").textContent(), "50%");
    await page.locator("#share-progress").click();
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
    await restored.locator(".delete-button").click();
    assert.equal(await page.locator("li.task").count(), 0);
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

    const oldPage = await page.goto(origin + "/goals/", { waitUntil: "domcontentloaded" });
    assert.equal(oldPage.status(), 404, "Old Big Goal page is removed");
    assert.equal(pageErrors.length, 0, "JS errors: " + pageErrors.join("; "));
    console.log("PASS " + width + "x" + height + ": responsive layout, timers, feedback, legacy storage, removed goals");
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
