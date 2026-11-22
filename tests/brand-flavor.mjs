import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const browserType = { chromium, firefox, webkit }[process.env.SDELANO_QA_ENGINE || "chromium"];
const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await browserType.launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts", { recursive: true });

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: width === 390 ? "reduce" : "no-preference"
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        const welcome = document.querySelector("#welcome");
        if (welcome?.open) document.querySelector("#welcome-start")?.click();
      });
      const state = await page.evaluate(() => ({
        title: document.querySelector("#page-heading")?.textContent,
        kicker: document.querySelector(".flavor-kicker")?.textContent.trim(),
        theme: document.querySelector('meta[name="theme-color"]')?.content,
        cssLoaded: [...document.styleSheets].some(x => x.href?.includes("brand-flavor.css")),
        vars: {
          paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
          red: getComputedStyle(document.documentElement).getPropertyValue("--red").trim(),
          ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()
        },
        button: (() => {
          const node = document.querySelector('#task-form .add-button');
          const c = getComputedStyle(node), bounds = node.getBoundingClientRect();
          return { bg: c.backgroundImage, height: bounds.height, width: bounds.width };
        })(),
        mascotSource: document.querySelector(".hero-mascot")?.getAttribute("src"),
        balance: window.sdelanoGame?.inspect(),
        overflow: document.documentElement.scrollWidth - window.innerWidth
      }));

      assert.equal(state.title, "Список задач", "Existing heading remains accessible");
      assert.equal(state.kicker, "Дела со вкусом");
      assert.equal(state.theme, "#fff4df");
      assert.equal(state.cssLoaded, true, "Flavor CSS must be loaded");
      assert.equal(state.vars.paper, "#fff4df");
      assert.equal(state.vars.red, "#c54227");
      assert.equal(state.vars.ink, "#422618");
      assert.match(state.button.bg, /linear-gradient/, "Primary CTA should feel tactile");
      assert.ok(state.button.height >= 44, "Touch target must be >= 44px tall");
      assert.ok(state.button.width >= 44, "Touch target must be >= 44px wide");
      assert.equal(state.mascotSource, "assets/fox-mascot.webp",
        "Original mascot asset must not be replaced");
      assert.equal(state.balance.coins, 0, "Theme must not mint coins");
      assert.ok(state.overflow <= 1, "Flavor theme must not overflow at width " + width);

      await page.screenshot({
        path: "artifacts/flavor-brand-" + engine + "-" + width + ".png",
        fullPage: true
      });
      if (await page.locator("#progress-toggle").getAttribute("aria-expanded") === "false") {
        await page.locator("#progress-toggle").click();
      }
      const achievementColors = await page.locator(".milestone-roadmap").evaluate(el => ({
        backgroundImage: getComputedStyle(el).backgroundImage,
        backgroundColor: getComputedStyle(el).backgroundColor
      }));
      assert.match(achievementColors.backgroundImage, /linear-gradient/,
        "Achievement card should have a warm caramel gradient, not legacy purple");
      await page.screenshot({
        path: "artifacts/flavor-brand-expanded-" + engine + "-" + width + ".png",
        fullPage: true
      });

      await page.locator("#task-title").fill("Прожарить маленькое дело");
      await page.locator("#task-title").press("Enter");
      await page.locator(".task-checkbox").first().check();
      await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
      assert.match(await page.locator("#progress-summary").textContent(), /1 из 1/,
        "Task completion still works with theme enabled");
      assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 10);
      assert.deepEqual(errors, [], "No page errors: " + errors.join(", "));
      console.log("Flavor brand QA passed:", engine, width);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
