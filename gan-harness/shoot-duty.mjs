// Slice 14 screenshots: the Duty*.dc.html mockups (expanded by a tiny renderer, they need the DC runtime) and the app (mock mode).
// Usage: node gan-harness/shoot-duty.mjs <baseUrl>   (a production build in E2E mock mode, e.g. port 3101)
import { devices, webkit } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:3101";
const out = resolve("gan-harness/screenshots");
const design = (f) => pathToFileURL(resolve("docs/design", f)).href;
const browser = await webkit.launch();
const VIEW = { width: 390, height: 844 };

// ---------------------------------------------------------------- the mockups

async function shootMock(file, name) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(design(file));
  await page.evaluate(() => {
    const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    class DCLogic {}
    const code = document.querySelector("script[data-dc-script]").textContent;
    const Component = new Function("DCLogic", `${code}; return Component;`)(DCLogic);
    const vals = new Component().renderVals();
    const interp = (s, scope) =>
      s.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_, p) => {
        const v = get(scope, p);
        return v == null ? "" : String(v);
      });
    const walk = (node, scope) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          child.textContent = interp(child.textContent, scope);
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === "SC-FOR") {
            const list = get(scope, child.getAttribute("list").replace(/[{}\s]/g, "")) ?? [];
            const as = child.getAttribute("as");
            const frag = document.createDocumentFragment();
            for (const item of list) {
              const copy = child.cloneNode(true);
              walk(copy, { ...scope, [as]: item });
              while (copy.firstChild) frag.appendChild(copy.firstChild);
            }
            child.replaceWith(frag);
          } else if (tag === "SC-IF") {
            const v = get(scope, child.getAttribute("value").replace(/[{}\s]/g, ""));
            if (!v) child.remove();
            else {
              walk(child, scope);
              child.replaceWith(...child.childNodes);
            }
          } else {
            for (const a of [...child.attributes]) if (a.value.includes("{{")) child.setAttribute(a.name, interp(a.value, scope));
            walk(child, scope);
          }
        }
      }
    };
    walk(document.querySelector("x-dc"), vals);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/duty-ref-${name}.png` });
  await ctx.close();
}
await shootMock("DutyMain.dc.html", "main");
await shootMock("DutyCalendar.dc.html", "calendar");
await shootMock("DutySwap.dc.html", "swap");
await shootMock("DutyRequest.dc.html", "request");

// ---------------------------------------------------------------- the app

const HOUSEHOLD = "10000000-0000-4000-8000-000000000001";
const E = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-000000000002";
const P = "00000000-0000-4000-8000-000000000003";
const N = "00000000-0000-4000-8000-000000000004";
const DUTY = "50000000-0000-4000-8000-000000000001";
const REQ = "60000000-0000-4000-8000-000000000001";

async function store() {
  return (await (await fetch(`${base}/api/mock-store`)).json()).stored;
}
async function put(s) {
  const r = await fetch(`${base}/api/mock-store`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
  if (r.status !== 204) throw new Error(`store put ${r.status}`);
}

/** Reset the duty data of the seeded household. */
async function setup({ order, start, awayN = null, overrides = [], doneUntil = null, requests = [] }) {
  const s = await store();
  s.db.profiles.find((p) => p.id === P).display_name = "Парасат";
  s.db.profiles.find((p) => p.id === N).display_name = "Nurdaulet";
  s.db.members.find((m) => m.user_id === N).away_until = awayN;
  s.db.duties = [{ id: DUTY, household_id: HOUSEHOLD, kind: "cooking", title: "Готовка", start_date: start, active: true, order }];
  s.db.dutyOverrides = overrides.map(([day, user]) => ({ duty_id: DUTY, day, user_id: user, source: "swap", reason: null }));
  const done = [];
  if (doneUntil) {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    for (let ms = Date.parse("2026-11-01T00:00:00Z"); ms <= Date.parse(`${doneUntil}T00:00:00Z`); ms += 86400000) {
      const day = new Date(ms).toISOString().slice(0, 10);
      if (day < start) continue;
      const o = overrides.find(([d]) => d === day);
      const user = o ? o[1] : order[Math.round((ms - startMs) / 86400000) % order.length];
      done.push({ duty_id: DUTY, day, user_id: user, done_at: `${day}T10:00:00.000Z` });
    }
  }
  s.db.dutyDone = done;
  s.db.swapRequests = requests;
  s.db.dutyMorningLog = [];
  await put(s);
}

async function phone(email, time) {
  const ctx = await browser.newContext({ ...devices["iPhone 15"], viewport: VIEW, baseURL: base, serviceWorkers: "block", colorScheme: "light" });
  await ctx.clock.setFixedTime(new Date(time));
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("link", { name: /^Профиль и квартира/ }).waitFor();
  return { ctx, page };
}
const ERASYL = "erasyl@obshak.test";
const NURIK = "nurik@obshak.test";
const shot = async (page, name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/duty-app-${name}.png` });
};

