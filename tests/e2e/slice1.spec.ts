import { expect, devices, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Slice 1 happy path in mock mode (production build, NEXT_PUBLIC_E2E=1 so two browser contexts share one
 * mock database through /api/mock-store, like two phones would).
 */
const NBSP = "\u00a0";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
const stamp = Date.now().toString(36);
const email = (who: string) => `${who}-${stamp}@test.kz`;
const SHOTS = "gan-harness/screenshots";

type Phone = { context: BrowserContext; page: Page; errors: string[] };

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block" }) // a registered worker would hide requests from page.route;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    if (!e.message.includes("access control checks")) errors.push(e.message);
  });
  page.on("console", (m) => {
    // WebKit logs prefetches that a navigation cancels mid-flight ("due to access control checks"): not an app error
    const benign = m.text().includes("Failed to load resource") || m.text().includes("access control checks");
    if (m.type() === "error" && !benign) errors.push(m.text());
  });
  return { context, page, errors };
}

/**
 * Runs `run` on a fresh phone. The context is always closed (even when an assertion throws), and a phone that
 * finishes must have had no console errors or uncaught exceptions.
 */
async function withPhone(browser: Browser, baseURL: string | undefined, run: (phone: Phone) => Promise<void>) {
  const phone = await newPhone(browser, baseURL);
  try {
    await run(phone);
  } finally {
    await phone.context.close();
  }
  expect(phone.errors).toEqual([]);
}

/** The row count of a purchase must be exactly 1 for a while (an optimistic row turning real must never show twice). */
async function expectSingleRowFor(page: Page, text: string, ms = 1500) {
  const rows = page.getByTestId("purchase-row").filter({ hasText: text });
  const until = Date.now() + ms;
  do {
    expect(await rows.count()).toBe(1);
    await page.waitForTimeout(50);
  } while (Date.now() < until);
}

/** App alerts only: Next injects its own route announcer with role="alert". */
const alerts = (page: Page) => page.locator("[role='alert']:not(#__next-route-announcer__)");

