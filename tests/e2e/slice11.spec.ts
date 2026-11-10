import { expect, devices, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Slice 11: swipe a purchase row to the left to delete it. Admin (Ерасыл, the first seeded member) can delete another
 * member's shared purchase; a plain member cannot swipe someone else's row. Mock mode, production build.
 */
const ME = { email: "erasyl@obshak.test", name: "Ерасыл" }; // admin
const AIDOS = { email: "aidos@obshak.test", name: "Айдос" }; // member
const WHAT = "Чай для свайпа";

type Phone = { context: BrowserContext; page: Page; errors: string[] };

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
  await expect(page.getByText(`Привет, ${who.name}`)).toBeVisible();
}

const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

async function swipeLeft(page: Page, row: ReturnType<Page["locator"]>) {
  const box = await row.boundingBox();
  if (!box) throw new Error("row has no box");
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width - 40;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 - i * 22, y);
    await page.waitForTimeout(40); // let the pan session process a frame per move
  }
  await page.mouse.up();
}

/** Swipes until the confirm sheet shows (a loaded machine can drop frames of a synthetic drag). */
async function swipeToConfirm(page: Page, row: ReturnType<Page["locator"]>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await swipeLeft(page, row);
    if (await page.getByTestId("swipe-confirm-sheet").isVisible({ timeout: 1500 }).catch(() => false)) return;
    await page.waitForTimeout(300);
  }
}

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("slice 11: swipe to delete", () => {
  test("a member adds a shared purchase; the admin swipes it left, confirms, the row disappears", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, AIDOS);
      await page.getByRole("link", { name: "Покупка", exact: true }).click();
      await expect(page).toHaveURL(/\/purchases\/new$/);
      for (const name of ["Даня", "Нурик"]) await page.getByRole("button", { name, pressed: true }).click();
      await page.getByLabel("Сумма", { exact: true }).fill("600");
      await page.getByLabel("Что купили").fill(WHAT);
      const saved = savedToStore(page);
      await page.getByRole("button", { name: "Поделить" }).click();
      await saved;
      await expect(page).toHaveURL(/\/$/);
    });

    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      const row = page.getByTestId("purchase-list-row").filter({ hasText: WHAT });
      await expect(row).toHaveCount(1);
      await expect(row.locator("[data-swipeable]")).toHaveCount(1);

      // a long pull asks for confirmation
      const link = row.getByRole("link");
      await swipeToConfirm(page, link);
      await expect(page.getByTestId("swipe-confirm-sheet")).toBeVisible();
      await expect(page.getByText("Доли у всех исчезнут.")).toBeVisible();

      // cancel: the row is still there
      await page.getByRole("button", { name: "Отмена" }).click();
      await expect(page.getByTestId("swipe-confirm-sheet")).toBeHidden();
      await expect(row).toHaveCount(1);

      // a plain tap still opens the purchase
      await link.click();
      await expect(page).toHaveURL(/\/purchases\/[^/]+$/);
      await page.goBack();

      const saved = savedToStore(page);
      await swipeToConfirm(page, row.getByRole("link"));
      await page.getByTestId("swipe-confirm").click();
      await saved;
      await expect(page.getByTestId("purchase-list-row").filter({ hasText: WHAT })).toHaveCount(0);
    });
  });

  test("a plain member cannot swipe another member's row, but can swipe their own", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, AIDOS);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      const rows = page.getByTestId("purchase-list-row");
      const others = rows.filter({ hasText: "Продукты" }); // paid by Ерасыл
      await expect(others).toHaveCount(1);
      await expect(others.locator("[data-swipeable]")).toHaveCount(0);
      await swipeLeft(page, others.getByRole("link"));
      await expect(page.getByTestId("swipe-confirm-sheet")).toBeHidden();
      await expect(rows.filter({ hasText: "Ты" }).first().locator("[data-swipeable]")).toHaveCount(1); // his own
    });
  });

  test("a short swipe only uncovers «Удалить»; a nudge does nothing; tapping the row closes it", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ME);
      await page.getByRole("link", { name: "Покупки", exact: true }).click();
      const row = page.locator("[data-swipeable]").first();
      await expect(row).toBeVisible();
      const box = await row.boundingBox();
      if (!box) throw new Error("row has no box");
      const y = box.y + box.height / 2;
      const x0 = box.x + box.width - 40;
      const drag = async (dx: number) => {
        await page.mouse.move(x0, y);
        await page.mouse.down();
        for (let i = 1; i <= 6; i++) {
          await page.mouse.move(x0 - (dx * i) / 6, y);
          await page.waitForTimeout(40);
        }
        await page.waitForTimeout(150); // stop before lifting: no flick
        await page.mouse.up();
      };
      await drag(20); // a nudge
      await page.waitForTimeout(500);
      await expect(page.getByTestId("swipe-confirm-sheet")).toHaveCount(0);
      await expect(page.getByTestId("swipe-delete")).toHaveCount(0);
      await drag(90); // a short swipe parks it open
      await expect(page.getByTestId("swipe-delete")).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page.getByTestId("swipe-confirm-sheet")).toHaveCount(0);
      await row.click({ position: { x: 30, y: box.height / 2 } }); // tap the row: closes, does not navigate
      await expect(page.getByTestId("swipe-delete")).toHaveCount(0);
      await expect(page).toHaveURL(/\/purchases$/);
    });
  });
});
