// Delivers .cook files (and the photos their `image:` front matter names) to the drop folder and waits until the
// dropFolder function has consumed each one (it deletes the file). Shared by `pnpm drop:recipes` and the e2e seed.
//
// Robustness: at most `concurrency` recipes are in flight (each photo goes up right before its .cook), and a .cook
// still present after `staleMs` is uploaded again as a new object generation, which fires a fresh trigger. A busy
// Functions emulator can drop Storage events ("Failed to load function"), and live triggers are capped at a couple of
// instances, so a bulk upload must not depend on every first event landing. The function de-duplicates by
// generation, so a re-upload can't import a recipe twice unless the first attempt never ran.
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { splitFrontMatter } from "../../packages/core/src/cooklang/parse";

export interface DropTransport {
  /** Uploads one local file to `<prefix><name>`. */
  put(localPath: string, name: string, contentType: string): Promise<void>;
  /** Object names (without the prefix) currently under the prefix. */
  list(): Promise<string[]>;
}

export interface DropItem {
  file: string; // e.g. baked-feta-pasta.cook
  cookPath: string;
  photo?: { name: string; path: string };
}

export function contentTypeOf(name: string): string {
  if (/\.cook$/i.test(name)) return "text/plain";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

/** The .cook files in a folder (optionally a subset by basename) with their relative-path photos. */
export function dropItems(dir: string, files: string[]): DropItem[] {
  return files.map((f) => {
    const cookPath = join(dir, f);
    const { frontMatter } = splitFrontMatter(readFileSync(cookPath, "utf8"));
    const img = typeof frontMatter.image === "string" ? frontMatter.image : "";
    const item: DropItem = { file: f, cookPath };
    if (img && !/^https?:/i.test(img)) item.photo = { name: basename(img), path: resolve(dir, img) };
    return item;
  });
}

export interface DropOptions {
  concurrency?: number;
  staleMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  pollMs?: number;
  log?: (msg: string) => void;
}

export async function dropAndWait(items: DropItem[], t: DropTransport, opts: DropOptions = {}): Promise<{ attempts: Record<string, number> }> {
  const concurrency = opts.concurrency ?? 3;
  const staleMs = opts.staleMs ?? 90_000;
  const maxAttempts = opts.maxAttempts ?? 4;
  const pollMs = opts.pollMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  const log = opts.log ?? (() => {});
  const queue = [...items];
  const inFlight = new Map<string, { item: DropItem; since: number; attempts: number }>();
  const attempts: Record<string, number> = {};
  let done = 0;

  const send = async (item: DropItem, attempt: number) => {
    if (item.photo) await t.put(item.photo.path, item.photo.name, contentTypeOf(item.photo.name));
    await t.put(item.cookPath, item.file, "text/plain");
    inFlight.set(item.file, { item, since: Date.now(), attempts: attempt });
    attempts[item.file] = attempt;
  };

  while (queue.length || inFlight.size) {
    while (queue.length && inFlight.size < concurrency) await send(queue.shift()!, 1);
    await new Promise((r) => setTimeout(r, pollMs));
    const present = new Set(await t.list());
    for (const [file, f] of [...inFlight]) {
      if (!present.has(file)) {
        inFlight.delete(file);
        done++;
        log(`${done}/${items.length} ${file}${f.attempts > 1 ? ` (attempt ${f.attempts})` : ""}`);
      } else if (Date.now() - f.since > staleMs) {
        if (f.attempts >= maxAttempts) throw new Error(`${file} was not processed after ${f.attempts} uploads`);
        log(`${file}: not picked up after ${Math.round(staleMs / 1000)} s; uploading again`);
        // The photo may already have been consumed by a run that's still going; re-sending it is harmless.
        await send(f.item, f.attempts + 1);
      }
    }
    if (Date.now() > deadline) throw new Error(`Timed out with ${inFlight.size + queue.length} recipes left`);
  }
  return { attempts };
}
