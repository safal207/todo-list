import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await { chromium, firefox, webkit }[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const url = "http://127.0.0.1:8765/";

async function enter(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
  });
  if (await page.locator("#game-preview-toggle").getAttribute("aria-expanded") === "false") {
    await page.locator("#game-preview-toggle").click();
  }
  if (!(await page.locator("#game-shop").evaluate(el => el.open))) {
    await page.locator("#game-shop summary").click();
  }
}

async function seed(page, count = 12) {
  await page.evaluate(count => {
    const now = Date.now(), d = new Date(now);
    const day = [d.getFullYear(), String(d.getMonth()+1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")].join("-");
    const grants = Array.from({ length: count }, (_, idx) => ({
      key: "task:shop-qa-" + idx, day, at: now, xp: 10, coins: 50
    }));
    localStorage.setItem("sdelano.game.v1", JSON.stringify({
      version: 1, grants, excludedIds: []
    }));
    dispatchEvent(new Event("sdelano:game-changed"));
  }, count);
}

async function wallet(page) {
  return page.evaluate(() => window.sdelanoGame.inspect());
}

async function buy(page, id) {
  const card = page.locator('.game-shop-card[data-item="' + id + '"]');
  await card.locator(".game-shop-action").click();
  await page.waitForFunction(id => document.querySelector('.game-shop-card[data-item="' + id + '"]')?.dataset.owned === "true", id);
  return card;
}

try {
  // Real, once-only purchases persist, and equipped cosmetic items affect
  // the existing fox without replacing its real asset.
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 850 }, reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await enter(page);
    assert.equal((await wallet(page)).coins, 0);
    assert.equal(await page.locator(".game-shop-card").count(), 4);
    assert.equal(await page.locator('.game-shop-card[data-item="scarf"] .game-shop-action').isDisabled(), true);
    await seed(page, 12);
    assert.equal((await wallet(page)).coins, 600);

    await buy(page, "scarf");
    assert.equal((await wallet(page)).coins, 550);
    assert.equal(await page.locator('.game-shop-card[data-item="scarf"]').getAttribute("data-equipped"), "true");
    assert.equal(await page.evaluate(() => document.body.dataset.gameScarf), "on");
    assert.equal(await page.locator(".game-hero-fox .hero-mascot").count(), 1);

    const duplicate = await page.evaluate(() => window.sdelanoGame.buyItem("scarf"));
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.reason, "already-owned");
    assert.equal((await wallet(page)).coins, 550);

    await page.locator('.game-shop-card[data-item="scarf"] .game-shop-action').click();
    await page.waitForFunction(() => document.body.dataset.gameScarf === "off");
    assert.equal((await wallet(page)).coins, 550);
    await page.locator('.game-shop-card[data-item="scarf"] .game-shop-action').click();
    await page.waitForFunction(() => document.body.dataset.gameScarf === "on");

    await buy(page, "glasses");
    assert.equal((await wallet(page)).coins, 450);
    assert.equal(await page.evaluate(() => document.body.dataset.gameGlasses), "on");
    await buy(page, "cosmic");
    assert.equal((await wallet(page)).coins, 300);
    assert.equal(await page.evaluate(() => document.body.dataset.gameTheme), "cosmic");
    await buy(page, "sparkle");
    assert.equal((await wallet(page)).coins, 100);
    assert.equal(await page.evaluate(() => document.body.dataset.gameVictory), "sparkle");

    const purchaseRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("sdelano.game.v1")));
    assert.equal(purchaseRecord.purchases.length, 4);
    assert.equal(new Set(purchaseRecord.purchases.map(p => p.id)).size, 4);
    assert.equal(purchaseRecord.grants.length, 12, "Purchases must not rewrite XP earning history");
    assert.equal((await wallet(page)).xp, 120);

    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await wallet(page)).coins, 100);
    assert.equal(await page.evaluate(() => document.body.dataset.gameTheme), "cosmic");
    assert.equal(await page.evaluate(() => document.body.dataset.gameScarf), "on");
    assert.equal((await wallet(page)).purchases.length, 4);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, "No horizontal page overflow at width " + width);
    if (width === 390) {
      const animation = await page.evaluate(() => {
        const burst = document.createElement("div");
        burst.className = "game-victory-burst";
        document.body.append(burst);
        const display = getComputedStyle(burst).display;
        burst.remove();
        return display;
      });
      assert.equal(animation, "none", "Reduced motion must disable victory particles");
    }
    assert.deepEqual(errors, [], "Page errors: " + errors.join(", "));
    await context.close();
  }

  // Two tabs buying the same item cannot debit twice with Web Locks.
  {
    const context = await browser.newContext();
    const one = await context.newPage(), two = await context.newPage();
    await enter(one);
    await enter(two);
    await seed(one, 1);
    if (await one.evaluate(() => Boolean(navigator.locks?.request))) {
      const outcomes = await Promise.all([
        one.evaluate(() => window.sdelanoGame.buyItem("scarf")),
        two.evaluate(() => window.sdelanoGame.buyItem("scarf"))
      ]);
      assert.equal(outcomes.filter(x => x.success).length, 1, "Exactly one concurrent purchase");
      assert.equal((await wallet(one)).coins, 0);
      assert.equal((await wallet(one)).purchases.length, 1);
    } else {
      const first = await one.evaluate(() => window.sdelanoGame.buyItem("scarf"));
      const repeat = await two.evaluate(() => window.sdelanoGame.buyItem("scarf"));
      assert.equal(first.success, true);
      assert.equal(repeat.success, false);
    }
    await context.close();
  }

  // Cannot buy without coins. A failed purchase keeps the wallet byte-identical.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await enter(page);
    const before = await page.evaluate(() => localStorage.getItem("sdelano.game.v1"));
    const result = await page.evaluate(() => window.sdelanoGame.buyItem("cosmic"));
    assert.equal(result.success, false);
    assert.equal(result.reason, "insufficient");
    assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.game.v1")), before);
    assert.equal((await wallet(page)).coins, 0);
    await context.close();
  }

  // A malformed purchase ledger is not overwritten; task creation still works.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await enter(page);
    await page.evaluate(() => {
      const wallet = JSON.parse(localStorage.getItem("sdelano.game.v1"));
      wallet.purchases = [{ id: "scarf", coins: 50, at: Date.now() },
        { id: "scarf", coins: 50, at: Date.now() }];
      localStorage.setItem("sdelano.game.v1", JSON.stringify(wallet));
    });
    assert.equal((await wallet(page)).available, false);
    assert.equal((await page.evaluate(() => window.sdelanoGame.buyItem("glasses"))).success, false);
    const saved = await page.evaluate(() => localStorage.getItem("sdelano.game.v1"));
    await page.locator("#task-title").fill("Задачи работают при ошибке магазина");
    await page.locator("#task-title").press("Enter");
    await page.locator(".task-checkbox").first().check();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    assert.match(await page.locator("#progress-summary").textContent(), /1 из 1/);
    assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.game.v1")), saved);
    await context.close();
  }

  console.log("Fox shop QA passed:", engine);
} finally {
  await browser.close();
}
