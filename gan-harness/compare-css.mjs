import { webkit } from "@playwright/test";
import { readFileSync } from "node:fs";
const dir = "/Users/yerasyltoleubek/Change me after/gan-harness/screenshots/";
const b = await webkit.launch(); const p = await b.newPage();
for (const n of ["home","fab-mid","fab-open","tab-mid","purchases","sheet-mid","sheet-open"]) {
  const a = readFileSync(`${dir}css-before-${n}.png`).toString("base64"), c = readFileSync(`${dir}css-after-${n}.png`).toString("base64");
  const r = await p.evaluate(async ([a, c]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + s; });
    const [x, y] = [await load(a), await load(c)];
    if (x.width !== y.width || x.height !== y.height) return `size differs ${x.width}x${x.height} vs ${y.width}x${y.height}`;
    const d = (i) => { const cv = document.createElement("canvas"); cv.width = i.width; cv.height = i.height; const g = cv.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const A = d(x), B = d(y); let diff = 0, max = 0, minY = 1e9, maxY = -1;
    for (let k = 0; k < A.length; k += 4) { const m = Math.max(Math.abs(A[k]-B[k]), Math.abs(A[k+1]-B[k+1]), Math.abs(A[k+2]-B[k+2])); if (m > 8) { diff++; const yy = Math.floor(k/4/x.width); minY=Math.min(minY,yy); maxY=Math.max(maxY,yy);} max = Math.max(max, m); }
    return `${x.width}x${x.height} pixels differing(>8): ${diff} (${(100*diff/(A.length/4)).toFixed(3)}%), max channel delta ${max}, rows ${minY}-${maxY}`;
  }, [a, c]);
  console.log(n, r);
}
await b.close();
