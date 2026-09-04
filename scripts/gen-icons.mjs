import { chromium } from "playwright";
import fs from "node:fs";

const TEAL = "#14b8a6";

/**
 * A plain teal circle. `square` fills the tile edge to edge; `maskable` keeps
 * the circle inside the 80% safe zone so Android can crop to any shape without
 * clipping it.
 */
const svg = (size, kind) => {
  const r = kind === "maskable" ? 12.4 : 15.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="${r}" fill="${TEAL}"/>
  </svg>`;
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const targets = [
  ["public/icon-192.png", 192, "square"],
  ["public/icon-512.png", 512, "square"],
  ["public/icon-maskable-512.png", 512, "maskable"],
  // iOS applies its own rounded mask, so the tile must be opaque edge to edge.
  ["app/apple-icon.png", 180, "apple"],
];

for (const [out, size, kind] of targets) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const body =
    kind === "apple"
      ? `<body style="margin:0;width:${size}px;height:${size}px;background:${TEAL}"></body>`
      : `<body style="margin:0;width:${size}px;height:${size}px">${svg(size, kind)}</body>`;
  await page.setContent(body);
  const buf = await page.screenshot({ omitBackground: kind !== "apple" });
  fs.mkdirSync(out.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(`/home/user/super-reader/${out}`, buf);
  console.log(out, size, kind, buf.length, "bytes");
  await page.close();
}
await b.close();
