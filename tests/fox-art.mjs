import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts", { recursive: true });
const base = "http://127.0.0.1:8765/";

function wallet(xp, buy = false) {
  const grants = [];
  for (let n = 0, remaining = xp; remaining > 0; n++) {
    const amount = Math.min(100, remaining);
    grants.push({
      key: "task:illustration-" + n, xp: amount, coins: 10,
      day: "2020-01-01", at: Date.now()
    });
    remaining -= amount;
  }
  const record = { version: 1, grants, excludedIds: [] };
  if (buy) {
    record.purchases = [
      { id: "scarf", coins: 50, at: Date.now() },
      { id: "glasses", coins: 100, at: Date.now() }
    ];
    record.equipped = { scarf: true, glasses: true, theme: "default", victory: "default" };
  }
  return record;
}

try {
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      // Inspect actual WebP decode; a CSS-only implementation must not pass.
      await page.goto(base, { waitUntil: "networkidle" });
      const art = await page.evaluate(async () => {
        const source = "assets/fox-evolution-stages.webp";
        const response = await fetch(source, { cache: "no-store" });
        const img = new Image();
        img.src = source;
        await img.decode();
        return {
          status: response.status, mime: response.headers.get("content-type"),
          width: img.naturalWidth, height: img.naturalHeight
        };
      });
      assert.equal(art.status, 200, "Illustrations must exist on the deployed branch");
      assert.match(art.mime, /image\/webp/);
      assert.deepEqual([art.width, art.height], [160, 640]);

      for (const [stage, xp, position] of [
        ["cub", 0, "0%"],
        ["student", 250, "33.333333%"],
        ["hero", 1000, "66.666667%"],
        ["master", 2700, "100%"]
      ]) {
        await page.goto(base + "invite/", { waitUntil: "domcontentloaded" });
        await page.evaluate(record => {
          localStorage.clear();
          localStorage.setItem("sdelano.game.v1", JSON.stringify(record));
        }, wallet(xp, stage === "master"));
        await page.goto(base, { waitUntil: "networkidle" });
        await page.evaluate(() => {
          if (document.querySelector("#welcome")?.open)
            document.querySelector("#welcome-start")?.click();
        });
        const views = await page.locator(".fox-evolution-figure").evaluateAll(nodes => nodes.map(node => {
          const core = node.querySelector(".fox-evolution-core");
          const paint = getComputedStyle(core);
          return {
            stage: node.dataset.foxStage,
            image: paint.backgroundImage,
            size: paint.backgroundSize,
            position: paint.backgroundPosition,
            originalStillPresent: Boolean(core.querySelector('img[src="assets/fox-mascot.webp"]')),
            overlayGlasses: Boolean(core.querySelector(".game-fox-glasses")),
            overlayScarf: Boolean(core.querySelector(".game-fox-scarf"))
          };
        }));
        assert.equal(views.length, 3);
        for (const view of views) {
          assert.equal(view.stage, stage);
          assert.match(view.image, /fox-evolution-stages\.webp/);
          assert.equal(view.size, "100% 400%");
          assert.ok(view.position.endsWith(position), "Wrong sprite quadrant: " + view.position);
          assert.equal(view.originalStillPresent, true, "Original mascot preserved in the DOM");
          assert.equal(view.overlayGlasses, true);
          assert.equal(view.overlayScarf, true);
        }
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(scroll <= 1, "No horizontal scroll at " + width + ", stage " + stage);
        if (stage === "master") {
          assert.equal(await page.locator("body").getAttribute("data-game-scarf"), "on");
          assert.equal(await page.locator("body").getAttribute("data-game-glasses"), "on");
          for (const name of [".game-fox-glasses", ".game-fox-scarf"]) {
            assert.equal(await page.locator("#game-shop-fox " + name).isVisible(), true,
              "Purchased accessory must survive art switch");
          }
        }
        await page.locator("#game-preview-toggle").click();
        await page.locator("#game-shop summary").click();
        await page.screenshot({ path: "artifacts/fox-art-" + engine + "-" + width + "-" + stage + ".png",
          fullPage: true });
      }
      assert.deepEqual(errors, [], "JS errors: " + errors.join(" | "));
    } finally { await ctx.close(); }
  }
  console.log("Fox art v2 QA passed:", engine);
} finally { await browser.close(); }
