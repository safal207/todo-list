import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const origin = "http://127.0.0.1:8765";
mkdirSync("artifacts", { recursive: true });

function makeWallet(xp, wear) {
  const grants = [];
  for (let i = 0, remaining = xp; remaining > 0; i++) {
    const amount = Math.min(100, remaining);
    grants.push({ key: "task:v2-seed-" + i, day: "2020-01-01",
      at: Date.now(), xp: amount, coins: 10 });
    remaining -= amount;
  }
  const state = { version: 1, grants, excludedIds: [] };
  if (wear) {
    state.purchases = [
      { id: "scarf", coins: 50, at: Date.now() },
      { id: "glasses", coins: 100, at: Date.now() }
    ];
    state.equipped = { scarf: true, glasses: true, theme: "default", victory: "default" };
  }
  return state;
}
async function visit(page, xp, wear) {
  await page.goto(origin + "/invite/", { waitUntil: "domcontentloaded" });
  await page.evaluate(wallet => {
    localStorage.setItem("sdelano.game.v1", JSON.stringify(wallet));
  }, makeWallet(xp, wear));
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open)
      document.querySelector("#welcome-start")?.click();
  });
  await page.waitForFunction(() => document.body.dataset.foxArt === "ready");
}
const cases = [
  { xp: 0, stage: "cub", age: "Малыш", y: 0, level: 1 },
  { xp: 250, stage: "student", age: "Ученик", y: 33.333, level: 3 },
  { xp: 1000, stage: "hero", age: "Герой", y: 66.667, level: 6 },
  { xp: 2700, stage: "master", age: "Мастер", y: 100, level: 10 }
];
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      const atlas = await page.request.get(origin + "/assets/fox-evolution-stages.webp");
      assert.equal(atlas.status(), 200, "Distinct artwork must exist at this branch");
      assert.ok((await atlas.body()).length > 10000, "Full atlas bytes must be served");

      for (const entry of cases) {
        await visit(page, entry.xp, entry.stage === "master");
        const state = await page.evaluate(() => {
          const figures = [...document.querySelectorAll(".fox-evolution-figure")];
          const one = figures.map(el => ({
            stage: el.dataset.foxStage,
            imageSrc: el.querySelector(".fox-evolution-core img")?.getAttribute("src"),
            imageOpacity: getComputedStyle(el.querySelector(".fox-evolution-core img")).opacity,
            beforeOpacity: getComputedStyle(el.querySelector(".fox-evolution-core"), "::before").opacity,
            beforeImage: getComputedStyle(el.querySelector(".fox-evolution-core"), "::before").backgroundImage,
            beforeY: parseFloat(getComputedStyle(el.querySelector(".fox-evolution-core"), "::before").backgroundPositionY)
          }));
          return {
            art: document.body.dataset.foxArt,
            figures: one,
            api: window.sdelanoFoxArt?.source,
            stage: window.sdelanoFoxEvolution.stageForLevel(window.sdelanoGame.inspect().level).id,
            level: window.sdelanoGame.inspect().level,
            labels: document.querySelector("#fox-evolution-stage").textContent,
            overflow: document.documentElement.scrollWidth - innerWidth,
            foxStorage: Object.keys(localStorage).filter(key => key.startsWith("sdelano.fox"))
          };
        });
        assert.equal(state.art, "ready");
        assert.equal(state.api, "assets/fox-evolution-stages.webp");
        assert.equal(state.stage, entry.stage);
        assert.equal(state.level, entry.level);
        assert.equal(state.figures.length, 3);
        assert.match(state.labels, new RegExp(entry.age));
        assert.ok(state.overflow <= 1, "Stage " + entry.stage + " overflows at " + width);
        assert.deepEqual(state.foxStorage, [], "No second wallet or growth tracking");
        for (const figure of state.figures) {
          assert.equal(figure.stage, entry.stage);
          assert.equal(figure.imageSrc, "assets/fox-mascot.webp", "Original fox remains a fallback");
          assert.equal(figure.imageOpacity, "0", "Fallback hides only after successful preload");
          assert.equal(figure.beforeOpacity, "1");
          assert.match(figure.beforeImage, /fox-evolution-stages\.webp/);
          assert.ok(Math.abs(figure.beforeY - entry.y) < 0.5,
            "Each age must use its own atlas frame, not a scaled baby fox");
        }
        if (entry.stage === "master") {
          const wallet = await page.evaluate(() => window.sdelanoGame.inspect());
          assert.equal(wallet.xp, entry.xp);
          assert.equal(wallet.purchases.length, 2);
          assert.equal(await page.locator("body").getAttribute("data-game-scarf"), "on");
          assert.equal(await page.locator("body").getAttribute("data-game-glasses"), "on");
          for (const type of ["scarf", "glasses"]) {
            const visible = await page.locator("#game-shop-fox .game-fox-" + type)
              .evaluate(el => getComputedStyle(el).display !== "none");
            assert.ok(visible, "Existing purchased " + type + " must stay equipped");
          }
        }
        await page.locator("#game-preview-toggle").click();
        await page.locator("#game-shop summary").click();
        await page.screenshot({
          path: "artifacts/fox-art-v2-" + engine + "-" + width + "-" + entry.stage + ".png",
          fullPage: true
        });
      }
      assert.deepEqual(errors, [], errors.join(" | "));
    } finally {
      await context.close();
    }
  }

  // On a blocked or missing new atlas, show the old fox instead of empty space.
  const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fallbackPage = await fallbackContext.newPage();
  try {
    await fallbackPage.route("**/assets/fox-evolution-stages.webp", route => route.abort());
    await fallbackPage.goto(origin + "/", { waitUntil: "networkidle" });
    await fallbackPage.waitForFunction(() => document.body.dataset.foxArt === "fallback");
    const fallback = await fallbackPage.locator(".mini-hero .fox-evolution-core").evaluate(el => ({
      oldImageVisible: getComputedStyle(el.querySelector("img")).opacity,
      oldImageLoaded: el.querySelector("img").complete && el.querySelector("img").naturalWidth > 0,
      spriteHidden: getComputedStyle(el, "::before").opacity
    }));
    assert.equal(fallback.oldImageVisible, "1");
    assert.equal(fallback.oldImageLoaded, true);
    assert.equal(fallback.spriteHidden, "0");
  } finally {
    await fallbackContext.close();
  }
  console.log("Approved fox artwork v2 QA passed:", engine);
} finally {
  await browser.close();
}
