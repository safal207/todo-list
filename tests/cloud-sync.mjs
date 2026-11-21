import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const origin = "http://127.0.0.1:8765";
const script = readFileSync("cloud-merge.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(script, sandbox);
const { merge, sameSnapshot } = sandbox.window.sdelanoSyncMerge;

const task = (id, title, done = false) => ({
  id, title, done, elapsedMs: 0, startedAt: done ? null : 10000,
  doneAt: done ? 11000 : null
});
const wrap = (tasks, record = 0) => ({
  tasks, achievements: { firstWin: record >= 1, threeSteps: record >= 3, record }
});
function titles(state) { return Array.from(state.tasks, x => x.title); }

const none = wrap([]);
const first = wrap([task("a", "Первая")]);
const second = wrap([task("a", "Первая"), task("b", "Вторая")]);
let result = merge(first, none);
assert.equal(result.conflicts.length, 0);
assert.deepEqual(titles(result), ["Первая"]);
result = merge(none, first);
assert.deepEqual(titles(result), ["Первая"], "Fresh second device downloads cloud");
result = merge(first, second);
assert.deepEqual(titles(result), ["Первая", "Вторая"], "First sync unions distinct IDs");
result = merge(wrap([task("a", "Изменено")]), first);
assert.equal(result.conflicts.length, 1, "Different edits without a baseline are never silently overwritten");

const base = wrap([task("a", "Первая"), task("b", "Вторая")], 1);
const local = wrap([task("a", "Локальное изменение")], 1);
const remote = wrap([task("a", "Первая"), task("b", "Вторая"), task("c", "Облачная третья")], 3);
result = merge(local, remote, base);
assert.equal(result.conflicts.length, 0);
assert.deepEqual(titles(result), ["Локальное изменение", "Облачная третья"],
  "Local deletion and cloud addition are both preserved");
assert.equal(result.achievements.record, 3);
assert.equal(result.achievements.threeSteps, true);
result = merge(wrap([]), base, base);
assert.equal(result.tasks.length, 0, "Deletion propagates with a known common baseline");
result = merge(wrap([task("a", "Локально"),task("b","Вторая")]), wrap([task("a", "Облако"),task("b","Вторая")]), base);
assert.equal(result.conflicts.length, 1, "Concurrent same-ID edit must stop sync");
result = merge(wrap([task("a", "Локально"), task("b", "Вторая")]), wrap([task("b", "Вторая")]), base);
assert.equal(result.conflicts.length, 1, "Concurrent delete versus edit must stop sync");
assert.equal(sameSnapshot(base, base), true);
assert.equal(sameSnapshot(base, first), false);

const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
const errors = [];
for (const width of [320, 390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 780 } });
  try {
    let sdkRequested = false;
    page.on("request", request => { if (/supabase-js|\.supabase\.co/.test(request.url())) sdkRequested = true; });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.locator("#cloud-sync").isVisible(), false,
      "Local-only installation must not show cloud registration");
    assert.equal(sdkRequested, false, "Local-only installation must not load third-party auth scripts");
    await page.locator("#welcome-start").click();
    await page.locator("#task-title").fill("Личное дело без облака");
    await page.locator('#task-form button[type="submit"]').click();
    await page.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
    assert.equal(await page.locator("li.task").count(), 1);
    assert.equal(sdkRequested, false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    console.log("PASS " + engine + " " + width + ": cloud disabled, no user data/network regression");
  } catch (error) { errors.push(width + ": " + (error.stack ?? error.message)); }
  finally { await page.close(); }
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exitCode = 1;
}
