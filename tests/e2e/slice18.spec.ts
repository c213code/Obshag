import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 18: «+ Заказ» in the purchase form (detail shows the orders and everyone's share), «Кто платил?» on the water card
 * (the partner becomes the payer), the admin / payer edit sheet (the payer changes). Own household, mock mode.
 */
const A = { email: "arman@obshak.test", name: "Арман", id: "00000000-0000-4000-8000-0000000000f1" };
const B = { email: "bakyt@obshak.test", name: "Бакыт", id: "00000000-0000-4000-8000-0000000000f2" };
const C = { email: "vera@obshak.test", name: "Вера", id: "00000000-0000-4000-8000-0000000000f3" };
const D = { email: "dias@obshak.test", name: "Диас", id: "00000000-0000-4000-8000-0000000000f4" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000f9";
const NBSP = " ";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = { version: number; rev: number; db: Record<string, Array<Record<string, unknown>>> };

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block", colorScheme: "light" });
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
    for (const [i, p] of [A, B, C, D].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7704000020${i}`, avatar_color: ["me", "blue", "brown", "purple"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === A ? "admin" : "member", active: true, away_until: null, joined_at: new Date(Date.parse(at) + i).toISOString() });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 18", invite_code: "ZX18CV24BN57", created_by: A.id, created_at: at });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

const WHAT = "Продукты на неделю";

test.describe.configure({ mode: "serial" });

test.describe("slice 18: заказы, кто платил, правка", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("«+ Заказ» in the form: live preview, the detail lists the order and everybody's share", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/purchases/new");
      await page.getByLabel("Сумма", { exact: true }).fill("3000");
      await page.getByLabel("Что купили").fill(WHAT);

      await page.getByTestId("add-order").click();
      const row = page.getByTestId("order-row");
      await expect(row).toHaveCount(1);
      await row.getByRole("button", { name: D.name }).click();
      await row.getByTestId("order-amount").fill("500");
      await row.getByTestId("order-note").fill("энергетик");
      await expect(page.getByTestId("orders-preview")).toContainText(`Каждому ${money(625)}`);
      await expect(page.getByTestId("orders-preview")).toContainText(`${D.name} ${money(1125)}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: "gan-harness/screenshots/s18-form-orders.png" });

      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Поделить" }).click();
      await saved;
      await expect(page).toHaveURL(/\/$/);

      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await page.getByRole("link", { name: new RegExp(WHAT) }).click();
      await expect(page.getByTestId("purchase-title")).toHaveText(WHAT);
      const orders = page.getByTestId("purchase-orders");
      await expect(orders).toContainText(D.name);
      await expect(orders).toContainText("энергетик");
      await expect(orders).toContainText(money(500));
      const rows = page.getByTestId("payment-row");
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: D.name })).toContainText(money(1125));
      await expect(rows.filter({ hasText: B.name })).toContainText(money(625));
      await expect(rows.filter({ hasText: C.name })).toContainText(money(625));
      await page.screenshot({ path: "gan-harness/screenshots/s18-detail-orders.png" });
    });
  });

  test("an order is refused for a rest that is too small", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/purchases/new");
      await page.getByLabel("Сумма", { exact: true }).fill("1000");
      await page.getByLabel("Что купили").fill("Мелочь");
      await page.getByTestId("add-order").click();
      const row = page.getByTestId("order-row");
      await row.getByRole("button", { name: D.name }).click();
      await row.getByTestId("order-amount").fill("999");
      await expect(page.getByText("После заказов остаётся слишком мало на всех")).toBeVisible();
      await expect(page.getByRole("button", { name: "Поделить" })).toBeDisabled();
      await row.getByTestId("order-remove").click();
      await expect(page.getByTestId("order-row")).toHaveCount(0);
    });
  });

  test("Вода «Кто платил?»: the partner pays, the queue still records who went", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty?kind=water");
      await page.getByTestId("duty-create-submit").click();
      await expect(page.getByTestId("water-card")).toBeVisible();
      await expect(page.getByTestId("water-payer-me")).toHaveAttribute("aria-checked", "true");
      await page.getByTestId("water-payer-partner").click();
      await expect(page.getByTestId("water-payer-partner")).toHaveAttribute("aria-checked", "true");
      await page.waitForTimeout(300);
      await page.screenshot({ path: "gan-harness/screenshots/s18-water-payer.png" });
      const brought = savedToStore(page);
      await page.getByTestId("water-brought").click();
      await brought;
      await expect(page.getByTestId("water-carried")).toContainText("Ты");

      await page.goto("/purchases");
      await page.getByRole("link", { name: /Вода 20 л/ }).first().click();
      await expect(page.getByTestId("purchase-byline")).toContainText(`платил ${B.name}`);
    });
  });

  test("the payer / admin edits a purchase: the payer changes, orders stay", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await page.getByRole("link", { name: new RegExp(WHAT) }).click();
      await expect(page.getByTestId("purchase-byline")).toContainText("платил ты");
      await page.getByRole("button", { name: "Изменить" }).click();
      const sheet = page.getByTestId("edit-purchase-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId("order-row")).toHaveCount(1);
      await page.waitForTimeout(400);
      await page.screenshot({ path: "gan-harness/screenshots/s18-edit-sheet.png" });
      await sheet.getByRole("radiogroup", { name: "Кто платил" }).getByRole("button", { name: B.name }).click();
      const saved = savedToStore(page);
      await sheet.getByTestId("edit-save").click();
      await saved;
      await expect(page.getByTestId("purchase-byline")).toContainText(`платил ${B.name}`);
      await expect(page.getByTestId("purchase-orders")).toContainText(D.name);
      // the old payer now owes his equal part
      const rows = page.getByTestId("payment-row");
      await expect(rows.filter({ hasText: "Ты" })).toContainText(money(625));
    });
  });
});
