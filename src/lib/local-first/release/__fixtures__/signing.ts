// Test helpers for signed releases (RELEASE_DISTRIBUTION): a throwaway ES256 keypair, a signature over a built release, a relay package.
import { signRelease, type ReleaseSignature, type TrustedReleaseKey } from "../../../release-dist/signed-manifest";
import type { BuiltRelease } from "./fakes";
import type { RelayPackage } from "../relay";

export type TestKey = { trusted: TrustedReleaseKey; privateJwk: JsonWebKey };

export async function makeKey(kid: string): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { trusted: { kid, jwk: publicJwk }, privateJwk };
}

export const signBuilt = (release: BuiltRelease, key: TestKey): Promise<ReleaseSignature> =>
  signRelease(release.manifest, { kid: key.trusted.kid, privateJwk: key.privateJwk });

export async function relayPackage(release: BuiltRelease, key: TestKey): Promise<RelayPackage> {
  return { manifest: release.manifest, signature: await signBuilt(release, key), bundle: release.bundle };
}

/** Deterministic incompressible bytes, so a bundle spans several relay chunks. */
export function noise(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
