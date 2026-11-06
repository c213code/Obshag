// Slice 3 iteration 2 screenshots: the app against a running mock/E2E server on :3100, then side-by-side composites
// (left = docs/design reference, right = the app). Run: node gan-harness/shoot-s3i2.mjs
import { webkit, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const BASE = "http://localhost:3100";
const dir = resolve("gan-harness/screenshots");
const out = (f) => resolve(dir, f);
const ME = "00000000-0000-4000-8000-000000000001";
const AIDOS = "00000000-0000-4000-8000-000000000002";
const HH = "10000000-0000-4000-8000-000000000001";

const browser = await webkit.launch();
const newPage = async (opts = {}) => {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL: BASE, ...opts });
  await context.route("https://kaspi.kz/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>kaspi</title>" }));
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.execCommand = (cmd) => cmd === "copy";
  });
  return { context, page };
};
const hydrated = (page) => page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });

// ---- login screens (fresh visitor)
{
  const { context, page } = await newPage();
  await page.goto("/login");
  await hydrated(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out("s3i2-app-login.png") });
  await page.getByLabel("Почта").fill("erasyl@obshak.test");
  await page.getByLabel("Пароль", { exact: true }).fill("wrong-pass");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByText("Неверная почта или пароль").waitFor();
  await page.screenshot({ path: out("s3i2-app-login-error.png") });
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Повтори пароль").waitFor();
  await page.waitForTimeout(600);
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Показать пароль" }).first().click();
  await page.screenshot({ path: out("s3i2-app-signup.png") });
  await context.close();
}

// ---- the pair screen: 4 000 against 3 600 between Ерасыл and Айдос (the numbers of Pay.dc.html's story)
{
  const { context, page } = await newPage();
  await page.goto("/login");
  await hydrated(page);
  await page.getByLabel("Почта").fill("erasyl@obshak.test");
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByText("Привет, Ерасыл").waitFor();
  const { stored } = await (await page.request.get("/api/mock-store")).json();
  const db = stored.db;
  const t = "2026-11-03T10:00:00.000Z";
  const purchase = (id, payer_id, amount, description) => ({ id, household_id: HH, payer_id, amount, description, merchant: null, source: "manual", status: "shared", created_at: t });
  const share = (purchase_id, debtor_id, amount, settled) => ({ purchase_id, debtor_id, amount, settled_at: settled ? t : null, settlement_id: null });
  db.purchases = [purchase("20000000-0000-4000-8000-0000000000a1", AIDOS, 4000, "Интернет"), purchase("20000000-0000-4000-8000-0000000000a2", ME, 3600, "Картошка")];
  db.shares = [
    share("20000000-0000-4000-8000-0000000000a1", ME, 2000, false),
    share("20000000-0000-4000-8000-0000000000a1", AIDOS, 2000, true),
    share("20000000-0000-4000-8000-0000000000a2", ME, 1800, true),
    share("20000000-0000-4000-8000-0000000000a2", AIDOS, 1800, false),
  ];
  db.settlements = [];
  const res = await page.request.put("/api/mock-store", { data: { version: stored.version, rev: stored.rev, db } });
  if (res.status() !== 204) throw new Error(`store PUT ${res.status()}`);
  await page.goto("/");
  await hydrated(page);
  await page.getByText("Привет, Ерасыл").waitFor();
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: "Рассчитаться" }).click();
  await page.waitForURL(/\/settle\/[0-9a-f-]{36}$/);
  await page.waitForTimeout(250);
  await page.screenshot({ path: out("s3i2-app-pay-1-mid.png") });
  await page.locator("[data-testid='pair-scene'][data-stage='3']").waitFor();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: out("s3i2-app-pay-2-end.png") });
  // first tap anywhere copies the number: the chip becomes «✓ скопирован» like the mockup
  await page.getByTestId("equation").click();
  await page.getByText("скопирован").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out("s3i2-app-pay-3-copied.png") });
  await page.getByRole("button", { name: "Я оплатил" }).click();
  await page.getByTestId("waiting").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: out("s3i2-app-pay-4-waiting.png") });
  // the bar is pinned to the bottom of the viewport; scroll position does not move it
  const bar = await page.getByRole("button", { name: /Перевести/ }).boundingBox();
  const vh = page.viewportSize().height;
  console.log("transfer button bottom edge", Math.round(bar.y + bar.height), "of viewport", vh);
  await page.goto("/");
  await page.getByTestId("waiting-row").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out("s3i2-app-main-waiting.png") });
  await context.close();

  // the creditor's side: «Подтверди оплату» and the «Получил» animation mid-frame
  const aidos = await newPage();
  const p = aidos.page;
  await p.goto("/login");
  await hydrated(p);
  await p.getByLabel("Почта").fill("aidos@obshak.test");
  await p.getByLabel("Пароль", { exact: true }).fill("password123");
  await p.getByRole("button", { name: "Войти", exact: true }).click();
  await p.getByText("Привет, Айдос").waitFor();
  await p.getByTestId("incoming-row").waitFor();
  await p.getByRole("heading", { name: "Подтверди оплату" }).scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  await p.screenshot({ path: out("s3i2-app-poluchil-0.png") });
  await p.getByTestId("incoming-row").getByRole("button", { name: "Получил" }).click();
  await p.waitForTimeout(120);
  await p.screenshot({ path: out("s3i2-app-poluchil-1-mid.png") });
  await aidos.context.close();
}
await browser.close();

// ---- side-by-side composites
const img = (f) => pathToFileURL(out(f)).href;
const pairs = [
  ["s3i2-cmp-pay-end.png", "s3-ref-pay.png", "s3i2-app-pay-3-copied.png", 844],
  ["s3i2-cmp-pay-waiting.png", "s3-ref-pay.png", "s3i2-app-pay-4-waiting.png", 844],
  ["s3i2-cmp-netting-mid.png", "s3-ref-netting-1.png", "s3i2-app-pay-1-mid.png", 700],
  ["s3i2-cmp-poluchil-mid.png", "s3-ref-poluchil-1.png", "s3i2-app-poluchil-1-mid.png", 700],
  ["s3i2-cmp-login.png", "s1-ref-addpurchase-390.png", "s3i2-app-login.png", 844],
  ["s3i2-cmp-signup.png", "s1-ref-addpurchase-390.png", "s3i2-app-signup.png", 844],
];
const b2 = await webkit.launch();
for (const [o, left, right, h] of pairs) {
  const page = await b2.newPage({ viewport: { width: 860, height: h + 40 }, deviceScaleFactor: 2 });
  const file = out("_cmp.html");
  writeFileSync(
    file,
    `<body style="margin:0;background:#444;display:flex;gap:20px;padding:20px;align-items:flex-start">
    <img src="${img(left)}" style="height:${h}px;max-width:410px;object-fit:contain;object-position:top;background:#000">
    <img src="${img(right)}" style="height:${h}px;max-width:410px;object-fit:contain;object-position:top;background:#000"></body>`,
  );
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out(o) });
  await page.close();
}
await b2.close();
