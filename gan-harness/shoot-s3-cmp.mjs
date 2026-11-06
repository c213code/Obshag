// Side-by-side comparisons (left = docs/design reference, right = the app) for slice 3.
import { webkit } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = resolve("gan-harness/screenshots");
const img = (f) => pathToFileURL(resolve(dir, f)).href;
const pairs = [
  ["s3-cmp-pay.png", "s3-ref-pay.png", "s3-app-pay-3-copied.png", 844],
  ["s3-cmp-netting.png", "s3-ref-netting-1.png", "s3-app-pay-1-mid.png", 700],
  ["s3-cmp-poluchil.png", "s3-ref-poluchil-1.png", "s3-app-poluchil-1-mid.png", 700],
  ["s3-cmp-waiting.png", "s3-ref-pay.png", "s3-app-pay-4-waiting.png", 844],
];
const browser = await webkit.launch();
for (const [out, left, right, h] of pairs) {
  const page = await browser.newPage({ viewport: { width: 860, height: h + 40 }, deviceScaleFactor: 2 });
  const html = `<body style="margin:0;background:#444;display:flex;gap:20px;padding:20px;align-items:flex-start">
    <img src="${img(left)}" style="height:${h}px;max-width:410px;object-fit:contain;object-position:top;background:#000">
    <img src="${img(right)}" style="height:${h}px;max-width:410px;object-fit:contain;object-position:top;background:#000"></body>`;
  const file = resolve(dir, "_cmp.html");
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(dir, out) });
  await page.close();
}
await browser.close();
