// LOCAL-FIRST PEERS (owner directive 2026-10-02, requirements G3/R2/R3): the verification half of laptop <-> laptop sync.
//
// A laptop may receive rows from ANOTHER laptop of its organisation (WebRTC, no server in the data path). It cannot trust that
// laptop, so it trusts only what OUR server signed:
//   * the peer's attestation token (POST /attest): a compact ES256 JWS `{typ:"px-peer", v, sub, org, projects, view, iat, exp}`,
//     24 hours long so two laptops can still verify each other while our server is down;
//   * every row: an ES256 signature over `px2|org|project|kind|id|version|updated_at|sha256hex(canonicalJSON(data))`.
// Both are checked here with WebCrypto against the server's PUBLIC keys, which are cached in the laptop's own database
// (meta PEER_KEYS_KEY) so verification keeps working with our server unreachable.
//
// The canonicalisation and the message layout are byte-for-byte those of compliance-tracker
// supabase/functions/projexa-sync/sign.ts; both repos assert the same TEST_VECTOR (CONTRACT.md section 1), so a drift fails a test.
//
// This file is pure (WebCrypto + plain data): no network, no IndexedDB of its own; the key cache takes a tiny meta store.

export const ITEM_MESSAGE_PREFIX = "px2";
export const TOKEN_TYPE = "px-peer";
/** A peer's clock may be a little off: an `iat` this far in the future is still accepted. */
export const CLOCK_SKEW_SECONDS = 300;
/** Meta keys in the person's local database. */
export const PEER_KEYS_KEY = "peer:keys";
export const PEER_ATTEST_KEY = "peer:attest";

/** The same constant as TEST_VECTOR in compliance-tracker supabase/functions/projexa-sync/sign.ts. */
export const TEST_VECTOR = {
  value: { b: [1, 2.5, "x"], a: { z: null, y: "é\n\"", x: -0.5 }, c: true },
  canonical: '{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}',
  sha256: "bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565",
} as const;

export type PublicKeyInfo = { kid: string; alg: string; jwk: JsonWebKey; active?: boolean };

export type PeerClaims = {
  typ: string; v: number; sub: string; org: string; projects: string[]; view: string; iat: number; exp: number;
  /**
   * lf-e7: the ORGANISATION view class (drizzle/0684 org_view_class) the server attests, claim `org_view`. Organisation rows move between
   * two laptops only when both tokens carry it and it is equal (protocol.ts). Absent from today's /attest: then they never move.
   */
  orgView?: string;
};

/**
 * A signed row as one laptop hands it to another. Nothing else travels: no tombstones, no local fields.
 * `sig3` (lf-e9): the server's px3 signature, which also commits to the VIEW CLASS the row was redacted for (sign.ts itemMessageV3).
 * Sent whenever the laptop holds one; a receiver that gets it verifies it with its OWN view class, so a row cut for another class is refused.
 */
export type SignedRow = { project: string; kind: string; id: string; version: number; updated_at: string; data: unknown; sig: string; kid: string; sig3?: string };

const te = new TextEncoder();
const td = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON with object keys sorted at every level (arrays keep their order). `undefined` members are dropped like JSON.stringify drops them. */
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

/** px3 (byte-for-byte compliance-tracker sign.ts itemMessageV3): JSON-encoded fields, and the view class the row was redacted for. */
export const ITEM_MESSAGE_PREFIX_V3 = "px3";
export function itemMessageV3(parts: { org: string; project: string; kind: string; view: string; id: string; version: number; updatedAt: string; dataHash: string }): string {
  return ITEM_MESSAGE_PREFIX_V3 + JSON.stringify([parts.org, parts.project, parts.kind, parts.view, parts.id, String(parts.version), parts.updatedAt, parts.dataHash]);
}

async function verifyRaw(pub: CryptoKey, message: string, sigB64url: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(sigB64url), te.encode(message));
  } catch {
    return false;
  }
}

// ─── the key ring ───────────────────────────────────────────────────────────────────────────────────

/** The two meta calls the key cache needs (a LocalDb satisfies it). */
export type MetaStore = { getMeta<T = unknown>(key: string): Promise<T | undefined>; setMeta(key: string, value: unknown): Promise<void> };

export type KeyRing = {
  /** The public key for `kid`, or null when unknown (a key we were never given cannot verify anything). */
  get(kid: string): Promise<CryptoKey | null>;
  /** Replaces the cached key list (what /attest returned) and persists it. */
  replace(keys: PublicKeyInfo[]): Promise<void>;
  kids(): Promise<string[]>;
};

function validKeyInfo(k: unknown): k is PublicKeyInfo {
  if (typeof k !== "object" || k === null) return false;
  const o = k as Record<string, unknown>;
  return typeof o.kid === "string" && o.kid !== "" && o.alg === "ES256" && typeof o.jwk === "object" && o.jwk !== null;
}

