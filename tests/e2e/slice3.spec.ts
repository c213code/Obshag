import { expect, devices, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { payViaKaspi } from "./payFlow";

/**
 * Slice 3: netting and settlement, mock mode, production build. Several browser contexts share one mock database
 * through /api/mock-store (NEXT_PUBLIC_E2E=1), like several phones would.
 */
const NBSP = " ";
const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
const stamp = Date.now().toString(36);
const email = (who: string) => `s3-${who}-${stamp}@test.kz`;
const SHOTS = "gan-harness/screenshots";

const PASSWORD = "password123";

const ADAM = { key: "adam", name: "Айдос", phone: "+77010000222", masked: "+7 7•• ••• 02 22" }; // creditor
const BORIS = { key: "boris", name: "Ерасыл", phone: "+77010000111" }; // debtor
const CARL = { key: "carl", name: "Даня", phone: "+77010000333" };

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Options = { reducedMotion?: "reduce" | "no-preference" };

async function newPhone(browser: Browser, baseURL: string | undefined, options: Options = {}): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block", reducedMotion: options.reducedMotion ?? "no-preference" });
  // Kaspi is only ever opened, never loaded in tests
  await context.route("https://kaspi.kz/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>kaspi</title>" }));
  const page = await context.newPage();
  const errors: string[] = [];
  // WebKit reports Next.js RSC prefetches that a navigation cancels mid-flight as "... due to access control checks"
  // (sometimes as a pageerror, sometimes as console): not an app error
  page.on("pageerror", (e) => {
    if (!e.message.includes("access control checks")) errors.push(e.message);
  });
  page.on("console", (m) => {
    const benign = m.text().includes("Failed to load resource") || m.text().includes("access control checks") || m.text().includes("Failed to fetch RSC payload");
    if (m.type() === "error" && !benign) errors.push(m.text());
  });
  // WebKit offers no clipboard-read permission: record what the app writes instead (the textarea path first, the async API
  // as the fallback), and sample the netting amounts every frame
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string | null; __samples: string[] };
    w.__copied = null;
    w.__samples = [];
    const nativeExec = document.execCommand.bind(document);
    document.execCommand = (command: string, ...rest: [boolean?, string?]) => {
      if (command === "copy") {
        const el = document.activeElement;
        const area = document.querySelector("textarea[readonly]") as HTMLTextAreaElement | null;
        w.__copied = area?.value ?? (el instanceof HTMLTextAreaElement ? el.value : w.__copied);
        return true;
      }
      return nativeExec(command, ...rest);
    };
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            w.__copied = text;
          },
        },
      });
    } catch {
      // keep the native clipboard
    }
    const tick = () => {
      const el = document.querySelector("[data-testid='arrow-owe-amount']");
      const text = el?.textContent ?? null;
      if (text && w.__samples[w.__samples.length - 1] !== text) w.__samples.push(text);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { context, page, errors };
}

async function withPhone(browser: Browser, baseURL: string | undefined, run: (phone: Phone) => Promise<void>, options: Options = {}) {
  const phone = await newPhone(browser, baseURL, options);
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

/** First visit: the «Регистрация» tab. */
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
  await expect(page.getByRole("link", { name: `Профиль и квартира, ${who.name}` })).toBeVisible();
}

/** Resolves when the shared mock store accepted a write (the optimistic UI shows results before that). */
function savedToStore(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);
}

/** «Перевести» -> back from Kaspi -> «Да, перевёл», and waits for the save, so closing the phone right after cannot lose the mark. */
async function markPaidSaved(page: Page) {
  await waitHydrated(page);
  await payViaKaspi(page, "yes");
}

/** Equal split of `amount` over the signed-in user and the named housemates (everyone else is switched off). */
async function buy(page: Page, amount: number, what: string, with_: ReadonlyArray<string>, without: ReadonlyArray<string> = []) {
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByRole("menuitem", { name: "Покупка" }).click();
  await expect(page).toHaveURL(/\/purchases\/new$/);
  for (const name of without) await page.getByRole("button", { name, pressed: true }).click();
  for (const name of with_) await expect(page.getByRole("button", { name, pressed: true })).toBeVisible();
  await page.getByLabel("Сумма").fill(String(amount));
  await page.getByLabel("Что купили").fill(what);
  // the row is optimistic: wait until the store has really saved it before anybody closes this phone
  const saved = savedToStore(page);
  await page.getByRole("button", { name: "Поделить" }).click();
  await saved;
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("purchase-row").first()).toContainText(what);
}

