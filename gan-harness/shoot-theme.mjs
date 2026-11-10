// Light/dark screenshots of the main screens (mock mode). Usage: node gan-harness/shoot-theme.mjs <baseUrl>
import { devices, webkit } from "@playwright/test";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:3102";
const dir = resolve("gan-harness/screenshots");
const browser = await webkit.launch();

async function session(scheme) {
  const ctx = await browser.newContext({ ...devices["iPhone 15"], baseURL: base, serviceWorkers: "block", colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  await page.getByLabel("Почта").fill("erasyl@obshak.test");
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("link", { name: /^Профиль и квартира/ }).waitFor();
  return { ctx, page };
}

async function buy(page, amount, what) {
  await page.getByRole("link", { name: "Покупка", exact: true }).click().catch(async () => {
    await page.goto("/purchases/new");
  });
  await page.getByLabel("Сумма").fill(String(amount));
  await page.getByLabel("Что купили").fill(what);
  await page.getByRole("button", { name: "Поделить" }).click();
  await page.waitForURL(/\/$/);
}

// seed some data once (light session), the store is shared
{
  const { ctx, page } = await session("light");
  for (const [a, w] of [[1200, "Хлеб"], [3400, "Овощи"], [900, "Вода"], [8600, "Magnum"], [1800, "Молоко"]]) {
    await page.goto("/purchases/new");
    await page.getByLabel("Сумма").fill(String(a));
    await page.getByLabel("Что купили").fill(w);
    await page.getByRole("button", { name: "Поделить" }).click();
    await page.waitForURL(/\/$/);
  }
  await page.goto("/monthly/new");
  await page.getByLabel("Название").fill("Аренда");
  await page.getByLabel("Сумма в месяц").fill("240000");
  await page.getByLabel(/Число месяца/).fill("5");
  await page.getByRole("button", { name: /Сохранить|Добавить|Создать|Готово/ }).click();
  await page.waitForTimeout(1500);
  await ctx.close();
}

for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await session(scheme);
  const shot = async (name) => {
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${dir}/theme-${scheme}-${name}.png` });
  };
  await page.goto("/");
  await page.getByTestId("bento-owed").waitFor();
  await shot("home");
  await page.screenshot({ path: `${dir}/theme-${scheme}-home-full.png`, fullPage: true });
  await page.getByRole("button", { name: "Добавить", exact: true }).click().catch(() => {});
  await shot("fab");
  await page.keyboard.press("Escape");
  await page.goto("/purchases");
  await shot("purchases");
  await page.goto("/settle");
  await shot("settle");
  await page.goto("/monthly");
  await shot("monthly");
  await page.goto("/flat");
  await shot("flat");
  await page.goto("/kit");
  await page.getByRole("button", { name: /Apple Pay/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/theme-${scheme}-island.png` });
  await ctx.close();
}
await browser.close();
