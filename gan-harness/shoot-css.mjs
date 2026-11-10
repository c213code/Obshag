// Before/after screenshots for the CSS motion pass (mock mode). Usage: node gan-harness/shoot-css.mjs <baseUrl> <before|after>
import { devices, webkit } from "@playwright/test";
import { resolve } from "node:path";

const [base, label] = [process.argv[2] ?? "http://localhost:3111", process.argv[3] ?? "after"];
const dir = resolve("gan-harness/screenshots");
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"], baseURL: base, serviceWorkers: "block" });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${dir}/css-${label}-${n}.png` });
await page.goto("/login");
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByLabel("Пароль", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Войти", exact: true }).click();
await page.getByText("Привет, Ерасыл").waitFor();
await page.waitForTimeout(2500);
await shot("home");
// Fab menu: mid frame then final
await page.getByRole("button", { name: "Добавить", exact: true }).tap();
await page.waitForTimeout(150);
await shot("fab-mid");
await page.waitForTimeout(1200);
await shot("fab-open");
await page.getByRole("button", { name: "Закрыть" }).tap();
await page.waitForTimeout(1200);
// tab switch mid frame
await page.getByRole("link", { name: "Покупки" }).tap();
await page.waitForTimeout(120);
await shot("tab-mid");
await page.getByTestId("purchase-list-row").first().waitFor();
await page.waitForTimeout(2500);
await shot("purchases");
// island sheet on the kit page
await page.goto("/kit");
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByRole("button", { name: "Оплатить Apple Pay" }).tap();
await page.waitForTimeout(150);
await shot("sheet-mid");
await page.waitForTimeout(1500);
await shot("sheet-open");
await browser.close();
