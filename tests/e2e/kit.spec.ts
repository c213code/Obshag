import { expect, test, type Locator, type Page } from "@playwright/test";

const NBSP = " ";
const LIME = "rgb(200, 242, 90)";
const CARD_2 = "rgb(44, 47, 55)";

async function openKit(page: Page) {
  await page.goto("/kit");
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

const css = (loc: Locator, prop: string) => loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe("/kit gallery", () => {
  test("loads with no console errors and with Russian-only section titles", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openKit(page);
    await expect(page.getByRole("heading", { name: "UI-кит" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    const titles = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(titles.filter((t) => /[A-Za-z]{3,}/.test(t))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("security headers are sent", async ({ page }) => {
    const res = await page.goto("/kit");
    const h = res!.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
  });

  test("tapping the Покупки tab actually moves the active pill", async ({ page }) => {
    await openKit(page);
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    const pill = nav.locator("[aria-current='page'] > span[aria-hidden='true']");
    const before = await pill.boundingBox();
    await nav.getByRole("button", { name: "Покупки" }).tap();
    await expect(nav.getByRole("button", { name: "Покупки" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("button", { name: "Главная" })).not.toHaveAttribute("aria-current", "page");
    await expect.poll(async () => (await pill.boundingBox())?.x ?? 0).toBeGreaterThan((before?.x ?? 0) + 20);
  });

  test.describe("Fab menu matches the approved reference", () => {
    test("has lime icons, a highlighted first row and a lime «Закрыть» pill", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Добавить" }).tap();
      const menu = page.getByRole("menu");
      const purchase = menu.getByRole("menuitem", { name: "Покупка" });
      const monthly = menu.getByRole("menuitem", { name: "Ежемесячный платёж" });
      const close = menu.getByRole("button", { name: "Закрыть" });
      await expect(purchase).toBeVisible();
      await expect(monthly).toBeVisible();
      await expect(close).toBeVisible();
      await expect.poll(() => css(menu, "opacity")).toBe("1");
      // first row highlighted, second transparent
      expect(await css(purchase, "background-color")).toBe(CARD_2);
      expect(await css(monthly, "background-color")).toBe("rgba(0, 0, 0, 0)");
      // lime icons on both rows
      for (const row of [purchase, monthly]) {
        expect(await row.locator("svg").count()).toBe(1);
        expect(await css(row.locator("svg"), "color")).toBe(LIME);
      }
      // lime pill, 600 weight
      expect(await css(close, "background-color")).toBe(LIME);
      expect(await css(close, "font-weight")).toBe("600");
      // container: radius 28, width 220
      expect(await css(menu, "border-top-left-radius")).toBe("28px");
      await expect.poll(async () => Math.round((await menu.boundingBox())?.width ?? 0)).toBe(220);
    });

    test("the + button never rotates: it scales and fades while the menu opens", async ({ page }) => {
      await openKit(page);
      const fab = page.getByRole("button", { name: "Добавить" });
      await fab.tap();
      await expect.poll(() => css(fab, "opacity")).toBe("0");
      const m = (await css(fab, "transform")).match(/matrix\(([^)]+)\)/);
      const [a, b] = m![1].split(",").map(Number);
      expect(b).toBeCloseTo(0, 5); // no rotation component
      expect(a).toBeCloseTo(0.6, 1);
    });

    test("focuses the first item, supports arrows, Esc closes and returns focus to the +", async ({ page }) => {
      await openKit(page);
      const fab = page.getByRole("button", { name: "Добавить" });
      await fab.tap();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "Покупка" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Ежемесячный платёж" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("button", { name: "Закрыть" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Покупка" })).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(menu.getByRole("button", { name: "Закрыть" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(fab).toBeFocused();
      await expect.poll(() => css(menu, "opacity")).toBe("0");
    });

    test("selecting an item reports the action and closes the menu", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Добавить" }).tap();
      await page.getByRole("menuitem", { name: "Ежемесячный платёж" }).tap();
      await expect(page.getByTestId("last-action")).toHaveText("Ежемесячный платёж");
      await expect.poll(() => css(page.getByRole("menu"), "opacity")).toBe("0");
    });

    test("«Закрыть» closes it and the + can be reopened immediately", async ({ page }) => {
      await openKit(page);
      const fab = page.getByRole("button", { name: "Добавить" });
      await fab.tap();
      await page.getByRole("menu").getByRole("button", { name: "Закрыть" }).tap();
      await expect.poll(() => css(fab, "opacity")).toBe("1");
      await fab.tap();
      await expect(page.getByRole("menuitem", { name: "Покупка" })).toBeFocused();
    });
  });

  test("tapping a CardStack card changes the front card, and a double tap advances once", async ({ page }) => {
    await openKit(page);
    const stack = page.getByTestId("card-stack");
    await expect(stack).toHaveAttribute("data-front", "Квартира 42");
    await stack.scrollIntoViewIfNeeded();
    const box = (await stack.getByTestId("balance-card-front").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // two raw taps back to back, without Playwright waiting for the animation in between
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(stack).toHaveAttribute("data-front", "Дача");
    await page.waitForTimeout(1000);
    await expect(stack).toHaveAttribute("data-front", "Дача");
    // and once the lock is over, it advances again
    await stack.getByTestId("balance-card-front").tap();
    await expect(stack).toHaveAttribute("data-front", "Поездка");
  });

  test("Money demo ends at exactly 200 ₸", async ({ page }) => {
    await openKit(page);
    await page.getByRole("button", { name: "Пересчитать" }).tap();
    await expect(page.getByTestId("money-demo")).toHaveText(`200${NBSP}₸`, { timeout: 5000 });
  });

  test("Netting: two debts collapse into one 200 ₸ transfer", async ({ page }) => {
    await openKit(page);
    await expect(page.getByTestId("netting-total")).toHaveText(`2${NBSP}000${NBSP}₸`);
    await page.getByRole("button", { name: "Посчитать" }).tap();
    await expect(page.getByTestId("netting-total")).toHaveText(`200${NBSP}₸`, { timeout: 5000 });
    await expect(page.getByText("Один перевод вместо двух", { exact: true }).first()).toBeVisible();
  });

  test("«Получил» fills the progress and swaps the button for a check", async ({ page }) => {
    await openKit(page);
    const progress = page.getByTestId("received-progress");
    await expect(progress).toHaveText("2 из 3");
    await page.getByRole("button", { name: "Получил", exact: true }).first().tap();
    await expect(progress).toHaveText("все скинули");
    await expect.poll(() => css(progress, "color")).toBe(LIME);
    await page.getByRole("button", { name: "Сначала" }).tap();
    await expect(progress).toHaveText("2 из 3");
  });

  test.describe("Sheet", () => {
    test("grows into a card, closes on Esc and restores focus to the trigger", async ({ page }) => {
      await openKit(page);
      const trigger = page.getByRole("button", { name: "Оплатить Apple Pay" });
      await trigger.focus(); // WebKit does not focus buttons on tap; focus via keyboard like a keyboard user
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Новая покупка" });
      await expect(dialog.getByText("Magnum")).toBeVisible();
      await expect(dialog.getByRole("button", { name: /Общее/ })).toBeFocused();
      // the page behind is held by the fixed overlay (no body overflow toggle): it takes the touches
      expect(await dialog.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).touchAction)).toBe("none");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0, { timeout: 3000 });
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    });

    test("closes on a backdrop tap", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Оплатить Apple Pay" }).tap();
      const dialog = page.getByRole("dialog", { name: "Новая покупка" });
      await expect(dialog.getByText("Magnum")).toBeVisible();
      await page.getByTestId("sheet-backdrop").tap({ position: { x: 20, y: 600 } });
      await expect(dialog).toHaveCount(0, { timeout: 3000 });
    });

    test("«Общее» collapses to a pill with ✓ «Поделено»", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Оплатить Apple Pay" }).tap();
      await page.getByRole("button", { name: /Общее/ }).tap();
      await expect(page.getByRole("dialog").getByText("Поделено")).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 4000 });
    });

    test("traps Tab inside the dialog", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Оплатить Apple Pay" }).tap();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: /Общее/ })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Моё" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: /Общее/ })).toBeFocused();
    });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the Fab menu fades without scaling", async ({ page }) => {
      await openKit(page);
      const menu = page.getByRole("menu");
      expect(await css(menu, "transform")).toBe("none");
      await page.getByRole("button", { name: "Добавить" }).tap();
      await expect.poll(() => css(menu, "opacity")).toBe("1");
      expect(await css(menu, "transform")).toBe("none");
      await expect(menu.getByRole("menuitem", { name: "Покупка" })).toBeVisible();
    });

    test("the Sheet fades in without a pill phase", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Оплатить Apple Pay" }).tap();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Magnum")).toBeVisible();
      expect(await css(dialog, "transform")).toBe("none");
    });
  });
});
