#!/usr/bin/env node
// Validates data/recipes/cooklang/*.cook against the conventions in README.md.
// Usage: node data/recipes/check-cooklang.mjs            (exit 1 on any problem)
// It is deliberately dependency-free (no YAML lib): the front matter here is simple enough to parse by hand,
// and the real parser lands in packages/core in M1.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "cooklang");
const CUISINES = new Set("american british canadian caribbean chinese french greek indian italian japanese korean mediterranean mexican middle-eastern nordic spanish thai vietnamese other".split(" "));
const PROTEINS = new Set("beef pork chicken turkey lamb fish seafood eggs tofu legumes dairy none".split(" "));
const REQUIRED = ["title", "servings", "cuisine", "main_protein", "prep_time", "cook_time", "tags"];
const OPTIONAL = ["source", "image", "leftover_portions", "prep"];

let problems = 0;
const say = (f, msg) => { problems++; console.log(`${f}: ${msg}`); };

function parseFrontMatter(text, f) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { say(f, "no front matter block"); return null; }
  const fm = {}; let key = null;
  for (const raw of m[1].split("\n")) {
    if (!raw.trim()) continue;
    const list = raw.match(/^\s+-\s+(.*)$/);
    if (list && key) { (fm[key] ||= []).push(list[1].replace(/^"(.*)"$/, "$1")); continue; }
    const kv = raw.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) { say(f, `unparseable front matter line: ${raw}`); continue; }
    key = kv[1];
    const v = kv[2].trim();
    if (v === "" || v === "[]") fm[key] = v === "[]" ? [] : [];
    else if (v.startsWith("[")) fm[key] = v.slice(1, -1).split(",").map(s => s.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    else fm[key] = v.replace(/^"(.*)"$/, "$1");
  }
  return { fm, body: m[2] };
}

const files = readdirSync(dir).filter(f => f.endsWith(".cook")).sort();
if (files.length === 0) { console.log("no .cook files"); process.exit(1); }

for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  const parsed = parseFrontMatter(text, f);
  if (!parsed) continue;
  const { fm, body } = parsed;
  for (const k of REQUIRED) if (!(k in fm)) say(f, `missing ${k}`);
  for (const k of Object.keys(fm)) if (!REQUIRED.includes(k) && !OPTIONAL.includes(k)) say(f, `unknown key ${k}`);
  if (fm.servings && !/^\d+$/.test(fm.servings)) say(f, `servings not an integer: ${fm.servings}`);
  if (fm.cuisine && !CUISINES.has(fm.cuisine)) say(f, `cuisine not in taxonomy: ${fm.cuisine}`);
  if (fm.main_protein && !PROTEINS.has(fm.main_protein)) say(f, `main_protein not in taxonomy: ${fm.main_protein}`);
  for (const k of ["prep_time", "cook_time"]) if (fm[k] && !/^\d+ (minutes?|hours?)$/.test(fm[k])) say(f, `${k} not "N minutes": ${fm[k]}`);
  if (!Array.isArray(fm.tags) || fm.tags.length === 0) say(f, "tags empty");
  else if (fm.tags.includes("recipe")) say(f, "tags contain 'recipe'");
  if (fm.leftover_portions && !/^\d+$/.test(fm.leftover_portions)) say(f, `leftover_portions not an integer`);
  if (fm.image) {
    const p = resolve(dir, fm.image);
    if (!existsSync(p)) say(f, `image not found: ${fm.image}`);
  }
  if (fm.source && !/^https?:\/\//.test(fm.source)) say(f, `source is not a URL: ${fm.source}`);
  if (!/^[a-z0-9-]+\.cook$/.test(f)) say(f, "filename not kebab-case");

  // body checks
  const ingredients = [...body.matchAll(/@([^@#~{}\n]+?)\{([^}]*)\}/g)];
  if (ingredients.length === 0) say(f, "no @ingredient tokens in body");
  const bareAt = body.replace(/@[^@#~{}\n]+?\{[^}]*\}/g, "").match(/@\w+/g);
  if (bareAt) say(f, `possible unbraced ingredient tokens: ${bareAt.slice(0, 3).join(", ")}`);
  const open = (body.match(/\{/g) || []).length, close = (body.match(/\}/g) || []).length;
  if (open !== close) say(f, `unbalanced braces (${open} vs ${close})`);
  for (const [, , qty] of ingredients) {
    if (qty && !/^[\d.]+(%[^%]+)?$/.test(qty) && !/^[^%]+%[^%]+$/.test(qty)) say(f, `odd quantity "{${qty}}"`);
    if (/[½¼¾⅓⅔⅛]/.test(qty)) say(f, `unicode fraction in quantity {${qty}}`);
  }
  if (!/~\{[^}]+\}/.test(body)) console.log(`${f}: note: no timers`);
  console.log(`${f}: ok · ${fm.servings} servings · ${fm.cuisine}/${fm.main_protein} · ${ingredients.length} ingredients`);
}

console.log(problems ? `\n${problems} problem(s)` : `\nall ${files.length} files pass`);
process.exit(problems ? 1 : 0);
