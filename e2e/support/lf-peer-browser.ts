// lf-e9 (peer e2e): shared plumbing of the e2e/lf-peer-*.spec.ts files. Each "laptop" is its own browser CONTEXT (its own IndexedDB, its
// own RTCPeerConnection) on one origin served by page.route -- no app server, no sync server, nothing on the network. The page runs
// src/lib/local-first/peer/e2e-harness-lf.ts (the real peer stack, bundled with esbuild); this file relays signalling between the pages
// exactly like a broadcast channel would (Supabase Realtime / ntfy carry only signalling, never rows).

import type { Browser, Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

export const ORIGIN = "http://localhost:4598"; // localhost is a secure context (WebCrypto); page.route answers, nothing listens

let bundle: string | null = null;

export async function harnessBundle(): Promise<string> {
  if (bundle) return bundle;
  const out = await build({
    entryPoints: [path.join(__dirname, "../../src/lib/local-first/peer/e2e-harness-lf.ts")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
    alias: { "@": path.join(__dirname, "../../src") },
  });
  bundle = out.outputFiles[0].text;
  return bundle;
}

/** One laptop: a fresh context and page with the harness loaded. Every request the page makes is logged in `requests`. */
export async function laptop(browser: Browser): Promise<Page & { requests: string[] }> {
  const js = await harnessBundle();
  const ctx = await browser.newContext();
  const page = (await ctx.newPage()) as Page & { requests: string[] };
  page.requests = [];
  page.on("request", (r) => page.requests.push(r.url()));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort(); // nothing leaves the machine
    if (url.pathname === "/harness.js") return route.fulfill({ contentType: "text/javascript", body: js });
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>laptop</title><script src="/harness.js"></script>` });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !!window.pxPeerLf);
  return page;
}

/**
 * Relays signalling among `pages` (keyed by laptop id). `online` decides who hears what: a laptop that is "offline" neither sends nor
 * receives signalling (its own LAN link to a peer is what (g) brings back).
 */
export async function relay(pages: Record<string, Page>, online: (id: string) => boolean = () => true): Promise<void> {
  for (const [id, p] of Object.entries(pages)) {
    await p.exposeFunction("pxSignalOut", async (json: string) => {
      if (!online(id)) return;
      for (const [other, q] of Object.entries(pages)) {
        if (other !== id && online(other)) await q.evaluate((j) => window.pxPeerLf!.signalIn(j), json).catch(() => {});
      }
    });
  }
}

/** Requests a page made that are NOT the harness itself (the page document and /harness.js). The peer path must make none. */
export function outsideRequests(p: Page & { requests: string[] }): string[] {
  return p.requests.filter((u) => u !== `${ORIGIN}/` && u !== `${ORIGIN}/harness.js`);
}

export const T1 = "2026-10-01T10:00:00Z";
export const T2 = "2026-10-02T09:00:00Z";
