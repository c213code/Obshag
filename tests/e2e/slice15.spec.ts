import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 14, «Очередь»: an admin creates Готовка, the week shows the rotation, A asks D to swap days, D accepts on the
 * request screen, the calendar shows ⇄ and the swapped cooks, «Приготовил» puts a check on today. Own household.
 */
const A = { email: "asel@obshak.test", name: "Асель", id: "00000000-0000-4000-8000-0000000000e1" };
const B = { email: "boris@obshak.test", name: "Борис", id: "00000000-0000-4000-8000-0000000000e2" };
const C = { email: "chyngys@obshak.test", name: "Чингис", id: "00000000-0000-4000-8000-0000000000e3" };
const D = { email: "damir@obshak.test", name: "Дамир", id: "00000000-0000-4000-8000-0000000000e4" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000e9";

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = { version: number; rev: number; db: Record<string, Array<Record<string, unknown>>> };

/** The Asia/Almaty date n days from now, 'YYYY-MM-DD' (the app's own definition of today). */
const almaty = (n: number) => new Date(Date.now() + 5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

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
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7704000010${i}`, avatar_color: ["me", "blue", "brown", "purple"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === A ? "admin" : "member", active: true, away_until: null, joined_at: new Date(Date.parse(at) + i).toISOString() });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 15", invite_code: "ZX15CV24BN57", created_by: A.id, created_at: at });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

test.describe.configure({ mode: "serial" });

test.describe("slice 15: Мусор и Вода", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("Мусор: the admin creates it, «Вынес я» moves the queue, «Пакет полный» has a cooldown", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty?kind=trash");
      await expect(page.getByTestId("duty-create")).toBeVisible();
      const saved = savedToStore(page);
      await page.getByTestId("duty-create-submit").click();
      await saved;
      await expect(page.getByTestId("trash-current")).toHaveText("Ты");
      await expect(page.getByTestId("trash-last")).toContainText("ещё никто не выносил");
      await expect(page.getByTestId("trash-chain").locator("li")).toHaveCount(4);

      const done = savedToStore(page);
      await page.getByTestId("trash-done").click();
      await done;
      await expect(page.getByTestId("trash-current")).toHaveText("Борис");
      await expect(page.getByTestId("trash-last")).toContainText("последний раз вынес ты");
      await expect(page.getByTestId("trash-history")).toContainText("Ты вынес");

      const ping = savedToStore(page);
      await page.getByTestId("trash-ping").click();
      await ping;
      await expect(page.getByTestId("trash-history")).toContainText("Ты напомнил Борису");
      await page.getByTestId("trash-ping").click();
      await expect(page.getByText(/Уже напоминали/)).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: "gan-harness/screenshots/duty15-trash.png" });
    });
  });

  test("Вода: «Принёс» вдвоём records 400 ₸ as a shared purchase and moves the queue", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty?kind=water");
      await page.getByTestId("duty-create-submit").click();
      await expect(page.getByTestId("water-card")).toBeVisible();
      await expect(page.getByTestId("water-left")).toContainText("Осталось 4 бутылки из 4 · 20 л");
      await expect(page.getByTestId("water-current")).toHaveText("Ты");
      await expect(page.getByTestId("water-mode-alone")).toContainText("10 л · 200 ₸");
      await expect(page.getByTestId("water-mode-pair")).toContainText("20 л · 400 ₸");
      await expect(page.getByTestId("water-hint")).toContainText("по 100 ₸ каждому");

      const empty = savedToStore(page);
      await page.getByTestId("water-empty").click();
      await empty;
      await expect(page.getByTestId("water-left")).toContainText("Воды нет");
      await page.waitForTimeout(400);
      await page.screenshot({ path: "gan-harness/screenshots/duty15-water.png" });

      const brought = savedToStore(page);
      await page.getByTestId("water-brought").click();
      await brought;
      await expect(page.getByTestId("water-left")).toContainText("Осталось 4 бутылки");
      await expect(page.getByTestId("water-month-liters")).toHaveText("20 л");
      await expect(page.getByTestId("water-carried")).toContainText("Ты");
      await expect(page.getByTestId("water-current")).toHaveText("Чингис"); // Асель + Борис carried: the pointer moves past both

      await page.goto("/purchases");
      await expect(page.getByText("Вода 20 л").first()).toBeVisible();
      await expect(page.getByText(/400/).first()).toBeVisible();
    });
  });
});
