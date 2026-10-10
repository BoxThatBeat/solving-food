// Uploads the household recipes (data/recipes/cooklang/*.cook) and the photos they reference into the drop folder,
// so the dropFolder function imports them exactly as it imports anything else (TECHNICAL_SPECS §9).
//
//   pnpm drop:recipes -- --emulator --uid <uid>          # Storage emulator (Admin SDK)
//   pnpm drop:recipes -- --email buitenwerfa@gmail.com   # live bucket via `gcloud storage cp`, as that user
//   … [--only baked-feta-pasta,greek-salad]              # a subset
//
// Photos go first (the import matches relative `image:` paths by file name in the same folder), then the .cook files.
// Then it waits until every .cook has been processed (the function deletes it) and prints what's left.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontMatter } from "../packages/core/src/cooklang/parse";
import { openStore } from "./lib/admin-store";

const root = fileURLToPath(new URL("..", import.meta.url));
const recipesDir = join(root, "data/recipes/cooklang");
const BUCKET = "solvingfood.firebasestorage.app";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const emulator = args.includes("--emulator");
const only = arg("--only")?.split(",").map((s) => s.trim().replace(/\.cook$/, ""));

let uid = arg("--uid");
const email = arg("--email");
if (!uid && email) {
  const store = openStore(emulator);
  const users = await store.queryEq("users", "email", email.toLowerCase());
  if (users.length !== 1) throw new Error(`Expected one users/* doc with email ${email}, found ${users.length}. Sign in to the app once first.`);
  uid = users[0]!.id;
}
if (!uid) throw new Error("Pass --uid <uid> or --email <address>");

const files = readdirSync(recipesDir)
  .filter((f) => f.endsWith(".cook"))
  .filter((f) => !only || only.includes(f.replace(/\.cook$/, "")))
  .sort();
const photos = new Map<string, string>(); // basename → absolute path
for (const f of files) {
  const { frontMatter } = splitFrontMatter(readFileSync(join(recipesDir, f), "utf8"));
  const img = typeof frontMatter.image === "string" ? frontMatter.image : "";
  if (img && !/^https?:/i.test(img)) photos.set(basename(img), resolve(recipesDir, img));
}
const prefix = `recipe-drop/${uid}/`;
console.log(`${files.length} recipes, ${photos.size} photos → gs://${BUCKET}/${prefix} (${emulator ? "emulator" : "live"})`);

function contentType(name: string): string {
  if (/\.cook$/i.test(name)) return "text/plain";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

if (emulator) {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  process.env.GCLOUD_PROJECT ??= "solvingfood";
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getStorage } = await import("firebase-admin/storage");
  const app = getApps()[0] ?? initializeApp({ projectId: "solvingfood", storageBucket: BUCKET });
  const bucket = getStorage(app).bucket(BUCKET);
  await Promise.all([...photos].map(([name, path]) => bucket.file(prefix + name).save(readFileSync(path), { contentType: contentType(name), resumable: false })));
  for (const f of files) await bucket.file(prefix + f).save(readFileSync(join(recipesDir, f)), { contentType: "text/plain", resumable: false });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const [left] = await bucket.getFiles({ prefix });
    const cooks = left.filter((x) => x.name.endsWith(".cook"));
    if (!cooks.length) break;
    if (Date.now() > deadline) throw new Error(`Still waiting for ${cooks.length} imports`);
    process.stdout.write(`\r${files.length - cooks.length}/${files.length} imported…`);
    await new Promise((r) => setTimeout(r, 1000));
  }
} else {
  const dest = `gs://${BUCKET}/${prefix}`;
  if (photos.size) execFileSync("gcloud", ["storage", "cp", ...photos.values(), dest], { stdio: "inherit" });
  execFileSync("gcloud", ["storage", "cp", ...files.map((f) => join(recipesDir, f)), dest], { stdio: "inherit" });
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    let out: string;
    try {
      out = execFileSync("gcloud", ["storage", "ls", dest], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      out = ""; // nothing left: ls exits non-zero on an empty prefix
    }
    const cooks = out.split("\n").filter((l) => l.endsWith(".cook"));
    if (!cooks.length) break;
    if (Date.now() > deadline) throw new Error(`Still waiting for ${cooks.length} imports`);
    process.stdout.write(`\r${files.length - cooks.length}/${files.length} imported…`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
console.log(`\nAll ${files.length} .cook files processed. Results are in the uploader's notifications (and dropImports/*).`);
