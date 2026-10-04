// TEST ONLY (lf-e7): plays OUR server's signing role like test-signer.ts, plus the `org_view` claim the peer layer needs to share
// ORGANISATION rows (drizzle/0684 org_view_class; /attest does not send it yet: a backend gap listed in the lf-e7 report), and builds a
// simulated laptop around it that connect() in laptop.ts accepts.

import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { b64url, canonicalize, createKeyRing, itemMessage, sha256Hex, verifyToken, type PeerClaims, type SignedRow } from "../verify";
import type { Laptop } from "./laptop";

const te = new TextEncoder();

export type OrgSigner = {
  token(c: { sub: string; org: string; view: string; projects: string[]; orgView?: string }, nowMs: number): Promise<string>;
  row(org: string, row: Omit<SignedRow, "sig" | "kid">): Promise<SignedRow>;
  makeLaptop(o: { userId: string; org: string; view: string; orgView?: string; projects: string[]; nowMs: number }): Promise<Laptop>;
  /** lf-e9: an ES256 signature of any message with the same key (px3 rows). */
  signRaw(message: string): Promise<string>;
};

export async function createOrgSigner(kid = "korg1"): Promise<OrgSigner> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = { kid, alg: "ES256", jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, active: true };
  const sign = async (message: string) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, te.encode(message))));
  const s: OrgSigner = {
    signRaw: sign,
    async token(c, nowMs) {
      const iat = Math.floor(nowMs / 1000);
      const payload = { typ: "px-peer", v: 1, sub: c.sub, org: c.org, projects: c.projects, view: c.view, iat, exp: iat + 86_400, ...(c.orgView ? { org_view: c.orgView } : {}) };
      const head = b64url(te.encode(JSON.stringify({ alg: "ES256", typ: "px-peer", kid })));
      const body = b64url(te.encode(JSON.stringify(payload)));
      return `${head}.${body}.${await sign(`${head}.${body}`)}`;
    },
    async row(org, r) {
      const dataHash = await sha256Hex(canonicalize(r.data));
      return { ...r, sig: await sign(itemMessage({ org, project: r.project, kind: r.kind, id: r.id, version: r.version, updatedAt: r.updated_at, dataHash })), kid };
    },
    async makeLaptop(o) {
      const db = await openLocalDb(new IDBFactory(), localDbNameFor(o.userId));
      const keys = createKeyRing(db);
      await keys.replace([publicKey]);
      const token = await s.token({ sub: o.userId, org: o.org, view: o.view, projects: o.projects, orgView: o.orgView }, o.nowMs);
      const v = await verifyToken(token, keys, o.nowMs);
      if (!v.ok) throw new Error(`test token did not verify: ${v.reason}`);
      const claims: PeerClaims = v.claims;
      return {
        userId: o.userId, org: o.org, db, keys, self: { token, claims },
        async seed(row, opts = {}) {
          const signed = await s.row(o.org, row);
          await db.putRecord({
            id: `${row.kind}:${row.id}`, type: row.kind, orgId: o.org, projectId: row.project, data: row.data,
            serverVersion: row.version, serverUpdatedAt: row.updated_at,
            ...(opts.unsigned ? {} : { sig: signed.sig, kid: signed.kid }),
            ...(opts.dirty ? { dirty: opts.dirty } : {}),
          });
        },
        get: (kind, id) => db.getRecord(kind, id),
      };
    },
  };
  return s;
}