// a clean seed first: log in once so the server store exists
{
  const { ctx } = await phone(ERASYL, "2026-11-18T05:30:00Z");
  await ctx.close();
}

// Tue 18 Nov 10:30 Almaty. Order E A P N, N on Mon 1 Nov... (start 29 Oct), Mon 17 N and Tue 18 E swapped, everything before the 18th cooked.
const SWAPS = [["2026-11-17", N], ["2026-11-18", E]];
await setup({ order: [E, A, P, N], start: "2026-10-29", overrides: SWAPS, doneUntil: "2026-11-17" });
{
  const { ctx, page } = await phone(ERASYL, "2026-11-18T05:30:00Z");
  await page.goto("/duty");
  await page.getByTestId("duty-stove").waitFor();
  await shot(page, "main");
  await page.screenshot({ path: `${out}/duty-app-main-full.png`, fullPage: true });
  await page.goto("/");
  await page.getByTestId("home-duty-tile").waitFor();
  await shot(page, "home");
  await ctx.close();
}

// the calendar, with N away for the 25th
await setup({ order: [E, A, P, N], start: "2026-10-29", awayN: "2026-11-25", overrides: SWAPS, doneUntil: "2026-11-17" });
{
  const { ctx, page } = await phone(ERASYL, "2026-11-18T05:30:00Z");
  await page.goto("/duty/calendar");
  await page.getByTestId("month-grid").waitFor();
  await shot(page, "calendar");
  await ctx.close();
}

// Mon 17 Nov 05:00 Almaty: the swap sheet (my day Tue 18, before: Mon 17 Nurdaulet, after: Wed 19 Айдос)
await setup({ order: [E, A, P, N], start: "2026-10-29", doneUntil: "2026-11-16" });
{
  const { ctx, page } = await phone(ERASYL, "2026-11-17T00:00:00Z");
  await page.goto("/duty");
  await page.getByTestId("duty-stove").waitFor();
  await page.getByTestId("duty-swap").click();
  const sheet = page.getByTestId("duty-swap-sheet");
  await sheet.getByTestId("swap-option").first().click();
  await sheet.getByTestId("swap-reason").fill("В понедельник пары до вечера");
  await shot(page, "swap");
  await ctx.close();
}

// the request: E gives Mon 17, takes Tue 18 from N (order E N A P from Tue 10 Nov)
await setup({
  order: [E, N, A, P],
  start: "2026-11-10",
  doneUntil: "2026-11-16",
  requests: [
    {
      id: REQ,
      duty_id: DUTY,
      from_user: E,
      from_day: "2026-11-17",
      to_user: N,
      to_day: "2026-11-18",
      reason: "В понедельник пары до вечера, не успею. Отработаю во вторник",
      status: "pending",
      expires_at: "2026-11-17T05:00:00.000Z",
      created_at: "2026-11-16T15:00:00.000Z",
      decided_at: null,
    },
  ],
});
{
  const { ctx, page } = await phone(NURIK, "2026-11-17T00:00:00Z");
  await page.goto(`/duty/request/${REQ}`);
  await page.getByTestId("request-accept").waitFor();
  await shot(page, "request");
  await ctx.close();
}
await browser.close();
