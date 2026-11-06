// Reference screenshots for slice 3: Pay.dc.html, Main.dc.html, motion-reference #3 and #4 (WebKit, iPhone 15 viewport).
import { webkit } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const out = "gan-harness/screenshots";
const url = (f) => pathToFileURL(resolve("docs/design", f)).href;
const browser = await webkit.launch();
// The mockups have no viewport meta, so a mobile context would shrink the 980px layout canvas: use a plain 390x844 viewport at the iPhone 15 pixel ratio.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await page.goto(url("Pay.dc.html"));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s3-ref-pay.png` });
await page.goto(url("Main.dc.html"));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s3-ref-main.png`, fullPage: true });

const wide = await browser.newContext({ viewport: { width: 390, height: 2400 }, deviceScaleFactor: 3 });
const m = await wide.newPage();
await m.goto(url("motion-reference.html"));
await m.waitForTimeout(500);
const netBox = m.locator("#netgo").locator("xpath=ancestor::div[contains(@class,'mx')]");
await netBox.screenshot({ path: `${out}/s3-ref-netting-0.png` });
await m.click("#netgo");
await m.waitForTimeout(250);
await netBox.screenshot({ path: `${out}/s3-ref-netting-1.png` });
await m.waitForTimeout(450);
await netBox.screenshot({ path: `${out}/s3-ref-netting-2.png` });
await m.waitForTimeout(1500);
await netBox.screenshot({ path: `${out}/s3-ref-netting-3.png` });
const rBox = m.locator("#okb").locator("xpath=ancestor::div[contains(@class,'mx')]");
await rBox.screenshot({ path: `${out}/s3-ref-poluchil-0.png` });
await m.click("#okb");
await m.waitForTimeout(150);
await rBox.screenshot({ path: `${out}/s3-ref-poluchil-1.png` });
await m.waitForTimeout(900);
await rBox.screenshot({ path: `${out}/s3-ref-poluchil-2.png` });
await browser.close();
