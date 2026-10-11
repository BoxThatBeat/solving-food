// A minimal admin-credentialed document store for maintenance scripts (ingredient upload, recipe seeding).
//
// Emulator: the Admin SDK against FIRESTORE_EMULATOR_HOST. Live: the Admin SDK with Application Default Credentials
// when present, otherwise the gcloud CLI's own login (`gcloud auth print-access-token`) against the Firestore REST API
// (this machine has no ADC; that login is interactive). Never used by tests against the live project.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const PROJECT_ID = "solvingfood";

export type Plain = null | boolean | number | string | Date | Plain[] | { [k: string]: Plain | undefined };

export interface AdminStore {
  where: "emulator" | "live";
  /** Documents that exist, by path. */
  getMany(paths: string[]): Promise<Map<string, Record<string, unknown>>>;
  /** Full overwrites, in batches of up to 400 (or `chunk`, pausing `pauseMs` between batches). `createOnly` fails a
   * batch instead of overwriting a document that exists. */
  setMany(docs: Array<{ path: string; data: Record<string, Plain | undefined> }>, opts?: { chunk?: number; pauseMs?: number; createOnly?: boolean }): Promise<void>;
  /** Every document of a top-level collection (IDs and data). */
  listAll(collection: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  /** Simple equality query on a top-level collection. */
  queryEq(collection: string, field: string, value: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
}

function hasAdc(): boolean {
  return (
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"))
  );
}

function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T;
  }
  return v;
}

function adminStore(where: "emulator" | "live"): AdminStore {
  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app);
  return {
    where,
    async getMany(paths) {
      const out = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < paths.length; i += 300) {
        const snaps = await db.getAll(...paths.slice(i, i + 300).map((p) => db.doc(p)));
        for (const s of snaps) if (s.exists) out.set(s.ref.path, s.data()!);
      }
      return out;
    },
    async setMany(docs, opts = {}) {
      const n = opts.chunk ?? 400;
      for (let i = 0; i < docs.length; i += n) {
        const b = db.batch();
        for (const d of docs.slice(i, i + n)) {
          if (opts.createOnly) b.create(db.doc(d.path), stripUndefined(d.data));
          else b.set(db.doc(d.path), stripUndefined(d.data));
        }
        await b.commit();
        if (opts.pauseMs && i + n < docs.length) await new Promise((r) => setTimeout(r, opts.pauseMs));
      }
    },
    async listAll(collection) {
      const snap = await db.collection(collection).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    async queryEq(collection, field, value) {
      const snap = await db.collection(collection).where(field, "==", value).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
  };
}

// ---------- REST (live, without ADC)

type RestValue = Record<string, unknown>;

function encode(v: Plain | undefined): RestValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}

function encodeFields(o: Record<string, Plain | undefined>): Record<string, RestValue> {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]));
}

function decode(v: RestValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return new Date(String(v.timestampValue));
  if ("arrayValue" in v) return ((v.arrayValue as { values?: RestValue[] }).values ?? []).map(decode);
  if ("mapValue" in v) return decodeFields((v.mapValue as { fields?: Record<string, RestValue> }).fields ?? {});
  return undefined;
}

function decodeFields(f: Record<string, RestValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, decode(x)]));
}

function restStore(): AdminStore {
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const root = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${root}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": PROJECT_ID };
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<unknown>;
  };
  return {
    where: "live",
    async getMany(paths) {
      const out = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < paths.length; i += 100) {
        const res = (await post(`${api}:batchGet`, { documents: paths.slice(i, i + 100).map((p) => `${root}/${p}`) })) as Array<{
          found?: { name: string; fields?: Record<string, RestValue> };
        }>;
        for (const r of res) if (r.found) out.set(r.found.name.slice(root.length + 1), decodeFields(r.found.fields ?? {}));
      }
      return out;
    },
    async setMany(docs, opts = {}) {
      for (let i = 0; i < docs.length; i += 400) {
        await post(`${api}:commit`, {
          writes: docs.slice(i, i + 400).map((d) => ({
            update: { name: `${root}/${d.path}`, fields: encodeFields(d.data) },
            ...(opts.createOnly ? { currentDocument: { exists: false } } : {}),
          })),
        });
      }
    },
    async listAll(collection) {
      const res = (await post(`${api}:runQuery`, { structuredQuery: { from: [{ collectionId: collection }] } })) as Array<{
        document?: { name: string; fields?: Record<string, RestValue> };
      }>;
      return res.filter((r) => r.document).map((r) => ({ id: r.document!.name.split("/").at(-1)!, data: decodeFields(r.document!.fields ?? {}) }));
    },
    async queryEq(collection, field, value) {
      const res = (await post(`${api}:runQuery`, {
        structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } } },
      })) as Array<{ document?: { name: string; fields?: Record<string, RestValue> } }>;
      return res.filter((r) => r.document).map((r) => ({ id: r.document!.name.split("/").at(-1)!, data: decodeFields(r.document!.fields ?? {}) }));
    },
  };
}

/** `--emulator` → the local emulator; otherwise the live project. */
export function openStore(emulator: boolean): AdminStore {
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    return adminStore("emulator");
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  return hasAdc() ? adminStore("live") : restStore();
}
