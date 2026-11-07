import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Slice 4: Apple Pay capture + push, mock mode, production build. Browser contexts and the capture endpoint share one
 * mock database through /api/mock-store (NEXT_PUBLIC_E2E=1). The push sender is a recorder (nothing is ever sent):
 * what it received is readable at /api/mock-push-log.
 */
const NBSP = " ";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
const stamp = Date.now().toString(36);
const email = (who: string) => `s4-${who}-${stamp}@test.kz`;
const SHOTS = "gan-harness/screenshots";
const PASSWORD = "password123";

const PAYER = { key: "payer", name: "Ерасыл", phone: "+77010000111" };
const MATE = { key: "mate", name: "Айдос", phone: "+77010000222" };

type Phone = { context: BrowserContext; page: Page; errors: string[] };

async function newPhone(
  browser: Browser,
  baseURL: string | undefined,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
  serviceWorkers: "allow" | "block" = "block",
): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, reducedMotion, serviceWorkers });
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
  // clipboard: record what the app writes (WebKit has no clipboard-read permission)
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string | null };
    w.__copied = null;
    const nativeExec = document.execCommand.bind(document);
    document.execCommand = (command: string, ...rest: [boolean?, string?]) => {
      if (command === "copy") {
        const area = document.querySelector("textarea[readonly]") as HTMLTextAreaElement | null;
        w.__copied = area?.value ?? w.__copied;
        return true;
      }
      return nativeExec(command, ...rest);
    };
  });
  return { context, page, errors };
}

async function withPhone(
  browser: Browser,
  baseURL: string | undefined,
  run: (phone: Phone) => Promise<void>,
  reducedMotion?: "reduce" | "no-preference",
  serviceWorkers?: "allow" | "block",
) {
  const phone = await newPhone(browser, baseURL, reducedMotion, serviceWorkers);
  try {
    await run(phone);
  } finally {
    await phone.context.close();
  }
  expect(phone.errors).toEqual([]);
}

async function waitHydrated(page: Page) {
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

async function register(page: Page, who: { key: string }, open = true) {
  if (open) await page.goto("/login");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Почта").fill(email(who.key));
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Повтори пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
}

async function signUp(page: Page, who: { key: string; name: string; phone: string }) {
  await register(page, who);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Имя").fill(who.name);
  await page.getByLabel("Номер Kaspi").fill(who.phone);
  await page.getByRole("button", { name: "Дальше" }).click();
}

async function logIn(page: Page, who: { key: string; name: string }) {
  await page.goto("/login");
  await waitHydrated(page);
  await page.getByLabel("Почта").fill(email(who.key));
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText(`Привет, ${who.name}`)).toBeVisible();
}

function savedToStore(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);
}

/** POSTs like the iOS Shortcut does: JSON, no cookies. */
function capture(request: APIRequestContext, data: unknown) {
  return request.post("/api/capture", { data });
}

type StoredDb = { rev: number; db: { users: Array<{ id: string; email: string }>; pushSubscriptions: Array<Record<string, string>> } };

