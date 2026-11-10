import { expect, devices, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** Slice 8: offline page + safe caching, forgot/reset password, Главная empty state. Mock mode, production build. */
const stamp = Date.now().toString(36);
const PASSWORD = "password123";

type Phone = { context: BrowserContext; page: Page; errors: string[] };

async function withPhone(
  browser: Browser,
  baseURL: string | undefined,
  run: (phone: Phone) => Promise<void>,
  serviceWorkers: "allow" | "block" = "block",
) {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    if (!e.message.includes("access control checks")) errors.push(e.message);
  });
  page.on("console", (m) => {
    const benign = m.text().includes("Failed to load resource") || m.text().includes("access control checks") || m.text().includes("Failed to fetch RSC payload");
    if (m.type() === "error" && !benign) errors.push(m.text());
  });
  try {
    await run({ context, page, errors });
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
}

const hydrated = (page: Page) => page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });

async function registerAndOnboard(page: Page, address: string, name: string) {
  await page.goto("/login");
  await hydrated(page);
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Почта").fill(address);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Повтори пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Имя").fill(name);
  await page.getByLabel("Номер Kaspi").fill("+77001234567");
  await page.getByRole("button", { name: "Дальше" }).click();
}

test.describe("slice 8", () => {
  test("forgot password shows the same neutral message for any address", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/login");
      await hydrated(page);
      await page.getByRole("link", { name: "Забыли пароль?" }).click();
      await expect(page).toHaveURL(/\/forgot$/);
      for (const address of [`nobody-${stamp}@test.kz`, "erasyl@obshak.test"]) {
        await page.goto("/forgot");
        await hydrated(page);
        await page.getByLabel("Почта").fill(address);
        await page.getByRole("button", { name: "Отправить ссылку" }).click();
        await expect(page.getByTestId("forgot-sent")).toHaveText("Если такая почта есть — мы отправили письмо");
      }
    });
  });

  test("mock reset flow: empty Главная, then a new password lands on Главная", async ({ browser, baseURL }) => {
    const address = `reset-${stamp}@test.kz`;
    await withPhone(browser, baseURL, async ({ page }) => {
      await registerAndOnboard(page, address, "Рита");
      await page.getByRole("link", { name: /Создать квартиру/ }).click();
      await page.getByLabel("Название").fill("Квартира 8");
      await page.getByRole("button", { name: "Создать" }).click();
      await expect(page.getByRole("link", { name: "Профиль и квартира, Рита" })).toBeVisible();
      await expect(page.getByTestId("home-empty")).toContainText("Пока пусто — добавь первую покупку");
      await expect(page.getByTestId("home-empty").getByRole("link", { name: "Добавить покупку" })).toBeVisible();

      await page.evaluate(() => window.localStorage.clear()); // a different phone: signed out
      await page.goto(`/reset?mock=1&email=${encodeURIComponent(address)}`);
      await hydrated(page);
      await expect(page.getByRole("heading", { name: "Новый пароль" })).toBeVisible();
      await page.getByLabel("Новый пароль", { exact: true }).fill("short");
      await page.getByLabel("Повтори пароль").fill("short");
      await page.getByRole("button", { name: "Сохранить пароль" }).click();
      await expect(page.getByText("Минимум 8 символов")).toBeVisible();
      await page.getByLabel("Новый пароль", { exact: true }).fill("brand-new-pass");
      await page.getByLabel("Повтори пароль").fill("other-pass-123");
      await page.getByRole("button", { name: "Сохранить пароль" }).click();
      await expect(page.getByText("Пароли не совпадают")).toBeVisible();
      await page.getByLabel("Повтори пароль").fill("brand-new-pass");
      await page.getByRole("button", { name: "Сохранить пароль" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("link", { name: "Профиль и квартира, Рита" })).toBeVisible();

    });
  });

  test("a stale reset link says so and offers a new one", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/reset?code=expired");
      await hydrated(page);
      await expect(page.getByText("Ссылка устарела или уже использована. Запроси новую.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Запросить новую ссылку" })).toBeVisible();
    });
  });

  test("offline: the worker shows /offline instead of a failed page and never caches API or private data", async ({ browser, baseURL }) => {
    await withPhone(
      browser,
      baseURL,
      async ({ page, context }) => {
        await page.goto("/");
        await hydrated(page);
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
        // some API traffic through the page, which the worker must leave alone
        await page.evaluate(() => fetch("/api/mock-store").catch(() => null));
        const cached = await page.evaluate(async () => {
          const urls: string[] = [];
          for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
          return urls;
        });
        expect(cached).toContain("/offline");
        expect(cached.some((u) => u.startsWith("/api/"))).toBe(false);
        expect(cached.every((u) => u === "/offline" || u.startsWith("/_next/static/") || u.startsWith("/icons/") || u === "/manifest.webmanifest")).toBe(true);

        await context.setOffline(true);
        await page.goto("/flat").catch(() => undefined);
        await expect(page.getByTestId("offline-screen")).toContainText("Нет интернета. Покажем, как только связь вернётся");
        await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
        await context.setOffline(false);
      },
      "allow",
    );
  });
});
