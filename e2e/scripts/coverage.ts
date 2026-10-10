// `pnpm e2e:coverage` (TECHNICAL_SPECS §14.1 "Coverage rule"). Fails when a user-facing requirement of a milestone
// whose plan says `Status: done` has no Playwright test tagged with its ID; prints coverage for the other milestones.
//
// User-facing = every `R<n>.<m>` defined in PRODUCT_REQUIREMENTS.md, plus NFR5 and NFR6.
// A milestone's IDs come from the "## Requirements covered" section of Planning/M*.md; ranges such as
// "R4.15–R4.22" are expanded. Tags are `@R4.15` / `@NFR6` anywhere in e2e/specs/**.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function definedRequirements(prd: string): Set<string> {
  const ids = new Set<string>();
  for (const m of prd.matchAll(/\*\*(R\d+\.\d+)\*\*/g)) ids.add(m[1]!);
  for (const m of prd.matchAll(/\*\*(NFR[56])\b/g)) ids.add(m[1]!);
  return ids;
}

export function planRequirements(plan: string, defined: Set<string>): string[] {
  const section = plan.split(/^## Requirements covered\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const ids = new Set<string>();
  for (const m of section.matchAll(/R(\d+)\.(\d+)\s*[–-]\s*R(\d+)\.(\d+)/g)) {
    const [maj, a, maj2, b] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    if (maj === maj2) for (let i = a; i <= b; i++) ids.add(`R${maj}.${i}`);
  }
  for (const m of section.matchAll(/\b(R\d+\.\d+|NFR\d+)\b/g)) ids.add(m[1]!);
  return [...ids].filter((id) => defined.has(id)).sort(byId);
}

function byId(a: string, b: string): number {
  const n = (s: string) => s.replace(/[A-Z]+/, "").split(".").map(Number);
  const [x, y] = [n(a), n(b)];
  return a.startsWith("NFR") !== b.startsWith("NFR") ? (a.startsWith("NFR") ? 1 : -1) : x[0]! - y[0]! || (x[1] ?? 0) - (y[1] ?? 0);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

export function taggedIds(files: string[]): Set<string> {
  const ids = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/@(R\d+\.\d+|NFR\d+)\b/g)) ids.add(m[1]!);
  return ids;
}

const defined = definedRequirements(readFileSync(join(root, "PRODUCT_REQUIREMENTS.md"), "utf8"));
const tags = taggedIds(walk(join(root, "e2e/specs")));
const planDir = join(root, "Planning");
let failed = false;

for (const file of readdirSync(planDir).filter((f) => /^M\d.*\.md$/.test(f)).sort()) {
  const text = readFileSync(join(planDir, file), "utf8");
  const status = /^Status:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "unknown";
  const ids = planRequirements(text, defined);
  const missing = ids.filter((id) => !tags.has(id));
  const done = status.toLowerCase().startsWith("done");
  const mark = done ? (missing.length ? "FAIL" : "ok") : "info";
  console.log(`${mark.padEnd(4)}  ${file.padEnd(22)} ${status.padEnd(14)} ${ids.length - missing.length}/${ids.length} tagged`);
  if (missing.length) console.log(`      missing: ${missing.join(" ")}`);
  if (done && missing.length) failed = true;
}

if (failed) {
  console.error("\nUser-facing requirements of completed milestones lack a tagged Playwright test.");
  process.exit(1);
}
