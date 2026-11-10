// Before/after screenshots for the perf pass (mock mode). Usage: node gan-harness/shoot-perf.mjs <baseUrl> <before|after>
import { devices, webkit } from "@playwright/test";
import { resolve } from "node:path";

const [base, label] = [process.argv[2] ?? "http://localhost:3100", process.argv[3] ?? "after"];
const dir = resolve("gan-harness/screenshots");
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"], baseURL: base, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto("/login");
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByLabel("Пароль", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Войти", exact: true }).click();
await page.getByText("Привет, Ерасыл").waitFor();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/perf-${label}-home.png` });
await page.screenshot({ path: `${dir}/perf-${label}-home-full.png`, fullPage: true });
await page.goto("/purchases");
await page.getByTestId("purchase-list-row").first().waitFor();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/perf-${label}-purchases.png` });
await browser.close();
