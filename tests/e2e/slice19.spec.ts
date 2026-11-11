import { expect, devices, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK_SCHEMA_VERSION } from "../../src/lib/data/mockDb";
import { createSeed } from "../../src/lib/data/seed";
import { decline } from "../../src/lib/i18n/declension";
import { returnFromKaspi } from "./payFlow";

/**
 * Slice 19: «перевод в пути» + «💸 Перевести» in the reminder + «Оплатить» on the debtor's home.
 * The live case, in an own household: Нурбол (C) paid Нурдаулет (D) 150 and marked it (D has not confirmed). Later D owes C 450.
 *  - the pair net for D is 450, not 450 - 150;
 *  - D's home: «Ты должен 450», «Оплатить», «К оплате» → «Перевести» → /settle/<C> with the Kaspi bar;
 *  - C's reminder makes a pay link; /k/<code> is public (no login): button → Kaspi → back → «Ты оплатил Нурболу 450 ₸?» → «Да» → «Отмечено ✓».
 */
const D = { email: "nurdaulet19@obshak.test", name: "Нурдаулет", id: "00000000-0000-4000-8000-0000000019d1" }; // owes 450
const C = { email: "nurbol19@obshak.test", name: "Нурбол", id: "00000000-0000-4000-8000-0000000019c2" }; // paid 900, marked 150 to D
const HOUSEHOLD = "10000000-0000-4000-8000-000000001919";
const P1 = "20000000-0000-4000-8000-000000001911"; // C paid 900 «Ролтон»: D owes 450
const P2 = "20000000-0000-4000-8000-000000001912"; // D paid 300 «нан»: C owes 150 (in flight)
const SETTLEMENT = "30000000-0000-4000-8000-000000001919";
const NBSP = " ";

type Phone = { context: BrowserContext; page: Page; errors: string[] };
type Stored = {
  version: number;
  rev: number;
  db: {
    users: Array<{ id: string; email: string; password: string }>;
    profiles: Array<Record<string, unknown>>;
    households: Array<Record<string, unknown>>;
    members: Array<Record<string, unknown>>;
    purchases: Array<Record<string, unknown>>;
    shares: Array<Record<string, unknown>>;
    settlements: Array<Record<string, unknown> & { household_id: string; from_id: string; to_id: string; status: string; amount: number }>;
    payLinks?: Array<{ code: string; household_id: string; from_user: string; to_user: string; opened_at: string | null }>;
    paidPrompts?: Array<{ household_id: string; from_user: string; to_user: string; amount: number; status: string }>;
  };
};

async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({ ...devices["iPhone 15"], baseURL, serviceWorkers: "block", colorScheme: "dark" });
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
const hydrated = (page: Page) => page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
async function logIn(page: Page, who: { email: string; name: string }) {
  await page.goto("/login");
  await hydrated(page);
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
    const old = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    for (const [i, p] of [D, C].entries()) {
      s.db.users.push({ id: p.id, email: p.email, password: "password123" });
      s.db.profiles.push({ id: p.id, display_name: p.name, kaspi_phone: `+7703190010${i}`, avatar_color: ["me", "blue"][i], created_at: at });
      s.db.members.push({ household_id: HOUSEHOLD, user_id: p.id, role: p === C ? "admin" : "member", active: true, away_until: null, joined_at: at });
    }
    s.db.households.push({ id: HOUSEHOLD, name: "Квартира 19", invite_code: "ZX19CV24BN57", created_by: C.id, created_at: at });
    s.db.purchases.push(
      { id: P1, household_id: HOUSEHOLD, payer_id: C.id, amount: 900, description: "Ролтон", merchant: null, source: "manual", status: "shared", created_at: old },
      { id: P2, household_id: HOUSEHOLD, payer_id: D.id, amount: 300, description: "нан", merchant: null, source: "manual", status: "shared", created_at: old },
    );
    s.db.shares.push(
      { purchase_id: P1, debtor_id: C.id, amount: 450, settled_at: old, settlement_id: null },
      { purchase_id: P1, debtor_id: D.id, amount: 450, settled_at: null, settlement_id: null },
      { purchase_id: P2, debtor_id: D.id, amount: 150, settled_at: old, settlement_id: null },
      { purchase_id: P2, debtor_id: C.id, amount: 150, settled_at: null, settlement_id: null },
    );
    // Нурбол marked his 150 to Нурдаулет; Нурдаулет has not confirmed: the share is only in flight
    s.db.settlements.push({
      id: SETTLEMENT,
      household_id: HOUSEHOLD,
      from_id: C.id,
      to_id: D.id,
      amount: 150,
      status: "marked",
      marked_at: at,
      confirmed_at: null,
      kind: "transfer",
      covered: [{ purchase_id: P2, debtor_id: C.id, amount: 150 }],
    });
    const res = await request.put("/api/mock-store", { data: { version: s.version, rev: s.rev, db: s.db } });
    if (res.status() === 204) return;
  }
  throw new Error("could not inject the household");
}
const marked = async (request: APIRequestContext) => (await readStore(request)).db.settlements.filter((s) => s.household_id === HOUSEHOLD && s.status === "marked");
const links = async (request: APIRequestContext) => (await readStore(request)).db.payLinks?.filter((l) => l.household_id === HOUSEHOLD) ?? [];