const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string | null }).__copied);
const samples = (page: Page) => page.evaluate(() => (window as unknown as { __samples: string[] }).__samples);
const num = (text: string) => Number(text.replace(/[^\d]/g, ""));

test.describe.configure({ mode: "serial" });

test.describe("slice 3: netting and settlement", () => {
  let inviteCode = "";
  let adamId = "";

  test("setup: three neighbours, 4 000 and 3 600 split between two of them", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await signUp(page, ADAM);
      await expect(page).toHaveURL(/\/household$/);
      await page.getByRole("link", { name: /Создать квартиру/ }).click();
      await page.getByLabel("Название").fill("Квартира S3");
      await page.getByRole("button", { name: "Создать" }).click();
      await expect(page).toHaveURL(/\/$/);
      await page.getByRole("link", { name: "Квартира", exact: true }).click();
      inviteCode = (await page.getByTestId("invite-code").innerText()).trim().replace(/[\s-]/g, "");
      expect(inviteCode).toMatch(/^[A-Z0-9]{10,}$/);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto(`/join/${inviteCode}`);
      await expect(page).toHaveURL(/\/login$/); // the deep link sends a signed-out visitor to the login first
      await register(page, BORIS, false);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.getByLabel("Имя").fill(BORIS.name);
      await page.getByLabel("Номер Kaspi").fill(BORIS.phone);
      await page.getByRole("button", { name: "Дальше" }).click();
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
    });
    // Айдос (creditor) pays 4 000 for both: Ерасыл owes 2 000
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await buy(page, 4000, "Интернет", [BORIS.name]);
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(money(2000));
      // «Расчёт» is a real link now, and the «Подтверди оплату» section is absent when nothing was marked
      await expect(page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ })).toBeVisible();
      await expect(page.getByText("Подтверди оплату")).toHaveCount(0);
    });
    // Ерасыл pays 3 600 for both: Айдос owes 1 800
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await buy(page, 3600, "Картошка", [ADAM.name]);
      // Главная nets per person now: 2 000 against 1 800 is "ты должен 200" (slice 19: the tile of a net debtor reads «Ты должен»)
      await expect(page.getByTestId("bento-owe-amount")).toHaveText(money(200));
      await expect(page.getByTestId("bento-owed")).toContainText("Ты должен");
      await expect(page.getByTestId("bento-owed-amount")).toHaveCount(0);
    });
  });

  test("the pair screen nets 2 000 against 1 800, copies the number and opens Kaspi", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page, context }) => {
      await logIn(page, BORIS);
      await page.screenshot({ path: `${SHOTS}/s3-app-main.png` });
      await page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ }).click();
      // exactly one counterparty: straight to the person
      await expect(page).toHaveURL(/\/settle\/[0-9a-f-]{36}$/);
      adamId = page.url().split("/").pop() ?? "";
      // names are declined like in the mockup: с кем / кому / чей
      await expect(page.getByRole("heading", { name: "Расчёт с Айдосом" })).toBeVisible();

      const scene = page.getByTestId("pair-scene");
      await expect(scene).toHaveAttribute("data-stage", "3", { timeout: 4000 });
      await expect(page.getByTestId("scene-caption")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: `${SHOTS}/s3-app-pay-2-end.png` });

      // the amount counted down from the bigger side to exactly the net: at least two samples, never up, right endpoints
      const seen = await samples(page);
      expect(seen[0]).toBe(money(2000));
      expect(seen[seen.length - 1]).toBe(money(200));
      const values = seen.map(num);
      expect(values.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
      await expect(page.getByTestId("arrow-owe-amount")).toHaveText(money(200));
      // the lime arrow dissolved into the orange one
      await expect(page.getByTestId("arrow-owed")).toHaveCSS("opacity", "0");
      await expect(page.getByTestId("scene-caption")).toHaveText("Один перевод вместо двух");

      // the equation and the two columns
      await expect(page.getByTestId("equation")).toHaveText(`2${NBSP}000−1${NBSP}800=200${NBSP}₸`);
      await expect(page.getByTestId("equation-result")).toHaveText(money(200));
      await expect(page.getByTestId("side-owe")).toContainText("Ты → Айдосу");
      await expect(page.getByTestId("side-owe")).toContainText("Интернет");
      await expect(page.getByTestId("side-owe")).toContainText(`2${NBSP}000`);
      await expect(page.getByTestId("side-owed")).toContainText(`${ADAM.name} → тебе`);
      await expect(page.getByTestId("side-owed")).toContainText("Картошка");
      await expect(page.getByTestId("side-owed")).toContainText(`1${NBSP}800`);

      // the Kaspi bar: masked number, «Kaspi Айдоса», the chip waits for the first tap
      const bar = page.getByTestId("kaspi-bar");
      await expect(bar).toContainText("Kaspi Айдоса");
      await expect(bar).toContainText(ADAM.masked);
      await expect(bar).toContainText("Скопировать");
      await expect(bar).not.toContainText("скопирован");
      expect(await copied(page)).toBeNull();

      // the first tap anywhere on the screen copies the creditor's number (unmasked) and turns the chip into «✓ скопирован»
      await page.getByTestId("equation").click();
      await expect(bar).toContainText("скопирован");
      expect(await copied(page)).toBe(ADAM.phone);
      await page.screenshot({ path: `${SHOTS}/s3-app-pay-3-copied.png` });
      // it survives a reload of this tab (sessionStorage, per person)
      await page.reload();
      await waitHydrated(page);
      await expect(page.getByTestId("kaspi-bar")).toContainText("скопирован");

      // «Перевести 200 ₸» copies again and opens kaspi.kz/transfers in a new tab (the request itself is stubbed)
      await page.evaluate(() => ((window as unknown as { __copied: string | null }).__copied = null));
      const popup = context.waitForEvent("page");
      await page.getByRole("button", { name: `Перевести 200${NBSP}₸` }).click();
      const kaspi = await popup;
      await kaspi.waitForURL("https://kaspi.kz/transfers");
      expect(kaspi.url()).toBe("https://kaspi.kz/transfers");
      expect(await copied(page)).toBe(ADAM.phone);
      await kaspi.close();
    });
  });

  test("«Да, перевёл» is final (slice 22): the debt is closed for the debtor at once and nobody has to confirm", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous test");
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await page.goto(`/settle/${adamId}`);
      await waitHydrated(page);
      // no «Я оплатил» any more: the way to pay is «Перевести …», and the question comes when the user is back
      await expect(page.getByRole("button", { name: "Я оплатил" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Перевести / })).toBeVisible();
      await markPaidSaved(page);
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
      await expect(page.getByTestId("waiting")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Отменить" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Перевести / })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/s3-app-pay-4-waiting.png` });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      // the creditor has nothing to confirm: no section, no row
      await expect(page.getByRole("heading", { name: "Подтверди оплату" })).toHaveCount(0);
      await expect(page.getByTestId("incoming-row")).toHaveCount(0);
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(money(0));
      await page.screenshot({ path: `${SHOTS}/s3-app-main-incoming.png` });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await expect(page.getByRole("heading", { name: "Ждём подтверждения" })).toHaveCount(0);
      await expect(page.getByTestId("waiting-row")).toHaveCount(0);
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(money(0));
      await page.goto(`/settle/${adamId}`);
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
      await page.reload(); // persisted, not just local state
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
    });
  });

  test("the paid pair is settled for both: purchases «1 из 1», «Все в расчёте» everywhere", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous tests");
    await withPhone(browser, baseURL, async (adam) => {
      await logIn(adam.page, ADAM);
      await expect(adam.page.getByText(`ты должен ${money(0)}`)).toBeVisible();
      await expect(adam.page.getByTestId("bento-owed-amount")).toHaveText(money(0));
      // «N из M скинули»: both purchases are fully paid now
      for (const text of ["Интернет", "Картошка"]) {
        await expect(adam.page.getByTestId("purchase-row").filter({ hasText: text })).toContainText("1 из 1");
      }
      await adam.page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ }).click();
      await expect(adam.page.getByTestId("settle-empty")).toContainText("Все в расчёте");
      await adam.page.screenshot({ path: `${SHOTS}/s3-app-settle-empty.png` });
    });
    await withPhone(browser, baseURL, async (boris) => {
      await logIn(boris.page, BORIS);
      await expect(boris.page.getByText(`ты должен ${money(0)}`)).toBeVisible();
      await expect(boris.page.getByTestId("bento-owed-amount")).toHaveText(money(0));
      await expect(boris.page.getByTestId("waiting-row")).toHaveCount(0);
      await boris.page.goto(`/settle/${adamId}`);
      await expect(boris.page.getByTestId("settle-empty")).toContainText("Все в расчёте");
      await boris.page.goto("/settle");
      await expect(boris.page.getByTestId("settle-empty")).toContainText("Все в расчёте");
    });
  });

  test("a second purchase after the mark is a new debt; marking it closes it again, the creditor never confirms", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous tests");
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await buy(page, 400, "Соль", [BORIS.name]); // Ерасыл owes 200
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await page.goto(`/settle/${adamId}`);
      await waitHydrated(page);
      await expect(page.getByTestId("equation")).toHaveText(`200−0=200${NBSP}₸`);
      await markPaidSaved(page);
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await expect(page.getByTestId("incoming-row")).toHaveCount(0);
      await expect(page.getByText("Подтверди оплату")).toHaveCount(0);
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(money(0));
    });
  });

  test("a final mark has no «Отменить»; a stranger's id goes back to the list", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous tests");
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await buy(page, 400, "Перец", [BORIS.name]); // Ерасыл owes 200 again, left open for the next test
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await page.goto(`/settle/${adamId}`);
      await waitHydrated(page);
      await expect(page.getByRole("button", { name: "Отменить" })).toHaveCount(0);
      await expect(page.getByTestId("waiting")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Перевести / })).toBeVisible();
      // one-sided: no netting, one arrow, no caption
      await expect(page.getByTestId("equation")).toHaveText(`200−0=200${NBSP}₸`);
      await expect(page.getByTestId("scene-caption")).toHaveCount(0);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(money(200));
      await expect(page.getByText("Подтверди оплату")).toHaveCount(0);
      await expect(page.getByTestId("incoming-row")).toHaveCount(0);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      // not a neighbour: back to the list, and with only one counterparty the list sends us to them
      await page.goto("/settle/00000000-0000-4000-8000-0000000000aa");
      await waitHydrated(page);
      await expect(page).toHaveURL(new RegExp(`/settle/${adamId}$`));
    });
  });

  test("the debtor's pair screen when THEY owe: Напомнить is disabled and the incoming row is on the screen", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous tests");
    // Айдос is the creditor: the list stays (it carries the «Напомнить» pill), the pair screen has a live «Напомнить»
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ }).click();
      await expect(page).toHaveURL(/\/settle$/);
      await expect(page.getByRole("button", { name: /^Напомнить: / })).toBeEnabled();
      await page.getByRole("link", { name: /Рассчитаться с / }).click();
      await expect(page).toHaveURL(/\/settle\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("remind-pair")).toBeEnabled();
      await expect(page.getByTestId("remind-pair")).toContainText("Напомнить");
      await expect(page.getByTestId("remind-pair")).not.toContainText("скоро");
      await expect(page.getByRole("button", { name: "Я оплатил" })).toHaveCount(0);
      await expect(page.getByTestId("kaspi-bar")).toContainText("Kaspi Ерасыла");
      await expect(page.getByTestId("kaspi-bar")).toContainText("+7 7•• ••• 01 11"); // Ерасыл's number
      await page.screenshot({ path: `${SHOTS}/s3-app-pay-they-owe.png` });
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await page.goto(`/settle/${adamId}`);
      await markPaidSaved(page);
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте");
    });
    // Айдос opens the same screen: nothing to confirm, the pair is closed
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, ADAM);
      await page.goto(`/settle/${adamId}`);
      await expect(page.getByTestId("incoming-row")).toHaveCount(0);
      await expect(page.getByTestId("settle-empty")).toContainText("Все в расчёте", { timeout: 5000 });
    });
  });

  test("the list: several counterparties as pill rows (orange: ты должен, lime: тебе должен)", async ({ browser, baseURL }) => {
    test.skip(!adamId || !inviteCode, "needs the previous tests");
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto(`/join/${inviteCode}`);
      await expect(page).toHaveURL(/\/login$/);
      await register(page, CARL, false);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.getByLabel("Имя").fill(CARL.name);
      await page.getByLabel("Номер Kaspi").fill(CARL.phone);
      await page.getByRole("button", { name: "Дальше" }).click();
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
    });
    // Ерасыл pays 900 with Даня (Даня owes 450); Айдос pays 1 400 with Ерасыл (Ерасыл owes 700)
    await withPhone(browser, baseURL, async (boris) => {
      await logIn(boris.page, BORIS);
      await buy(boris.page, 900, "Вода для Дани", [CARL.name], [ADAM.name]);
    });
    await withPhone(browser, baseURL, async (adam) => {
      await logIn(adam.page, ADAM);
      await buy(adam.page, 1400, "Чай", [BORIS.name], [CARL.name]);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, BORIS);
      await page.getByRole("link", { name: /^Расчёт: (тебе должны|ты должен)/ }).click();
      await expect(page).toHaveURL(/\/settle$/);
      const list = page.getByRole("list", { name: "Расчёт" });
      const rows = list.getByRole("link");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText(ADAM.name); // biggest transfer first
      await expect(rows.nth(0)).toContainText(`ты должен ${money(700)}`);
      await expect(rows.nth(1)).toContainText(CARL.name);
      await expect(rows.nth(1)).toContainText(`тебе должен ${money(450)}`);
      expect(await rows.nth(0).getByText(`ты должен ${money(700)}`).evaluate((el) => getComputedStyle(el).color)).not.toBe(
        await rows.nth(1).getByText(`тебе должен ${money(450)}`).evaluate((el) => getComputedStyle(el).color),
      );
      await page.screenshot({ path: `${SHOTS}/s3-app-settle-list.png` });
      await rows.nth(0).click();
      await expect(page).toHaveURL(new RegExp(`/settle/${adamId}$`));
      // Back returns to the list, not to a redirect
      await page.getByRole("button", { name: "Назад" }).click();
      await expect(page).toHaveURL(/\/settle$/);
    });
  });

  test("reduced motion: the final state is shown at once, without counting", async ({ browser, baseURL }) => {
    test.skip(!adamId, "needs the previous tests");
    // Ерасыл owes Айдос 700; Ерасыл pays 600 with Айдос -> Айдос owes 300: net 400 for Ерасыл
    await withPhone(browser, baseURL, async (boris) => {
      await logIn(boris.page, BORIS);
      await buy(boris.page, 600, "Хлеб", [ADAM.name], [CARL.name]);
    });
    await withPhone(
      browser,
      baseURL,
      async ({ page }) => {
        await logIn(page, BORIS);
        await page.goto(`/settle/${adamId}`);
        await waitHydrated(page);
        await expect(page.getByTestId("arrow-owe-amount")).toHaveText(money(400));
        const seen = await samples(page);
        expect(seen).toEqual([money(400)]); // no intermediate numbers
        await expect(page.getByTestId("pair-scene")).toHaveAttribute("data-stage", "3");
        await expect(page.getByTestId("equation")).toHaveText(`700−300=400${NBSP}₸`);
        await expect(page.getByTestId("arrow-owed")).toHaveCSS("opacity", "0");
        await expect(page.getByTestId("scene-caption")).toHaveCSS("opacity", "1");
        await page.screenshot({ path: `${SHOTS}/s3-app-pay-reduced.png` });
      },
      { reducedMotion: "reduce" },
    );
  });
});
