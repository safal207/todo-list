import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
try {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", err => errors.push(err.message));
    try {
      // Deterministic notification transport; no real OS prompts in CI.
      await page.addInitScript(() => {
        const history = { permissionRequests: 0, registrations: 0, notifications: [], closed: 0 };
        window.__pauseAlertsQA = history;
        const fake = {
          permission: "default",
          requestPermission() {
            history.permissionRequests++;
            this.permission = "granted";
            return Promise.resolve("granted");
          }
        };
        Object.defineProperty(window, "Notification", { configurable: true, value: fake });
        const registration = {
          active: { state: "activated" },
          async showNotification(title, options) {
            history.notifications.push({ title, options });
          },
          async getNotifications() { return [{ close() { history.closed++; } }]; }
        };
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          value: {
            register: async () => { history.registrations++; return registration; },
            ready: Promise.resolve(registration)
          }
        });
      });
      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
      });
      await page.locator("#game-preview-toggle").click();
      const toggle = page.locator("#game-focus-alert-toggle");
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.deepEqual(await page.evaluate(() => [
        window.__pauseAlertsQA.permissionRequests, window.__pauseAlertsQA.registrations
      ]), [0, 0], "No automatic permission requests or service worker");
      await page.locator("#game-focus-start").click();

      // Notification disabled by default; pause still shows frozen countdown.
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.match(await page.locator("#game-focus-status").textContent(), /Осталось 15:00/);
      assert.equal(await page.locator("#game-focus-resume").isVisible(), true);
      assert.equal(await page.evaluate(() => window.__pauseAlertsQA.notifications.length), 0);

      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await toggle.click();
      await page.waitForFunction(() => document.querySelector("#game-focus-alert-toggle")
        .getAttribute("aria-pressed") === "true");
      assert.deepEqual(await page.evaluate(() => [
        window.__pauseAlertsQA.permissionRequests, window.__pauseAlertsQA.registrations,
        localStorage.getItem("sdelano.focus.pause-alerts.v1")
      ]), [1, 1, "on"]);

      await page.locator("#game-focus-resume").click();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => window.__pauseAlertsQA.notifications.length === 1);
      const sent = await page.evaluate(() => window.__pauseAlertsQA.notifications[0]);
      assert.equal(sent.title, "Фокус на паузе");
      assert.match(sent.options.body, /Осталось 15:00/);
      assert.equal(sent.options.tag, "sdelano-focus-paused");
      assert.equal(sent.options.silent, true);
      assert.equal(sent.options.renotify, false);
      assert.equal(await page.evaluate(() => window.sdelanoGame.inspect().xp), 0);
      assert.equal(await page.evaluate(() => window.__pauseAlertsQA.notifications.length), 1,
        "Repeated visibilitychange must not send another notification");

      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await page.locator("#game-focus-resume").click();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.evaluate(() => window.__pauseAlertsQA.notifications.length), 1,
        "Turning alerts off suppresses all new notifications");
      assert.deepEqual(errors, []);
      console.log("Focus pause notification QA passed:", engine, width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
