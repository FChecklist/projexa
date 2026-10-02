// TEST ONLY: plays OUR server's signing role (compliance-tracker supabase/functions/projexa-sync/sign.ts) so the peer tests can
// mint attestation tokens and signed rows exactly as /attest and /pull do. Same message layout, same JWS shape.

import { b64url, canonicalize, itemMessage, sha256Hex, type PeerClaims, type PublicKeyInfo, type SignedRow } from "../verify";

const te = new TextEncoder();

export type TestSigner = {
  kid: string;
  publicKey: PublicKeyInfo;
  token(claims: Partial<PeerClaims> & { org: string; view: string; projects: string[] }, nowMs?: number): Promise<string>;
  row(org: string, row: Omit<SignedRow, "sig" | "kid">): Promise<SignedRow>;
};

export async function createTestSigner(kid = "ktest1"): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (message: string) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, te.encode(message))));
  return {
    kid,
    publicKey: { kid, alg: "ES256", jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, active: true },
    async token(claims, nowMs = Date.now()) {
      const iat = claims.iat ?? Math.floor(nowMs / 1000);
      const payload = { typ: "px-peer", v: 1, sub: claims.sub ?? "user-a", org: claims.org, projects: claims.projects, view: claims.view, iat, exp: claims.exp ?? iat + 86_400 };
      const head = b64url(te.encode(JSON.stringify({ alg: "ES256", typ: "px-peer", kid })));
      const body = b64url(te.encode(JSON.stringify(payload)));
      return `${head}.${body}.${await sign(`${head}.${body}`)}`;
    },
    async row(org, r) {
      const dataHash = await sha256Hex(canonicalize(r.data));
      const sig = await sign(itemMessage({ org, project: r.project, kind: r.kind, id: r.id, version: r.version, updatedAt: r.updated_at, dataHash }));
      return { ...r, sig, kid };
    },
  };
}
