// LOCAL-FIRST browser AI: before the AI surface opens, check that the INSTALLED SOFTWARE is still exactly what was
// installed (requirement R5: "the downloaded bundle is immutable (hash-verified, read-only) ... bundle hash mismatch
// refuses to run").
//
// WHAT IS CHECKED. The release installer (origin/feat/lf-pwa-offline, src/lib/local-first/release/installer.ts) writes,
// in the DEVICE-level local database ("projexa-local") meta store:
//   app:release  {version, manifest_sha256, ...}                 the release this laptop runs
//   app:files    {version, rows:[{path, sha256, size, ...}]}      the verified file table
// and the files themselves into Cache Storage `px-release-<version>`, each under urlForReleasePath(path). This file
// re-reads every cached file, hashes it (SHA-256) and compares it with the recorded table. Any file that is missing,
// of another size or another hash means somebody (or something, an AI included) changed the software after it was
// installed: the AI surface then switches itself OFF and reports it. It never "repairs" anything itself; the
// installer's next verified install is the only way software changes on this laptop.
//
// INTEGRATION (narrow interface on purpose). That branch is not merged into this one, so its types are mirrored here
// as the few fields this check reads (MetaLike / CachesLike), with the same key names and the same cache naming. When
// both branches are merged, AiAttach passes the device database's meta store and `caches`, nothing else changes.
// No release installed (a page served straight from the web, a dev server) => "not_installed": nothing to verify, the
// surface stays on, and that is stated in manifest().integrity.

export const RELEASE_META_KEY = "app:release";
export const FILES_META_KEY = "app:files";
export const RELEASE_CACHE_PREFIX = "px-release-";
/** Mirrors release-constants.ts: the prerendered /local shell travels as this path and is cached under /local. */
export const SHELL_FILE_PATH = "_shell/local.html";

export function urlForReleasePath(path: string): string {
  return path === SHELL_FILE_PATH ? "/local" : `/${path}`;
}

export type MetaLike = { getMeta<T = unknown>(key: string): Promise<T | undefined> };
export type CacheLike = { match(request: string): Promise<Response | undefined> };
export type CachesLike = { has(name: string): Promise<boolean>; open(name: string): Promise<CacheLike> };

type InstalledRelease = { version: string; manifest_sha256?: string };
type FileRow = { path: string; sha256: string; size: number };
type FileTable = { version: string; rows: FileRow[] };

export type IntegrityProblem = { path: string; problem: "missing" | "size" | "hash" };

export type IntegrityReport =
  | { status: "not_installed"; checkedAt: number }
  | { status: "ok"; version: string; files: number; checkedAt: number }
  | { status: "tampered"; version: string | null; problems: IntegrityProblem[]; message: string; checkedAt: number };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TAMPERED = "PROJEXA's installed files no longer match the fingerprints recorded when they were installed, so AI access on this laptop is switched off. Reconnect to the internet: PROJEXA will reinstall a verified copy.";

export async function verifyInstalledRelease(deps: { meta: MetaLike | null; caches: CachesLike | null; now?: () => number }): Promise<IntegrityReport> {
  const checkedAt = (deps.now ?? Date.now)();
  if (!deps.meta) return { status: "not_installed", checkedAt };
  const release = await deps.meta.getMeta<InstalledRelease>(RELEASE_META_KEY);
  if (!release) return { status: "not_installed", checkedAt };
  const table = await deps.meta.getMeta<FileTable>(FILES_META_KEY);
  // A release is recorded but its file table, its cache or the cache API is gone: that is not "nothing installed".
  if (!table || table.version !== release.version || !Array.isArray(table.rows) || table.rows.length === 0 || !deps.caches) {
    return { status: "tampered", version: release.version, problems: [{ path: "app:files", problem: "missing" }], message: TAMPERED, checkedAt };
  }
  const name = `${RELEASE_CACHE_PREFIX}${release.version}`;
  if (!(await deps.caches.has(name))) {
    return { status: "tampered", version: release.version, problems: [{ path: name, problem: "missing" }], message: TAMPERED, checkedAt };
  }
  const cache = await deps.caches.open(name);
  const problems: IntegrityProblem[] = [];
  for (const row of table.rows) {
    const response = await cache.match(urlForReleasePath(row.path));
    if (!response) { problems.push({ path: row.path, problem: "missing" }); continue; }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== row.size) { problems.push({ path: row.path, problem: "size" }); continue; }
    if ((await sha256Hex(bytes)) !== row.sha256) problems.push({ path: row.path, problem: "hash" });
  }
  if (problems.length) return { status: "tampered", version: release.version, problems, message: TAMPERED, checkedAt };
  return { status: "ok", version: release.version, files: table.rows.length, checkedAt };
}
