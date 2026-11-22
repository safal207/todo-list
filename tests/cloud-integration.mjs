import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.SDELANO_QA_ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
const origin = "http://127.0.0.1:8765";

const moduleCode = `
export function createClient(url, key, options) {
  const store = window.__cloudMock ??= {
    row: null,
    user: { id: "b329e6e2-4b27-4818-bf80-1155e831aaf2", email: "tester@example.com" },
    emailCount: 0
  };
  function query(mode, payload = null) {
    const filters = {};
    return {
      eq(field, value) { filters[field] = value; return this; },
      maybeSingle() {
        return Promise.resolve({data:store.row ? structuredClone(store.row) : null,error:null});
      },
      select() {
        if (mode === "read") return this;
        if (mode === "insert") {
          if (store.row) return Promise.resolve({data:null,error:{code:"23505",message:"duplicate"}});
          store.row = {revision:payload.revision,snapshot:structuredClone(payload.snapshot)};
          return Promise.resolve({data:[{revision:store.row.revision}],error:null});
        }
        if (mode === "update") {
          if (!store.row || store.row.revision !== filters.revision) {
            return Promise.resolve({data:[],error:null});
          }
          store.row = {revision:payload.revision,snapshot:structuredClone(payload.snapshot)};
          return Promise.resolve({data:[{revision:store.row.revision}],error:null});
        }
      }
    };
  }
  return {
    auth: {
      async getUser() {return {data:{user:store.user},error:null};},
      onAuthStateChange(fn) {store.onAuth = fn;return {data:{subscription:{unsubscribe(){}}}};},
      async signInWithOtp() {store.emailCount++;return {error:null};},
      async signOut() {store.onAuth("SIGNED_OUT",null);return {error:null};}
    },
    from(table) {
      if(table !== "sdelano_sync_v1") throw new Error("Unexpected table");
      return {
        select() {return query("read");},
        insert(values) {return query("insert",values);},
        update(values) {return query("update",values);}
      };
    }
  };
}
`;

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("**/cloud-config.js**", route => route.fulfill({
  status: 200, contentType: "text/javascript",
  body: 'window.SDELANO_CLOUD_CONFIG = {url:"https://testproj.supabase.co",publishableKey:"sb_publishable_test"};'
}));
await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.1/+esm", route => route.fulfill({
  status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "text/javascript",
  body: moduleCode
}));

