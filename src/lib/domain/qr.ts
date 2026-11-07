import QRCode from "qrcode";

/** A QR code as one SVG path (`d`, one 1x1 square per dark module) plus its side length in modules. */
export function qrPath(text: string): { size: number; d: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let d = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!modules.get(x, y)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && modules.get(x + run, y)) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size, d };
}
