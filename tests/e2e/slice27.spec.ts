import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 27: one number on Главная. The hero card says «Ты должен N» (+ «Оплатить»), else «Тебе должны N» (+ «Напомнить»),
 * else «Всё ровно» ✓. Only pairs of 100 ₸ and up count; the bento money tile is gone. An own household:
 *   Икс owes Игрек 300 and Зет 200     -> «Ты должен 500», «Оплатить» scrolls to «К оплате» (two rows);
 *   Игрек is owed 300 by Икс, 50 by Вэ -> «Тебе должны 300» (the 50 is not shown anywhere on home);
 *   Вэ owes Игрек only 50              -> «Всё ровно», no «К оплате», no «копится».
 */
const X = { email: "iks27@obshak.test", name: "Икс", id: "00000000-0000-4000-8000-0000000027a1" };
const Y = { email: "igrek27@obshak.test", name: "Игрек", id: "00000000-0000-4000-8000-0000000027b2" };
const Z = { email: "zet27@obshak.test", name: "Зет", id: "00000000-0000-4000-8000-0000000027c3" };
const W = { email: "ve27@obshak.test", name: "Вэ", id: "00000000-0000-4000-8000-0000000027d4" };
const HOUSEHOLD = "10000000-0000-4000-8000-000000002727";
const P1 = "20000000-0000-4000-8000-000000002711"; // Игрек paid 600 «Ролтон»: Икс owes 300
const P2 = "20000000-0000-4000-8000-000000002712"; // Зет paid 400 «Вода»: Икс owes 200
const P3 = "20000000-0000-4000-8000-000000002713"; // Игрек paid 100 «Соль»: Вэ owes 50
const NBSP = " ";
const SHOTS = "gan-harness/screenshots";

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = {
  version: number;
  rev: number;
  db: {
    users: Array<{ id: string; email: string; password: string }>;
    profiles: Array<Record<string, unknown>>;
    households: Array<Record<string, unknown>>;
    members: Array<Record<string, unknown>>;
    purchases: Array<Record<string, unknown>>;
    shares: Array<Record<string, unknown>>;
  };
};

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block", colorScheme: "dark" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    if (!e.message.includes("access control checks")) errors.push(e.message);
  });
  page.on("console", (m) => {
    const benign = m.text().includes("Failed to load resource") || m.text().includes("access control checks") || m.text().includes("Failed to fetch RSC payload");
    if (m.type() === "error" && !benign) errors.push(m.text());
  });
  return { context, page, errors };
}
async function withPhone(browser: Browser, baseURL: string | undefined, run: (phone: Phone) => Promise<void>) {
  const phone = await newPhone(browser, baseURL);
  try {
    await run(phone);
  } finally {
    await phone.context.close();
  }
  expect(phone.errors).toEqual([]);
}
async function logIn(page: Page, who: { email: string; name: string }) {
  await page.goto("/login");
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  await page.getByLabel("Почта").fill(who.email);
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("link", { name: `Профиль и квартира, ${who.name}` })).toBeVisible();
}
async function readStore(request: APIRequestContext): Promise<Stored> {
  const { stored } = (await (await request.get("/api/mock-store")).json()) as { stored: Stored | null };
  if (!stored) throw new Error("mock store is empty");
  return stored;
}
async function injectHousehold(request: APIRequestContext) {
  const current = (await (await request.get("/api/mock-store")).json()) as { stored: Stored | null };
  if (!current.stored) await request.put("/api/mock-store", { data: { version: MOCK_SCHEMA_VERSION, rev: 0, db: createSeed() } });
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await readStore(request);
    if (s.db.households.some((h) => h.id === HOUSEHOLD)) return;
    const at = new Date().toISOString();
    const old = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    for (const [i, p] of [X, Y, Z, W].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7702700010${i}`, avatar_color: ["me", "blue", "brown", "green"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === Y ? "admin" : "member", active: true, away_until: null, joined_at: at });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 27", invite_code: "ZX27CV24BN57", created_by: Y.id, created_at: at });
    s.db.purchases.push(
      { id: P1, household_id: HOUSEHOLD, payer_id: Y.id, amount: 600, description: "Ролтон", merchant: null, source: "manual", status: "shared", created_at: old },
      { id: P2, household_id: HOUSEHOLD, payer_id: Z.id, amount: 400, description: "Вода", merchant: null, source: "manual", status: "shared", created_at: old },
      { id: P3, household_id: HOUSEHOLD, payer_id: Y.id, amount: 100, description: "Соль", merchant: null, source: "manual", status: "shared", created_at: old },
    );
    s.db.shares.push(
      { purchase_id: P1, debtor_id: Y.id, amount: 300, settled_at: old, settlement_id: null },
      { purchase_id: P1, debtor_id: X.id, amount: 300, settled_at: null, settlement_id: null },
      { purchase_id: P2, debtor_id: Z.id, amount: 200, settled_at: old, settlement_id: null },
      { purchase_id: P2, debtor_id: X.id, amount: 200, settled_at: null, settlement_id: null },
      { purchase_id: P3, debtor_id: Y.id, amount: 50, settled_at: old, settlement_id: null },
      { purchase_id: P3, debtor_id: W.id, amount: 50, settled_at: null, settlement_id: null },
    );
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}

/** No money tile in the bento; the monthly tile and «Траты» share one row (no hole in the grid). */
async function expectBentoRow(page: Page) {
  await expect(page.getByTestId("bento-owed")).toHaveCount(0);
  const bill = (await page.getByTestId("bento-bill").boundingBox())!;
  const spending = (await page.getByTestId("bento-spending").boundingBox())!;
  expect(Math.abs(bill.y - spending.y)).toBeLessThan(1);
  expect(Math.abs(bill.height - spending.height)).toBeLessThan(1);
}

test.describe.configure({ mode: "serial" });

test.describe("slice 27: one number on Главная", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("I owe: «Ты должен 500», a lime «Оплатить» to «К оплате» (two rows)", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, X);
      const hero = page.getByTestId("balance-card-front");
      await expect(hero).toContainText("Квартира 27");
      await expect(hero.getByTestId("hero-label")).toHaveText("Ты должен");
      await expect(hero.getByTestId("hero-amount")).toHaveText(`500${NBSP}₸`);
      await expect(page.getByText("Баланс", { exact: true })).toHaveCount(0);
      const pay = page.getByTestId("hero-pay");
      await expect(pay).toHaveText("Оплатить");
      await expect(pay).toHaveAccessibleName(`Оплатить 500${NBSP}₸`);
      expect(await pay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(200, 242, 90)"); // lime
      await expect(page.getByTestId("hero-remind")).toHaveCount(0);
      await expectBentoRow(page);
      const rows = page.getByTestId("to-pay-section").getByTestId("to-pay-row");
      await expect(rows).toHaveCount(2);
      await page.screenshot({ path: `${SHOTS}/s27-home-owe.png` });

      // two people to pay: «Оплатить» brings «К оплате» into view (no navigation)
      await pay.click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { name: "К оплате" })).toBeInViewport();
      await rows.filter({ hasText: Y.name }).getByTestId("to-pay-go").click();
      await expect(page).toHaveURL(new RegExp(`/settle/${Y.id}$`));
    });
  });

  test("they owe me: «Тебе должны 300» (the 50 is not shown), «Напомнить» opens the settle list", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, Y);
      const hero = page.getByTestId("balance-card-front");
      await expect(hero.getByTestId("hero-label")).toHaveText("Тебе должны");
      await expect(hero.getByTestId("hero-amount")).toHaveText(`300${NBSP}₸`);
      await expect(page.getByTestId("hero-pay")).toHaveCount(0);
      await expect(page.getByTestId("hero-remind")).toHaveText("Напомнить");
      await expect(page.getByTestId("to-pay-section")).toHaveCount(0);
      await expect(page.getByText(/копится/)).toHaveCount(0);
      await expectBentoRow(page);
      await page.screenshot({ path: `${SHOTS}/s27-home-owed.png` });

      await page.getByTestId("hero-remind").click();
      await expect(page).toHaveURL(/\/settle$/);
      // the settle list keeps the small pair, muted, without the «копится» wording
      const small = page.getByTestId("settle-owes-me-row").filter({ hasText: W.name });
      await expect(small).toContainText(`тебе должен 50${NBSP}₸`);
      await expect(small).not.toContainText("копится");
      await expect(page.getByRole("button", { name: /^Списать 50/ })).toBeVisible();
    });
  });

  test("only a small debt: «Всё ровно» ✓, no number, no action, no «К оплате»", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, W);
      const hero = page.getByTestId("balance-card-front");
      await expect(hero.getByTestId("hero-even")).toHaveText("Всё ровно");
      await expect(hero.getByTestId("hero-amount")).toHaveCount(0);
      await expect(page.getByTestId("card-action")).toHaveCount(0);
      await expect(page.getByTestId("to-pay-section")).toHaveCount(0);
      await expect(page.getByText(/копится/)).toHaveCount(0);
      await expectBentoRow(page);
      await page.screenshot({ path: `${SHOTS}/s27-home-even.png` });
    });
  });
});