async function waitHydrated(page: Page) {
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

const PASSWORD = "password123";

/** First visit: the «Регистрация» tab with a matching pair of passwords. */
async function register(page: Page, address: string) {
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Почта").fill(address);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Повтори пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
}

/** Returning user: the «Вход» tab. */
async function login(page: Page, address: string) {
  await page.getByLabel("Почта").fill(address);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

async function onboard(page: Page, name: string, phone: string) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Имя").fill(name);
  await page.getByLabel("Номер Kaspi").fill(phone);
  await page.getByRole("button", { name: "Дальше" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("slice 1: first end-to-end path", () => {
  let inviteCode = "";

  test("a fresh visit to / redirects to /login, and every guarded page follows", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Войди в Общак" })).toBeVisible();
    for (const path of ["/purchases/new", "/flat", "/household", "/onboarding"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await page.screenshot({ path: `${SHOTS}/s1-e2e-login.png` });
  });

  test("login and registration validate email and password with short Russian messages", async ({ page }) => {
    await page.goto("/login");
    await waitHydrated(page);
    // «Вход»
    await page.getByLabel("Почта").fill("nope");
    await page.getByLabel("Пароль", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(alerts(page)).toHaveCount(1);
    await expect(alerts(page)).toContainText("Проверь почту");
    await page.getByLabel("Почта").fill(email("bad"));
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(alerts(page)).toHaveCount(1);
    await expect(alerts(page)).toContainText("Неверная почта или пароль");
    await expect(page).toHaveURL(/\/login$/);
    // the eye toggles the visibility of the password
    const password = page.getByLabel("Пароль", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Показать пароль" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Скрыть пароль" }).click();
    await expect(password).toHaveAttribute("type", "password");
    // «Регистрация»
    await page.getByRole("button", { name: "Регистрация", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Создай аккаунт" })).toBeVisible();
    await expect(page.getByLabel("Повтори пароль")).toBeVisible();
    await page.getByLabel("Пароль", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(alerts(page)).toContainText("Минимум 8 символов");
    await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Повтори пароль").fill("another-password");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(alerts(page)).toContainText("Пароли не совпадают");
    // the password fields use the right autocomplete hints and a >= 16px font (no iOS zoom)
    expect(await page.getByLabel("Пароль", { exact: true }).getAttribute("autocomplete")).toBe("new-password");
    expect(parseFloat(await password.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: `${SHOTS}/s1-e2e-login-signup.png` });
  });

  test("the old code step is gone: /login/verify lands on /login, and a taken email is refused", async ({ page }) => {
    await page.goto("/login/verify?email=a%40b.kz");
    await expect(page).toHaveURL(/\/login$/);
    await waitHydrated(page);
    await page.getByLabel("Почта").fill("erasyl@obshak.test"); // a seeded mock user already exists
    await page.getByRole("button", { name: "Регистрация", exact: true }).click();
    await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Повтори пароль").fill(PASSWORD);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(alerts(page)).toContainText("Такая почта уже зарегистрирована");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("user 1: sign up, onboarding, create household, invite code shown", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/");
      await waitHydrated(page);
      await expect(page).toHaveURL(/\/login$/);
      await register(page, email("one"));

      // signed in without a profile: everything leads to onboarding
      await onboard(page, "", "");
      await expect(alerts(page).first()).toBeVisible();
      await page.getByLabel("Имя").fill("Ерасыл");
      await page.getByLabel("Номер Kaspi").fill("123");
      await page.getByRole("button", { name: "Дальше" }).click();
      await expect(page.getByText("Номер в формате +7 700 123 45 67")).toBeVisible();
      await page.getByLabel("Номер Kaspi").fill("+77001234567");
      await expect(page.getByLabel("Номер Kaspi")).toHaveValue("700 123 45 67");
      await page.getByRole("button", { name: "Дальше" }).click();

      // profile but no household: the choice screen with two big capsules
      await expect(page).toHaveURL(/\/household$/);
      await page.goto("/");
      await expect(page).toHaveURL(/\/household$/);
      await expect(page.getByRole("link", { name: /Создать квартиру/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /У меня есть код/ })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/s1-e2e-household.png` });
      await page.getByRole("link", { name: /Создать квартиру/ }).click();
      await page.getByLabel("Название").fill("Квартира 42");
      await page.getByRole("button", { name: "Создать" }).click();

      // Главная
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText("Привет, Ерасыл")).toBeVisible();
      await expect(page.getByTestId("card-stack")).toHaveAttribute("data-front", "Квартира 42");
      await expect(page.getByText(`ты должен ${money(0)}`)).toBeVisible();
      await expect(page.getByText("Пока ни одной покупки")).toBeVisible();
      // one household: the decorative peek layers are still there, the "N из M" chip is not (nobody to count)
      await expect(page.getByTestId("stack-peek")).toHaveCount(2);
      await expect(page.getByTestId("card-stack").getByText(/^\d+ из \d+$/)).toHaveCount(0);
      // no unread notifications in slice 1: the bell keeps its slot but shows no dot
      await expect(page.getByRole("button", { name: "Уведомления" })).toBeDisabled();
      expect(await page.getByRole("button", { name: "Уведомления" }).locator("span.bg-orange").count()).toBe(0);
      // the action row keeps the mockup height: no extra caption line under the «скоро» actions
      const rowBox = (await page.getByRole("navigation", { name: "Покупка" }).boundingBox())!;
      expect(rowBox.height).toBeLessThan(96);
      // the Fab menu offers the monthly payment (live since slice 6)
      await page.getByRole("button", { name: "Добавить" }).tap();
      await expect(page.getByRole("menuitem", { name: /Ежемесячный платёж/ })).toBeEnabled();
      await page.getByRole("button", { name: "Закрыть" }).tap();

      // the invite code lives on the Квартира tab, grouped and on one line
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await expect(page).toHaveURL(/\/flat$/);
      const shown = (await page.getByTestId("invite-code").innerText()).trim();
      expect(shown).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect((await page.getByTestId("invite-code").boundingBox())!.height).toBeLessThan(45);
      inviteCode = shown.replace(/[\s-]/g, "");
      expect(inviteCode).toMatch(/^[A-Z0-9]{10,}$/);
      await expect(page.getByText("Ерасыл (ты)")).toBeVisible();
      // "Выйти" is a real button, not a faded-out label
      await expect(page.getByRole("button", { name: "Выйти" })).toBeEnabled();
    });
  });

  test("a wrong invite code gives one generic answer", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/login");
      await waitHydrated(page);
      await register(page, email("probe"));
      await onboard(page, "Проверка", "+77009998877");
      await expect(page).toHaveURL(/\/household$/);
      await page.getByRole("link", { name: /У меня есть код/ }).click();
      await page.getByLabel("Код приглашения").fill("NOPENOPENOPE");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(alerts(page)).toContainText("Не получилось войти по этому коду");
      await page.getByLabel("Код приглашения").fill("x");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(alerts(page)).toContainText("Не получилось войти по этому коду");
    });
  });

  test("a malformed deep link gets a clean 400, an odd but valid one still opens", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      const bad = await page.goto("/join/%E0%A4%A");
      expect(bad?.status()).toBe(400);
      const odd = await page.goto("/join/%25ZZ%20Q");
      expect(odd?.status()).toBe(200);
      await waitHydrated(page);
      await expect(page).toHaveURL(/\/login$/);
    });
  });

  test("user 2 joins from the deep link; both are members; purchase, optimistic row, balances on both phones", async ({
    browser,
    baseURL,
  }) => {
    test.skip(!inviteCode, "needs the invite code from the previous test");
    await withPhone(browser, baseURL, async (one) => {
      await one.page.goto("/login");
      await waitHydrated(one.page);
      await login(one.page, email("one")); // same mock user as above (the shared store knows them)
      await expect(one.page).toHaveURL(/\/$/);

      await withPhone(browser, baseURL, async (two) => {
        // deep link while signed out: login, onboarding, then the code is already filled in
        await two.page.goto(`/join/${inviteCode}`);
        await waitHydrated(two.page);
        await expect(two.page).toHaveURL(/\/login$/);
        await register(two.page, email("two"));
        await onboard(two.page, "Айдос", "+77007654321");
        await expect(two.page).toHaveURL(new RegExp(`/join/${inviteCode}$`));
        await expect(two.page.getByRole("heading", { name: "Тебя зовут в квартиру" })).toBeVisible();
        await expect(two.page.getByLabel("Код приглашения")).toHaveValue(inviteCode);
        await two.page.getByRole("button", { name: "Войти", exact: true }).click();
        await expect(two.page).toHaveURL(/\/$/);
        await expect(two.page.getByTestId("card-stack")).toHaveAttribute("data-front", "Квартира 42");

        // both are members (the Квартира tab of user 1 lists them)
        await one.page.reload();
        await one.page.getByRole("link", { name: "Квартира", exact: true }).click();
        await expect(one.page.getByText("Ерасыл (ты)")).toBeVisible();
        await expect(one.page.getByText("Айдос", { exact: true })).toBeVisible();
        await one.page.getByRole("link", { name: "Главная", exact: true }).click();

        // Новая покупка: 6 000 for both -> по 3 000 ₸ on 2 people
        await one.page.getByRole("link", { name: "Покупка", exact: true }).click();
        await expect(one.page).toHaveURL(/\/purchases\/new$/);
        const amount = one.page.getByLabel("Сумма");
        expect(await amount.getAttribute("inputmode")).toBe("numeric");
        expect(parseFloat(await amount.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
        const submit = one.page.getByRole("button", { name: "Поделить" });
        await expect(submit).toBeDisabled();

        // over the limit and too small for the group: a message says why, the check stays disabled
        await amount.fill("99999999");
        await expect(alerts(one.page)).toContainText(`Максимум ${money(10_000_000)}`);
        await expect(submit).toBeDisabled();
        await amount.fill("1");
        await expect(alerts(one.page)).toContainText("Сумма меньше числа людей");
        await expect(submit).toBeDisabled();

        await amount.fill("6000");
        await expect(amount).toHaveValue(`6${NBSP}000`);
        await one.page.getByLabel("Что купили").fill("Хлеб, картошка");
        await expect(one.page.getByText(`по ${money(3000)}`)).toBeVisible();
        await expect(one.page.getByText("на 2 человека")).toBeVisible();
        await expect(submit).toBeEnabled();

        // nobody but me selected: no debt, so no purchase
        const aidos = one.page.getByRole("button", { name: "Айдос", pressed: true });
        await aidos.click();
        await expect(one.page.getByText("Выбери, с кем делить")).toBeVisible();
        await expect(submit).toBeDisabled();
        await one.page.getByRole("button", { name: "Айдос", pressed: false }).last().click();
        await expect(one.page.getByText("Выбери, с кем делить")).toHaveCount(0);
        await expect(submit).toBeEnabled();

        // only "Я" can pay, only equal split in this slice; the disabled options look disabled
        const payers = one.page.getByRole("group", { name: "Кто платил" });
        await expect(payers.getByRole("button", { name: "Айдос" })).toBeDisabled();
        expect(await payers.getByRole("button", { name: "Айдос" }).evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(0.6);
        const custom = one.page.getByRole("button", { name: /Свои суммы/ });
        await expect(custom).toBeEnabled(); // «Свои суммы» is live since slice 2
        await expect(custom).not.toContainText("скоро");
        await one.page.screenshot({ path: `${SHOTS}/s1-e2e-purchase.png` });

        // optimistic: hold the save back, the row must already be on Главная
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await one.page.route("**/api/mock-store", async (route) => {
          if (route.request().method() === "PUT") await gate;
          await route.continue();
        });
        const saved = one.page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT");
        await submit.click();
        await expect(one.page).toHaveURL(/\/$/);
        const firstRow = one.page.getByTestId("purchase-row").first();
        await expect(firstRow).toContainText("Хлеб, картошка");
        await expect(firstRow).toContainText(money(6000));
        await expect(one.page.getByText(`тебе должны ${money(3000)}`)).toBeVisible();
        release();
        await saved;
        await expect(one.page.getByText(`тебе должны ${money(3000)}`)).toBeVisible();
        await expect(one.page.getByText(`+${money(3000)}`).first()).toBeVisible();
        await expect(firstRow).toContainText("0 из 1");
        // the optimistic row turning into the real one must never render twice
        await expectSingleRowFor(one.page, "Хлеб, картошка");
        await one.page.screenshot({ path: `${SHOTS}/s1-e2e-main.png` });

        // user 2 sees the debt
        await two.page.reload();
        await expect(two.page.getByText(`ты должен ${money(3000)}`)).toBeVisible();
        await expect(two.page.getByText(`тебе должны ${money(0)}`)).toBeVisible();
        await expect(two.page.getByTestId("purchase-row").first()).toContainText("Хлеб, картошка");

        // the new purchase is still there after a reload for user 1 (persisted)
        await one.page.reload();
        await expect(one.page.getByTestId("purchase-row").first()).toContainText("Хлеб, картошка");
        await expect(one.page.getByText(`тебе должны ${money(3000)}`)).toBeVisible();
        await expectSingleRowFor(one.page, "Хлеб, картошка", 300);
      });
    });
  });

  test("a neighbour who joins while the app is open shows up in «На кого» without a reload", async ({ browser, baseURL }) => {
    test.skip(!inviteCode, "needs the invite code from an earlier test");
    await withPhone(browser, baseURL, async (one) => {
      await one.page.goto("/login");
      await waitHydrated(one.page);
      await login(one.page, email("one"));
      await expect(one.page).toHaveURL(/\/$/);
      await expect(one.page.getByText("Привет, Ерасыл")).toBeVisible();

      // somebody else joins now; user 1 does not reload anything
      await withPhone(browser, baseURL, async (three) => {
        await three.page.goto(`/join/${inviteCode}`);
        await waitHydrated(three.page);
        await register(three.page, email("three"));
        await onboard(three.page, "Даня", "+77005554433");
        await expect(three.page).toHaveURL(new RegExp(`/join/${inviteCode}$`));
        await three.page.getByRole("button", { name: "Войти", exact: true }).click();
        await expect(three.page).toHaveURL(/\/$/);
      });

      // client-side navigation only: the roster is fetched again when the screen opens
      await one.page.getByRole("link", { name: "Покупка", exact: true }).click();
      await expect(one.page).toHaveURL(/\/purchases\/new$/);
      await expect(one.page.getByRole("button", { name: "Даня", pressed: true })).toBeVisible();
      await one.page.getByLabel("Сумма").fill("900");
      await one.page.getByLabel("Что купили").fill("Вода на троих");
      await expect(one.page.getByText("на 3 человека")).toBeVisible();
      await expect(one.page.getByText(`по ${money(300)}`)).toBeVisible();
    });
  });

  test("a failed save rolls the optimistic row back and says so", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/login");
      await waitHydrated(page);
      await login(page, email("one"));
      await expect(page).toHaveURL(/\/$/);
      await page.goto("/purchases/new");
      await page.getByLabel("Сумма").fill("500");
      await page.getByLabel("Что купили").fill("Не сохранится");
      await page.route("**/api/mock-store", (route) =>
        route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.continue(),
      );
      await page.getByRole("button", { name: "Поделить" }).click();
      await expect(alerts(page)).toContainText("Покупка не сохранилась");
      await expect(page.getByText("Не сохранится")).toHaveCount(0);
    });
  });

  test("sign out from the Квартира tab returns to /login and locks the app again", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/login");
      await waitHydrated(page);
      await login(page, email("two"));
      await expect(page).toHaveURL(/\/$/);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      await page.getByRole("button", { name: "Выйти" }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
