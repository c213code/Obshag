import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slices 6 + 7: monthly bills and the Квартира tab. Mock mode, production build. The tests run in their OWN household
 * («Квартира 7», injected into the shared mock store with three new users) so the bills they generate never touch the
 * balances other specs assert. Everything is "due" because the bills use day 1.
 */
const NBSP = " ";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
const SHOTS = "gan-harness/screenshots";
const CRON_SECRET = "e2e-cron-secret-0123456789abcdef";

const T = { email: "timur@obshak.test", name: "Тимур", id: "00000000-0000-4000-8000-0000000000a1" };
const A = { email: "aliya@obshak.test", name: "Алия", id: "00000000-0000-4000-8000-0000000000a2" };
const R = { email: "rustem@obshak.test", name: "Рустем", id: "00000000-0000-4000-8000-0000000000a3" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000a7";
const CODE = "QW7ER4TY9UI2";

type Phone = { context: BrowserContext; page: Page; errors: string[] };

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors: string[] = [];
  // WebKit reports Next.js RSC prefetches that a navigation cancels mid-flight as "... due to access control checks"
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
  await expect(page.getByText(`Привет, ${who.name}`)).toBeVisible();
}

type Stored = {
  version: number;
  rev: number;
  db: {
    users: Array<{ id: string; email: string; password: string }>;
    profiles: Array<Record<string, unknown>>;
    households: Array<Record<string, unknown>>;
    members: Array<Record<string, unknown>>;
    purchases: Array<{ id: string; household_id: string; description: string; amount: number; source: string; bill_month?: string | null }>;
    shares: Array<{ purchase_id: string; debtor_id: string; amount: number; settled_at: string | null }>;
    bills: Array<{ id: string; household_id: string; title: string; participants: string[] }>;
    pushSubscriptions: Array<Record<string, string>>;
  };
};
async function readStore(request: APIRequestContext): Promise<Stored> {
  const { stored } = (await (await request.get("/api/mock-store")).json()) as { stored: Stored | null };
  if (!stored) throw new Error("mock store is empty");
  return stored;
}
async function mutateStore(request: APIRequestContext, change: (s: Stored) => void) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await readStore(request);
    change(s);
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not save the mock store");
}
const pushLog = async (request: APIRequestContext) =>
  ((await (await request.get("/api/mock-push-log")).json()) as { calls: Array<{ endpoint: string; payload: Record<string, unknown> }> }).calls;
const cron = (request: APIRequestContext) => request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

/** Three fresh users in their own household; Тимур is the admin. Safe to call more than once. */
async function injectHousehold(request: APIRequestContext) {
  // a fresh server has no store yet (the app seeds it on first load): seed it here, like the app would
  const current = (await (await request.get("/api/mock-store")).json()) as { stored: Stored | null };
  if (!current.stored) await request.put("/api/mock-store", { data: { version: MOCK_SCHEMA_VERSION, rev: 0, db: createSeed() } });
  await mutateStore(request, (s) => {
    if (s.db.households.some((h) => h.id === HOUSEHOLD)) return;
    const at = new Date().toISOString();
    const people = [
      { ...T, kaspi: "+77020000001", color: "me" },
      { ...A, kaspi: "+77020000002", color: "blue" },
      { ...R, kaspi: null, color: "brown" },
    ];
    for (const p of people) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: p.kaspi, avatar_color: p.color, created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p.id === T.id ? "admin" : "member", active: true, away_until: null, joined_at: at });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 7", invite_code: CODE, created_by: T.id, created_at: at });
  });
}