/** E2E shortcut for a device subscription: real push needs a real browser permission, so the subscription is written to the store. */
async function addSubscription(request: APIRequestContext, who: { key: string }, endpoint: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { stored } = (await (await request.get("/api/mock-store")).json()) as { stored: (StoredDb & { version: number }) | null };
    if (!stored) throw new Error("mock store is empty");
    const user = stored.db.users.find((u) => u.email === email(who.key));
    if (!user) throw new Error("user not found");
    stored.db.pushSubscriptions.push({ user_id: user.id, endpoint, p256dh: "BPubKey", auth: "authSecret", created_at: new Date().toISOString() });
    const res = await request.put("/api/mock-store", { data: { version: stored.version, rev: stored.rev, db: stored.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not save the subscription");
}

const pushLog = async (request: APIRequestContext) =>
  ((await (await request.get("/api/mock-push-log")).json()) as { calls: Array<{ endpoint: string; payload: Record<string, unknown> }> }).calls;

async function openFlat(page: Page) {
  await page.getByRole("link", { name: "Квартира", exact: true }).click();
  await expect(page).toHaveURL(/\/flat$/);
}

test.describe.configure({ mode: "serial" });

test.describe("slice 4: Apple Pay capture", () => {
  let token = "";
  let captures = 0; // accepted captures so far (the rate limit is 30 per hour)

  test("setup: two neighbours in one flat", async ({ browser, baseURL }) => {
    let inviteCode = "";
    await withPhone(browser, baseURL, async ({ page }) => {
      await signUp(page, PAYER);
      await expect(page).toHaveURL(/\/household$/);
      await page.getByRole("link", { name: /Создать квартиру/ }).click();
      await page.getByLabel("Название").fill("Квартира S4");
      await page.getByRole("button", { name: "Создать" }).click();
      await expect(page).toHaveURL(/\/$/);
      await openFlat(page);
      inviteCode = (await page.getByTestId("invite-code").innerText()).trim().replace(/[\s-]/g, "");
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto(`/join/${inviteCode}`);
      await expect(page).toHaveURL(/\/login$/);
      await register(page, MATE, false);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.getByLabel("Имя").fill(MATE.name);
      await page.getByLabel("Номер Kaspi").fill(MATE.phone);
      await page.getByRole("button", { name: "Дальше" }).click();
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test("PWA bits: manifest, icons, worker file", async ({ browser, baseURL, request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "Общак", short_name: "Общак", display: "standalone", start_url: "/" });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
      const res = await request.get(icon);
      expect(res.status(), icon).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect(await sw.text()).toContain("notificationclick");

    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/login");
      await waitHydrated(page);
      await expect(page.locator("link[rel='manifest']")).toHaveAttribute("href", "/manifest.webmanifest");
      await expect(page.locator("link[rel='apple-touch-icon']")).toHaveCount(1);
      await expect(page.locator("meta[name='mobile-web-app-capable'], meta[name='apple-mobile-web-app-capable']").first()).toHaveAttribute("content", "yes");
      // the worker registers in a production build
      await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 10_000 }).toBe(true);
    }, undefined, "allow");
  });

  test("the capture key is shown once, hidden after a reload, and rotates", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, PAYER);
      await openFlat(page);
      await page.screenshot({ path: `${SHOTS}/s4-app-flat.png` });
      await page.getByTestId("shortcut-row").click();
      await expect(page).toHaveURL(/\/settings\/shortcut$/);
      await expect(page.getByRole("heading", { name: "Apple Pay → Общак", level: 2 })).toBeVisible();

      await expect(page.getByTestId("capture-token")).toHaveCount(0);
      await page.getByRole("button", { name: "Создать ключ" }).click();
      const shown = page.getByTestId("capture-token");
      await expect(shown).toBeVisible();
      token = (await shown.innerText()).trim();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expect(page.getByTestId("token-warning")).toHaveText("Сохрани — второй раз не покажем");

      // the recipe: numbered steps, the URL with a copy button, method, body and the three keys
      const steps = page.getByTestId("shortcut-steps");
      await expect(steps).toContainText("Кошелёк (Wallet)");
      await expect(steps).toContainText("Получить содержимое URL");
      await expect(steps).toContainText("POST");
      await expect(steps).toContainText("JSON");
      await expect(steps).toContainText("Ввод команды → Сумма");
      await expect(steps).toContainText("Ввод команды → Продавец");
      await expect(page.getByTestId("capture-url")).toHaveText(`${baseURL}/api/capture`);
      await expect(page.getByText("Работает, только если Общак добавлен на экран Домой и уведомления включены.")).toBeVisible();

      // copy buttons
      await page.getByRole("button", { name: "Скопировать: Адрес" }).click();
      await expect(page.getByRole("button", { name: "Скопировать: Адрес" })).toContainText("Скопировано");
      expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(`${baseURL}/api/capture`);
      await page.getByRole("button", { name: "Скопировать: Ключ" }).click();
      expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(token);

      // iPhone Safari outside the Home Screen app cannot do push: the pill says what to do
      await expect(page.getByTestId("push-status")).toHaveAttribute("data-status", "needs_home_screen");
      await expect(page.getByTestId("push-status")).toContainText("добавь на экран Домой");
      await page.screenshot({ path: `${SHOTS}/s4-app-shortcut-token.png`, fullPage: true });

      // a reload: the plaintext is gone for good, only «Создать новый» remains
      await page.reload();
      await waitHydrated(page);
      await expect(page.getByTestId("token-exists")).toBeVisible();
      await expect(page.getByTestId("capture-token")).toHaveCount(0);
      expect(await page.content()).not.toContain(token);
      await expect(page.getByRole("button", { name: "Создать ключ" })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/s4-app-shortcut-hidden.png` });

      // rotating gives a different key and the old one stops working
      await page.getByRole("button", { name: "Создать новый" }).click();
      const fresh = (await page.getByTestId("capture-token").innerText()).trim();
      expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fresh).not.toBe(token);
      const res = await capture(request, { token, amount: 100, merchant: "Old" });
      expect(res.status()).toBe(401);
      token = fresh;
    });
  });

  test("a capture lands as «Ждут решения» for the payer only, and records one push", async ({ browser, baseURL, request }) => {
    const endpoint = `https://push.example.test/${stamp}/payer-device`;
    await addSubscription(request, PAYER, endpoint);
    await addSubscription(request, MATE, `https://push.example.test/${stamp}/mate-device`);

    const res = await capture(request, { token, amount: "6 000,00 ₸", merchant: "Magnum" });
    expect(res.status()).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    captures++;

    // the recorder got exactly one notification, for the payer's device (never the neighbour's)
    await expect.poll(async () => (await pushLog(request)).filter((c) => c.endpoint.includes(stamp)).length, { timeout: 5000 }).toBe(1);
    const [call] = (await pushLog(request)).filter((c) => c.endpoint.includes(stamp));
    expect(call.endpoint).toBe(endpoint);
    expect(call.payload).toMatchObject({ type: "pending", merchant: "Magnum", amount: 6000 });
    expect(typeof call.payload.purchaseId).toBe("string");

    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, PAYER);
      const section = page.getByTestId("pending-section");
      await expect(section).toContainText("Ждут решения");
      await expect(section.getByTestId("pending-row")).toHaveCount(1);
      await expect(section.getByTestId("pending-row")).toContainText("Magnum");
      await expect(section.getByTestId("pending-row")).toContainText(money(6000));
      await expect(section.getByTestId("pending-row")).toContainText("Решить");
      // not in «Последние покупки» yet
      await expect(page.getByTestId("purchase-row").filter({ hasText: "Magnum" })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/s4-app-main-pending.png` });
    });

    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, MATE);
      await expect(page.getByTestId("pending-section")).toHaveCount(0);
      await expect(page.getByText("Magnum")).toHaveCount(0);
      await expect(page.getByText(money(6000))).toHaveCount(0);
    });
  });

  test("«Общее» with «Продукты»: the island collapses to «Поделено», and the neighbour owes his half", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, PAYER);
      await page.getByTestId("pending-row").click();
      await expect(page).toHaveURL(/\/pending\/[0-9a-f-]{36}$/);
      const dialog = page.getByRole("dialog", { name: "Что купил?" });

      // grows from a black pill: the card is a small pill first, its content is hidden, then it opens
      await expect(dialog).toBeVisible();
      const early = await dialog.boundingBox();
      await expect(page.getByTestId("pending-shared")).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(700);
      const open = await dialog.boundingBox();
      expect(early && open && open.width).toBeGreaterThan(300);
      expect(open!.width).toBeLessThanOrEqual(368.5);
      await page.screenshot({ path: `${SHOTS}/s4-app-island-open.png` });

      await expect(page.getByTestId("pending-merchant")).toHaveText("Magnum");
      await expect(dialog).toContainText(money(6000));
      await expect(page.getByTestId("pending-shared")).toHaveText(`Общее · по ${money(3000)}`);
      await expect(page.getByTestId("pending-shared")).toHaveAttribute("data-selected", "true");
      for (const chip of ["Продукты", "Хлеб", "Вода", "Бытовое", "Написать…"]) await expect(dialog.getByRole("button", { name: chip, exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Продукты", exact: true })).toHaveAttribute("aria-pressed", "true");
      // the sheet floats over Главная
      await expect(page.getByTestId("pending-section")).toBeVisible();

      const saved = savedToStore(page);
      await page.getByTestId("pending-shared").click();
      // it collapses to a pill with ✓ «Поделено»
      await expect(dialog.getByText("Поделено")).toBeVisible({ timeout: 3000 });
      await page.screenshot({ path: `${SHOTS}/s4-app-island-done.png` });
      await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
      await saved;

      await expect(page.getByTestId("pending-section")).toHaveCount(0);
      const row = page.getByTestId("purchase-row").first();
      await expect(row).toContainText("Продукты");
      await expect(row).toContainText("Magnum");
      await expect(row).toContainText(money(6000));
      await expect(page.getByText(`тебе должны ${money(3000)}`)).toBeVisible();
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, MATE);
      await expect(page.getByTestId("purchase-row").first()).toContainText("Продукты");
      await expect(page.getByText(`ты должен ${money(3000)}`)).toBeVisible();
    });
  });

  test("«Моё» with a written text stays invisible to the neighbour", async ({ browser, baseURL, request }) => {
    const res = await capture(request, { token, amount: 1200, merchant: "Coffee Boom" });
    expect(res.status()).toBe(201);
    captures++;
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, PAYER);
      await page.getByTestId("pending-row").click();
      const dialog = page.getByRole("dialog", { name: "Что купил?" });
      await expect(page.getByTestId("pending-personal")).toBeVisible({ timeout: 3000 });

      // «Написать…» reveals a text field (>= 16px so iOS does not zoom)
      await dialog.getByRole("button", { name: "Написать…", exact: true }).click();
      const field = dialog.getByLabel("Что купил?");
      await expect(field).toBeVisible();
      await expect(field).toBeFocused();
      expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      await field.fill("Кофе с собой");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/s4-app-island-write.png` });

      const saved = savedToStore(page);
      await page.getByTestId("pending-personal").click();
      await expect(dialog.getByText("Моё", { exact: true })).toBeVisible({ timeout: 3000 });
      await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
      await saved;
      await expect(page.getByTestId("pending-section")).toHaveCount(0);
      await expect(page.getByTestId("purchase-row").first()).toContainText("Кофе с собой");
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, MATE);
      await expect(page.getByTestId("purchase-row").first()).toContainText("Продукты");
      await expect(page.getByText("Кофе с собой")).toHaveCount(0);
      await expect(page.getByText("Coffee Boom")).toHaveCount(0);
      await expect(page.getByText(`ты должен ${money(3000)}`)).toBeVisible(); // personal purchases never create debt
    });
  });

  test("?choice= pre-selects a button but never submits; reduced motion still resolves", async ({ browser, baseURL, request }) => {
    const res = await capture(request, { token, amount: 800, merchant: "Chaihana" });
    expect(res.status()).toBe(201);
    captures++;
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, PAYER);
      const href = await page.getByTestId("pending-row").getAttribute("href");
      expect(href).toMatch(/^\/pending\/[0-9a-f-]{36}$/);

      await page.goto(`${href}?choice=shared`);
      await waitHydrated(page);
      await expect(page.getByTestId("pending-shared")).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId("pending-shared")).toHaveAttribute("data-selected", "true");
      await expect(page.getByTestId("pending-personal")).toHaveAttribute("data-selected", "false");
      await page.waitForTimeout(1500); // nothing submits itself
      await expect(page.getByTestId("pending-shared")).toBeVisible();

      await page.goto(`${href}?choice=personal`);
      await waitHydrated(page);
      await expect(page.getByTestId("pending-personal")).toHaveAttribute("data-selected", "true", { timeout: 3000 });
      await expect(page.getByTestId("pending-shared")).toHaveAttribute("data-selected", "false");
      await page.screenshot({ path: `${SHOTS}/s4-app-island-choice-personal.png` });
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("pending-personal")).toBeVisible();

      // escape closes without resolving: the row is still waiting on Главная
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
      await expect(page.getByTestId("pending-row")).toHaveCount(1);

      // an unknown id: back home with a notice, nothing breaks
      await page.goto("/pending/00000000-0000-4000-8000-000000000999");
      await waitHydrated(page);
      await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
      await expect(page.getByText("Эта покупка уже решена. Список обновлён.")).toBeVisible();
    });

    await withPhone(
      browser,
      baseURL,
      async ({ page }) => {
        await logIn(page, PAYER);
        await page.getByTestId("pending-row").click();
        const dialog = page.getByRole("dialog", { name: "Что купил?" });
        await expect(page.getByTestId("pending-shared")).toBeVisible({ timeout: 3000 });
        await dialog.getByRole("button", { name: "Хлеб", exact: true }).click();
        const saved = savedToStore(page);
        await page.getByTestId("pending-shared").click();
        await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
        await saved;
        await expect(page.getByTestId("purchase-row").first()).toContainText("Хлеб");
        await expect(page.getByTestId("pending-section")).toHaveCount(0);
      },
      "reduce",
    );
  });

  test("error paths: bad token 401, bad amount 400, the 31st capture in an hour 429", async ({ request }) => {
    expect((await capture(request, { token: "z".repeat(43), amount: 100 })).status()).toBe(401);
    expect((await capture(request, { token: "short", amount: 100 })).status()).toBe(400);
    for (const amount of ["abc", "", 0, -5, "-6 000 ₸", 10_000_001, "10 000 001", null, {}]) {
      const res = await capture(request, { token, amount, merchant: "X" });
      expect(res.status(), JSON.stringify(amount)).toBe(400);
      expect(await res.json()).toEqual({ ok: false });
    }
    expect((await capture(request, { token, amount: 100, merchant: "m".repeat(121) })).status()).toBe(400);
    expect((await capture(request, { amount: 100 })).status()).toBe(400);
    expect((await request.post("/api/capture", { data: "not json", headers: { "content-type": "text/plain" } })).status()).toBe(400);
    // nothing in the answers hints at the token
    const bad = await capture(request, { token: "q".repeat(43), amount: 100 });
    expect(await bad.text()).toBe(JSON.stringify({ ok: false }));

    // the rest of the hour's allowance goes through, formats and all, and the next one is refused
    const formats: Array<string | number> = ["₸6,000.00", "KZT 6,000.00", "6000", 6000, "6000.5", `1${NBSP}234${NBSP}567,89`, "6 000 ₸"];
    let i = 0;
    while (captures < 30) {
      const amount = formats[i++ % formats.length];
      const res = await capture(request, { token, amount, merchant: `Shop ${i}` });
      expect(res.status(), `capture #${captures + 1} (${amount})`).toBe(201);
      captures++;
    }
    const limited = await capture(request, { token, amount: 100, merchant: "One too many" });
    expect(limited.status()).toBe(429);
    expect(await limited.json()).toEqual({ ok: false });
  });
});
