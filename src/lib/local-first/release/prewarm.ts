// P1 (2026-10-08): the release bundle starts downloading when the e-mail is submitted, BEFORE the code is verified.
//
// WHY THIS IS SAFE: the only things fetched are the two PUBLIC build files every visitor can already read - /_release/release.json and the
// bundle it names (the same bytes for everyone; the service worker serves them with no session, see sw-core.ts "release files are public
// build output"). The request carries no cookie and no token (credentials omitted for a static host, same-origin plain GET otherwise), and
// NOTHING about any organisation is requested (rule D2: org data copies only after the code is accepted). The bytes are held in memory only
// and are checked here (manifest digest, bundle size and sha256) AND again by installRelease() before anything is written.
//
// WHAT STAYS AFTER VERIFICATION: the registry calls (GET /release/current, POST /release/register, POST /install) need the session's
// access token, and the install record needs a person; installRelease() still does all of that. It only skips the network download when a
// matching prewarmed bundle is handed to it (InstallerDeps.takePrewarmedBundle). If the page was reloaded or the bytes do not match, the
// installer downloads as before.
import { parseManifest, manifestDigestOk } from "./installer";
import { sha256Hex } from "./canonical";
import { STATIC_BASE, installFetchUrl } from "./release-constants";
import type { ReleaseManifest } from "./release-client";

const KEEP_MS = 30 * 60 * 1000;

type Held = { manifest: ReleaseManifest; bytes: Uint8Array; at: number };
let held: Held | null = null;
let running: Promise<boolean> | null = null;

export type PrewarmDeps = { fetchImpl?: typeof fetch; staticBase?: string; now?: () => number };

/** Downloads and verifies the public release bundle into memory. Idempotent while running or held. Never throws; true when bytes are held. */
export function prewarmReleaseBundle(deps: PrewarmDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  if (held && now() - held.at < KEEP_MS) return Promise.resolve(true);
  if (running) return running;
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = deps.staticBase ?? STATIC_BASE;
  // Same request shapes the installer uses for these two public files: fresh bytes, no credentials to a static host.
  const sameOrigin: RequestInit = { cache: "no-store", credentials: "same-origin", headers: { "X-Px-Install": "1" } };
  const crossOrigin: RequestInit = { cache: "no-store", credentials: "omit", mode: "cors" };
  const get = (urlPath: string) => {
    const url = installFetchUrl(base, urlPath);
    return doFetch(url, url === urlPath ? sameOrigin : crossOrigin);
  };
  running = (async () => {
    try {
      const m = await get("/_release/release.json");
      if (!m.ok) return false;
      const manifest = parseManifest(await m.json());
      if (!(await manifestDigestOk(manifest))) return false;
      const b = await get(`/${manifest.bundle.path}`);
      if (!b.ok) return false;
      const bytes = new Uint8Array(await b.arrayBuffer());
      if (bytes.length !== manifest.bundle.size || (await sha256Hex(bytes)) !== manifest.bundle.sha256) return false;
      held = { manifest, bytes, at: now() };
      return true;
    } catch {
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** The held bundle if it belongs to exactly this manifest (single use: it is released from memory either way). */
export function takePrewarmedBundle(manifest: ReleaseManifest, now: () => number = Date.now): Uint8Array | null {
  const h = held;
  held = null;
  if (!h || now() - h.at >= KEEP_MS) return null;
  return h.manifest.manifest_sha256 === manifest.manifest_sha256 && h.manifest.bundle.sha256 === manifest.bundle.sha256 ? h.bytes : null;
}

/** For tests. */
export function resetPrewarm(): void {
  held = null;
  running = null;
}
