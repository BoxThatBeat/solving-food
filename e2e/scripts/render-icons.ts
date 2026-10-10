// Renders the PWA icons from the prototype's mark ("SOLVING FOOD", Archivo Black, base on ink) with Playwright's
// Chromium, using the app's self-hosted font. Output: apps/web/public/icons/*.png. Run: pnpm --filter @solving-food/e2e icons
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const web = fileURLToPath(new URL("../../apps/web/public/", import.meta.url));
const font = readFileSync(`${web}fonts/archivo-black-latin-400.woff2`).toString("base64");
const out = `${web}icons/`;
mkdirSync(out, { recursive: true });

// Latte tokens from the prototype's FLAV table; green accent.
const INK = "#4c4f69";
const BASE = "#eff1f5";
const ACC = "#a6da95";

function html(size: number, opts: { safe: number; mini?: boolean }) {
  const inner = Math.round(size * opts.safe);
  const fs = opts.mini ? inner * 0.62 : inner * 0.27;
  const text = opts.mini ? "SF" : "SOLVING<br>FOOD";
  const bar = Math.max(2, Math.round(size * 0.045));
  return `<!doctype html><html><head><style>
    @font-face { font-family: AB; src: url(data:font/woff2;base64,${font}) format("woff2"); }
    html,body { margin:0; width:${size}px; height:${size}px; }
    body { background:${INK}; display:grid; place-items:center; }
    .m { font-family: AB; color:${BASE}; font-size:${fs}px; line-height:1.0; letter-spacing:${fs * 0.02}px;
         display:inline-block; text-align:left; padding-bottom:${bar * 1.6}px; border-bottom:${bar}px solid ${ACC}; }
  </style></head><body><div class="m">${text}</div></body></html>`;
}

const targets: Array<[string, number, { safe: number; mini?: boolean }]> = [
  ["icon-192.png", 192, { safe: 0.86 }],
  ["icon-512.png", 512, { safe: 0.86 }],
  ["maskable-512.png", 512, { safe: 0.66 }], // maskable safe zone: centre 80% circle
  ["apple-touch-icon.png", 180, { safe: 0.82 }],
  ["favicon-48.png", 48, { safe: 0.9, mini: true }],
];

const browser = await chromium.launch();
for (const [name, size, opts] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size, opts));
  await page.evaluate(async (inner) => {
    await document.fonts.ready;
    // Fit the mark's width to the safe zone.
    const el = document.querySelector<HTMLElement>(".m")!;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${(fs * inner) / el.getBoundingClientRect().width}px`;
  }, Math.round(size * opts.safe));
  await page.screenshot({ path: `${out}${name}`, omitBackground: false });
  await page.close();
  console.log("wrote", name);
}
await browser.close();
