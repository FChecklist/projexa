// lf-e9 (peer e2e): OUR server's signing role, copied from compliance-tracker supabase/functions/projexa-sync/sign.ts (origin/main,
// 2026-10-02) so the peer specs exercise the laptop's PRODUCTION verify path (src/lib/local-first/peer/verify.ts) with a genuine ES256 key
// record, genuine px2 + px3 row signatures and a genuine /attest token -- not the projexa test fixture's own re-implementation. Copied, not
// imported: the two repos are separate checkouts and a spec must not reach across them at run time.
//
// What is copied VERBATIM from sign.ts (keep in step if sign.ts changes; the TEST_VECTOR check below fails on a canonicalisation drift):
//   b64url, canonicalize, sha256Hex, itemMessage (px2), itemMessageV3 (px3), generateKeyRecord, createSigning (sign, signToken, signItem,
//   signItemV3), jwkThumbprint, holderProofMessage.
// What is ADDED here: `attestToken`, the exact payload handler.ts attest() signs ({typ, v, sub, org, projects, view, iat, exp, cnf?}),
// `publicKeyInfo`, the shape handler.ts returns in `public_keys`, and `signedRow`, one /pull item as a laptop stores it (sig + sig3 + kid).

export type Jwk = JsonWebKey;
export type KeyRecord = { kid: string; alg: "ES256"; public_jwk: Jwk; private_jwk: Jwk };

export const ITEM_MESSAGE_PREFIX = "px2";
export const ITEM_MESSAGE_PREFIX_V3 = "px3";
export const ATTEST_TTL_SECONDS = 86_400;

const te = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",") + "]";
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}
export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text))));
}
export function itemMessage(parts: { org: string; project: string; kind: string; id: string; version: number; updatedAt: string; dataHash: string }): string {
  return [ITEM_MESSAGE_PREFIX, parts.org, parts.project, parts.kind, parts.id, String(parts.version), parts.updatedAt, parts.dataHash].join("|");
}
export function itemMessageV3(parts: { org: string; project: string; kind: string; view: string; id: string; version: number; updatedAt: string; dataHash: string }): string {
  return ITEM_MESSAGE_PREFIX_V3 + JSON.stringify([parts.org, parts.project, parts.kind, parts.view, parts.id, String(parts.version), parts.updatedAt, parts.dataHash]);
}
export type EcPublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };
export async function jwkThumbprint(jwk: EcPublicJwk): Promise<string> {
  const text = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text))));
}
export function holderProofMessage(nonce: string, verifierId: string, jkt: string): string {
  return "px-hold" + JSON.stringify([nonce, verifierId, jkt]);
}

export async function generateKeyRecord(): Promise<KeyRecord> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const kidBytes = new Uint8Array(12);
  crypto.getRandomValues(kidBytes);
  return { kid: "k" + b64url(kidBytes), alg: "ES256", public_jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, private_jwk: privateJwk };
}

export type Signing = {
  kid: string;
  sign(message: string): Promise<string>;
  signToken(payload: Record<string, unknown>): Promise<string>;
  signItem(parts: { org: string; project: string; kind: string; id: string; version: number; updatedAt: string; data: unknown }): Promise<string>;
  signItemV3(parts: { org: string; project: string; kind: string; view: string; id: string; version: number; updatedAt: string; data: unknown }): Promise<string>;
};

export async function createSigning(rec: KeyRecord): Promise<Signing> {
  const key = await crypto.subtle.importKey("jwk", rec.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sign = async (message: string) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(message))));
  return {
    kid: rec.kid,
    sign,
    async signToken(payload) {
      const head = b64url(te.encode(JSON.stringify({ alg: "ES256", typ: "px-peer", kid: rec.kid })));
      const body = b64url(te.encode(JSON.stringify(payload)));
      return `${head}.${body}.${await sign(`${head}.${body}`)}`;
    },
    async signItem(p) {
      const dataHash = await sha256Hex(canonicalize(p.data));
      return sign(itemMessage({ org: p.org, project: p.project, kind: p.kind, id: p.id, version: p.version, updatedAt: p.updatedAt, dataHash }));
    },
    async signItemV3(p) {
      const dataHash = await sha256Hex(canonicalize(p.data));
      return sign(itemMessageV3({ org: p.org, project: p.project, kind: p.kind, view: p.view, id: p.id, version: p.version, updatedAt: p.updatedAt, dataHash }));
    },
  };
}

export const TEST_VECTOR = {
  value: { b: [1, 2.5, "x"], a: { z: null, y: "é\n\"", x: -0.5 }, c: true },
  canonical: '{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}',
  sha256: "bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565",
} as const;

// ─── added for the specs ────────────────────────────────────────────────────────────────────────────

export type PublicKeyInfo = { kid: string; alg: string; jwk: JsonWebKey; active: boolean };
export type SignedRow = { project: string; kind: string; id: string; version: number; updated_at: string; data: unknown; sig: string; kid: string; sig3?: string };

export type TestServer = {
  rec: KeyRecord;
  signing: Signing;
  /** What handler.ts attest() returns in `public_keys`. */
  publicKeyInfo: PublicKeyInfo;
  /** The token handler.ts attest() signs (cnf only when a device key thumbprint is given). `iat` defaults to now. */
  attestToken(c: { sub: string; org: string; view: string; projects: string[]; iat?: number; exp?: number; jkt?: string; orgView?: string }): Promise<string>;
  /** One /pull item as the laptop stores it: px2 `sig`, px3 `sig3` for `view` (null = an older server without px3), the key id. */
  signedRow(org: string, view: string | null, r: Omit<SignedRow, "sig" | "kid" | "sig3">): Promise<SignedRow>;
};

/** A fresh server key record (sign.ts generateKeyRecord) and the signer handler.ts builds from it. */
export async function createTestServer(): Promise<TestServer> {
  const canonical = canonicalize(TEST_VECTOR.value);
  if (canonical !== TEST_VECTOR.canonical || (await sha256Hex(canonical)) !== TEST_VECTOR.sha256) throw new Error("lf-peer-sign.ts drifted from sign.ts TEST_VECTOR");
  const rec = await generateKeyRecord();
  const signing = await createSigning(rec);
  return {
    rec,
    signing,
    publicKeyInfo: { kid: rec.kid, alg: "ES256", jwk: rec.public_jwk, active: true },
    attestToken(c) {
      const iat = c.iat ?? Math.floor(Date.now() / 1000);
      const exp = c.exp ?? iat + ATTEST_TTL_SECONDS;
      return signing.signToken({ typ: "px-peer", v: 1, sub: c.sub, org: c.org, projects: c.projects, view: c.view, iat, exp, ...(c.jkt ? { cnf: { jkt: c.jkt } } : {}), ...(c.orgView ? { org_view: c.orgView } : {}) });
    },
    async signedRow(org, view, r) {
      const base = { org, project: r.project, kind: r.kind, id: r.id, version: r.version, updatedAt: r.updated_at, data: r.data };
      const sig = await signing.signItem(base);
      const sig3 = view ? await signing.signItemV3({ ...base, view }) : undefined;
      return { ...r, sig, kid: rec.kid, ...(sig3 ? { sig3 } : {}) };
    },
  };
}
