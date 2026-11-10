import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 13: Kaspi cannot transfer less than 100 ₸. A 350 ₸ loaf split 4 ways is ~88 ₸ per person: the debt only
 * accumulates (no Kaspi / «Я оплатил» / «Напомнить») and the creditor can write it off. Own household, so the balances
 * other specs assert are untouched.
 */
const ME = { email: "ismail@obshak.test", name: "Исмаил", id: "00000000-0000-4000-8000-0000000000c1" };
const B = { email: "berik@obshak.test", name: "Берик", id: "00000000-0000-4000-8000-0000000000c2" };
const L = { email: "lyazzat@obshak.test", name: "Ляззат", id: "00000000-0000-4000-8000-0000000000c3" };
const S = { email: "saule@obshak.test", name: "Сауле", id: "00000000-0000-4000-8000-0000000000c4" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000c9";

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = {
  version: number;
  rev: number;
  db: {
    users: Array<{ id: string; email: string; password: string }>;
    profiles: Array<Record<string, unknown>>;
    households: Array<Record<string, unknown>>;
    members: Array<Record<string, unknown>>;
    settlements: Array<{ household_id: string; kind?: string; status: string; amount: number }>;
    shares: Array<{ debtor_id: string; amount: number; settled_at: string | null }>;
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
    for (const [i, p] of [ME, B, L, S].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7702000010${i}`, avatar_color: ["me", "blue", "brown", "green"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === ME ? "admin" : "member", active: true, away_until: null, joined_at: at });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 13", invite_code: "ZX13CV24BN57", created_by: ME.id, created_at: at });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

test.describe.configure({ mode: "serial" });

test.describe("slice 13: Kaspi minimum", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("350 ₸ split 4 ways accumulates (no Kaspi); the creditor writes it off and the debt disappears", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.goto("/purchases/new");
      await page.getByLabel("Сумма", { exact: true }).fill("350");
      await page.getByLabel("Что купили").fill("Хлеб");
      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Поделить" }).click();
      await saved;
      await expect(page).toHaveURL(/\/$/);

      // Главная: the amount accumulates, nothing is claimable, no «Напомнить»
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(/^0\s₸$/);
      await expect(page.getByTestId("bento-accruing")).toContainText("копится");
      await expect(page.getByTestId("bento-owed").getByText("Напомнить", { exact: true })).toHaveCount(0);

      // the list: three people, each «копится», each with «Списать», no «Напомнить»
      await page.goto("/settle");
      await expect(page.getByTestId("settle-owes-me-row")).toHaveCount(3);
      await expect(page.getByTestId("settle-owes-me-row").first()).toContainText("копится");
      await expect(page.getByRole("button", { name: /^Списать \d+/ })).toHaveCount(3);
      await expect(page.getByRole("button", { name: "Напомнить" })).toHaveCount(0);

      // the pair screen: the muted note, no Kaspi / «Я оплатил» / «Напомнить»
      await page.getByTestId("settle-owes-me-row").filter({ hasText: B.name }).getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/settle/${B.id}$`));
      await expect(page.getByTestId("small-note")).toContainText("меньше 100");
      await expect(page.getByTestId("small-note")).toContainText("Копится до следующих покупок");
      await expect(page.getByTestId("kaspi-bar")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Перевести|Я оплатил|Напомнить/ })).toHaveCount(0);

      // write off: the confirm sheet says what happens
      await page.getByTestId("writeoff-pair").click();
      const sheet = page.getByTestId("writeoff-sheet");
      await expect(sheet).toContainText(/Списать \d+\s₸ у Берика\?/);
      await expect(sheet).toContainText("Долг закроется без перевода.");
      const saved2 = savedToStore(page);
      await page.getByTestId("writeoff-confirm").click();
      await saved2;

      // the debt is gone: Берик is no longer in the list, the other two are
      await page.goto("/settle");
      await expect(page.getByTestId("settle-owes-me-row")).toHaveCount(2);
      await expect(page.getByTestId("settle-owes-me-row").filter({ hasText: B.name })).toHaveCount(0);

      const s = await readStore(request);
      const mine = s.db.settlements.filter((x) => x.household_id === HOUSEHOLD);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ kind: "writeoff", status: "confirmed" });
      expect(mine[0].amount).toBeLessThan(100);
      expect(s.db.shares.filter((x) => x.debtor_id === B.id && x.settled_at === null)).toEqual([]);
    });
  });
});
