// App screenshots for slice 4 (needs the E2E build served on :3100) and side-by-side comparisons with the reference.
import { devices, webkit } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const base = "http://localhost:3100";
const dir = resolve("gan-harness/screenshots");
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"], baseURL: base });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });

await page.goto("/login");
await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
await page.getByLabel("Почта").fill("erasyl@obshak.test");
await page.getByLabel("Пароль", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Войти", exact: true }).click();
await page.getByText("Привет, Ерасыл").waitFor();

// key via the UI, capture via the endpoint
await page.goto("/settings/shortcut");
await page.getByRole("button", { name: "Создать ключ" }).click();
const token = (await page.getByTestId("capture-token").innerText()).trim();
const res = await page.request.post("/api/capture", { data: { token, amount: "6 000,00 ₸", merchant: "Magnum" } });
console.log("capture", res.status());

await page.goto("/");
await page.getByTestId("pending-row").waitFor();
await page.waitForTimeout(1500);
await shot("s4f-app-main");
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByTestId("pending-row").click();
await page.getByRole("dialog").waitFor();
await shot("s4f-app-island-0-pill");
await page.waitForTimeout(150);
await shot("s4f-app-island-1-growing");
await page.waitForTimeout(1200);
await shot("s4f-app-island-2-open");
await page.getByTestId("pending-shared").click();
await page.waitForTimeout(450);
await shot("s4f-app-island-3-collapsing");
await page.waitForTimeout(700);
await shot("s4f-app-island-4-done");
await browser.close();

const img = (f) => pathToFileURL(resolve(dir, f)).href;
const cells = [
  ["s4-ref-island-0-pill.png", "s4f-app-island-0-pill.png"],
  ["s4-ref-island-2-open.png", "s4f-app-island-2-open.png"],
  ["s4-ref-island-4-done.png", "s4f-app-island-4-done.png"],
];
const b2 = await webkit.launch();
const p = await b2.newPage({ viewport: { width: 1240, height: 560 }, deviceScaleFactor: 2 });
const col = (f, label) => `<figure style="margin:0;color:#fff;font:12px sans-serif"><div style="height:24px">${label}</div><img src="${img(f)}" style="height:420px;max-width:290px;object-fit:contain;object-position:top;background:#000"></figure>`;
writeFileSync(
  resolve(dir, "_cmp.html"),
  `<body style="margin:0;background:#444;display:grid;grid-template-columns:repeat(3,1fr);gap:20px 20px;padding:16px">${cells
    .map(([l, r]) => col(l, "reference") + col(r, "app"))
    .join("")}</body>`,
);
await p.goto(pathToFileURL(resolve(dir, "_cmp.html")).href);
await p.waitForTimeout(300);
await p.screenshot({ path: resolve(dir, "s4f-cmp-island.png") });
await b2.close();