test.describe.configure({ mode: "serial" });

test.describe("slice 19: перевод в пути, «Оплатить», «💸 Перевести»", () => {
  test.beforeAll(async ({ request }) => {
    await injectHousehold(request);
  });

  test("the debtor's home: «Ты должен 450» (not 300), «Оплатить» and «К оплате» → «Перевести» opens the Kaspi screen", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, D);
      const tile = page.getByTestId("bento-owed");
      await expect(tile).toContainText("Ты должен");
      await expect(page.getByTestId("bento-owe-amount")).toHaveText(`450${NBSP}₸`);
      await expect(page.getByTestId("bento-owed-caption")).toHaveText(`тебе должны 0${NBSP}₸`);
      await expect(page.getByTestId("bento-pay")).toHaveText("Оплатить");

      const section = page.getByTestId("to-pay-section");
      await expect(section.getByRole("heading", { name: "К оплате" })).toBeVisible();
      const row = section.getByTestId("to-pay-row");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(C.name);
      await expect(row).toContainText(`450${NBSP}₸ · Ролтон`);
      await expect(row.getByTestId("to-pay-go")).toHaveText("Перевести");
      await page.screenshot({ path: "gan-harness/screenshots/s19-home-debtor.png", fullPage: true });

      await row.getByTestId("to-pay-go").click();
      await expect(page).toHaveURL(new RegExp(`/settle/${C.id}$`));
      await expect(page.getByTestId("kaspi-bar")).toBeVisible();
      await page.goto("/");
      await hydrated(page);
      await page.getByTestId("bento-pay").click();
      await expect(page).toHaveURL(new RegExp(`/settle/${C.id}$`)); // one person to pay: straight to their screen
    });
  });

  test("the pair screen nets 450 without the transfer in flight; the sender sees a waiting card, never a doubled amount", async ({ browser, baseURL }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, D);
      await page.goto(`/settle/${C.id}`);
      await hydrated(page);
      await expect(page.getByTestId("equation-result")).toHaveText(`450${NBSP}₸`);
      await expect(page.getByTestId("side-owe")).toContainText("Ролтон");
      await expect(page.getByTestId("waiting")).toHaveCount(0); // D waits for nobody: C is the one who sent money
      await expect(page.getByTestId("incoming-row")).toContainText(`${C.name} отметил оплату 150${NBSP}₸`);
    });
    await withPhone(browser, baseURL, async ({ page }) => {
      await logIn(page, C);
      // the home of the creditor: 450 is owed to him, and his own pending 150 does not reduce it
      await expect(page.getByTestId("bento-owed-amount")).toHaveText(`450${NBSP}₸`);
      await expect(page.getByTestId("waiting-row")).toContainText(`${D.name}`);
      await page.goto(`/settle/${D.id}`);
      await hydrated(page);
      await expect(page.getByTestId("equation-result")).toHaveText(`450${NBSP}₸`);
      await expect(page.getByTestId("waiting")).toContainText(`Ждём подтверждения от ${decline(D.name, "gen")}`);
      await expect(page.getByTestId("waiting")).toContainText(`150${NBSP}₸`);
      await expect(page.getByRole("button", { name: "Отменить" })).toBeVisible();
      await page.screenshot({ path: "gan-harness/screenshots/s19-creditor-waiting.png" });
    });
  });

  test("the reminder builds a pay link; /k/<code> works without a login, Kaspi, back, «Да, перевёл» → «Отмечено ✓»", async ({ browser, baseURL, request }) => {
    // Нурбол reminds Нурдаулет (the app route is what «Напомнить» calls)
    const reminded = await request.post("/api/remind", {
      headers: { "x-mock-user": C.id, "content-type": "application/json" },
      data: { household_id: HOUSEHOLD, debtor_id: D.id },
    });
    expect(reminded.status()).toBe(200);
    const [link] = await links(request);
    expect(link).toMatchObject({ from_user: D.id, to_user: C.id, opened_at: null });
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{12}$/);

    await withPhone(browser, baseURL, async ({ page, context }) => {
      await context.route("https://kaspi.kz/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>kaspi</title>" }));
      // not signed in at all: the page is public and has no app shell
      const res = await page.goto(`/k/${link.code}`);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`/k/${link.code}$`));
      await hydrated(page);
      await expect(page.getByTestId("pay-to")).toHaveText(decline(C.name, "dat"));
      await expect(page.getByTestId("pay-amount")).toHaveText(`450${NBSP}₸`);
      await expect(page.getByTestId("kaspi-bar")).toContainText("+7 7•• ••• 01");
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByTestId("paid-sheet")).toHaveCount(0);
      // a plain view recorded nothing
      expect((await readStore(request)).db.paidPrompts?.filter((p) => p.household_id === HOUSEHOLD) ?? []).toEqual([]);
      await page.screenshot({ path: "gan-harness/screenshots/s19-k-page.png" });

      // the button: Kaspi opens (the stub), the prompt is recorded
      const opened = page.waitForResponse((r) => r.url().includes(`/api/k/${link.code}/open`) && r.request().method() === "POST");
      const toKaspi = page.waitForURL("https://kaspi.kz/transfers");
      await page.getByTestId("pay-go").click();
      await toKaspi;
      expect((await opened).status()).toBe(200);
      expect((await readStore(request)).db.paidPrompts?.filter((p) => p.household_id === HOUSEHOLD)).toMatchObject([
        { from_user: D.id, to_user: C.id, amount: 450, status: "pending" },
      ]);
      expect((await links(request))[0].opened_at).not.toBeNull();

      // back from Kaspi: the sheet asks
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/k/${link.code}$`));
      await hydrated(page);
      const sheet = page.getByTestId("paid-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("heading")).toHaveText(`Ты оплатил ${decline(C.name, "dat")} 450${NBSP}₸?`);
      await expect(sheet).toContainText("Ты перешёл в Kaspi");
      await page.waitForTimeout(900); // let the sheet / notice finish animating
      await page.screenshot({ path: "gan-harness/screenshots/s19-k-sheet.png" });

      // «Ещё нет» closes it; coming back asks again until it is answered
      await page.getByTestId("paid-no").click();
      await expect(sheet).toHaveCount(0);
      expect(await marked(request)).toHaveLength(1); // only the C -> D transfer of the fixture
      await returnFromKaspi(page);
      await expect(sheet).toHaveCount(0); // answered «no»: the link does not nag

      // go again and say yes
      const toKaspi2 = page.waitForURL("https://kaspi.kz/transfers");
      await page.getByTestId("pay-go").click();
      await toKaspi2;
      await page.goBack();
      await hydrated(page);
      await expect(sheet).toBeVisible();
      await page.getByTestId("paid-yes").click();
      await expect(page.getByTestId("pay-notice")).toHaveText(`Отмечено ✓ — ${C.name} подтвердит`);
      await expect(page.getByTestId("pay-go")).toHaveCount(0);
      await page.waitForTimeout(900); // let the sheet / notice finish animating
      await page.screenshot({ path: "gan-harness/screenshots/s19-k-marked.png" });
      const open = await marked(request);
      expect(open).toHaveLength(2);
      expect(open.find((s) => s.from_id === D.id)).toMatchObject({ to_id: C.id, amount: 450 });

      // the same link now reads «paid»
      await page.reload();
      await expect(page.getByTestId("pay-notice")).toContainText("Уже оплачено");
    });
  });

  test("an unknown or malformed link is «Ссылка устарела», never a login redirect; the answer route refuses a foreign prompt", async ({ browser, baseURL, request }) => {
    await withPhone(browser, baseURL, async ({ page }) => {
      await page.goto("/k/ZZZZZZZZZZZZ");
      await expect(page).toHaveURL(/\/k\/ZZZZZZZZZZZZ$/);
      await expect(page.getByTestId("pay-notice")).toContainText("Ссылка устарела");
      await page.goto("/k/bad");
      await expect(page.getByTestId("pay-notice")).toContainText("Ссылка устарела");
      await expect(page.getByTestId("pay-open-app")).toHaveText("Открыть Общак");
    });
    const [link] = await links(request);
    const bad = await request.post(`/api/k/${link.code}/answer`, { data: { prompt_id: "00000000-0000-4000-8000-000000000999", yes: true } });
    expect(bad.status()).toBe(403);
    const wrongShape = await request.post(`/api/k/${link.code}/answer`, { data: { prompt_id: "x", yes: true, extra: 1 } });
    expect(wrongShape.status()).toBe(400);
    const unknown = await request.post(`/api/k/NOPENOPENOPE/open`);
    expect(unknown.status()).toBe(404);
  });
});
