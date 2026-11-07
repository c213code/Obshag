import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Slices 5 + 2: «Свои суммы», purchase detail (edit / delete), the Покупки tab and «Напомнить». Mock mode, production
 * build, the seeded household (Ерасыл, Айдос, Даня, Нурик; password123). The push sender is a recorder.
 */
const NBSP = " ";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
const SHOTS = "gan-harness/screenshots";
const CRON_SECRET = "e2e-cron-secret-0123456789abcdef";

const ME = { email: "erasyl@obshak.test", name: "Ерасыл" };
const AIDOS = { email: "aidos@obshak.test", name: "Айдос" };

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
    const benign = m.text().includes("Failed to load resource") || m.text().includes("access control checks");
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

const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

type Stored = {
  version: number;
  rev: number;
  db: {
    users: Array<{ id: string; email: string }>;
    purchases: Array<{ id: string; description: string; amount: number }>;
    shares: Array<{ purchase_id: string; debtor_id: string; amount: number; settled_at: string | null }>;
    members: Array<{ user_id: string; reminders_enabled?: boolean }>;
    pushSubscriptions: Array<Record<string, string>>;
  };
};
async function readStore(request: APIRequestContext): Promise<Stored> {
  const { stored } = (await (await request.get("/api/mock-store")).json()) as { stored: Stored | null };
  if (!stored) throw new Error("mock store is empty");
  return stored;
}
const userId = (s: Stored, email: string) => s.db.users.find((u) => u.email === email)!.id;

async function addSubscription(request: APIRequestContext, email: string, endpoint: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await readStore(request);
    s.db.pushSubscriptions.push({ user_id: userId(s, email), endpoint, p256dh: "BPubKey", auth: "authSecret", created_at: new Date().toISOString() });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not save the subscription");
}
const pushLog = async (request: APIRequestContext) =>
  ((await (await request.get("/api/mock-push-log")).json()) as { calls: Array<{ endpoint: string; payload: Record<string, unknown> }> }).calls;

