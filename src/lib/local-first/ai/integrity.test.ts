// The release check behind R5's "bundle hash mismatch refuses to run": real SHA-256 over fake Cache Storage and a fake
// meta store laid out exactly as the release installer (origin/feat/lf-pwa-offline) writes them.

import { describe, expect, test } from "bun:test";
import { FILES_META_KEY, RELEASE_META_KEY, verifyInstalledRelease, type CachesLike } from "./integrity";

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const FILES: Record<string, string> = { "_next/static/chunks/app.js": "console.log('app')", "_shell/local.html": "<html>local</html>", "index.css": "body{}" };

async function installed(opts: { tamper?: (urls: Map<string, string>) => void; dropTable?: boolean; dropCache?: boolean } = {}) {
  const rows = await Promise.all(Object.entries(FILES).map(async ([path, text]) => ({ path, sha256: await sha(text), size: new TextEncoder().encode(text).length, file_no: 1, file_version: 1, version: "2026.10.02-1" })));
  const meta = new Map<string, unknown>([
    [RELEASE_META_KEY, { version: "2026.10.02-1", manifest_sha256: "x".repeat(64) }],
    ...(opts.dropTable ? [] : [[FILES_META_KEY, { version: "2026.10.02-1", rows }] as [string, unknown]]),
  ]);
  const urls = new Map(Object.entries(FILES).map(([path, text]) => [path === "_shell/local.html" ? "/local" : `/${path}`, text]));
  opts.tamper?.(urls);
  const caches: CachesLike = {
    has: async (name) => !opts.dropCache && name === "px-release-2026.10.02-1",
    open: async () => ({ match: async (url: string) => (urls.has(url) ? new Response(urls.get(url)) : undefined) }),
  };
  return { meta: { getMeta: async <T,>(k: string) => meta.get(k) as T | undefined }, caches };
}

describe("verifyInstalledRelease", () => {
  test("every file matches its recorded fingerprint -> ok", async () => {
    expect(await verifyInstalledRelease({ ...(await installed()), now: () => 5 })).toEqual({ status: "ok", version: "2026.10.02-1", files: 3, checkedAt: 5 });
  });

  test("one changed byte in one file -> tampered, naming the file", async () => {
    const r = await verifyInstalledRelease(await installed({ tamper: (u) => u.set("/_next/static/chunks/app.js", "console.log('apq')") }));
    expect(r.status).toBe("tampered");
    if (r.status === "tampered") {
      expect(r.problems).toEqual([{ path: "_next/static/chunks/app.js", problem: "hash" }]);
      expect(r.message).toContain("switched off");
    }
  });

  test("a different size, a missing file, a missing cache or file table -> tampered", async () => {
    expect((await verifyInstalledRelease(await installed({ tamper: (u) => u.set("/index.css", "body{color:red}") }))).status).toBe("tampered");
    const missing = await verifyInstalledRelease(await installed({ tamper: (u) => u.delete("/local") }));
    expect(missing.status === "tampered" && missing.problems).toEqual([{ path: "_shell/local.html", problem: "missing" }]);
    expect((await verifyInstalledRelease(await installed({ dropCache: true }))).status).toBe("tampered");
    expect((await verifyInstalledRelease(await installed({ dropTable: true }))).status).toBe("tampered");
    expect((await verifyInstalledRelease({ ...(await installed()), caches: null })).status).toBe("tampered");
  });

  test("nothing installed (served from the web, a dev server) -> not_installed", async () => {
    expect((await verifyInstalledRelease({ meta: { getMeta: async () => undefined }, caches: null })).status).toBe("not_installed");
    expect((await verifyInstalledRelease({ meta: null, caches: null })).status).toBe("not_installed");
  });
});
