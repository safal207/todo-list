import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { mkdirSync } from "node:fs";
const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser=await ({ chromium, firefox, webkit })[engine].launch({
  headless:true, executablePath:process.env.SDELANO_QA_EXECUTABLE
});
mkdirSync("artifacts",{recursive:true});
try {
  for(const width of [320,390,1280]) {
    const context=await browser.newContext({viewport:{width,height:844},reducedMotion:width===390?"reduce":"no-preference"});
    const page=await context.newPage(),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    try {
      await page.goto("http://127.0.0.1:8765/preview-demo.html",{waitUntil:"networkidle"});
      assert.match(await page.title(),/визуальная демоверсия/);
      assert.match(await page.locator(".demo-notice").textContent(),/Только дизайн/);
      assert.equal(await page.locator("#demo-claim").isVisible(),true);
      const fox=await page.locator(".hero-mascot").evaluate(el=>el.complete&&el.naturalWidth>0);
      assert.equal(fox,true,"Original fox asset must load");
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,true,"No horizontal overflow");
      const storageBefore=await page.evaluate(()=>Object.keys(localStorage));
      assert.deepEqual(await page.locator(".game-resource-amount").allTextContents(),["0","0 XP","5/5"]);
      await page.locator("#demo-claim").click();
      assert.deepEqual(await page.locator(".game-resource-amount").allTextContents(),["10","20 XP","5/5"]);
      assert.equal(await page.locator("#demo-percentage").textContent(),"100%");
      assert.equal(await page.locator("#demo-check").isChecked(),true);
      const storageAfter=await page.evaluate(()=>Object.keys(localStorage));
      assert.deepEqual(storageAfter,storageBefore,"Visual demo must not save any data");
      if(width===390) {
        const style=await page.locator("#game-xp .game-resource-icon").evaluate(e=>getComputedStyle(e).animationName);
        assert.equal(style,"none","Reduced motion disables breathing animation");
        assert.equal(await page.locator(".game-juice-particle").count(),0);
      } else {
        assert.ok(await page.locator(".game-juice-particle").count()>=8,"Rewards fly");
        assert.ok(await page.locator(".game-juice-label").count()>=2,"Floating amounts exist");
      }
      await page.screenshot({path:"artifacts/visual-preview-"+engine+"-"+width+".png",fullPage:true});
      await page.locator("#demo-reset").click();
      assert.deepEqual(await page.locator(".game-resource-amount").allTextContents(),["0","0 XP","5/5"]);
      await page.locator("#demo-sound").click();
      assert.equal(await page.locator("#demo-sound").getAttribute("aria-pressed"),"false");
      await page.locator("#game-preview-toggle").click();
      assert.equal(await page.locator("#game-preview-details").isVisible(),true);
      await page.locator("#demo-progress-toggle").click();
      assert.equal(await page.locator("#demo-progress-details").isVisible(),true);
      assert.deepEqual(errors,[],"No browser errors: "+errors.join(" | "));
      console.log("Safe visual preview QA passed:",engine,width);
    } finally {await context.close();}
  }
} finally {await browser.close();}