/**
 * Public keys looked up by `kid`, cached in the local database (meta PEER_KEYS_KEY). A key the server no longer lists is
 * dropped on the next replace(); a key listed as inactive still verifies (rows signed before a rotation stay valid).
 */
export function createKeyRing(store: MetaStore): KeyRing {
  const imported = new Map<string, Promise<CryptoKey | null>>();
  let list: PublicKeyInfo[] | null = null;

  async function load(): Promise<PublicKeyInfo[]> {
    if (list) return list;
    const stored = await store.getMeta<unknown>(PEER_KEYS_KEY);
    list = Array.isArray(stored) ? stored.filter(validKeyInfo) : [];
    return list;
  }

  return {
    async get(kid) {
      const keys = await load();
      const info = keys.find((k) => k.kid === kid);
      if (!info) return null;
      let p = imported.get(kid);
      if (!p) {
        const { kty, crv, x, y } = info.jwk;
        p = crypto.subtle.importKey("jwk", { kty, crv, x, y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]).catch(() => null);
        imported.set(kid, p);
      }
      return p;
    },
    async replace(keys) {
      const clean = keys.filter(validKeyInfo).map((k) => ({ kid: k.kid, alg: k.alg, jwk: k.jwk, active: k.active !== false }));
      await store.setMeta(PEER_KEYS_KEY, clean);
      list = clean;
      imported.clear();
    },
    async kids() {
      return (await load()).map((k) => k.kid);
    },
  };
}

// ─── attestation tokens ─────────────────────────────────────────────────────────────────────────────

export type TokenCheck = { ok: true; claims: PeerClaims } | { ok: false; reason: "malformed" | "unknown_key" | "bad_signature" | "expired" | "not_yet_valid" | "wrong_type" };

function parseJsonPart(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(td.decode(fromB64url(part)));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Verifies a peer attestation token: shape, a key we hold, the ES256 signature, the type and the time window. */
export async function verifyToken(token: unknown, keys: KeyRing, nowMs: number): Promise<TokenCheck> {
  if (typeof token !== "string" || token.length > 8192) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const head = parseJsonPart(parts[0]);
  const body = parseJsonPart(parts[1]);
  if (!head || !body || head.alg !== "ES256" || typeof head.kid !== "string") return { ok: false, reason: "malformed" };
  const pub = await keys.get(head.kid);
  if (!pub) return { ok: false, reason: "unknown_key" };
  if (!(await verifyRaw(pub, `${parts[0]}.${parts[1]}`, parts[2]))) return { ok: false, reason: "bad_signature" };
  if (head.typ !== TOKEN_TYPE || body.typ !== TOKEN_TYPE) return { ok: false, reason: "wrong_type" };
  const { sub, org, projects, view, iat, exp } = body;
  if (typeof sub !== "string" || typeof org !== "string" || typeof view !== "string" || !Array.isArray(projects) || !projects.every((p) => typeof p === "string")
    || typeof iat !== "number" || typeof exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  const now = Math.floor(nowMs / 1000);
  if (exp <= now) return { ok: false, reason: "expired" };
  if (iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  const orgView = typeof body.org_view === "string" && body.org_view !== "" ? body.org_view : undefined;
  return { ok: true, claims: { typ: TOKEN_TYPE, v: typeof body.v === "number" ? body.v : 1, sub, org, projects: projects as string[], view, iat, exp, ...(orgView ? { orgView } : {}) } };
}

// ─── rows ───────────────────────────────────────────────────────────────────────────────────────────

/** True only when `row` carries a valid server signature for organisation `org` under a key we hold. */
export async function verifyRow(row: SignedRow, org: string, keys: KeyRing): Promise<boolean> {
  if (typeof row.sig !== "string" || typeof row.kid !== "string" || !Number.isInteger(row.version) || row.version < 0 || typeof row.updated_at !== "string") return false;
  const pub = await keys.get(row.kid);
  if (!pub) return false;
  const dataHash = await sha256Hex(canonicalize(row.data));
  return verifyRaw(pub, itemMessage({ org, project: row.project, kind: row.kind, id: row.id, version: row.version, updatedAt: row.updated_at, dataHash }), row.sig);
}

/**
 * lf-e9: true only when `row.sig3` is a valid px3 signature for organisation `org` AND view class `view` (the RECEIVER's own) under the
 * same key as `row.kid`. A row the server cut for another view class carries a sig3 over that other class and fails here.
 */
export async function verifyRowV3(row: SignedRow, org: string, view: string, keys: KeyRing): Promise<boolean> {
  if (typeof row.sig3 !== "string" || row.sig3 === "" || typeof row.kid !== "string" || !Number.isInteger(row.version) || row.version < 0 || typeof row.updated_at !== "string") return false;
  const pub = await keys.get(row.kid);
  if (!pub) return false;
  const dataHash = await sha256Hex(canonicalize(row.data));
  return verifyRaw(pub, itemMessageV3({ org, project: row.project, kind: row.kind, view, id: row.id, version: row.version, updatedAt: row.updated_at, dataHash }), row.sig3);
}
