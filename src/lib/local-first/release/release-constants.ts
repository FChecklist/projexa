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
