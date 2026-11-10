import { webkit } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const dir = "/Users/yerasyltoleubek/Change me after/gan-harness/screenshots/";
const names = process.argv.slice(2);
const b = await webkit.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
for (const n of names) {
  const [crop] = [n.includes("sheet") ? [0,0,1179,520] : n.includes("tab") ? [0,1500,1179,477] : [0,1000,1179,977]];
  const imgs = ["before","after"].map(l => "data:image/png;base64," + readFileSync(`${dir}css-${l}-${n}.png`).toString("base64"));
  const out = await p.evaluate(async ([imgs, crop]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [a, c] = [await load(imgs[0]), await load(imgs[1])];
    const cv = document.createElement("canvas"); cv.width = crop[2]*2+20; cv.height = crop[3];
    const g = cv.getContext("2d"); g.fillStyle="#f0f"; g.fillRect(0,0,cv.width,cv.height);
    g.drawImage(a, crop[0],crop[1],crop[2],crop[3], 0,0,crop[2],crop[3]);
    g.drawImage(c, crop[0],crop[1],crop[2],crop[3], crop[2]+20,0,crop[2],crop[3]);
    return cv.toDataURL("image/png").split(",")[1];
  }, [imgs, crop]);
  writeFileSync(`${dir}css-cmp-${n}.png`, Buffer.from(out, "base64"));
}
await b.close();
