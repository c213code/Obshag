// Slices 6+7: side-by-side of Bills.dc.html / Invite.dc.html (left) and the app (right).
// Needs the E2E build served on :3100 (NEXT_PUBLIC_DATA_MODE=mock, NEXT_PUBLIC_E2E=1, E2E_ALLOW_MOCK_STORE=1, CRON_SECRET set).
import { webkit } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = resolve("gan-harness/screenshots");
const base = "http://localhost:3100";
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

const ref = await ctx.newPage();
for (const [file, out] of [["Bills.dc.html", "s67-ref-bills.png"], ["Invite.dc.html", "s67-ref-flat.png"]]) {
  await ref.goto(pathToFileURL(resolve("docs/design", file)).href);
  await ref.waitForTimeout(400);
  await ref.screenshot({ path: resolve(dir, out) });
}

const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByLabel("Пароль", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Войти", exact: true }).click();
await page.getByText("Привет, Ерасыл").waitFor();

// data like the mockup: Аренда (all paid), Коммуналка (needs an amount), Интернет (2 of 3)
const api = ctx.request;
const stored = (await (await api.get(`${base}/api/mock-store`)).json()).stored;
const db = stored.db;
const idOf = (email) => db.users.find((u) => u.email === email).id;
const [me, aidos, danya, nurik] = ["erasyl", "aidos", "danya", "nurik"].map((n) => idOf(`${n}@obshak.test`));
const hh = db.households[0].id;
const month = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
const now = new Date().toISOString();
const bill = (id, title, icon, amount, variable, day, payer, participants) => ({ id, household_id: hh, title, icon, amount, variable, day_of_month: day, payer_id: payer, last_generated_month: variable ? null : month, participants });
db.bills = [
  bill("b0000000-0000-4000-8000-000000000001", "Аренда", "home", 180000, false, 1, me, [me, aidos, danya, nurik]),
  bill("b0000000-0000-4000-8000-000000000002", "Коммуналка", "drop", null, true, 1, me, [me, aidos, danya, nurik]),
  bill("b0000000-0000-4000-8000-000000000003", "Интернет", "wifi", 8000, false, 5, aidos, [me, aidos, danya]),
];
const mk = (pid, bid, title, amount, payer, ids, settledIds) => {
  db.purchases.push({ id: pid, household_id: hh, payer_id: payer, amount, description: title, merchant: null, source: "monthly", status: "shared", created_at: now, bill_id: bid, bill_month: month });
  const base = Math.floor(amount / ids.length);
  for (const d of ids) db.shares.push({ purchase_id: pid, debtor_id: d, amount: base, settled_at: settledIds.includes(d) ? now : null, settlement_id: null });
};
mk("c0000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000001", "Аренда", 180000, me, [me, aidos, danya, nurik], [me, aidos, danya, nurik]);
mk("c0000000-0000-4000-8000-000000000003", "b0000000-0000-4000-8000-000000000003", "Интернет", 8000, aidos, [me, aidos, danya], [me, aidos]);
const away = new Date(Date.now() + (5 + 24 * 7) * 3600_000).toISOString().slice(0, 10);
db.members.find((m) => m.user_id === nurik).away_until = away;
await api.put(`${base}/api/mock-store`, { data: { version: stored.version, rev: stored.rev, db } });

await page.goto(`${base}/monthly`);
await page.getByTestId("bill-card").first().waitFor();
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(dir, "s67-app-bills.png") });
await page.goto(`${base}/flat`);
await page.getByTestId("invite-code").waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(dir, "s67-app-flat.png") });

const cmp = await browser.newPage({ viewport: { width: 860, height: 884 }, deviceScaleFactor: 2 });
const img = (f) => pathToFileURL(resolve(dir, f)).href;
for (const [name, a, b] of [["bills", "s67-ref-bills.png", "s67-app-bills.png"], ["flat", "s67-ref-flat.png", "s67-app-flat.png"]]) {
  writeFileSync(
    resolve(dir, "_cmp.html"),
    `<body style="margin:0;background:#444;display:flex;gap:20px;padding:20px;align-items:flex-start">
      <img src="${img(a)}" style="height:844px;max-width:410px;object-fit:contain;background:#000">
      <img src="${img(b)}" style="height:844px;max-width:410px;object-fit:contain;background:#000"></body>`,
  );
  await cmp.goto(pathToFileURL(resolve(dir, "_cmp.html")).href);
  await cmp.waitForTimeout(300);
  await cmp.screenshot({ path: resolve(dir, `s67-cmp-${name}.png`) });
}
await browser.close();
