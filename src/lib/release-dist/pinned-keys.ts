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

export const PINNED_RELEASE_KEYS: readonly TrustedReleaseKey[] = parsePinnedKeys(process.env.NEXT_PUBLIC_PX_RELEASE_KEYS)
