// Uploads the household recipes (data/recipes/cooklang/*.cook) and the photos they reference into the drop folder,
// so the dropFolder function imports them exactly as it imports anything else (TECHNICAL_SPECS §9).
//
//   pnpm drop:recipes -- --emulator --uid <uid>          # Storage emulator (Admin SDK)
//   pnpm drop:recipes -- --email buitenwerfa@gmail.com   # live bucket via `gcloud storage cp`, as that user
//   … [--only baked-feta-pasta,greek-salad]              # a subset
//   … [--concurrency 2]                                  # recipes in flight at once
//
// Each recipe's photo goes up right before its .cook (the import matches relative `image:` paths by file name in the
// same folder). It waits until every .cook has been processed (the function deletes it), re-uploading any that a busy
// trigger never picked up (scripts/lib/drop.ts).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dropAndWait, dropItems, type DropTransport } from "./lib/drop";
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
const items = dropItems(recipesDir, files);
const prefix = `recipe-drop/${uid}/`;
const concurrency = Number(arg("--concurrency") ?? (emulator ? 3 : 2));
console.log(`${files.length} recipes, ${items.filter((i) => i.photo).length} photos → gs://${BUCKET}/${prefix} (${emulator ? "emulator" : "live"}, ${concurrency} at a time)`);

let transport: DropTransport;
if (emulator) {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  process.env.GCLOUD_PROJECT ??= "solvingfood";
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getStorage } = await import("firebase-admin/storage");
  const app = getApps()[0] ?? initializeApp({ projectId: "solvingfood", storageBucket: BUCKET });
  const bucket = getStorage(app).bucket(BUCKET);
  transport = {
    put: async (path, name, contentType) => void (await bucket.file(prefix + name).save(readFileSync(path), { contentType, resumable: false })),
    list: async () => (await bucket.getFiles({ prefix }))[0].map((f) => f.name.slice(prefix.length)),
  };
} else {
  const dest = `gs://${BUCKET}/${prefix}`;
  transport = {
    put: async (path, name, contentType) =>
      void execFileSync("gcloud", ["storage", "cp", `--content-type=${contentType}`, path, dest + name], { stdio: ["ignore", "ignore", "inherit"] }),
    list: async () => {
      let out: string;
      try {
        out = execFileSync("gcloud", ["storage", "ls", dest], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        out = ""; // ls exits non-zero on an empty prefix
      }
      return out.split("\n").filter((l) => l.startsWith(dest)).map((l) => l.slice(dest.length));
    },
  };
}

const { attempts } = await dropAndWait(items, transport, { concurrency, staleMs: emulator ? 60_000 : 120_000, pollMs: emulator ? 1000 : 4000, log: (m) => console.log(m) });
const retried = Object.entries(attempts).filter(([, n]) => n > 1);
console.log(`All ${files.length} .cook files processed${retried.length ? ` (${retried.length} needed a re-upload)` : ""}. Results are in the uploader's notifications (and dropImports/*).`);
