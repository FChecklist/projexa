// RELEASE DISTRIBUTION (ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md): the release-signing public keys this build trusts.
//
// Set NEXT_PUBLIC_PX_RELEASE_KEYS at build time to a JSON array of {kid, jwk} (ES256 public JWKs, never a private one). Empty or absent = no key
// is pinned: the installer then behaves as before (manifest digest and file hashes only) and the peer release relay is OFF (a relayed release is
// accepted only when a pinned key verified its signature). Creating the signing keypair is the owner's decision (spec, OWNER decisions 1).
import type { TrustedReleaseKey } from "./signed-manifest"

export function parsePinnedKeys(raw: string | undefined | null): TrustedReleaseKey[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const keys: TrustedReleaseKey[] = []
    for (const k of parsed) {
      if (typeof k !== "object" || k === null) continue
      const o = k as { kid?: unknown; jwk?: unknown }
      if (typeof o.kid !== "string" || !o.kid || typeof o.jwk !== "object" || o.jwk === null) continue
      const jwk = o.jwk as JsonWebKey & { d?: unknown }
      if (jwk.d !== undefined || jwk.kty !== "EC" || jwk.crv !== "P-256") continue // a private part, or not an ES256 public key: never pinned
      keys.push({ kid: o.kid, jwk })
    }
    return keys
  } catch {
    return []
  }
}

/**
 * The owner's release-signing PUBLIC key, created 2026-10-08 (kid px-release-2026-10-08, public key sha256
 * 3d2c2c63e5ea7ba76538369e4b3eb744b8e29479de9559b4efb4689b1875a8de). The private half lives only on the owner's machine and in the build secret
 * PX_RELEASE_SIGNING_KEY (docs/local-first/RELEASE_SIGNING_OWNER_STEPS.md). ROTATION: add the new key here (or in NEXT_PUBLIC_PX_RELEASE_KEYS)
 * in a release signed by this one; keep the old one listed until every laptop has moved past it.
 */
export const BUILTIN_RELEASE_KEYS: readonly TrustedReleaseKey[] = [
  {
    kid: "px-release-2026-10-08",
    jwk: { kty: "EC", crv: "P-256", x: "DEXw_KzskKaoKVCl55v1KHol2LvQL9pCK9l23yQyWvI", y: "LFVQ8o4LWztsSlvIu50TRNGQ1LLQ3G66ISwHLPm4fbo" },
  },
]

/** Built-in keys plus those from NEXT_PUBLIC_PX_RELEASE_KEYS; the first entry of a kid wins. */
export function mergePinnedKeys(...lists: readonly (readonly TrustedReleaseKey[])[]): TrustedReleaseKey[] {
  const seen = new Set<string>()
  const out: TrustedReleaseKey[] = []
  for (const list of lists) for (const k of list) if (!seen.has(k.kid)) { seen.add(k.kid); out.push(k) }
  return out
}

export const PINNED_RELEASE_KEYS: readonly TrustedReleaseKey[] = mergePinnedKeys(BUILTIN_RELEASE_KEYS, parsePinnedKeys(process.env.NEXT_PUBLIC_PX_RELEASE_KEYS))

/**
 * SIGNATURE_REQUIRED_FROM: the first release_version (YYYY.MM.DD-NNN) that MUST carry a valid signature. Empty (the default) = signatures are
 * checked whenever a release carries one (a bad one always refuses), but an unsigned release is still installed, so a laptop can never be held
 * back just because the owner has not yet put the signing secret into the build. The owner turns enforcement on by setting
 * NEXT_PUBLIC_PX_SIGNATURE_REQUIRED_FROM to the version of the first signed release. A pinned-in-the-build value, never read from the release
 * itself, so whoever can write to the host cannot switch the check off.
 */
export function normalizeRequiredFrom(raw: string | undefined | null): string {
  const v = (raw ?? "").trim()
  return /^\d{4}\.\d{2}\.\d{2}-\d{3}$/.test(v) ? v : ""
}
export const SIGNATURE_REQUIRED_FROM: string = normalizeRequiredFrom(process.env.NEXT_PUBLIC_PX_SIGNATURE_REQUIRED_FROM)

/** True when a release of this version must be signed. Versions compare as strings (the format is fixed width, later = larger). */
export function signatureRequired(releaseVersion: string, requiredFrom: string = SIGNATURE_REQUIRED_FROM): boolean {
  return requiredFrom !== "" && releaseVersion >= requiredFrom
}
