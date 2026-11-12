import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";
import { payViaKaspi, returnFromKaspi } from "./payFlow";

/**
 * Slice 17: «Я оплатил» is gone. Opening Kaspi records a prompt; coming back to the app asks «Ты перевёл …?».
 * «Да, перевёл» marks the settlement and it is final at once (slice 22: nobody confirms), «Ещё нет» only closes the question.
 * Own household with one debt of 300 ₸, so the balances other specs assert are untouched.
 */
const P = { email: "timur@obshak.test", name: "Тимур", id: "00000000-0000-4000-8000-0000000000f1" }; // the debtor
const Q = { email: "zarina@obshak.test", name: "Зарина", id: "00000000-0000-4000-8000-0000000000f2" }; // the creditor
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000f9";
const PURCHASE = "20000000-0000-4000-8000-0000000000f9";
const NBSP = " ";

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
    settlements: Array<{ household_id: string; from_id: string; to_id: string; status: string; amount: number }>;
    paidPrompts?: Array<{ household_id: string; from_user: string; to_user: string; amount: number; status: string }>;
  };
};

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block" });
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
const hydrated = (page: Page) => page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
async function logIn(page: Page, who: { email: string; name: string }) {
  await page.goto("/login");
  await hydrated(page);
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
    for (const [i, p] of [P, Q].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7703000010${i}`, avatar_color: ["me", "blue"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === Q ? "admin" : "member", active: true, away_until: null, joined_at: at });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 17", invite_code: "ZX17CV24BN57", created_by: Q.id, created_at: at });
    // Зарина paid 600 for both: Тимур owes her 300
    s.db.purchases.push({ id: PURCHASE, household_id: HOUSEHOLD, payer_id: Q.id, amount: 600, description: "Продукты", merchant: null, source: "manual", status: "shared", created_at: at });
    s.db.shares.push(
      { purchase_id: PURCHASE, debtor_id: Q.id, amount: 300, settled_at: at, settlement_id: null },
      { purchase_id: PURCHASE, debtor_id: P.id, amount: 300, settled_at: null, settlement_id: null },
    );
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const prompts = async (request: APIRequestContext) => (await readStore(request)).db.paidPrompts?.filter((p) => p.household_id === HOUSEHOLD) ?? [];
const marked = async (request: APIRequestContext) =>
  (await readStore(request)).db.settlements.filter((s) => s.household_id === HOUSEHOLD && s.status === "marked");
const settled = async (request: APIRequestContext) => (await readStore(request)).db.settlements.filter((s) => s.household_id === HOUSEHOLD);
/** A new open debt of 300 for Тимур (the previous test closed the first one). */
async function addDebt(request: APIRequestContext) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await readStore(request);
    const id = `20000000-0000-4000-8000-0000000000${(10 + s.db.purchases.length) % 100}`.slice(0, 36);
    const at = new Date().toISOString();
    s.db.purchases.push({ id, household_id: HOUSEHOLD, payer_id: Q.id, amount: 600, description: "Ещё продукты", merchant: null, source: "manual", status: "shared", created_at: at });
    s.db.shares.push(
      { purchase_id: id, debtor_id: Q.id, amount: 300, settled_at: at, settlement_id: null },
      { purchase_id: id, debtor_id: P.id, amount: 300, settled_at: null, settlement_id: null },
    );
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not add a debt");
}

test.describe.configure({ mode: "serial" });

test.describe("slice 17: «Ты перевёл?»", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("no «Я оплатил»; Kaspi -> back -> «Да, перевёл» closes the debt, nobody confirms", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, P);
      await page.goto(`/settle/${Q.id}`);
      await hydrated(page);
      await expect(page.getByRole("button", { name: "Я оплатил" })).toHaveCount(0);
      await expect(page.getByTestId("paid-sheet")).toHaveCount(0);

      // opening Kaspi records one pending prompt for exactly this pair and amount
      await payViaKaspi(page, "yes");
      expect(await prompts(request)).toMatchObject([{ from_user: P.id, to_user: Q.id, amount: 300, status: "yes" }]);
      expect(await marked(request)).toEqual([]);
      expect(await settled(request)).toMatchObject([{ from_id: P.id, to_id: Q.id, amount: 300, status: "confirmed" }]);

      // the debt is closed at once: no wait for the creditor
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
      await expect(page.getByTestId("waiting")).toHaveCount(0);
      await page.screenshot({ path: "gan-harness/screenshots/s17-waiting.png" });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, Q);
      await expect(page.getByRole("heading", { name: "Подтверди оплату" })).toHaveCount(0);
      await expect(page.getByTestId("incoming-row")).toHaveCount(0);
    });
  });

  test("the sheet reads «Ты перевёл Зарине 300 ₸?» and «Ещё нет» marks nothing", async ({ browser, baseURL, request }) => {
    await addDebt(request);
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, P);
      await page.goto(`/settle/${Q.id}`);
      await hydrated(page);
      await expect(page.getByTestId("waiting")).toHaveCount(0);
      expect(await marked(request)).toEqual([]);

      const popup = page.context().waitForEvent("page");
      await page.getByRole("button", { name: /^Перевести / }).click();
      await (await popup).close();
      await returnFromKaspi(page);
      const sheet = page.getByTestId("paid-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("heading")).toHaveText(`Ты перевёл Зарине 300${NBSP}₸?`);
      await expect(sheet).not.toContainText("подтвердит");
      await page.screenshot({ path: "gan-harness/screenshots/s17-sheet.png" });
      await page.getByTestId("paid-no").click();
      await expect(sheet).toHaveCount(0);
      expect(await marked(request)).toEqual([]);
      expect(await settled(request)).toHaveLength(1); // only the one from the first test
      expect((await prompts(request)).at(-1)).toMatchObject({ status: "no" });
      // the pair screen is unchanged: still payable
      await expect(page.getByRole("button", { name: /^Перевести / })).toBeVisible();
    });
  });

  test("a push opens the pair screen with ?ask=1: the question is already there; dismissing keeps it for the next return", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, P);
      await page.goto(`/settle/${Q.id}`);
      await hydrated(page);
      const popup = page.context().waitForEvent("page");
      const opened = page.waitForResponse((r) => r.url().includes("/api/settle/opened"));
      await page.getByRole("button", { name: /^Перевести / }).click();
      await (await popup).close();
      expect((await opened).status()).toBe(200);

      await page.goto(`/settle/${Q.id}?ask=1`);
      await hydrated(page);
      const sheet = page.getByTestId("paid-sheet");
      await expect(sheet).toBeVisible();
      // Esc closes without answering
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0); // the collapse is over: the sheet is gone for good
      await returnFromKaspi(page);
      await expect(sheet).toBeVisible();
      await page.getByTestId("paid-yes").click();
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
    });
  });

  test("the route refuses a body that is not exactly {household_id, to_user}", async ({ request }) => {
    const res = await request.post("/api/settle/opened", { data: { household_id: HOUSEHOLD, to_user: Q.id, amount: 1 } });
    expect(res.status()).toBe(400);
    const anon = await request.post("/api/settle/opened", { data: { household_id: HOUSEHOLD, to_user: Q.id } });
    expect([401, 403, 500]).toContain(anon.status());
  });
});