async function addBill(page: Page, opts: { title: string; amount?: number; variable?: boolean }) {
  await page.getByRole("link", { name: "Добавить платёж" }).click();
  await expect(page).toHaveURL(/\/monthly\/new$/);
  await page.getByLabel("Название").fill(opts.title);
  if (opts.variable) await page.getByRole("switch", { name: "Переменная сумма" }).click();
  else await page.getByLabel("Сумма в месяц").fill(String(opts.amount));
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page).toHaveURL(/\/monthly$/);
  await expect(page.getByTestId("bill-card").filter({ hasText: opts.title })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("slices 6+7", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("a fixed bill: add it from the Fab menu, the cron creates the purchase with equal shares", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, T);
      await page.getByRole("button", { name: "Добавить" }).tap();
      await page.getByRole("menuitem", { name: "Ежемесячный платёж" }).tap();
      await expect(page).toHaveURL(/\/monthly\/new$/);
      await page.getByLabel("Название").fill("Аренда");
      await page.getByLabel("Сумма в месяц").fill("12000");
      await page.getByRole("button", { name: "Сохранить" }).click();
      await expect(page).toHaveURL(/\/monthly$/);
      const card = page.getByTestId("bill-card").filter({ hasText: "Аренда" });
      await expect(card).toContainText("1 числа · платит Тимур");
      await expect(page.getByTestId("month-total")).toHaveText(money(12000));
      await expect(page.getByTestId("month-mine")).toHaveText(money(4000));

      expect((await cron(request)).status()).toBe(200);
      await expect.poll(async () => (await readStore(request)).db.purchases.filter((p) => p.household_id === HOUSEHOLD && p.source === "monthly").length).toBe(1);
      const s = await readStore(request);
      const purchase = s.db.purchases.find((p) => p.household_id === HOUSEHOLD && p.source === "monthly")!;
      expect(purchase).toMatchObject({ description: "Аренда", amount: 12000 });
      expect(s.db.shares.filter((x) => x.purchase_id === purchase.id).map((x) => [x.debtor_id, x.amount]).sort()).toEqual(
        [[T.id, 4000], [A.id, 4000], [R.id, 4000]].sort(),
      );
      expect((await cron(request)).status()).toBe(200); // a second run creates nothing
      expect((await readStore(request)).db.purchases.filter((p) => p.household_id === HOUSEHOLD && p.source === "monthly")).toHaveLength(1);

      await page.reload();
      await expect(page.getByTestId("bill-card").filter({ hasText: "Аренда" })).toContainText("1 из 3");
      await page.getByRole("button", { name: "Предыдущий месяц" }).click();
      await expect(page.getByTestId("bill-card").filter({ hasText: "Аренда" })).not.toContainText("1 из 3");
      await page.getByRole("button", { name: "Следующий месяц" }).click();
      await page.screenshot({ path: `${SHOTS}/s67-app-bills-fixed.png` });
    });
  });

  test("a variable bill shows «нужна сумма»; «Ввести» creates the purchase; the payer gets the push", async ({ browser, baseURL, request }) => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/e2e-timur";
    await mutateStore(request, (s) => {
      s.db.pushSubscriptions.push({ user_id: T.id, endpoint, p256dh: "BPubKey", auth: "authSecret", created_at: new Date().toISOString() });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, T);
      await page.goto("/monthly");
      await expect(page).toHaveURL(/\/monthly$/);
      await addBill(page, { title: "Коммуналка", variable: true });
      const card = page.getByTestId("bill-card").filter({ hasText: "Коммуналка" });
      await expect(card).toContainText("нужна сумма");
      await expect(card.getByRole("button", { name: "Ввести" })).toBeVisible();

      expect((await cron(request)).status()).toBe(200);
      await expect
        .poll(async () => (await pushLog(request)).some((c) => c.endpoint === endpoint && c.payload.type === "bill" && c.payload.title === "Коммуналка"))
        .toBe(true);
      expect((await readStore(request)).db.purchases.filter((p) => p.description === "Коммуналка")).toHaveLength(0);

      await page.screenshot({ path: `${SHOTS}/s67-app-bills-needs.png` });
      await card.getByRole("button", { name: "Ввести" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Сумма за месяц").fill("9000");
      await dialog.getByRole("button", { name: "Поделить" }).click();
      await expect(card).toContainText("1 из 3");
      await expect(card).not.toContainText("нужна сумма");
      await expect(card).toContainText("9" + NBSP + "000");
      const s = await readStore(request);
      const made = s.db.purchases.find((p) => p.household_id === HOUSEHOLD && p.description === "Коммуналка");
      expect(made).toMatchObject({ amount: 9000, source: "monthly" });
      expect(s.db.shares.filter((x) => x.purchase_id === made!.id).map((x) => x.amount)).toEqual([3000, 3000, 3000]);
    });
  });

  test("Квартира: the invite link falls back to copy, QR opens, a member cannot add bills", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      // no Web Share, and a clipboard we can read back
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async (t: string) => ((window as unknown as { __copied: string }).__copied = t) },
          configurable: true,
        });
      });
      await logIn(page, T);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await expect(page.getByTestId("invite-code")).toHaveText("QW7E-R4TY-9UI2");
      await page.getByRole("button", { name: "Поделиться" }).click();
      await expect(page.getByRole("button", { name: "Скопировано" })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(`${baseURL}/join/${CODE}`);

      await page.getByTestId("invite-qr-open").click();
      const qr = page.getByTestId("invite-qr");
      await expect(qr).toBeVisible();
      expect((await qr.locator("path").getAttribute("d"))!.length).toBeGreaterThan(200);
      await page.keyboard.press("Escape");
      await expect(qr).toBeHidden();
      await expect(page.getByText("Тимур (ты)")).toBeVisible();
      await expect(page.getByTestId("member-Рустем")).toContainText("нет номера Kaspi");
      await page.screenshot({ path: `${SHOTS}/s67-app-flat.png`, fullPage: true });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/monthly");
      await expect(page.getByRole("link", { name: "Добавить платёж" })).toHaveCount(0);
      await expect(page.getByTestId("bill-card").filter({ hasText: "Аренда" })).toBeVisible();
      await page.goto("/monthly/new");
      await expect(page.getByText("Платежи добавляет и меняет админ квартиры.")).toBeVisible();
    });
  });

  test("away: Алия sets a date, Тимур's new purchase leaves her out by default", async ({ browser, baseURL }) => {
    const back = new Date(Date.now() + (5 * 60 + 3 * 24 * 60) * 60_000).toISOString().slice(0, 10); // Almaty today + 3 days
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByTestId("away-row").click();
      await page.getByLabel("Вернусь").fill(back);
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
      await expect(page.getByTestId("member-Алия")).toContainText(`в отъезде до ${back.slice(8, 10)}.${back.slice(5, 7)}`);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, T);
      await page.getByRole("link", { name: "Покупка", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases\/new$/);
      await expect(page.getByRole("button", { name: "Рустем", pressed: true })).toBeVisible();
      // (the disabled «Кто платил» option is named «Алия» too: the person chip is the last one)
      await expect(page.getByRole("button", { name: "Алия", pressed: false }).last()).toBeVisible();
    });
  });

  test("leaving is blocked while there is a debt; an admin cannot remove a debtor", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A); // owes Тимур 4 000 + 3 000
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByTestId("leave-household").click();
      await page.getByTestId("leave-confirm").click();
      await expect(page.getByTestId("leave-error")).toHaveText("Сначала рассчитайтесь");
      await expect(page.getByText("Квартира 7").first()).toBeVisible(); // still in the flat
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, T);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByTestId("member-Алия").getByRole("button").click();
      await page.getByTestId("member-remove").click();
      await page.getByTestId("member-remove-confirm").click();
      await expect(page.getByTestId("member-error")).toHaveText("Сначала рассчитайтесь");
      // roles work: promote, then demote again
      await page.getByTestId("member-role").click();
      await expect(page.getByTestId("member-Алия")).toContainText("админ");
    });
  });
});
