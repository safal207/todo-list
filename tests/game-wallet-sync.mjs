import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE || "chromium";
const browser = await { chromium, firefox, webkit }[engine].launch({
  headless: true, executablePath: process.env.SDELANO_QA_EXECUTABLE
});
const url = "http://127.0.0.1:8765/";

async function enter(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
    const progress = document.querySelector("#progress-toggle");
    if (progress?.getAttribute("aria-expanded") === "false") progress.click();
  });
  if (await page.locator("#progress-toggle").getAttribute("aria-expanded") === "false") {
    await page.locator("#progress-toggle").click();
  }
  if (!(await page.locator("#backup-tools").evaluate(el => el.open))) {
    await page.locator("#backup-tools summary").click();
  }
}
async function importFile(page, text) {
  await page.locator("#backup-file").setInputFiles({
    name: "sdelano-complete.json", mimeType: "application/json", buffer: Buffer.from(text)
  });
  await page.locator("#backup-preview").waitFor({ state: "visible" });
}
async function wallet(page) { return page.evaluate(() => window.sdelanoGame.inspect()); }

try {
  const sourceContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  const targetContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const conflictContext = await browser.newContext({ viewport: { width: 390, height: 844 } });

  const source = await sourceContext.newPage();
  await enter(source);
  await source.locator("#task-title").fill("Заработанная награда");
  await source.locator("#task-title").press("Enter");
  await source.locator(".task-checkbox").first().check();
  await source.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
  assert.equal((await wallet(source)).coins, 10);

  // QA fixture: give enough earned fake tasks to exercise all cosmetics.
  await source.evaluate(() => {
    const key = "sdelano.game.v1", state = JSON.parse(localStorage.getItem(key));
    const at = Date.now(), d = new Date(at);
    const day = [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),
      String(d.getDate()).padStart(2,"0")].join("-");
    for (let i = 0; i < 10; i++) {
      state.grants.push({ key: "task:wallet-transfer-fixture-" + i,
        day, at, xp: 10, coins: 50 });
    }
    localStorage.setItem(key, JSON.stringify(state));
    dispatchEvent(new Event("sdelano:game-changed"));
  });
  for (const id of ["scarf", "glasses", "cosmic", "sparkle"]) {
    assert.equal((await source.evaluate(id => window.sdelanoGame.buyItem(id), id)).success, true);
  }
  const earned = await wallet(source);
  assert.deepEqual([earned.xp, earned.coins, earned.purchases.length],
    [120, 10, 4], "Items purchased without losing XP");

  const [download] = await Promise.all([
    source.waitForEvent("download"),
    source.locator("#backup-download").click()
  ]);
  const exported = (await readFile(await download.path())).toString("utf8");
  const archive = JSON.parse(exported);
  assert.equal(archive.version, 2);
  assert.equal(archive.game.purchases.length, 4);
  assert.equal(archive.tasks.length, 1);

  const target = await targetContext.newPage();
  await enter(target);
  await importFile(target, exported);
  assert.match(await target.locator("#backup-preview-summary").textContent(), /кошелёк/);
  await target.locator("#backup-import").click();
  await target.locator("#backup-status").filter({ hasText: "Игровые монеты" }).waitFor();
  const loaded = await wallet(target);
  assert.deepEqual([loaded.xp, loaded.coins, loaded.energy, loaded.purchases.length],
    [120, 10, 5, 4], "Cross-device transfer preserves complete wallet");
  assert.equal(loaded.equipped.theme, "cosmic");
  assert.equal(loaded.equipped.scarf, true);

  await importFile(target, exported);
  await target.locator("#backup-import").click();
  await target.locator("#backup-status").filter({ hasText: "Восстановлено: 0" }).waitFor();
  assert.deepEqual([ (await wallet(target)).coins, (await wallet(target)).purchases.length ], [10, 4],
    "Repeated import cannot duplicate currency or purchases");

  // A legacy v1 backup must still import without changing the existing wallet.
  const legacy = await source.evaluate(() => {
    const tasks = JSON.parse(localStorage.getItem("todo-list.tasks.v1"));
    return window.sdelanoBackup.create(tasks, { firstWin: true, threeSteps: false, record: 1 });
  });
  assert.equal(JSON.parse(legacy).version, 1);
  await importFile(target, legacy);
  await target.locator("#backup-import").click();
  await target.locator("#backup-status").filter({ hasText: "копия v1" }).waitFor();
  assert.equal((await wallet(target)).coins, 10);

  // Divergent local progress blocks a wallet transfer before importing tasks.
  const conflict = await conflictContext.newPage();
  await enter(conflict);
  await conflict.locator("#task-title").fill("Моё другое дело");
  await conflict.locator("#task-title").press("Enter");
  await conflict.locator(".task-checkbox").first().check();
  await conflict.locator('.task-panel[aria-busy="true"]').waitFor({ state: "hidden" });
  assert.equal((await wallet(conflict)).coins, 10);
  await importFile(conflict, exported);
  await conflict.locator("#backup-import").click();
  await conflict.locator("#backup-status").filter({ hasText: "уже есть другой игровой кошелёк" }).waitFor();
  assert.equal(await conflict.locator("li.task").count(), 1);
  assert.equal((await wallet(conflict)).coins, 10);

  // Reject a malformed wallet without writing either tasks or currency.
  const bad = JSON.parse(exported);
  bad.game.purchases.push({ ...bad.game.purchases[0] });
  await conflict.locator("#backup-file").setInputFiles({
    name: "bad-wallet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad))
  });
  await conflict.locator("#backup-status").filter({ hasText: "История игровых покупок повреждена" }).waitFor();
  assert.equal((await wallet(conflict)).coins, 10);

  // A quota failure while saving the wallet must roll back imported tasks.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await enter(page);
    await importFile(page, exported);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "sdelano.game.v1") throw new DOMException("Full", "QuotaExceededError");
        return original.call(this, key, value);
      };
      window.__resetStorage = () => { Storage.prototype.setItem = original; };
    });
    await page.locator("#backup-import").click();
    await page.locator("#backup-status").filter({ hasText: "Не хватает места" }).waitFor();
    await page.evaluate(() => window.__resetStorage());
    assert.equal((await page.evaluate(() =>
      JSON.parse(localStorage.getItem("todo-list.tasks.v1") || "[]"))).length, 0,
      "Failed wallet write must not leave imported tasks behind");
    assert.equal((await wallet(page)).coins, 0);
    await context.close();
  }

  // Three-way wallet merge must halt on concurrent independent rewards.
  const checks = await source.evaluate(() => {
    const merge = window.sdelanoSyncMerge;
    const wallet = window.sdelanoGame.exportWallet();
    const empty = { version: 1, grants: [], excludedIds: [] };
    const changedA = structuredClone(wallet);
    changedA.grants.push({ key: "task:local-extra", day: "2026-11-22",
      at: Date.now(), xp: 10, coins: 5 });
    const changedB = structuredClone(wallet);
    changedB.grants.push({ key: "task:remote-extra", day: "2026-11-22",
      at: Date.now(), xp: 10, coins: 5 });
    return {
      adopt: merge.mergeWallet(empty, wallet, null).game?.purchases?.length,
      remoteChanged: merge.mergeWallet(wallet, changedA, wallet).game?.grants.length,
      divergent: merge.mergeWallet(changedA, changedB, wallet).conflict,
      downgrade: merge.mergeWallet(wallet, null, wallet).conflict,
      reset: merge.mergeWallet({ ...wallet, grants: [] }, wallet, wallet).conflict
    };
  });
  assert.equal(checks.adopt, 4);
  assert.equal(checks.remoteChanged, archive.game.grants.length + 1);
  assert.equal(checks.divergent, true);
  assert.equal(checks.downgrade, true);
  assert.equal(checks.reset, true, "Clearing wallet on one device cannot erase earned balance");

  await sourceContext.close();
  await targetContext.close();
  await conflictContext.close();
  console.log("Wallet portable backup and cloud merge QA passed:", engine);
} finally {
  await browser.close();
}
