import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";

/**
 * Slice 14, «Очередь»: an admin creates Готовка, the week shows the rotation, A asks D to swap days, D accepts on the
 * request screen, the calendar shows ⇄ and the swapped cooks, «Приготовил» puts a check on today. Own household.
 */
const A = { email: "asset@obshak.test", name: "Асет", id: "00000000-0000-4000-8000-0000000000d1" };
const B = { email: "bota@obshak.test", name: "Бота", id: "00000000-0000-4000-8000-0000000000d2" };
const C = { email: "chingiz@obshak.test", name: "Чингиз", id: "00000000-0000-4000-8000-0000000000d3" };
const D = { email: "dana@obshak.test", name: "Дана", id: "00000000-0000-4000-8000-0000000000d4" };
const HOUSEHOLD = "10000000-0000-4000-8000-0000000000d9";

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
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 14", invite_code: "ZX14CV24BN57", created_by: A.id, created_at: at });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const savedToStore = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);

test.describe.configure({ mode: "serial" });

test.describe("slice 14: Очередь", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("a member sees «Админ ещё не настроил очередь» before anything is set up; a tab leads to /duty", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, B);
      await page.getByRole("link", { name: "Очередь" }).click();
      await expect(page).toHaveURL(/\/duty$/);
      await expect(page.getByTestId("duty-empty")).toContainText("Админ ещё не настроил очередь");
      await expect(page.getByTestId("duty-create")).toHaveCount(0);
      await page.goto("/");
      await expect(page.getByTestId("home-duty-tile")).toHaveCount(0);
    });
  });

  test("the admin creates Готовка; the week shows the rotation; «Приготовил» puts a check on today", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty");
      await expect(page.getByTestId("duty-create")).toBeVisible();
      // the default order is the join order; move Бота down once to prove the editor works, then back up
      await expect(page.getByTestId("order-row")).toHaveCount(4);
      await page.getByRole("button", { name: "Бота: ниже" }).click();
      await expect(page.getByTestId("order-row").nth(2)).toContainText("Бота");
      await page.getByRole("button", { name: "Бота: выше" }).click();
      await expect(page.getByTestId("order-row").nth(1)).toContainText("Бота");
      const saved = savedToStore(page);
      await page.getByTestId("duty-create-submit").click();
      await saved;

      // today is Асет's: the stove card says so, the week starts the rotation today, the order lists four
      await expect(page.getByTestId("duty-cook")).toHaveText("Готовишь ты");
      await expect(page.getByTestId("duty-stove")).toContainText("Завтра — Бота");
      const todayCell = page.locator(`[data-testid="week-cell"][data-day="${almaty(0)}"]`);
      await expect(todayCell).toHaveAttribute("data-user", A.id);
      await expect(page.locator(`[data-testid="week-cell"][data-day="${almaty(1)}"]`)).toHaveAttribute("data-user", B.id);
      await expect(page.getByTestId("week-cell")).toHaveCount(7);
      await expect(page.getByTestId("order-person")).toHaveCount(4);
      await expect(page.getByTestId("home-duty-tile")).toHaveCount(0); // we are on /duty
      expect((await readStore(request)).db.duties).toHaveLength(1);

      // «Приготовил»: a check over today's circle
      await expect(todayCell).toHaveAttribute("data-done", "false");
      const done = savedToStore(page);
      await page.getByTestId("duty-done").click();
      await done;
      await expect(page.getByTestId("duty-done-state")).toBeVisible();
      await expect(todayCell).toHaveAttribute("data-done", "true");
      await expect(todayCell.getByRole("img", { name: "приготовлено" })).toBeVisible();

      // Главная has the stove tile
      await page.goto("/");
      await expect(page.getByTestId("home-duty-cook")).toHaveText("Готовишь ты");
    });
  });

  test("Асет asks Дана to swap, Дана accepts on the request screen, the calendar shows ⇄ and the swapped cooks", async ({ browser, baseURL }) => {
    // rotation A B C D: day +3 is Дана's, day +4 is Асет's again (today is done, so the sheet starts from +4)
    const mine = almaty(4);
    const theirs = almaty(3);
    let requestUrl = "";
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      await page.goto("/duty");
      await page.getByTestId("duty-swap").click();
      const sheet = page.getByTestId("duty-swap-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("Поменяться днём");
      await expect(sheet.getByTestId("swap-option")).toHaveCount(2); // перед тобой (Дана) / после тебя (Бота)
      await sheet.locator(`[data-testid="swap-option"][data-day="${theirs}"]`).click();
      await expect(sheet.getByTestId("swap-summary")).toBeVisible();
      await sheet.getByTestId("swap-reason").fill("Пары до вечера");
      const saved = savedToStore(page);
      await sheet.getByTestId("swap-send").click();
      await saved;

      // my outgoing request shows up with «Отменить»
      await expect(page.getByTestId("duty-outgoing")).toContainText("Ждём ответ от Дана");
      await expect(page.getByTestId("duty-cancel-swap")).toBeVisible();
    });

    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, D);
      await page.goto("/duty");
      const incoming = page.getByTestId("duty-incoming");
      await expect(incoming).toContainText("Асет просит поменяться");
      await incoming.click();
      await expect(page).toHaveURL(/\/duty\/request\/.+/);
      requestUrl = page.url();
      await expect(page.getByTestId("request-title")).toContainText("Асет просит поменяться днями");
      await expect(page.getByTestId("request-reason")).toContainText("Пары до вечера");
      await expect(page.getByTestId("request-countdown")).toContainText("ещё");
      await expect(page.getByTestId("request-day-card")).toHaveCount(2);
      const saved = savedToStore(page);
      await page.getByTestId("request-accept").click();
      await saved;
      await expect(page.getByTestId("request-result")).toHaveAttribute("data-status", "accepted");
    });

    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, A);
      // the request screen of an answered request shows the result, not the buttons
      await page.goto(requestUrl.replace(/^https?:\/\/[^/]+/, ""));
      await expect(page.getByTestId("request-result")).toHaveAttribute("data-status", "accepted");

      await page.goto("/duty/calendar");
      const cellOf = async (day: string) => {
        // a day of another month is reached with the month arrows
        const here = await page.getByTestId("calendar-title").textContent();
        const month = Number(day.slice(5, 7));
        const shown = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"].indexOf(here!.split(" ")[0]) + 1;
        if (shown !== month) await page.getByTestId("calendar-next").click();
        return page.locator(`[data-testid="month-cell"][data-day="${day}"]`);
      };
      const m = await cellOf(mine);
      await expect(m).toHaveAttribute("data-user", D.id);
      await expect(m).toHaveAttribute("data-swapped", "true");
      await expect(m.getByRole("img", { name: "обмен" })).toBeVisible();
      const t = await cellOf(theirs);
      await expect(t).toHaveAttribute("data-user", A.id);
      await expect(t).toHaveAttribute("data-swapped", "true");
      await expect(page.getByTestId("stat-row")).toHaveCount(4);
    });

    // the swap is also visible to Дана on her own week / calendar, and the pending card is gone
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, D);
      await page.goto("/duty");
      await expect(page.getByTestId("duty-pending")).toHaveCount(0);
    });
  });

  test("«Другой день» opens the calendar picker and returns to the sheet", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, B);
      await page.goto("/duty");
      await page.getByTestId("duty-swap").click();
      const sheet = page.getByTestId("duty-swap-sheet");
      await sheet.getByTestId("swap-other-day").click();
      await expect(page).toHaveURL(/\/duty\/calendar\?swap=/);
      await expect(page.getByTestId("calendar-pick")).toBeVisible();
      // pick a day of Чингиз (rotation: day +2)
      const target = almaty(2);
      const month = Number(target.slice(5, 7));
      const title = await page.getByTestId("calendar-title").textContent();
      if (!title!.includes(["", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"][month])) await page.getByTestId("calendar-next").click();
      await page.locator(`[data-testid="month-cell"][data-day="${target}"]`).click();
      await expect(page).toHaveURL(/\/duty$/);
      const back = page.getByTestId("duty-swap-sheet");
      await expect(back).toBeVisible();
      await expect(back.getByTestId("swap-summary")).toBeVisible();
      await expect(back.getByTestId("swap-option").filter({ hasText: "Чингиз" })).toHaveAttribute("aria-checked", "true");
    });
  });
});