try {
  await page.goto(origin, {waitUntil:"domcontentloaded"});
  await page.evaluate(() => {
  if (document.querySelector("#welcome")?.open) document.querySelector("#welcome-start")?.click();
});
  await page.locator("#cloud-sync summary").waitFor({state:"visible",timeout:8000});
  await page.locator("#cloud-sync summary").click();
  await page.locator("#cloud-account").getByText("tester@example.com").waitFor({state:"visible",timeout:8000});
  assert.equal(await page.locator("#cloud-sync-now").textContent(), "Включить синхронизацию");
  assert.equal(await page.evaluate(() => window.__cloudMock.row), null,
    "Email login alone must never upload personal tasks");

  await page.locator("#task-title").fill("Приватная задача");
  await page.locator("#task-form button[type='submit']").click();
  await page.locator('.task-panel[aria-busy="true"]').waitFor({state:"hidden"});
  assert.equal(await page.evaluate(() => window.__cloudMock.row), null,
    "Local edits before explicit opt-in stay local");
  page.once("dialog", d => d.dismiss());
  await page.locator("#cloud-sync-now").click();
  assert.equal(await page.evaluate(() => window.__cloudMock.row), null,
    "Denied opt-in must not upload tasks");
  page.once("dialog", d => d.accept());
  await page.locator("#cloud-sync-now").click();
  await page.waitForFunction(() => window.__cloudMock.row?.snapshot?.tasks?.length === 1, {timeout:10000});
  const uploaded = await page.evaluate(() => structuredClone(window.__cloudMock.row));
  assert.equal(uploaded.snapshot.tasks[0].title, "Приватная задача");
  assert.equal(uploaded.revision, 1);
  assert.equal(uploaded.snapshot.version, 1, "Task-only cloud sync stays v1 until wallet consent");

  // Wallet opt-in is distinct from the task-upload consent.
  await page.evaluate(() => {
    const key = "sdelano.game.v1", wallet = JSON.parse(localStorage.getItem(key));
    const now = Date.now(), date = new Date(now);
    const day = [date.getFullYear(), String(date.getMonth()+1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")].join("-");
    wallet.grants.push({ key: "task:cloud-wallet-fixture", day, at: now, xp: 10, coins: 5 });
    localStorage.setItem(key, JSON.stringify(wallet));
    dispatchEvent(new Event("sdelano:game-changed"));
  });
  assert.equal(await page.evaluate(() => window.__cloudMock.row.snapshot.version), 1);
  page.once("dialog", d => d.accept());
  await page.locator("#cloud-wallet-toggle").click();
  await page.waitForFunction(() => window.__cloudMock.row?.snapshot?.version === 2,
    { timeout: 10000 });
  const uploadedWallet = await page.evaluate(() => structuredClone(window.__cloudMock.row.snapshot.game));
  assert.equal(uploadedWallet.grants.filter(g => g.key === "task:cloud-wallet-fixture").length, 1);
  assert.equal((await page.evaluate(() => window.sdelanoGame.inspect())).coins, 5);
  assert.match(await page.locator("#cloud-wallet-toggle").textContent(), /включена/);

  // Adopt a remote-only wallet reward when local still equals the common baseline.
  await page.evaluate(() => {
    const row = window.__cloudMock.row, wallet = row.snapshot.game;
    const prior = wallet.grants.at(-1);
    wallet.grants.push({ ...prior, key: "task:cloud-remote-bonus", at: prior.at + 1 });
    row.revision++;
  });
  await page.locator("#cloud-sync-now").click();
  await page.waitForFunction(() => window.sdelanoGame.inspect().coins === 10);
  assert.equal(await page.evaluate(() => window.__cloudMock.row.snapshot.game.grants.length), 2);

  assert.equal(await page.locator("#cloud-sync-now").textContent(), "Синхронизировать сейчас");

  // Another device added a distinct task to the cloud; merge both.
  await page.evaluate(() => {
    const row = window.__cloudMock.row;
    row.snapshot.tasks.push({
      id:"another-device-id",title:"Вторая с компьютера",done:false,elapsedMs:0,
      startedAt:Date.now(),doneAt:null
    });
    row.revision += 1;
  });
  await page.locator("#cloud-sync-now").click();
  await page.waitForFunction(() => document.querySelectorAll("li.task").length === 2);
  assert.equal(await page.locator("li.task").count(), 2);
  assert.equal((await page.evaluate(() => window.__cloudMock.row.snapshot.tasks.length)), 2);

  // Simultaneous edits of the same row must halt sync with no data loss.
  const first = page.locator("li.task").first();
  await first.locator(".edit-button").click();
  await first.locator(".task-edit-input").fill("Моя версия задачи");
  await first.locator(".task-edit-save").click();
  await page.locator('.task-panel[aria-busy="true"]').waitFor({state:"hidden"});
  await page.evaluate(() => {
    const row = window.__cloudMock.row;
    row.snapshot.tasks[0].title = "Облачная версия задачи";
    row.revision++;
  });
  await page.locator("#cloud-sync-now").click();
  await page.locator("#cloud-status").filter({hasText:"Синхронизация приостановлена"}).waitFor();
  assert.equal(await first.locator(".task-title").textContent(), "Моя версия задачи");
  assert.equal(await page.evaluate(() => window.__cloudMock.row.snapshot.tasks[0].title), "Облачная версия задачи");

  await page.locator("#cloud-signout").click();
  assert.equal(await page.locator("li.task").count(), 2,
    "Sign out must not erase local tasks");
  assert.equal(await page.locator("#cloud-auth-actions").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("PASS " + engine + ": opt-in, upload, merge, conflict stop, sign out (mock backend)");
} catch(error) {
  errors.push(error.stack || error.message);
} finally {
  await browser.close();
}
if (errors.length) {console.error(errors.join("\n\n"));process.exitCode = 1;}
