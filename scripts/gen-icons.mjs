import { chromium } from "playwright";
import fs from "node:fs";

// The lens mark, drawn at whatever size we need.
const mark = (pad) => `
  <path d="M4.6 16C7.2 11.4 11.3 9.1 16 9.1S24.8 11.4 27.4 16C24.8 20.6 20.7 22.9 16 22.9S7.2 20.6 4.6 16Z"
        fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="3.5" fill="#2563eb"/>`;

// square: full-bleed tile with rounded corners (Android/desktop, apple-touch)
// maskable: same mark inside the 80% safe zone, edge-to-edge background,
//           so Android can crop it to a circle or squircle without clipping.
const svg = (size, kind) => {
  // apple: iOS applies its own rounded mask, so ship a full-bleed square —
  // baked-in transparent corners render as black on the Home Screen.
  const scale = kind === "maskable" ? 0.62 : kind === "apple" ? 0.74 : 0.86;
  const offset = (32 - 32 * scale) / 2;
  const radius = kind === "square" ? 7 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="${radius}" fill="#111318"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">${mark()}</g>
  </svg>`;
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const targets = [
  ["public/icon-192.png", 192, "square"],
  ["public/icon-512.png", 512, "square"],
  ["public/icon-maskable-512.png", 512, "maskable"],
  ["app/apple-icon.png", 180, "apple"],
];

for (const [out, size, kind] of targets) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px">${svg(size, kind)}</body>`,
  );
  const buf = await page.screenshot({ omitBackground: true });
  fs.mkdirSync(out.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(`/home/user/super-reader/${out}`, buf);
  console.log(out, size, kind, buf.length, "bytes");
  await page.close();
}
await b.close();
