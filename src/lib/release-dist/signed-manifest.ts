// RELEASE DISTRIBUTION without Vercel/Cloudflare (ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md).
//
// WHY. The release manifest's own digest (installer.ts manifestDigestOk) only proves the manifest is self-consistent; whoever can
// write to the static host can publish a different, equally self-consistent release. With the host now a public Supabase Storage
// bucket, the laptop must check WHO made the release. This is a detached ES256 signature over (release_version, manifest_sha256)
// -- the digest already commits to every file hash and the bundle hash -- made with a key only the owner's release machine holds
// and whose PUBLIC half is pinned in the app build.
//
// Pure WebCrypto (browser, service worker, bun, node >= 20). No imports. NOT yet wired into the installer: src/lib/local-first/**
// is owned by the offline session; the hook is described in the design doc (one call right after manifestDigestOk).

export const SIGNATURE_VERSION = 1
export const SIGNATURE_FILE = "_release/release.sig.json"
const PREFIX = "px-release-v1"

export type TrustedReleaseKey = { kid: string; jwk: JsonWebKey }
export type ReleaseSignature = {
  v: 1
  release_version: string
  manifest_sha256: string
  kid: string
  alg: "ES256"
  sig: string
  signed_at: string
}
export type SignatureCheck =
  | { ok: true; kid: string }
  | { ok: false; reason: "malformed" | "mismatch" | "unknown_key" | "bad_signature" }

const te = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const signedMessage = (releaseVersion: string, manifestSha256: string): Uint8Array<ArrayBuffer> =>
  te.encode(`${PREFIX}\n${releaseVersion}\n${manifestSha256}`) as Uint8Array<ArrayBuffer>

/** Owner's release machine only. `privateJwk` is an ES256 (P-256) private JWK. */
export async function signRelease(
  manifest: { release_version: string; manifest_sha256: string },
  key: { kid: string; privateJwk: JsonWebKey },
  now: Date = new Date()
): Promise<ReleaseSignature> {
  const k = await crypto.subtle.importKey("jwk", key.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, signedMessage(manifest.release_version, manifest.manifest_sha256)))
  return { v: 1, release_version: manifest.release_version, manifest_sha256: manifest.manifest_sha256, kid: key.kid, alg: "ES256", sig: b64url(sig), signed_at: now.toISOString() }
}

/** Laptop side. The signature must name exactly this manifest, a pinned key, and verify. Anything else refuses. */
export async function verifyRelease(
  manifest: { release_version: string; manifest_sha256: string },
  doc: unknown,
  trusted: readonly TrustedReleaseKey[]
): Promise<SignatureCheck> {
  const d = doc as Partial<ReleaseSignature> | null
  if (!d || typeof d !== "object" || d.v !== 1 || d.alg !== "ES256" || typeof d.sig !== "string" || typeof d.kid !== "string") return { ok: false, reason: "malformed" }
  if (d.release_version !== manifest.release_version || d.manifest_sha256 !== manifest.manifest_sha256) return { ok: false, reason: "mismatch" }
  const pinned = trusted.find((t) => t.kid === d.kid)
  if (!pinned) return { ok: false, reason: "unknown_key" }
  try {
    const k = await crypto.subtle.importKey("jwk", pinned.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, fromB64url(d.sig), signedMessage(manifest.release_version, manifest.manifest_sha256))
    return ok ? { ok: true, kid: pinned.kid } : { ok: false, reason: "bad_signature" }
  } catch {
    return { ok: false, reason: "malformed" }
  }
}
