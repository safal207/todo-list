import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await { chromium, firefox, webkit }[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
        window.__juiceSounds = [];
        const original = window.taskFeedback.play;
        window.taskFeedback.play = kind => {
          window.__juiceSounds.push(kind);
          original(kind);
        };
      });

      const css = await page.evaluate(() => ({
        coin: getComputedStyle(document.querySelector("#game-coins .game-resource-icon")).animationName,
        xp: getComputedStyle(document.querySelector("#game-xp .game-resource-icon")).animationName,
        energy: getComputedStyle(document.querySelector("#game-energy .game-resource-icon")).animationName
      }));
      if (width === 390) {
        assert.equal(css.xp, "none", "Reduced motion must disable idle breathing");
        assert.equal(css.energy, "none", "Reduced motion must disable idle glow");
      } else {
        assert.match(css.xp, /sdelano-xp-breath/, "XP must breathe while idle");
        assert.match(css.coin, /sdelano-coin-shine-idle/, "Coin must shimmer while idle");
        assert.match(css.energy, /sdelano-energy-glow/, "Energy must glow while idle");
      }
      const panel = page.locator("#game-preview");
      assert.equal(await panel.locator(".game-juice-layer").count(), 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, "Responsive HUD must fit at " + width + "px");
      const first = await page.evaluate(() => localStorage.getItem("sdelano.game.v1"));
      await page.locator("#game-preview-toggle").click();
      await page.locator("#game-preview-try").click();
      assert.equal(await page.evaluate(() => localStorage.getItem("sdelano.game.v1")), first,
        "Preview effects must not grant virtual currency");
      if (width !== 390) {
        assert.ok(await panel.locator(".game-juice-particle").count() >= 4,
          "Demo must create flying coin / XP particles");
        assert.ok(await panel.locator(".game-juice-label").count() >= 2,
          "Demo must show floating award amounts");
      } else {
        assert.equal(await panel.locator(".game-juice-particle").count(), 0,
          "Reduced motion avoids particle animations");
      }

      // Award a real task; the wallet, not the animation, sets final values.
      await page.locator("#task-title").fill("Награда за реальную задачу");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.querySelector("#game-coins .game-resource-amount")?.textContent === "10" &&
        document.querySelector("#game-xp .game-resource-amount")?.textContent === "20 XP");
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 10);
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, 20);
      await page.waitForTimeout(750);
      const sounds = await page.evaluate(() => window.__juiceSounds);
      assert.ok(sounds.includes("coins"), "Real coin award needs a distinct jingle");
      assert.ok(sounds.includes("xp"), "Real XP award needs a separate sparkle sound");
      if (width !== 390) {
        assert.ok(await panel.locator(".game-juice-label").count() > 0 ||
          (await page.locator("#game-preview-feedback").textContent()).includes("20 XP"),
          "Earned reward must remain visible");
      }
      // No sound starts by itself after the initial page load.
      const beforeReload = await page.evaluate(() => window.sdelanoGame.inspect());
      await page.reload({ waitUntil: "networkidle" });
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, beforeReload.coins);
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).xp, beforeReload.xp);
      assert.deepEqual(pageErrors, [], "No page errors: " + pageErrors.join(", "));
      console.log("Game juicy visual QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
