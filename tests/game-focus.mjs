import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await { chromium, firefox, webkit }[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
const FOCUS_MS = 15 * 60 * 1000;
const sessionKey = "sdelano.focus.session.v1";

async function enter(page) {
  await page.goto(origin, { waitUntil: "networkidle" });
  if (await page.locator("#welcome").evaluate(el => el.open)) await page.locator("#welcome-start").click();
  await page.locator("#game-preview-toggle").click();
}

async function claimWithFixture(page, id, elapsedMs = FOCUS_MS, status = "ready") {
  return page.evaluate(async ({ id, elapsedMs, status, sessionKey }) => {
    sessionStorage.setItem(sessionKey, JSON.stringify({ id, elapsedMs, status }));
    return window.sdelanoGame.claimFocus(id);
  }, { id, elapsedMs, status, sessionKey });
}

try {
  // Visual UI, pause when the tab is hidden, and paused session after reload.
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await enter(page);
    assert.equal(await page.locator("#game-energy").getAttribute("aria-label"), "Энергия: 5 из 5");
    assert.equal(await page.locator("#game-focus-timer").textContent(), "15:00");
    assert.equal(await page.locator("#game-focus-start").isVisible(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, "320px layout must not scroll horizontally");

    await page.locator("#game-focus-start").click();
    assert.equal(await page.locator("#game-focus-pause").isVisible(), true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.locator("#game-focus-resume").isVisible(), true,
      "Hiding the tab must pause focus");
    const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), sessionKey);
    assert.equal(stored.status, "paused");

    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#game-preview-toggle").click();
    assert.equal(await page.locator("#game-focus-resume").isVisible(), true,
      "Reload must not automatically resume hidden time");
    await page.locator("#game-focus-cancel").click();
    assert.equal(await page.locator("#game-focus-start").isVisible(), true);
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).energy, 5,
      "Cancelling focus must not spend energy");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // A claim needs a persisted READY session with >=15 minutes; one energy and
  // one XP grant are committed together. Duplicate claims are idempotent.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await enter(page);
    const underTime = await claimWithFixture(page, "focus-unit-1", FOCUS_MS - 1000);
    assert.equal(underTime.awarded, false);
    assert.equal(underTime.reason, "unfinished");
    const grant = await claimWithFixture(page, "focus-unit-1");
    assert.equal(grant.awarded, true);
    assert.equal(grant.xp, 5);
    assert.equal(grant.energy, 4);
    let details = await page.evaluate(() => window.sdelanoGame.inspect());
    assert.deepEqual([details.xp, details.coins, details.energy, details.focusToday], [5, 0, 4, 1]);
    const repeated = await claimWithFixture(page, "focus-unit-1");
    assert.equal(repeated.awarded, false);
    assert.equal(repeated.reason, "already-awarded");
    assert.deepEqual([details.xp, details.coins], [5, 0]);

    const second = await claimWithFixture(page, "focus-unit-2");
    const third = await claimWithFixture(page, "focus-unit-3");
    const fourth = await claimWithFixture(page, "focus-unit-4");
    assert.equal(second.awarded, true);
    assert.equal(third.awarded, true);
    assert.equal(fourth.awarded, false);
    assert.equal(fourth.reason, "daily-limit");
    details = await page.evaluate(() => window.sdelanoGame.inspect());
    assert.deepEqual([details.xp, details.coins, details.energy, details.focusToday], [15, 0, 2, 3]);
    const wallet = await page.evaluate(() => JSON.parse(localStorage.getItem("sdelano.game.v1")));
    assert.equal(wallet.grants.length, 3);
    assert.equal(new Set(wallet.grants.map(g => g.key)).size, 3);

    // The user can close the browser: recharge is derived from timestamps.
    await page.evaluate(() => {
      const key = "sdelano.game.v1", wallet = JSON.parse(localStorage.getItem(key));
      wallet.energy.updatedAt = Date.now() - (2 * 60 + 1) * 60 * 1000;
      localStorage.setItem(key, JSON.stringify(wallet));
    });
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).energy, 4,
      "Two full hours restore two energy units");
    await page.evaluate(() => {
      const key = "sdelano.game.v1", wallet = JSON.parse(localStorage.getItem(key));
      wallet.energy.updatedAt = Date.now() - 4 * 60 * 60 * 1000;
      localStorage.setItem(key, JSON.stringify(wallet));
    });
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).energy, 5);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 15);
    await context.close();
  }

  // Older PR2 wallets contain no energy state; they begin at 5/5 without losing XP.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await enter(page);
    const result = await page.evaluate(() => {
      const state = { version: 1, grants: [], excludedIds: [] };
      localStorage.setItem("sdelano.game.v1", JSON.stringify(state));
      return window.sdelanoGame.inspect();
    });
    assert.equal(result.energy, 5);
    assert.equal(result.available, true);
    assert.equal((await claimWithFixture(page, "legacy-focus")).energy, 4);
    await context.close();
  }

  // An empty battery must not block tasks or create XP.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await enter(page);
    await page.evaluate(() => {
      const state = { version: 1, grants: [], excludedIds: [],
        energy: { value: 0, updatedAt: Date.now() } };
      localStorage.setItem("sdelano.game.v1", JSON.stringify(state));
    });
    const result = await claimWithFixture(page, "empty-energy");
    assert.equal(result.awarded, false);
    assert.equal(result.reason, "no-energy");
    assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 0);
    await page.locator("#task-title").fill("Сделать дело без энергии");
    await page.locator("#task-title").press("Enter");
    await page.locator(".task-checkbox").first().check();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    assert.match(await page.locator("#progress-summary").textContent(), /1 из 1/,
      "Task completion must work even without energy");
    await context.close();
  }

  console.log("Game energy and focus QA passed:", engine);
} finally {
  await browser.close();
}
