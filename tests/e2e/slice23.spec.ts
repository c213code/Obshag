import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 23: a housemate marks another one «в отъезде» from «Порядок» (and from Квартира → сосед); the week skips them. Own household.
 */
const A = { email: "asetx@obshak.test", name: "Асет", id: "00000000-0000-4000-8000-0000000000e1" };
const B = { email: "botax@obshak.test", name: "Бота", id: "00000000-0000-4000-8000-0000000000e2" };
const C = { email: "chingizx@obshak.test", name: "Чингиз", id: "00000000-0000-4000-8000-0000000000e3" };
const D = { email: "danax@obshak.test", name: "Дана", id: "00000000-0000-4000-8000-0000000000e4" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000e9";

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = { version: number; rev: number; db: Record<string, Array<Record<string, unknown>>> };

/** The Asia/Almaty date n days from now, 'YYYY-MM-DD' (the app's own definition of today). */
const almaty = (n: number) => new Date(Date.now() + 5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

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
    for (const [i, p] of [A, B, C, D].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7703000010${i}`, avatar_color: ["me", "blue", "brown", "purple"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === A ? "admin" : "member", active: true, away_until: null, joined_at: new Date(Date.parse(at) + i).toISOString() });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 23", invite_code: "ZX23CV24BN57", created_by: A.id, created_at: at });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

test.describe.configure({ mode: "serial" });

test.describe("slice 23: в отъезде за соседа", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("the admin sets up Готовка; Асет marks Бота away from «Порядок»; the week gives his day to the next; the neighbour sheet has the same action", async ({ browser, baseURL }) => {
    const back = almaty(3);
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty");
      const saved = savedToStore(page);
      await page.getByTestId("duty-create-submit").click();
      await saved;
      // rotation A B C D: tomorrow is Бота's
      const tomorrow = page.locator(`[data-testid="week-cell"][data-day="${almaty(1)}"]`);
      await expect(tomorrow).toHaveAttribute("data-user", B.id);

      await page.getByTestId("order-person").filter({ hasText: B.name }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toContainText("Бота в отъезде");
      await expect(sheet).toContainText("Пока его нет, его дни готовки берёт следующий по кругу.");
      await sheet.getByLabel("Вернётся").fill(back);
      const away = savedToStore(page);
      await sheet.getByRole("button", { name: "Сохранить" }).click();
      await away;

      // Бота's day goes to Чингиз, marked with the away plane; his row says when he is back
      await expect(tomorrow).toHaveAttribute("data-user", C.id);
      await expect(tomorrow.getByRole("img", { name: "в отъезде" })).toBeVisible();
      await expect(page.getByTestId("order-person").filter({ hasText: B.name })).toContainText(`в отъезде до ${Number(back.slice(8, 10))}`);
      await page.screenshot({ path: "gan-harness/screenshots/s23-away-for.png", fullPage: true });

      // Квартира → neighbour → «В отъезде…» reaches the same sheet; «Бота дома» clears it
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByTestId("member-Бота").getByRole("button").click();
      await page.getByTestId("member-away").click();
      const sheet2 = page.getByRole("dialog").filter({ hasText: "Бота в отъезде" });
      await expect(sheet2).toBeVisible();
      const home = savedToStore(page);
      await sheet2.getByRole("button", { name: "Бота дома" }).click();
      await home;
      await expect(page.getByTestId("member-Бота")).not.toContainText("в отъезде");
      await page.goto("/duty");
      await expect(page.locator(`[data-testid="week-cell"][data-day="${almaty(1)}"]`)).toHaveAttribute("data-user", B.id);
    });
  });

  test("a non-admin housemate can mark someone away too, and sees only «В отъезде…» in the neighbour sheet", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, D);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByTestId("member-Чингиз").getByRole("button").click();
      await expect(page.getByTestId("member-away")).toBeVisible();
      await expect(page.getByTestId("member-role")).toHaveCount(0);
      await expect(page.getByTestId("member-remove")).toHaveCount(0);
    });
  });
});