/** Equal purchase with the signed-in user plus the named housemates. */
async function buy(page: Page, amount: number, what: string, with_: ReadonlyArray<string>) {
  await page.goto("/");
  await page.getByRole("link", { name: "Покупка", exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/new$/);
  for (const name of ["Айдос", "Даня", "Нурик"].filter((n) => !with_.includes(n))) await page.getByRole("button", { name, pressed: true }).click();
  await page.getByLabel("Сумма", { exact: true }).fill(String(amount));
  await page.getByLabel("Что купили").fill(what);
  const saved = savedToStore(page);
  await page.getByRole("button", { name: "Поделить" }).click();
  await saved;
  await expect(page).toHaveURL(/\/$/);
}

test.describe.configure({ mode: "serial" });

test.describe("slices 5+2", () => {
  test("«Свои суммы»: 6000 = 3000/2000/1000, ✓ waits for an exact sum", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупка", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases\/new$/);
      await page.getByRole("button", { name: "Нурик", pressed: true }).click(); // Ерасыл, Айдос, Даня
      await page.getByLabel("Сумма", { exact: true }).fill("6000");
      await page.getByLabel("Что купили").fill("Ужин в кафе");
      const submit = page.getByRole("button", { name: "Поделить" });
      await expect(submit).toBeEnabled(); // equal split is fine

      await page.getByRole("button", { name: "Свои суммы", exact: true }).click();
      await expect(page.getByTestId("custom-rows")).toBeVisible();
      await expect(submit).toBeDisabled();
      await expect(page.getByText(`осталось ${money(6000)}`)).toBeVisible();

      await page.getByLabel("Сумма: Айдос").fill("2000");
      await page.getByLabel("Сумма: Даня").fill("1000");
      await expect(page.getByText(`осталось ${money(3000)}`)).toBeVisible();
      await expect(submit).toBeDisabled();

      await page.getByLabel("Сумма: Я").fill("3500");
      await expect(page.getByText(`лишних ${money(500)}`)).toBeVisible();
      await expect(submit).toBeDisabled();

      await page.getByLabel("Сумма: Я").fill("3000");
      await expect(page.getByText("всё распределено")).toBeVisible();
      await expect(submit).toBeEnabled();
      await page.screenshot({ path: `${SHOTS}/s52-app-custom.png` });

      const saved = savedToStore(page);
      await submit.click();
      await saved;
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId("purchase-row").first()).toContainText("Ужин в кафе");
    });
    const s = await readStore(request);
    const dinner = s.db.purchases.find((p) => p.description === "Ужин в кафе")!;
    const shares = s.db.shares.filter((x) => x.purchase_id === dinner.id);
    const byUser = (email: string) => shares.find((x) => x.debtor_id === userId(s, email))!;
    expect(shares).toHaveLength(3);
    expect(byUser(ME.email)).toMatchObject({ amount: 3000 });
    expect(byUser(ME.email).settled_at).not.toBeNull();
    expect(byUser(AIDOS.email)).toMatchObject({ amount: 2000, settled_at: null });
    expect(byUser("danya@obshak.test")).toMatchObject({ amount: 1000, settled_at: null });
  });

  test("detail screen: lime card, «Кто скинул», edit the description", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases$/);
      await page.getByRole("link", { name: /Ужин в кафе/ }).click();
      await expect(page).toHaveURL(/\/purchases\/[^/]+$/);
      await expect(page.getByTestId("purchase-title")).toHaveText("Ужин в кафе");
      await expect(page.getByTestId("purchase-byline")).toContainText("сегодня");
      await expect(page.getByTestId("purchase-byline")).toContainText("платил ты");
      await expect(page.getByText(money(6000), { exact: true }).first()).toBeVisible();
      await expect(page.getByText("на 3 человека")).toBeVisible();
      await expect(page.getByText("свои суммы", { exact: true })).toBeVisible();
      await expect(page.getByTestId("purchase-progress")).toHaveText("0 из 2");
      const rows = page.getByTestId("payment-row");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText("Айдос");
      await expect(rows.first()).toContainText("ждём");
      await expect(rows.first()).toContainText(money(2000));
      await page.screenshot({ path: `${SHOTS}/s52-app-detail.png` });

      // edit
      await page.getByRole("button", { name: "Изменить" }).click();
      const input = page.getByLabel("Что купили");
      await expect(input).toBeFocused();
      await input.fill("Ужин и десерт");
      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Сохранить" }).click();
      await saved;
      await expect(page.getByTestId("purchase-title")).toHaveText("Ужин и десерт");
      await page.reload();
      await expect(page.getByTestId("purchase-title")).toHaveText("Ужин и десерт");

      // cancel leaves the text alone
      await page.getByRole("button", { name: "Изменить" }).click();
      await page.getByLabel("Что купили").fill("Не сохранять");
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(page.getByTestId("purchase-title")).toHaveText("Ужин и десерт");
    });
  });

  test("a housemate sees the purchase without edit, delete or remind", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, AIDOS);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await page.getByRole("link", { name: /Ужин и десерт/ }).click();
      await expect(page.getByTestId("purchase-title")).toHaveText("Ужин и десерт");
      await expect(page.getByTestId("purchase-byline")).toContainText("платил Ерасыл");
      await expect(page.getByRole("button", { name: "Изменить" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Удалить покупку" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Напомнить/ })).toHaveCount(0);
    });
  });

  test("delete before any payment: confirm in the page, cancel keeps it, delete removes it", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await buy(page, 600, "Вода на выброс", ["Айдос"]);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await page.getByRole("link", { name: /Вода на выброс/ }).click();
      const trigger = page.getByRole("button", { name: "Удалить покупку" });
      await trigger.click();
      await expect(page.getByText("Точно удалить?")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/s52-app-delete-ask.png` });
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(trigger).toBeVisible();
      await expect(page.getByTestId("purchase-title")).toHaveText("Вода на выброс");

      await trigger.click();
      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Удалить", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases$/);
      await expect(page.getByRole("link", { name: /Вода на выброс/ })).toHaveCount(0);
      await saved;
    });
    const s = await readStore(request);
    expect(s.db.purchases.find((p) => p.description === "Вода на выброс")).toBeUndefined();
  });

  test("delete is blocked once a payment is on its way: the row comes back with a reason", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await buy(page, 800, "Чай и печенье", ["Айдос"]);
    });
    // Айдос says «я оплатил» (a marked settlement covers every open share between them)
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, AIDOS);
      await page.getByRole("link", { name: "Расчёт", exact: true }).click();
      await page.getByRole("link", { name: /Рассчитаться с Ерасылом/ }).click();
      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Я оплатил" }).click();
      await saved;
      await expect(page.getByRole("button", { name: "Отменить" })).toBeVisible();
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await page.getByRole("link", { name: /Чай и печенье/ }).click();
      await page.getByRole("button", { name: "Удалить покупку" }).click();
      await page.getByRole("button", { name: "Удалить", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases$/);
      await expect(page.getByText("Нельзя удалить: по этой покупке уже есть оплата.")).toBeVisible();
      await expect(page.getByRole("link", { name: /Чай и печенье/ })).toBeVisible(); // rolled back
      await page.screenshot({ path: `${SHOTS}/s52-app-delete-blocked.png` });
    });
    const s = await readStore(request);
    expect(s.db.purchases.find((p) => p.description === "Чай и печенье")).toBeDefined();
  });

  test("Покупки tab: grouped by day, filters Все / Мои / Должен я", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Сегодня" })).toBeVisible();
      const rows = page.getByTestId("purchase-list-row");
      await expect(rows.filter({ hasText: "Ужин и десерт" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Продукты" })).toHaveCount(1); // seeded, paid by me
      await expect(rows.filter({ hasText: "Вода" }).first()).toBeVisible(); // seeded, paid by Айдос
      await expect(rows.filter({ hasText: "Ужин и десерт" }).getByText("0 из 2")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/s52-app-list.png` });

      await page.getByRole("button", { name: "Мои", exact: true }).click();
      await expect(rows.filter({ hasText: "Ужин и десерт" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Продукты" })).toHaveCount(1);
      await expect(rows.filter({ hasText: /^Вода/ })).toHaveCount(0);
      for (const text of await rows.allInnerTexts()) expect(text).toContain("Ты");

      await page.getByRole("button", { name: "Должен я", exact: true }).click();
      await expect(rows.filter({ hasText: "Вода" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Ужин и десерт" })).toHaveCount(0);
      await expect(rows.filter({ hasText: "Продукты" })).toHaveCount(0);

      await page.getByRole("button", { name: "Все", exact: true }).click();
      await expect(rows.filter({ hasText: "Ужин и десерт" })).toHaveCount(1);
      await expect(rows.filter({ hasText: "Вода" }).first()).toBeVisible();
    });
  });

  test("«Напомнить»: a pill per debtor, sending → «Напомнили» → cooldown, also after a reload", async ({ browser, baseURL, request }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/s52-${Date.now().toString(36)}`;
    await addSubscription(request, AIDOS.email, endpoint);
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Напомнить", exact: true }).click();
      await expect(page).toHaveURL(/\/settle$/);
      // Айдос, Даня, Нурик all owe me
      await expect(page.getByRole("button", { name: /^Напомнить: / })).toHaveCount(3);
      await page.screenshot({ path: `${SHOTS}/s52-app-remind-list.png` });

      const aidos = page.getByRole("button", { name: "Напомнить: Айдос" });
      await aidos.click();
      const state = page.getByTestId(/^remind-/).first();
      await expect(page.getByText("Напомнили", { exact: true })).toBeVisible();
      await expect(page.getByText(/Можно через [56] ч/).first()).toBeVisible({ timeout: 6000 });
      await expect(state).toBeVisible();
      // a second tap changes nothing
      await page.getByText(/Можно через [56] ч/).first().click({ force: true });

      const calls = (await pushLog(request)).filter((c) => c.endpoint === endpoint);
      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toMatchObject({ type: "reminder", fromName: "Ерасылу" });
      expect(typeof calls[0].payload.amount).toBe("number");
      expect(typeof calls[0].payload.fromUserId).toBe("string");

      // after a reload the button is idle again; the server's 429 puts it back into the cooldown
      await page.reload();
      await page.getByRole("button", { name: "Напомнить: Айдос" }).click();
      await expect(page.getByText(/Можно через [56] ч/).first()).toBeVisible();
      expect((await pushLog(request)).filter((c) => c.endpoint === endpoint)).toHaveLength(1);

      // the pair screen has the same button, in the cooldown as well
      await page.getByRole("link", { name: /Рассчитаться с Айдосом/ }).click();
      await expect(page).toHaveURL(/\/settle\/[^/]+$/);
      await expect(page.getByTestId("remind-pair")).toContainText(/Можно через [56] ч/);
      await page.getByTestId("remind-pair").click({ force: true }); // a tap in the cooldown changes nothing
      expect((await pushLog(request)).filter((c) => c.endpoint === endpoint)).toHaveLength(1);
    });
  });

  test("/api/remind and /api/cron/daily are closed to strangers", async ({ request }) => {
    const s = await readStore(request);
    const me = userId(s, ME.email);
    const aidos = userId(s, AIDOS.email);
    const household = (s.db as unknown as { households: Array<{ id: string }> }).households[0].id;
    const body = { household_id: household, debtor_id: aidos };

    expect((await request.post("/api/remind", { data: body })).status()).toBe(401); // no session
    expect((await request.post("/api/remind", { data: { household_id: household }, headers: { "x-mock-user": me } })).status()).toBe(400);
    expect((await request.post("/api/remind", { data: "not json", headers: { "x-mock-user": me } })).status()).toBe(400);
    // Айдос owes Ерасыл, so Айдос is not a creditor
    expect((await request.post("/api/remind", { data: { household_id: household, debtor_id: me }, headers: { "x-mock-user": aidos } })).status()).toBe(403);
    // already reminded above: the cooldown answers 429 with retry_after
    const again = await request.post("/api/remind", { data: body, headers: { "x-mock-user": me } });
    expect(again.status()).toBe(429);
    expect(((await again.json()) as { retry_after: number }).retry_after).toBeGreaterThan(5 * 3600);

    expect((await request.get("/api/cron/daily")).status()).toBe(401);
    expect((await request.get("/api/cron/daily", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.get("/api/cron/daily", { headers: { authorization: CRON_SECRET } })).status()).toBe(401);
    const ok = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    const json = (await ok.json()) as { ok: boolean; reminders: number };
    expect(json.ok).toBe(true);
    expect(json.reminders).toBeGreaterThanOrEqual(0);
  });

  test("Квартира: the «Напоминания» switch is saved", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      const toggle = page.getByRole("switch", { name: "Напоминания" });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await page.screenshot({ path: `${SHOTS}/s52-app-flat.png` });
      const saved = savedToStore(page);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await saved;
      let s = await readStore(request);
      expect(s.db.members.find((m) => m.user_id === userId(s, ME.email))?.reminders_enabled).toBe(false);

      await page.reload();
      await expect(page.getByRole("switch", { name: "Напоминания" })).toHaveAttribute("aria-checked", "false");
      const back = savedToStore(page);
      await page.getByRole("switch", { name: "Напоминания" }).click();
      await back;
      s = await readStore(request);
      expect(s.db.members.find((m) => m.user_id === userId(s, ME.email))?.reminders_enabled).toBe(true);
    });
  });
});
