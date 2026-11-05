// Outbound fetches of URLs people give the app (M22, TECHNICAL_SPECS §10 "Outbound fetches"): the recipe page behind
// Add with Gemini's link and a recipe's `image:` URL. Functions run inside Google's network, so a URL naming a private,
// loopback, link-local or metadata address (169.254.169.254, metadata.google.internal) must never be fetched, whatever
// the hostname says and wherever a redirect points. This helper:
//
//   - accepts http(s) only, and refuses hostnames that are obviously internal (localhost, *.local, *.internal);
//   - resolves the hostname itself (every address, IPv4 and IPv6) and refuses it when any address isn't public; the
//     connection then uses exactly the addresses it checked (a custom `lookup` on the request, so a DNS answer that
//     changes between the check and the connect can't slip through);
//   - follows redirects by hand (at most MAX_REDIRECTS), checking every hop the same way;
//   - stops at a timeout and a size cap, and decompresses gzip / deflate / br.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    /** "blocked": the URL or an address it resolves to isn't public; otherwise a network, size or timeout failure. */
    readonly kind: "blocked" | "failed" | "tooLarge" | "timeout",
  ) {
    super(message);
  }
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: Buffer;
  /** The URL that answered (after redirects). */
  url: string;
}

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
  /** Tests only: which resolved addresses may be connected to (default: public ones). */
  allowAddress?: (ip: string) => boolean;
}

export const MAX_REDIRECTS = 5;

// ---------- address ranges

function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. the metadata server 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { net: (v4ToInt(base)! & mask) >>> 0, mask };
});

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return false;
  return !V4_RANGES.some((r) => ((n & r.mask) >>> 0) === r.net);
}

/** Eight 16-bit groups, or null. Accepts "::", an embedded dotted quad at the end, and a zone ("%eth0"). */
export function parseV6(raw: string): number[] | null {
  let ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (dotted) {
    const n = v4ToInt(dotted[1]!);
    if (n === null) return null;
    ip = `${ip.slice(0, -dotted[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function v6Public(ip: string): boolean {
  const g = parseV6(ip);
  if (!g) return false;
  const embedded = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return false; // ::
  if (zeros(0, 7) && g[7] === 1) return false; // ::1
  if (zeros(0, 5) && g[5] === 0xffff) return v4Public(embedded()); // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeros(0, 6)) return v4Public(embedded()); // ::a.b.c.d (IPv4-compatible, deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4Public(embedded()); // NAT64
  if (g[0] === 0x2002) return v4Public(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`); // 6to4
  if ((g[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local
  if ((g[0]! & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && zeros(1, 4)) return false; // 100::/64 discard
  return true;
}

/** Whether an IP address (v4 or v6) is a public internet address the functions may connect to. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]!);
  if (kind === 4) return v4Public(ip);
  if (kind === 6) return v6Public(ip);
  return false;
}

/** The URL if it may be fetched at all (scheme, credentials, obviously internal names); else a reason. */
export function checkUrl(raw: string | URL, allow: (ip: string) => boolean = isPublicAddress): URL {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new SafeFetchError("not a web address", "blocked");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SafeFetchError("not an http(s) address", "blocked");
  if (u.username || u.password) throw new SafeFetchError("addresses with a user name aren't fetched", "blocked");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) {
    throw new SafeFetchError("that address is on a private network", "blocked");
  }
  if (isIP(h) && !allow(h)) throw new SafeFetchError("that address is on a private network", "blocked");
  if (!isIP(h) && !h.includes(".")) throw new SafeFetchError("that address is on a private network", "blocked");
  return u;
}

/** A `lookup` for the request that resolves every address and refuses the host unless all are allowed. */
function guardedLookup(allow: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true, verbatim: true })
      .then((addrs) => {
        if (!addrs.length) throw new SafeFetchError(`${hostname} has no address`, "failed");
        const bad = addrs.find((a) => !allow(a.address));
        if (bad) throw new SafeFetchError("that address is on a private network", "blocked");
        const wanted = options.family === 4 || options.family === 6 ? addrs.filter((a) => a.family === options.family) : addrs;
        const use = wanted.length ? wanted : addrs;
        if (options.all) (callback as unknown as (e: null, a: typeof use) => void)(null, use);
        else callback(null, use[0]!.address, use[0]!.family);
      })
      .catch((e: Error) => callback(Object.assign(e, { code: (e as NodeJS.ErrnoException).code ?? "EBLOCKED" }), "", 0));
  };
}

function once(u: URL, opts: SafeFetchOptions, deadline: number): Promise<{ res: IncomingMessage; body: Buffer }> {
  const allow = opts.allowAddress ?? isPublicAddress;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allow(host)) return Promise.reject(new SafeFetchError("that address is on a private network", "blocked"));
  const reqOpts: RequestOptions = {
    method: "GET",
    headers: { "Accept-Encoding": "gzip, deflate, br", ...opts.headers },
    lookup: guardedLookup(allow),
    timeout: Math.max(1, deadline - Date.now()),
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy(new SafeFetchError("it took too long", "timeout"));
    }, Math.max(1, deadline - Date.now()));
    const done = (e: Error | null, v?: { res: IncomingMessage; body: Buffer }) => {
      clearTimeout(timer);
      if (e) reject(e instanceof SafeFetchError ? e : new SafeFetchError(e.message, "failed"));
      else resolve(v!);
    };
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, reqOpts, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        done(null, { res, body: Buffer.alloc(0) });
        return;
      }
      const len = Number(res.headers["content-length"] ?? 0);
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      if (!enc && len > opts.maxBytes) {
        res.destroy();
        done(new SafeFetchError("too large", "tooLarge"));
        return;
      }
      let stream: Readable = res;
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(createGunzip());
      else if (enc === "deflate") stream = res.pipe(createInflate());
      else if (enc === "br") stream = res.pipe(createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > opts.maxBytes) {
          res.destroy();
          stream.destroy();
          done(new SafeFetchError("too large", "tooLarge"));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => done(null, { res, body: Buffer.concat(chunks) }));
      stream.on("error", (e) => done(e));
    });
    req.on("timeout", () => req.destroy(new SafeFetchError("it took too long", "timeout")));
    req.on("error", (e) => done(e));
    req.end();
  });
}

/** GET `url` under the guards above. Throws SafeFetchError; an HTTP error status is returned, not thrown. */
export async function safeFetch(url: string | URL, opts: SafeFetchOptions): Promise<SafeResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  const max = opts.maxRedirects ?? MAX_REDIRECTS;
  const allow = opts.allowAddress ?? isPublicAddress;
  let u = checkUrl(url, allow);
  for (let hop = 0; ; hop++) {
    const { res, body } = await once(u, opts, deadline);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      if (hop >= max) throw new SafeFetchError("too many redirects", "failed");
      u = checkUrl(new URL(location, u), allow);
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
    return { status, ok: status >= 200 && status < 300, headers, body, url: u.href };
  }
}
