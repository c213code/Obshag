// Reference screenshots for slice 4: ApplePay.dc.html, Main.dc.html, motion-reference #2 island (WebKit, iPhone 15 pixel ratio).
import { webkit } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const out = "gan-harness/screenshots";
const url = (f) => pathToFileURL(resolve("docs/design", f)).href;
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await page.goto(url("ApplePay.dc.html"));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s4-ref-applepay.png` });
await page.goto(url("Main.dc.html"));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s4-ref-main.png`, fullPage: true });

const wide = await browser.newContext({ viewport: { width: 390, height: 2400 }, deviceScaleFactor: 3 });
const m = await wide.newPage();
await m.goto(url("motion-reference.html"));
await m.waitForTimeout(500);
const box = m.locator("#isl").locator("xpath=ancestor::div[contains(@class,'mx')]");
await box.screenshot({ path: `${out}/s4-ref-island-0-pill.png` });
await m.click("#islgo");
await m.waitForTimeout(200);
await box.screenshot({ path: `${out}/s4-ref-island-1-growing.png` });
await m.waitForTimeout(900);
await box.screenshot({ path: `${out}/s4-ref-island-2-open.png` });
await m.click("#islok");
await m.waitForTimeout(500);
await box.screenshot({ path: `${out}/s4-ref-island-3-collapsing.png` });
await m.waitForTimeout(1000);
await box.screenshot({ path: `${out}/s4-ref-island-4-done.png` });
await browser.close();
