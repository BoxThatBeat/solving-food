#!/usr/bin/env node
// Serves the Claude Design prototype (claude-design-result/) on http://127.0.0.1:8787 with generated variants
// for every device mode and flavour, so the Playwright CLI can screenshot the reference at any size.
//
//   node scripts/design-serve.mjs            # foreground; Ctrl-C to stop
//   node scripts/design-serve.mjs --daemon   # background; prints the pid; stop with --stop
//   node scripts/design-serve.mjs --stop
//
// URLs (all serve the same prototype with different data-props defaults):
//   /                                   Phone, Latte, Classic (the file as shipped)
//   /v/<device>/<flavour>/<look>.html   e.g. /v/desktop/latte/classic.html, /v/4k/mocha/loud.html
//   devices: phone | tablet | desktop | 4k | fill      flavours: latte | frappe | macchiato | mocha
//   looks:   quiet | classic | loud
// "fill" makes the prototype fill the window, so combine it with `scripts/pw resize W H` for any viewport.
// The prototype's page (plan/recipes/...) is UI state: click the bottom nav or side nav after loading.

import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-design-result");
const htmlPath = join(root, "Solving Food.dc.html");
const PORT = 8787;
const pidFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".playwright-cli", "design-serve.pid");

const DEVICES = { phone: "Phone", tablet: "Tablet", desktop: "Desktop 1080p", "4k": "4K", fill: "Fill window" };
const FLAVOURS = { latte: "Latte", frappe: "Frappe", macchiato: "Macchiato", mocha: "Mocha" };
const LOOKS = { quiet: "Quiet", classic: "Classic", loud: "Loud" };

const arg = process.argv[2];
if (arg === "--stop") {
  if (existsSync(pidFile)) {
    try { process.kill(Number(readFileSync(pidFile, "utf8"))); } catch {}
    unlinkSync(pidFile);
    console.log("design-serve stopped");
  } else console.log("design-serve not running");
  process.exit(0);
}
if (arg === "--daemon") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: "ignore" });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`design-serve pid ${child.pid} on http://127.0.0.1:${PORT}/`);
  process.exit(0);
}

const base = readFileSync(htmlPath, "utf8");
const esc = (s) => s.replace(/"/g, "&quot;");

// Rewrite the `"default":"X"` inside a named data-props entry. The attribute is HTML-escaped JSON.
function withDefault(html, key, value) {
  const re = new RegExp(`(&quot;${key}&quot;:\\{[^}]*?&quot;default&quot;:)&quot;[^&]*&quot;`);
  if (!re.test(html)) throw new Error(`data-props key not found: ${key}`);
  return html.replace(re, `$1${esc(JSON.stringify(value))}`);
}

function variant(device, flavour, look) {
  let html = base;
  html = withDefault(html, "device", DEVICES[device]);
  html = withDefault(html, "flavour", FLAVOURS[flavour]);
  html = withDefault(html, "look", LOOKS[look]);
  return html;
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const m = url.match(/^\/v\/(phone|tablet|desktop|4k|fill)\/(latte|frappe|macchiato|mocha)\/(quiet|classic|loud)\.html$/);
  try {
    if (url === "/" || url === "/Solving Food.dc.html" || url === "/index.html") {
      res.writeHead(200, { "content-type": types[".html"] }).end(base);
    } else if (m) {
      res.writeHead(200, { "content-type": types[".html"] }).end(variant(m[1], m[2], m[3]));
    } else {
      // support.js and anything else next to the prototype, also for /v/... relative references
      const file = join(root, url.split("/").pop());
      if (!existsSync(file)) return res.writeHead(404).end("not found");
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => {
  if (process.stdout.isTTY) console.log(`design prototype on http://127.0.0.1:${PORT}/  (variants: /v/<device>/<flavour>/<look>.html)`);
});
