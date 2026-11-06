// Captures Главная and Новая покупка from the E2E production server (port 3100, seeded mock data) at 390x844 @2x.
import { webkit, devices } from "@playwright/test";

const out = "gan-harness/screenshots";
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto("http://localhost:3100/login");
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByRole("button", { name: "Получить код" }).click();
await page.getByLabel("Код из письма").fill("000000");
await page.getByText("Привет, Ерасыл").waitFor();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/s1i2-app-main.png` });

// single household, empty: join with a fresh user would differ; capture the disabled states instead
await page.getByRole("link", { name: "Покупка", exact: true }).click();
await page.getByLabel("Сумма").fill("2400");
await page.getByLabel("Что купили").fill("Хлеб, картошка, лук");
await page.getByRole("button", { name: "Нурик", pressed: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/s1i2-app-addpurchase.png` });
await browser.close();
