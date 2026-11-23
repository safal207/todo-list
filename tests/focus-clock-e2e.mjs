import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

// Run the *actual UI focus timer* with Playwright's virtual performance clock.
// This verifies the time flow without forging an already-ready session.
// It does not reproduce a physical phone or 15 minutes of human attention.
const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const root = "http://127.0.0.1:8765/";
const key = "sdelano.focus.session.v1";
const snapshot = page => page.evaluate(k =>
  JSON.parse(sessionStorage.getItem(k) || "null"), key);
const balance = page => page.evaluate(() => {
  const state = window.sdelanoGame.inspect();
  return [state.xp, state.coins, state.energy, state.focusToday];
});
try {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      // Install before navigation: patches both setInterval and performance.now.
      await page.clock.install({ time: new Date("2026-11-23T12:00:00Z") });
      await page.goto(root, { waitUntil: "load" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open)
          document.querySelector("#welcome-start")?.click();
      });
      await page.locator("#game-preview-toggle").click();
      assert.equal(await page.locator("#game-focus-start").isVisible(), true);
      assert.deepEqual(await balance(page), [0, 0, 5, 0]);

      await page.locator("#game-focus-start").click();
      const id = (await snapshot(page)).id;
      assert.ok(id, "Starting focus persists a unique session ID");
      assert.equal((await snapshot(page)).status, "running");

      // First 30 seconds count while visible.
      await page.clock.fastForward(30_000);
      assert.equal(await page.locator("#game-focus-timer").textContent(), "14:30");
      const firstElapsed = (await snapshot(page)).elapsedMs;
      assert.ok(firstElapsed >= 29_800 && firstElapsed <= 30_200,
        "30 seconds of visible focus; tolerate up to 200ms browser scheduling skew");
      assert.deepEqual(await balance(page), [0, 0, 5, 0]);

      // Hiding the tab immediately pauses. Ten minutes while hidden must
      // count as precisely zero additional work, even with a virtual clock.
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true, get: () => true
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.locator("#game-focus-resume").isVisible(), true);
      assert.equal((await snapshot(page)).status, "paused");
      await page.clock.fastForward(600_000);
      assert.equal((await snapshot(page)).elapsedMs, firstElapsed,
        "Hidden/paused time must add exactly zero milliseconds");
      assert.deepEqual(await balance(page), [0, 0, 5, 0]);

      // Showing a tab never starts the focus without the user's Resume.
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true, get: () => false
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal((await snapshot(page)).status, "paused");
      await page.clock.fastForward(120_000);
      assert.equal((await snapshot(page)).elapsedMs, firstElapsed,
        "Hidden/paused time must add exactly zero milliseconds");

      // Only 14m29s of additional visible focus: claim must remain blocked.
      await page.locator("#game-focus-resume").click();
      await page.clock.fastForward(869_000);
      assert.equal(await page.locator("#game-focus-timer").textContent(), "00:01");
      assert.equal((await snapshot(page)).status, "running");
      const nearFinish = (await snapshot(page)).elapsedMs;
      assert.ok(nearFinish >= 898_800 && nearFinish < 900_000,
        "15 minutes of visible time must NOT be complete at this point");
      assert.equal(await page.locator("#game-focus-claim").isVisible(), false);
      assert.deepEqual(await balance(page), [0, 0, 5, 0]);

      // The 900th visible second enables claim; it never auto-credits XP.
      await page.clock.fastForward(1_000);
      assert.equal(await page.locator("#game-focus-timer").textContent(), "00:00");
      assert.equal((await snapshot(page)).status, "ready");
      assert.equal((await snapshot(page)).elapsedMs, 900_000);
      assert.equal(await page.locator("#game-focus-claim").isVisible(), true);
      assert.deepEqual(await balance(page), [0, 0, 5, 0]);

      await page.locator("#game-focus-claim").click();
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 5);
      assert.deepEqual(await balance(page), [5, 0, 4, 1]);
      assert.equal(await snapshot(page), null);
      assert.equal(await page.locator("#game-focus-start").isVisible(), true);
      assert.equal(await page.locator("#game-focus-claim").isVisible(), false);
      const repeat = await page.evaluate(id => window.sdelanoGame.claimFocus(id), id);
      assert.equal(repeat.awarded, false);
      assert.equal(repeat.reason, "unfinished",
        "Without a persisted READY session, a repeat is rejected");
      assert.deepEqual(await balance(page), [5, 0, 4, 1]);

      await page.reload({ waitUntil: "load" });
      assert.deepEqual(await balance(page), [5, 0, 4, 1]);
      assert.equal(await snapshot(page), null,
        "Reload cannot restart an already-rewarded focus session");
      assert.deepEqual(errors, []);
      console.log("Visible-time focus clock QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally { await browser.close(); }
