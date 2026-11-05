// safeFetch (Planning/M22 item 8, TECHNICAL_SPECS §10 "Outbound fetches"): the address ranges it refuses (IPv4, IPv6,
// IPv4-mapped), URL checks, and redirects, size and time limits against a local server. Loopback is refused by default;
// the redirect tests allow 127.0.0.1 explicitly (`allowAddress`) to have something to talk to.
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, isPublicAddress, parseV6, safeFetch, SafeFetchError } from "../src/safeFetch";

describe("address ranges", () => {
  it("refuses private, loopback, link-local, metadata and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.5"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "142.250.65.68", "172.32.0.1", "172.15.255.255", "100.128.0.1", "1.1.1.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses the same in IPv6, including IPv4-mapped and NAT64 forms", () => {
    for (const ip of ["::1", "::", "fe80::1", "fe80::1%eth0", "fc00::1", "fd00:ec2::254", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "2002:a00:1::", "::127.0.0.1", "[::1]"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["2607:f8b0:4004:c07::64", "::ffff:8.8.8.8", "2002:808:808::1", "2001:4860:4860::8888"]) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress("not an ip")).toBe(false);
  });

  it("parses IPv6 forms", () => {
    expect(parseV6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseV6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseV6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseV6("1::2::3")).toBeNull();
    expect(parseV6("1:2:3")).toBeNull();
  });

  it("refuses URLs that aren't public web addresses before any lookup", () => {
    for (const u of ["ftp://example.com/x", "file:///etc/passwd", "http://localhost/", "http://metadata.google.internal/", "http://printer.local/", "http://intranet/", "http://user:pw@example.com/", "http://[::1]/", "http://169.254.169.254/latest", "http://2130706433/", "http://0x7f.1/"]) {
      expect(() => checkUrl(u), u).toThrow(SafeFetchError);
    }
    expect(checkUrl("https://www.allrecipes.com/recipe/1").hostname).toBe("www.allrecipes.com");
  });
});

describe("safeFetch against a local server", () => {
  let server: Server;
  let base = "";
  const loopback = (ip: string) => ip === "127.0.0.1" || isPublicAddress(ip);

  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = req.url ?? "/";
      if (u === "/ok") res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>ok</h1>");
      else if (u === "/gz") res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" }).end(gzipSync("<h1>zipped</h1>"));
      else if (u === "/hop") res.writeHead(302, { Location: "/ok" }).end();
      else if (u === "/loop") res.writeHead(302, { Location: "/loop" }).end();
      else if (u === "/to-private") res.writeHead(301, { Location: "http://10.0.0.1/secret" }).end();
      else if (u === "/to-metadata") res.writeHead(307, { Location: "http://metadata.google.internal/computeMetadata/v1/" }).end();
      else if (u === "/big") res.writeHead(200, { "Content-Type": "text/html" }).end("x".repeat(5000));
      else if (u === "/slow") setTimeout(() => res.writeHead(200).end("late"), 1500);
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const opts = { timeoutMs: 1000, maxBytes: 1000, allowAddress: loopback };

  it("refuses loopback unless a test allows it", async () => {
    await expect(safeFetch(`${base}/ok`, { timeoutMs: 1000, maxBytes: 1000 })).rejects.toMatchObject({ kind: "blocked" });
    const r = await safeFetch(`${base}/ok`, opts);
    expect(r).toMatchObject({ status: 200, ok: true });
    expect(r.body.toString()).toBe("<h1>ok</h1>");
  });

  it("follows a redirect, re-checking every hop, and stops at five", async () => {
    expect((await safeFetch(`${base}/hop`, opts)).url).toBe(`${base}/ok`);
    await expect(safeFetch(`${base}/to-private`, opts)).rejects.toMatchObject({ kind: "blocked" });
    await expect(safeFetch(`${base}/to-metadata`, opts)).rejects.toMatchObject({ kind: "blocked" });
    await expect(safeFetch(`${base}/loop`, opts)).rejects.toThrow(/too many redirects/);
  });

  it("caps size and time, decompresses gzip, and returns HTTP errors", async () => {
    await expect(safeFetch(`${base}/big`, opts)).rejects.toMatchObject({ kind: "tooLarge" });
    await expect(safeFetch(`${base}/slow`, opts)).rejects.toMatchObject({ kind: "timeout" });
    expect((await safeFetch(`${base}/gz`, opts)).body.toString()).toBe("<h1>zipped</h1>");
    expect(await safeFetch(`${base}/missing`, opts)).toMatchObject({ status: 404, ok: false });
  });
});
