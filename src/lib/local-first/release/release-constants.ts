// LOCAL-FIRST release: the names the build script, the installer, the service worker and the connectivity code must agree on.
// A leaf file (no imports) so the service worker's configuration can be built from it.

/** Cache Storage name of one installed release: px-release-<release_version> (CONTRACT.md section 3). */
export const RELEASE_CACHE_PREFIX = "px-release-";
export const releaseCacheName = (version: string): string => `${RELEASE_CACHE_PREFIX}${version}`;

/**
 * A tiny cache the service worker keeps ONE entry in: which release is active, whose it is, and whether local-first mode is on.
 * A service worker cannot read localStorage or IndexedDB of the page, and it is stopped and restarted by the browser all the
 * time, so this is where it remembers.
 */
export const SW_META_CACHE = "px-sw-meta";
export const SW_POINTER_URL = "/__px/active-release";

/** The prerendered /local shell travels in the bundle under this virtual path and is cached under SHELL_URL. */
export const SHELL_FILE_PATH = "_shell/local.html";
export const SHELL_URL = "/local";

/** The URL a release file is served at (and cached under). */
export function urlForReleasePath(path: string): string {
  return path === SHELL_FILE_PATH ? SHELL_URL : `/${path}`;
}

// ─── the static host (AUDIT-100 B60) ────────────────────────────────────────────────────────────
//
// ONE switch, NEXT_PUBLIC_PX_STATIC_BASE: the address of a separate static host (a free Cloudflare Pages project, see
// ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md) that serves the SAME files at the SAME paths as the app origin: /_next/static/**,
// /_release/** and the public files. Unset or empty (the default) = today's behaviour, everything from the app origin.
// When it is set:
//   * next.config.ts uses it as `assetPrefix`, so every page asks the static host for /_next/static/** (not Vercel);
//   * the installer reads release.json, the bundle and changed files from it (installer.ts);
//   * the service worker answers requests for that host from the installed release, exactly like same-origin static files
//     (sw-core.ts), so an installed laptop works offline with the code on the static host.
// The release's file hashes are of CONTENT, so a different host changes no hash: the registry, the manifest digest and the cache
// keys (always the app-origin path, urlForReleasePath) stay exactly as they are.
//
// A value that is not an absolute http(s) URL is IGNORED (treated as unset): a typo must never send the app's code to nowhere.

/** The static host's base URL without a trailing slash ("https://projexa-static.pages.dev"), or "" when none (the default). */
export function normalizeStaticBase(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.search || url.hash || url.username || url.password) return "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** This build's static host ("" = the app origin). NEXT_PUBLIC_* is fixed at build time. */
export const STATIC_BASE = normalizeStaticBase(process.env.NEXT_PUBLIC_PX_STATIC_BASE);

/**
 * The address of a PUBLIC file (public/**, e.g. "/logo-mark.svg") for an <img>/<Image>: on the static host when there is one.
 * Next's assetPrefix covers /_next/static only, so the few public files the app's chrome shows are pointed at the host here.
 * Pass `unoptimized` to next/image with it (an absolute URL would otherwise go through /_next/image, a server function).
 */
export function publicFileUrl(path: string, base: string = STATIC_BASE): string {
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : path;
}

/** The static host's origin and path prefix, for the service worker's JSON configuration. */
export function staticHostParts(base: string): { staticOrigin: string; staticPathPrefix: string } {
  if (!base) return { staticOrigin: "", staticPathPrefix: "" };
  const url = new URL(base);
  return { staticOrigin: url.origin, staticPathPrefix: url.pathname.replace(/\/+$/, "") };
}

/**
 * The query parameter the installer adds to its own requests to the static host. A header (X-Px-Install, used same-origin) would
 * make every cross-origin request a CORS preflight, which a static host does not answer; the service worker lets any request
 * carrying this parameter (or the header) through to the network, so the installer always compares FRESH bytes.
 */
export const INSTALL_PARAM = "px-install";

/** Where the installer fetches a release URL path ("/_release/release.json", "/_next/static/x.js"): the static host, or the app origin. */
export function installFetchUrl(base: string, urlPath: string): string {
  // The shell (/local) is an app PAGE, not a static file: it always comes from the app origin.
  if (!base || urlPath === SHELL_URL) return urlPath;
  return `${base}${urlPath}${urlPath.includes("?") ? "&" : "?"}${INSTALL_PARAM}=1`;
}

const TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  map: "application/json; charset=utf-8",
};

/** The Content-Type a cached file is answered with. A script served as text/plain would not run, so this matters. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return TYPES[ext] ?? "application/octet-stream";
}

/** Keys in the device-level local database meta store (the "projexa-local" database). */
export const META_KEYS = {
  release: "app:release",
  files: "app:files",
  device: "device:id",
  installPending: "app:install-pending",
  releaseFailure: "app:release-failure",
  identity: "identity",
  persistence: "persist:state",
} as const;
