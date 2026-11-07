// Slices 5+2: side-by-side of Purchase.dc.html (left) and the app's purchase detail (right).
// Needs the E2E build served on :3100 (NEXT_PUBLIC_DATA_MODE=mock, NEXT_PUBLIC_E2E=1, E2E_ALLOW_MOCK_STORE=1, CRON_SECRET set).
import { webkit } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = resolve("gan-harness/screenshots");
const base = "http://localhost:3100";
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

// reference
const ref = await ctx.newPage();
await ref.goto(pathToFileURL(resolve("docs/design/Purchase.dc.html")).href);
await ref.waitForTimeout(400);
await ref.screenshot({ path: resolve(dir, "s52-ref-purchase.png") });

// app: the seeded «Продукты» (6000, Magnum, paid by me) with Айдос and Нурик already received, Даня waiting, like the mockup
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByLabel("Пароль", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Войти", exact: true }).click();
await page.getByText("Привет, Ерасыл").waitFor();

const api = ctx.request;
const stored = (await (await api.get(`${base}/api/mock-store`)).json()).stored;
const idOf = (email) => stored.db.users.find((u) => u.email === email).id;
const groceries = stored.db.purchases.find((p) => p.description === "Продукты");
const at = (h, m) => new Date(Date.now() - 3600_000 * 2 + m * 1000 + h).toISOString();
for (const s of stored.db.shares) {
  if (s.purchase_id !== groceries.id) continue;
  if (s.debtor_id === idOf("aidos@obshak.test")) s.settled_at = at(0, 0);
  if (s.debtor_id === idOf("nurik@obshak.test")) s.settled_at = at(0, 1100);
}
groceries.created_at = new Date(new Date().setHours(18, 40, 0, 0)).toISOString();
await api.put(`${base}/api/mock-store`, { data: { version: stored.version, rev: stored.rev, db: stored.db } });

await page.goto(`${base}/purchases`);
await page.getByRole("link", { name: /Продукты/ }).first().click();
await page.getByTestId("purchase-title").waitFor();
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(dir, "s52-app-purchase.png") });

const cmp = await browser.newPage({ viewport: { width: 860, height: 884 }, deviceScaleFactor: 2 });
const img = (f) => pathToFileURL(resolve(dir, f)).href;
writeFileSync(
  resolve(dir, "_cmp.html"),
  `<body style="margin:0;background:#444;display:flex;gap:20px;padding:20px;align-items:flex-start">
    <img src="${img("s52-ref-purchase.png")}" style="height:844px;max-width:410px;object-fit:contain;background:#000">
    <img src="${img("s52-app-purchase.png")}" style="height:844px;max-width:410px;object-fit:contain;background:#000"></body>`,
);
await cmp.goto(pathToFileURL(resolve(dir, "_cmp.html")).href);
await cmp.waitForTimeout(300);
await cmp.screenshot({ path: resolve(dir, "s52-cmp-purchase.png") });
await browser.close();
