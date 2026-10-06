// RELEASE DISTRIBUTION: the pure half of publishing a release to a PUBLIC Supabase Storage bucket (RELEASE_DISTRIBUTION_2026-10-06.md).
// No network here. planPublish() says which objects go where with which headers; planRollback() says which objects to rewrite.

export type StagedFile = { path: string; bytes: number }
export type PlannedObject = { key: string; source: string; cacheControl: string; mutable: boolean }

export const IMMUTABLE = "public, max-age=31536000, immutable"
export const NO_CACHE = "no-cache"

const MUTABLE_KEYS = new Set(["_release/release.json", "_release/release.sig.json"])

export function publicBase(projectRef: string, bucket: string): string {
  return `https://${projectRef}.supabase.co/storage/v1/object/public/${bucket}`
}

/** Everything a release needs on the host, at the SAME relative paths the app origin serves (so STATIC_BASE needs no remapping). */
export function planPublish(files: readonly StagedFile[], releaseVersion: string): PlannedObject[] {
  const out: PlannedObject[] = []
  for (const f of files) {
    if (f.path.includes("..") || f.path.startsWith("/")) throw new Error(`refusing path ${f.path}`)
    const mutable = MUTABLE_KEYS.has(f.path)
    out.push({ key: f.path, source: f.path, cacheControl: mutable ? NO_CACHE : IMMUTABLE, mutable })
  }
  // Rollback copies: this release's manifest and signature are also kept under a per-version key, never overwritten.
  for (const name of ["release.json", "release.sig.json"]) {
    if (files.some((f) => f.path === `_release/${name}`)) {
      out.push({ key: `_release/releases/${releaseVersion}/${name}`, source: `_release/${name}`, cacheControl: IMMUTABLE, mutable: false })
    }
  }
  return out
}

/** Rollback = point the two mutable keys back at a kept version. The old bundle must still be in the bucket (retention, see the doc). */
export function planRollback(toVersion: string): PlannedObject[] {
  return ["release.json", "release.sig.json"].map((name) => ({
    key: `_release/${name}`,
    source: `_release/releases/${toVersion}/${name}`,
    cacheControl: NO_CACHE,
    mutable: true,
  }))
}

/** Versions a retention of `keep` may drop; never the newest two. The caller asks the owner before deleting anything. */
export function prunable(versionsNewestFirst: readonly string[], keep: number): string[] {
  return versionsNewestFirst.slice(Math.max(keep, 2))
}
