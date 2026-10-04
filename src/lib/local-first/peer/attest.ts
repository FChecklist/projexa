// LOCAL-FIRST PEERS: this laptop's own attestation (POST /attest, CONTRACT.md section 4), kept in its local database.
//
// The server answers `{token, expires_at, org_id, user_id, view_class, projects, channel, public_keys, server_time}`. We store
// the public keys in the key ring (so every later verification works offline) and the rest under meta PEER_ATTEST_KEY.
// `current()` hands out the cached token only while it still verifies against the cached keys and is unexpired, so a laptop
// never presents a token a peer would refuse. `refresh()` asks the server again when fewer than 2 hours are left (cheap: at
// most a few calls a day); when the server is down the cached one keeps working until it expires (24 h).

import { createKeyRing, PEER_ATTEST_KEY, verifyToken, type KeyRing, type MetaStore, type PeerClaims, type PublicKeyInfo } from "./verify";

export type StoredAttestation = { token: string; expiresAt: number; orgId: string; userId: string; viewClass: string; projects: string[]; channel: string; fetchedAt: number };

export type AttestationSource = {
  current(): Promise<{ token: string; claims: PeerClaims; channel: string } | null>;
  /** Fetches a new attestation when the cached one is missing or close to expiry (or `force`). Never throws. */
  refresh(force?: boolean): Promise<boolean>;
  readonly keys: KeyRing;
};

export const REFRESH_BEFORE_MS = 2 * 60 * 60_000;

function parse(body: unknown, nowMs: number): { att: StoredAttestation; keys: PublicKeyInfo[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const exp = typeof b.expires_at === "string" ? Date.parse(b.expires_at) : NaN;
  if (typeof b.token !== "string" || typeof b.org_id !== "string" || typeof b.user_id !== "string" || typeof b.view_class !== "string"
    || typeof b.channel !== "string" || !Array.isArray(b.projects) || !Array.isArray(b.public_keys) || !Number.isFinite(exp)) return null;
  return {
    att: { token: b.token, expiresAt: exp, orgId: b.org_id, userId: b.user_id, viewClass: b.view_class, projects: b.projects.filter((p): p is string => typeof p === "string"), channel: b.channel, fetchedAt: nowMs },
    keys: b.public_keys as PublicKeyInfo[],
  };
}

// NOTE: no `userId` equality check against the attestation's `user_id`. The server's `user_id`/`sub` is the sync service's own person id
// (compliance.users), a different id space from the browser session's Supabase auth id that names this local database; comparing them
// rejected EVERY real attestation (found live, audit 37: /attest 200, nothing stored, no signalling ever opened). The cache is per
// person already (the database is `localDbNameFor(session user)`), and /attest answers for the bearer token we sent.
export function createAttestationSource(o: { meta: MetaStore; fetchAttest: () => Promise<unknown>; now?: () => number; userId: string; keys?: KeyRing }): AttestationSource {
  const now = o.now ?? (() => Date.now());
  const keys = o.keys ?? createKeyRing(o.meta);
  let inFlight: Promise<boolean> | null = null;

  return {
    keys,
    async current() {
      const att = await o.meta.getMeta<StoredAttestation>(PEER_ATTEST_KEY);
      if (!att) return null;
      const check = await verifyToken(att.token, keys, now());
      if (!check.ok) return null;
      return { token: att.token, claims: check.claims, channel: att.channel };
    },
    refresh(force = false) {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const att = await o.meta.getMeta<StoredAttestation>(PEER_ATTEST_KEY);
          if (!force && att && att.expiresAt - now() > REFRESH_BEFORE_MS) return true;
          const parsed = parse(await o.fetchAttest(), now());
          if (!parsed) return false;
          await keys.replace(parsed.keys);
          await o.meta.setMeta(PEER_ATTEST_KEY, parsed.att);
          return true;
        } catch {
          return false; // our server is down: the cached attestation (if any) keeps working until it expires
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}
