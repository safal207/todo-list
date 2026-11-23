import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const root = "http://127.0.0.1:8765/";
const nod = ".mini-hero .fox-evolution-figure.fox-microreaction--nod";
async function openApp(page) {
  await page.goto(root, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
}
async function verifiedFocus(page, id, hidden = false) {
  return page.evaluate(async ({ id, hidden }) => {
    if (hidden) Object.defineProperty(document, "hidden", {
      configurable: true, get: () => true
    });
    const game = window.sdelanoGame;
    const before = game.inspect();
    sessionStorage.setItem(game.focusKey, JSON.stringify({
      id, status: "ready", elapsedMs: game.focusMs
    }));
    const grant = await game.claimFocus(id);
    const animated = document.querySelector(".mini-hero .fox-evolution-figure")
      .classList.contains("fox-microreaction--nod");
    const replay = await game.claimFocus(id);
    const after = game.inspect();
    return {
      grant, replay, animated,
      before: [before.xp, before.coins, before.energy],
      after: [after.xp, after.coins, after.energy],
      foxKeys: Object.keys(localStorage).filter(key => key.startsWith("sdelano.fox"))
    };
  }, { id, hidden });
}

try {
  // Focus XP is granted only by the real, validated claimFocus method.
  // The READY session is a test fixture for 15 minutes already completed.
  {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await openApp(page);
      const result = await verifiedFocus(page, "microreaction-focus-regression");
      assert.equal(result.grant.awarded, true);
      assert.deepEqual(result.before, [0, 0, 5]);
      assert.deepEqual(result.after, [5, 0, 4]);
      assert.equal(result.animated, true, "Focus reward should trigger one small nod");
      assert.equal(result.replay.awarded, false);
      assert.equal(result.replay.reason, "already-awarded");
      assert.deepEqual(result.foxKeys, [], "Fox reactions must not persist state");
      await page.waitForTimeout(720);
      assert.equal(await page.locator(nod).count(), 0, "Nod must finish without looping");
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator(nod).count(), 0, "Reload must not animate");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }

  // An authentic XP boundary crossing owns exactly the v3.1 growth ceremony.
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, reducedMotion: "no-preference"
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(root + "invite/", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        const grants = [100, 100, 40].map((xp, i) => ({
          key: "task:micro-seed-" + i, xp, coins: 0,
          day: "2020-01-01", at: Date.now()
        }));
        localStorage.setItem("sdelano.game.v1", JSON.stringify({
          version: 1, grants, excludedIds: []
        }));
      });
      await openApp(page);
      assert.equal(await page.locator(".mini-hero .fox-evolution-figure")
        .getAttribute("data-fox-stage"), "cub");
      await page.locator("#task-title").fill("Дело для новой стадии");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.waitForFunction(() => window.sdelanoGame.inspect().xp === 260);
      assert.equal(await page.locator(".mini-hero .fox-evolution-figure")
        .getAttribute("data-fox-stage"), "student");
      assert.equal(await page.locator(nod).count(), 0,
        "Growth ceremony must not stack a microreaction");
      assert.equal(await page.locator("#fox-evolution-notice").isVisible(), true);
      assert.equal(await page.locator(".fox-ceremony-sparks > span").count(), 6,
        "Existing v3.1 ceremony must remain intact");
      assert.deepEqual(await page.evaluate(() => {
        const wallet = window.sdelanoGame.inspect();
        return [wallet.xp, wallet.coins];
      }), [260, 10]);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }

  // Even an earned focus grant must not animate a hidden tab.
  {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await openApp(page);
      const result = await verifiedFocus(page, "microreaction-hidden-regression", true);
      assert.equal(result.grant.awarded, true);
      assert.equal(result.animated, false);
      assert.deepEqual(result.after, [5, 0, 4]);
      assert.deepEqual(result.foxKeys, []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log("Fox focus/stage/hidden integration passed:", engine);
} finally { await browser.close(); }
