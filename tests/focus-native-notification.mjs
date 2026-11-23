import assert from "node:assert/strict";
import { chromium } from "playwright";

// Genuine Chromium Notification and Service Worker APIs (no JS mocks).
// 127.0.0.1 is a potentially trustworthy origin for localhost testing.
// This confirms browser registration and stored notifications, NOT whether
// Android displays a visible OS notification when it freezes a background tab.
const origin = "http://127.0.0.1:8765";
const tag = "sdelano-focus-paused";
const browser = await chromium.launch({
  headless: process.env.SDELANO_QA_HEADED !== "1",
  executablePath: process.env.SDELANO_QA_EXECUTABLE
});
async function notes(page) {
  return page.evaluate(async tag => {
    const registration = await navigator.serviceWorker.getRegistration("./");
    const result = registration ? await registration.getNotifications({ tag }) : [];
    return result.map(item => ({
      title: item.title, body: item.body, tag: item.tag, silent: item.silent
    }));
  }, tag);
}
async function waitForNotification(page) {
  // Poll real getNotifications() calls from Node, *not* an async callback to
  // page.waitForFunction. Every observation is complete before it is checked.
  const until = Date.now() + 12_000;
  do {
    const found = await notes(page);
    if (found.length) return found[0];
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < until);
  throw new Error("Native notification never appeared in getNotifications()");
}
async function waitForNoNotification(page) {
  const until = Date.now() + 12_000;
  do {
    if ((await notes(page)).length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < until);
  throw new Error("Stale browser notification did not close");
}
async function ensureOpen(page) {
  if (await page.locator("#game-preview-toggle").getAttribute("aria-expanded") === "false")
    await page.locator("#game-preview-toggle").click();
}
async function background(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function foreground(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

try {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, serviceWorkers: "allow"
    });
    await context.grantPermissions(["notifications"], { origin });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    try {
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
      });
      await ensureOpen(page);
      assert.equal(await page.evaluate(() => window.Notification.permission), "granted");
      assert.equal(await page.locator("#game-focus-alert-toggle").getAttribute("aria-pressed"), "false");
      assert.deepEqual(await notes(page), [], "Before explicit opt-in, no notifications");

      // Permission was granted by the isolated test browser context;
      // the product switch must still be explicitly enabled by the user.
      await page.locator("#game-focus-alert-toggle").click();
      await page.waitForFunction(() =>
        document.querySelector("#game-focus-alert-toggle")?.getAttribute("aria-pressed") === "true");
      const worker = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return {
          active: Boolean(registration.active),
          url: registration.active?.scriptURL || "",
          scope: registration.scope
        };
      });
      assert.equal(worker.active, true, "The real Service Worker must activate");
      assert.ok(worker.url.endsWith("/focus-pause-sw.js"), "Correct worker, not a mock");
      assert.ok(worker.scope.startsWith(origin + "/"), "Worker scoped to the test origin");

      await page.locator("#game-focus-start").click();
      await background(page);
      const first = await waitForNotification(page);
      assert.equal(first.title, "Фокус на паузе");
      assert.match(first.body, /Осталось 15:00/);
      assert.equal(first.tag, tag);
      assert.equal(first.silent, true);
      assert.equal(await page.evaluate(() => window.sdelanoGame.inspect().xp), 0);

      await foreground(page);
      await waitForNoNotification(page);

      // Reload preserves the opted-in setting and does not prompt anew;
      // the real worker remains registered and active.
      await page.reload({ waitUntil: "networkidle" });
      await ensureOpen(page);
      assert.equal(await page.locator("#game-focus-alert-toggle").getAttribute("aria-pressed"), "true");
      assert.equal((await notes(page)).length, 0);
      assert.equal(await page.locator("#game-focus-resume").isVisible(), true);
      await page.locator("#game-focus-resume").click();
      await background(page);
      const second = await waitForNotification(page);
      assert.equal(second.title, "Фокус на паузе");
      assert.match(second.body, /Осталось 15:00/);

      await foreground(page);
      await page.locator("#game-focus-alert-toggle").click();
      assert.equal(await page.locator("#game-focus-alert-toggle").getAttribute("aria-pressed"), "false");
      assert.equal(await page.evaluate(() =>
        localStorage.getItem("sdelano.focus.pause-alerts.v1")), "off");
      await waitForNoNotification(page);
      assert.deepEqual(errors, []);
      console.log("Native Service Worker notification QA passed: chromium", width);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
