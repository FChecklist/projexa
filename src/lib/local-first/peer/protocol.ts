// LOCAL-FIRST PEERS: the conversation two laptops hold over one data channel (CONTRACT.md section 4).
//
//   both sides  -> hello {token}                     the peer's 24 h attestation, signed by OUR server
//   both sides  -> have  {projects: {p: {kind: {n, digest}}}, reply}
//                                                    what I hold that I may share, only for projects in BOTH tokens
//   receiver    -> want  {project, kind, known:[[id, version]...], done}
//                                                    sent only for a (project, kind) whose digest differs; `known` may span messages
//   sender      -> items {rows: SignedRow[]}         rows newer than `known`, in batches of at most maxBatchBytes
//   receiver    -> gone  {project, kind, ids:[[id, version]...]}
//                                                    AUDIT-100 B8: sent with a want: the receiver's tombstones of that (project, kind) (the
//                                                    server deleted them at that version). A HINT for the peer, never a delete: see below
//   sender      -> end   {project, kind}
//   either      -> bye   {reason}                    then the link is closed
//
// RELEASE RELAY (P4, docs/local-first/RELEASE_RELAY.md; only when `options.release` is given, only after the hello verified):
//   sender      -> rel_have  {version, manifest_sha256}   "I hold a verified, signed release" (announced once per session)
//   receiver    -> rel_want  {manifest_sha256}            only if release.wants() says it is newer and signing keys are pinned
//   sender      -> rel_start {manifest, signature, size, chunks}, then rel_chunk {i, b} x chunks   (or rel_none)
// The receiver hands the reassembled package to release.accept(), which verifies the manifest digest, the pinned-key signature, that the
// version is newer, and the bundle size/sha256/every file hash -- the download path's checks -- and only then parks it. Nothing unverified is ever
// stored, installed or passed on; a peer that sends a bad package is dropped from the exchange, not trusted any less or more.
//
// Rules (each has a test in protocol.test.ts, and the first five a planted-bug check):
//   * a hello is accepted only when the token verifies under a key we hold, is unexpired, and names the SAME org and the SAME
//     view class as ours; anything else is a bye and NOTHING of ours is ever sent (have/items wait for a verified hello);
//   * a row is accepted only when its server signature verifies for OUR org, its project is in both tokens, it is not a
//     tombstone, its version is strictly higher than the local serverVersion, and the local record is not dirty;
//   * lf-e9: a row that carries the px3 signature (`sig3`, it commits to the view class the row was cut for) must verify for OUR
//     view class, or it is refused as `wrong_view` (px3.test.ts); a row with only px2 is still accepted until every server sends px3;
//   * AUDIT-100 B8: a row is also refused (`deleted`) when the receiver holds a TOMBSTONE for it at that version or newer (the server
//     deleted it; local-db.ts schema 5), and a receiver lists its tombstones in `known` so a sender does not even offer such a row;
//   * the sender hands over only rows with a valid server signature and no pending local edit (local-db.ts isShareable),
//     and never a version or a deletion of its own (a signed row cannot be altered: its version is inside the signature);
//   * AUDIT-100 B8: deletions are not signed by the server, so a `gone` message NEVER deletes anything: the receiver only stops sharing
//     the named rows and asks the SERVER about them at its next sync (replica.ts verifySuspects), which removes them (with a tombstone)
//     only when the server confirms. A lying peer can at most make a laptop ask the server about a few rows (bounded, SUSPECT_MAX);
//     an older peer ignores the message (unknown types are ignored after hello);
//   * every message is size-capped; an oversized or unparseable message ends the session;
//   * lf-e7: ORGANISATION rows (project "__org__") are shared only when BOTH tokens carry the server-attested organisation view class
//     (claim `org_view`) and it is equal -- today's /attest does not send it, so they do not move yet; a token project named "__org__"
//     is never the organisation; org_people (and any `peer_shareable: false` kind) never moves, either way (org-peer.test.ts).
//
// Pure apart from WebCrypto: the link, the store, the keys and the clock are all injected.

import { canonicalize, sha256Hex, verifyRow, verifyRowV3, verifyToken, type KeyRing, type PeerClaims, type SignedRow } from "./verify";
import type { PeerLink } from "./transport";
import { ORG_PROJECT } from "../sync-client";
import { NEVER_PEER_KINDS } from "../replica-org";
import type { ReleaseRelay, RelayPackage } from "../release/relay";
import { b64url, fromB64url } from "../../release-dist/signed-manifest";

export const MAX_MESSAGE_BYTES = 512 * 1024;
export const DEFAULT_BATCH_BYTES = 64 * 1024;
export const KNOWN_PER_MESSAGE = 2000;
/** lf-e9: how often a session asks for a lost hello again, and how often it answers such an ask (bounded: never a loop). */
export const MAX_HELLO_RESENDS = 3;
/** Release relay: raw bytes per `rel_chunk` (base64 of it plus the JSON frame stays far below MAX_MESSAGE_BYTES). */
export const RELAY_CHUNK_BYTES = 192 * 1024;
export const MAX_RELAY_BYTES = 32 * 1024 * 1024;

export type PairSummary = { n: number; digest: string };
export type ProjectSummary = Record<string, PairSummary>;

/** The narrow view of the local database a peer session needs (localdb-store.ts implements it over LocalDb). */
export type PeerStore = {
  /** Per kind, a summary of the SHAREABLE rows of one project. */
  summary(project: string): Promise<ProjectSummary>;
  /** Every local row of (project, kind) with the server version it is at (-1 when unversioned). Dirty rows included. */
  known(project: string, kind: string): Promise<Array<[string, number]>>;
  /** The rows of (project, kind) that may be handed to another laptop: signed and not dirty. */
  shareable(project: string, kind: string): Promise<SignedRow[]>;
  /** What the receiver needs to know about its own copy of a record. */
  local(kind: string, id: string): Promise<{ dirty: boolean; serverVersion: number | null } | null>;
  /** Stores verified rows (as server rows: a row turned dirty meanwhile is parked, never overwritten). Returns how many were written. */
  apply(rows: SignedRow[]): Promise<number>;
  /** AUDIT-100 B8: the tombstone this laptop holds for a record (the server deleted it at `version`; null = any version), or null. */
  deleted?(kind: string, id: string): Promise<{ version: number | null } | null>;
  /** AUDIT-100 B8: every tombstone of (project, kind), as [id, version]. */
  tombstones?(project: string, kind: string): Promise<Array<[string, number | null]>>;
  /** AUDIT-100 B8: a peer said these rows were deleted (UNSIGNED): keep them out of sharing and have the server checked. Deletes nothing. */
  suspect?(project: string, kind: string, ids: Array<[string, number | null]>): Promise<void>;
};

export type RejectReason = "bad_signature" | "wrong_view" | "not_shared" | "tombstone" | "not_newer" | "dirty" | "foreign_org" | "malformed" | "deleted";

export type SessionState = "connecting" | "verified" | "closed";

export type SessionStats = { accepted: number; rejected: Partial<Record<RejectReason, number>>; sent: number };

export type HelloRefusal = "malformed" | "unknown_key" | "bad_signature" | "expired" | "not_yet_valid" | "wrong_type" | "wrong_org" | "wrong_view";

export type PeerSessionOptions = {
  link: PeerLink;
  /** Our own attestation: the token we present and its claims (verified by the caller, or trusted as ours). */
  self: { token: string; claims: PeerClaims };
  keys: KeyRing;
  store: PeerStore;
  now?: () => number;
  maxBatchBytes?: number;
  /** Kinds that may move at all (default: every kind). */
  allowedKinds?: readonly string[];
  /** lf-e7: organisation kinds that never move between laptops (manifest `peer_shareable: false`); org_people always among them. */
  noPeerKinds?: readonly string[];
  /**
   * lf-e9 review: a row WITHOUT `sig3` is refused (reason wrong_view). px2 alone does not commit to the view class, so a peer could strip
   * sig3 from a row cut for another class and have it accepted. The server signs px3 on every row that has a view; the real network sets this.
   */
  requirePx3?: boolean;
  /** A data field naming another organisation (replica.ts foreignOrg). */
  foreignOrg?: (data: unknown, org: string) => boolean;
  /** Release relay (release/relay.ts). Absent: the `rel_*` messages are ignored and none is sent. */
  release?: ReleaseRelay;
  /** Told the outcome of every package received from this peer. */
  onRelease?: (result: { accepted: boolean; reason?: string; version?: string }) => void;
  onVerified?: (peer: PeerClaims) => void;
  onRefused?: (reason: HelloRefusal | "protocol") => void;
  onRows?: (accepted: number) => void;
  onClose?: () => void;
};

export type PeerSession = {
  readonly state: SessionState;
  readonly peer: PeerClaims | null;
  readonly stats: SessionStats;
  /** Projects present in both tokens (empty until verified). */
  readonly sharedProjects: string[];
  /** Asks the peer for anything new (sends our `have` with reply=true). Resolves when every want it caused has ended, or on timeout/close. */
  resync(timeoutMs?: number): Promise<SessionStats>;
  /** Resolves once the first exchange after hello has finished receiving (or the session closed). */
  readonly ready: Promise<void>;
  close(reason?: string): void;
};

type Msg =
  | { t: "hello"; token: string; ask?: boolean }
  | { t: "have"; projects: Record<string, ProjectSummary>; reply?: boolean }
  | { t: "want"; project: string; kind: string; known: Array<[string, number]>; done: boolean }
  | { t: "items"; rows: SignedRow[] }
  | { t: "gone"; project: string; kind: string; ids: Array<[string, number | null]> }
  | { t: "end"; project: string; kind: string }
  | { t: "bye"; reason: string }
  | { t: "rel_have"; version: string; manifest_sha256: string }
  | { t: "rel_want"; manifest_sha256: string }
  | { t: "rel_start"; manifest: unknown; signature: unknown; size: number; chunks: number }
  | { t: "rel_chunk"; i: number; b: string }
  | { t: "rel_none" };

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export async function digestOf(rows: Array<[string, number]>): Promise<string> {
  const sorted = [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return (await sha256Hex(canonicalize(sorted))).slice(0, 32);
}

function isRowShape(r: unknown): r is SignedRow & { deleted?: unknown } {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return typeof o.project === "string" && typeof o.kind === "string" && typeof o.id === "string" && typeof o.version === "number"
    && typeof o.updated_at === "string" && typeof o.sig === "string" && typeof o.kid === "string" && "data" in o;
}

export function createPeerSession(options: PeerSessionOptions): PeerSession {
  const { link, self, keys, store } = options;
  const now = options.now ?? (() => Date.now());
  const maxBatch = Math.max(1024, options.maxBatchBytes ?? DEFAULT_BATCH_BYTES);
  const allowed = options.allowedKinds ? new Set(options.allowedKinds) : null;
  // lf-e7: a kind moves only when allowed AND not one that must never leave its laptop (org_people: the person's own unmasked email)
  const noPeer = new Set([...NEVER_PEER_KINDS, ...(options.noPeerKinds ?? [])]);
  const kindOk = (kind: string) => (!allowed || allowed.has(kind)) && !noPeer.has(kind);

  let state: SessionState = "connecting";
  let peer: PeerClaims | null = null;
  let shared = new Set<string>();
  const stats: SessionStats = { accepted: 0, rejected: {}, sent: 0 };
  /** Wants we sent and are waiting on (`project|kind`). */
  const pending = new Set<string>();
  /** `known` lists the peer is still sending us (`project|kind`). */
  const incomingKnown = new Map<string, Map<string, number>>();
  const waiters: Array<() => void> = [];
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));
  let firstHaveSeen = false;
  let helloAsks = 0;
  let helloResends = 0;
  // Messages are handled strictly one after another: a batch of rows is stored before the next message is looked at.
  let chain: Promise<void> = Promise.resolve();
  // release relay state
  let relayAsked: string | null = null;
  let relayTried = false;
  const relayServed = new Set<string>();
  let assembly: { manifest: unknown; signature: unknown; size: number; chunks: number; next: number; parts: Uint8Array[]; got: number } | null = null;

  const send = (m: Msg) => {
    if (state === "closed" || !link.open) return;
    const text = JSON.stringify(m);
    if (byteLength(text) > MAX_MESSAGE_BYTES) return; // never send what the other side would refuse
    link.send(text);
  };

  const settle = () => {
    if (pending.size > 0) return;
    if (firstHaveSeen) readyResolve();
    while (waiters.length) waiters.shift()!();
  };

  const close = (reason = "done") => {
    if (state === "closed") return;
    if (link.open) {
      try { link.send(JSON.stringify({ t: "bye", reason } satisfies Msg)); } catch { /* the link is going anyway */ }
    }
    state = "closed";
    pending.clear();
    readyResolve();
    while (waiters.length) waiters.shift()!();
    link.close();
    options.onClose?.();
  };

  const refuse = (reason: HelloRefusal | "protocol") => {
    options.onRefused?.(reason);
    close(reason);
  };

  const reject = (reason: RejectReason) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  };

  async function sendHave(reply: boolean) {
    const projects: Record<string, ProjectSummary> = {};
    for (const p of shared) {
      const s = await store.summary(p);
      projects[p] = Object.fromEntries(Object.entries(s).filter(([k]) => kindOk(k)));
    }
    send({ t: "have", projects, reply });
  }

  async function onHello(token: unknown, ask: boolean) {
    if (peer) {
      // a second hello changes nothing; one that ASKS means the peer never got ours (lf-e9: lost in a real browser), so it is sent again
      if (ask && helloResends < MAX_HELLO_RESENDS) { helloResends += 1; send({ t: "hello", token: self.token }); }
      return;
    }
    const check = await verifyToken(token, keys, now());
    if (!check.ok) return refuse(check.reason);
    if (check.claims.org !== self.claims.org) return refuse("wrong_org");
    if (check.claims.view !== self.claims.view) return refuse("wrong_view");
    peer = check.claims;
    const theirs = new Set(peer.projects);
    shared = new Set(self.claims.projects.filter((p) => theirs.has(p) && p !== ORG_PROJECT));
    // lf-e7: the organisation's rows move only between two laptops whose server-attested ORGANISATION view class is the same (both
    // tokens carry `org_view` and it is equal); otherwise a laptop could hand a lower role vendor rows the server never gave it.
    if (self.claims.orgView && peer.orgView && self.claims.orgView === peer.orgView) shared.add(ORG_PROJECT);
    state = "verified";
    options.onVerified?.(peer);
    // when we had to ask for this hello, the peer's own `have` arrived before it and was dropped: ask it to send that again
    await sendHave(helloAsks > 0);
    if (options.release) {
      const offer = await options.release.offer().catch(() => null);
      if (offer) send({ t: "rel_have", version: offer.version, manifest_sha256: offer.manifest_sha256 });
    }
  }

  async function onRelHave(m: Extract<Msg, { t: "rel_have" }>) {
    const rel = options.release;
    if (!rel || relayTried || typeof m.version !== "string" || typeof m.manifest_sha256 !== "string") return;
    if (!(await rel.wants({ version: m.version, manifest_sha256: m.manifest_sha256 }))) return;
    relayTried = true; // one attempt per session: a peer cannot make us ask over and over
    relayAsked = m.manifest_sha256;
    send({ t: "rel_want", manifest_sha256: m.manifest_sha256 });
  }

  async function onRelWant(m: Extract<Msg, { t: "rel_want" }>) {
    const rel = options.release;
    if (!rel || typeof m.manifest_sha256 !== "string") return;
    if (relayServed.has(m.manifest_sha256)) return; // each package at most once per session
    relayServed.add(m.manifest_sha256);
    const pkg: RelayPackage | null = await rel.serve(m.manifest_sha256).catch(() => null); // serve() verifies it again before it leaves
    if (!pkg) return void send({ t: "rel_none" });
    const chunks = Math.ceil(pkg.bundle.length / RELAY_CHUNK_BYTES);
    send({ t: "rel_start", manifest: pkg.manifest, signature: pkg.signature, size: pkg.bundle.length, chunks });
    for (let i = 0; i < chunks; i += 1) {
      send({ t: "rel_chunk", i, b: b64url(pkg.bundle.subarray(i * RELAY_CHUNK_BYTES, (i + 1) * RELAY_CHUNK_BYTES)) });
      if (i % 4 === 3) await new Promise<void>((r) => setTimeout(r, 0)); // let the link drain; never a burst of megabytes in one turn
    }
  }

  function onRelStart(m: Extract<Msg, { t: "rel_start" }>) {
    assembly = null;
    if (!options.release || relayAsked === null) return; // we never asked: ignore
    const manifest = m.manifest as { manifest_sha256?: unknown; bundle?: { size?: unknown } } | null;
    const ok = Number.isInteger(m.size) && m.size > 0 && m.size <= MAX_RELAY_BYTES
      && m.chunks === Math.ceil(m.size / RELAY_CHUNK_BYTES)
      && manifest !== null && typeof manifest === "object" && manifest.manifest_sha256 === relayAsked && manifest.bundle?.size === m.size;
    if (!ok) return void options.onRelease?.({ accepted: false, reason: "malformed" });
    assembly = { manifest: m.manifest, signature: m.signature, size: m.size, chunks: m.chunks, next: 0, parts: [], got: 0 };
  }

  async function onRelChunk(m: Extract<Msg, { t: "rel_chunk" }>) {
    const a = assembly;
    if (!a || !options.release) return;
    let bytes: Uint8Array;
    try {
      if (m.i !== a.next || typeof m.b !== "string") throw new Error("order");
      bytes = fromB64url(m.b);
      if (bytes.length > RELAY_CHUNK_BYTES || a.got + bytes.length > a.size) throw new Error("size");
    } catch {
      assembly = null;
      return void options.onRelease?.({ accepted: false, reason: "malformed" });
    }
    a.parts.push(bytes);
    a.got += bytes.length;
    a.next += 1;
    if (a.next < a.chunks) return;
    assembly = null;
    if (a.got !== a.size) return void options.onRelease?.({ accepted: false, reason: "malformed" });
    const bundle = new Uint8Array(a.size);
    let at = 0;
    for (const part of a.parts) { bundle.set(part, at); at += part.length; }
    const verdict = await options.release.accept({ manifest: a.manifest as RelayPackage["manifest"], signature: a.signature as RelayPackage["signature"], bundle });
    options.onRelease?.(verdict.ok ? { accepted: true, version: (a.manifest as RelayPackage["manifest"]).release_version } : { accepted: false, reason: verdict.reason });
  }

  async function onHave(m: Extract<Msg, { t: "have" }>) {
    if (typeof m.projects !== "object" || m.projects === null) return refuse("protocol");
    firstHaveSeen = true;
    for (const [project, kinds] of Object.entries(m.projects)) {
      if (!shared.has(project) || typeof kinds !== "object" || kinds === null) continue;
      const mine = await store.summary(project);
      for (const [kind, summary] of Object.entries(kinds)) {
        if (!kindOk(kind)) continue;
        if (!summary || typeof summary.digest !== "string" || summary.n === 0) continue;
        if (mine[kind]?.digest === summary.digest) continue;
        const key = `${project}|${kind}`;
        if (pending.has(key)) continue;
        pending.add(key);
        const known = await store.known(project, kind);
        if (known.length === 0) send({ t: "want", project, kind, known: [], done: true });
        for (let i = 0; i < known.length; i += KNOWN_PER_MESSAGE) {
          send({ t: "want", project, kind, known: known.slice(i, i + KNOWN_PER_MESSAGE), done: i + KNOWN_PER_MESSAGE >= known.length });
        }
        // AUDIT-100 B8: the peer's copy of this kind differs from ours; if it still holds a row the server deleted, it should know (a HINT
        // it checks with the server). Its own store keeps only the ids it really holds at a version the tombstone covers.
        const tombs = store.tombstones ? await store.tombstones(project, kind) : [];
        for (let i = 0; i < tombs.length; i += KNOWN_PER_MESSAGE) send({ t: "gone", project, kind, ids: tombs.slice(i, i + KNOWN_PER_MESSAGE) });
      }
    }
    if (m.reply) await sendHave(false);
    settle();
  }

  async function onWant(m: Extract<Msg, { t: "want" }>) {
    if (typeof m.project !== "string" || typeof m.kind !== "string" || !Array.isArray(m.known)) return refuse("protocol");
    const key = `${m.project}|${m.kind}`;
    let acc = incomingKnown.get(key);
    if (!acc) incomingKnown.set(key, (acc = new Map()));
    for (const e of m.known) if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number") acc.set(e[0], e[1]);
    if (!m.done) return;
    incomingKnown.delete(key);
    // Only projects in both tokens, only allowed kinds; otherwise answer an empty end so the peer is not left waiting.
    if (shared.has(m.project) && kindOk(m.kind)) {
      const rows = await store.shareable(m.project, m.kind);
      let batch: SignedRow[] = [];
      let size = 0;
      for (const row of rows) {
        // the store already filters, but the rule is the sender's to keep: a row without a server signature never leaves
        if (!row.sig || !row.kid) continue;
        const theirs = acc.get(row.id);
        if (theirs !== undefined && theirs >= row.version) continue;
        const bytes = byteLength(JSON.stringify(row));
        if (bytes > MAX_MESSAGE_BYTES - 64) continue; // a single row too large for one message travels by the server path instead
        if (size + bytes > maxBatch && batch.length > 0) {
          send({ t: "items", rows: batch });
          batch = [];
          size = 0;
        }
        batch.push(row);
        size += bytes;
        stats.sent += 1;
      }
      if (batch.length) send({ t: "items", rows: batch });
    }
    send({ t: "end", project: m.project, kind: m.kind });
  }

  async function onItems(m: Extract<Msg, { t: "items" }>) {
    if (!Array.isArray(m.rows)) return refuse("protocol");
    const accept: SignedRow[] = [];
    for (const raw of m.rows) {
      if (!isRowShape(raw)) { reject("malformed"); continue; }
      if ((raw as { deleted?: unknown }).deleted !== undefined) { reject("tombstone"); continue; }
      if (!shared.has(raw.project) || !kindOk(raw.kind)) { reject("not_shared"); continue; }
      const sig3 = (raw as { sig3?: unknown }).sig3;
      if (sig3 !== undefined && (typeof sig3 !== "string" || sig3 === "")) { reject("malformed"); continue; }
      const row: SignedRow = { project: raw.project, kind: raw.kind, id: raw.id, version: raw.version, updated_at: raw.updated_at, data: raw.data, sig: raw.sig, kid: raw.kid, ...(sig3 ? { sig3 } : {}) };
      if (!(await verifyRow(row, self.claims.org, keys))) { reject("bad_signature"); continue; }
      // lf-e9 (px3): a row that carries the view-class signature must carry it for OUR view class; one cut for another class is refused
      // (the server signs an ORGANISATION row's px3 with the organisation view class, handler.ts `isOrgKind(kind) ? orgView : view`)
      const v3View = row.project === ORG_PROJECT ? self.claims.orgView : self.claims.view;
      if ((row.sig3 || options.requirePx3) && !(v3View && row.sig3 && (await verifyRowV3(row, self.claims.org, v3View, keys)))) { reject("wrong_view"); continue; }
      if (options.foreignOrg?.(row.data, self.claims.org)) { reject("foreign_org"); continue; }
      // AUDIT-100 B8: the server deleted this record at this version or later (this laptop's tombstone): never stored again
      const gone = store.deleted ? await store.deleted(row.kind, row.id) : null;
      if (gone && (gone.version === null || row.version <= gone.version)) { reject("deleted"); continue; }
      const local = await store.local(row.kind, row.id);
      if (local?.dirty) { reject("dirty"); continue; }
      if (local && local.serverVersion !== null && row.version <= local.serverVersion) { reject("not_newer"); continue; }
      accept.push(row);
    }
    if (accept.length) {
      const written = await store.apply(accept);
      stats.accepted += written;
      options.onRows?.(written);
    }
  }

  async function onGone(m: Extract<Msg, { t: "gone" }>) {
    if (typeof m.project !== "string" || typeof m.kind !== "string" || !Array.isArray(m.ids)) return refuse("protocol");
    if (!shared.has(m.project) || !kindOk(m.kind) || !store.suspect) return;
    const ids = m.ids
      .filter((e): e is [string, number | null] => Array.isArray(e) && typeof e[0] === "string" && (e[1] === null || (typeof e[1] === "number" && Number.isFinite(e[1]))))
      .slice(0, KNOWN_PER_MESSAGE);
    await store.suspect(m.project, m.kind, ids);
  }

  async function handle(text: string) {
    if (state === "closed") return;
    if (byteLength(text) > MAX_MESSAGE_BYTES) return refuse("protocol");
    let m: Msg;
    try {
      m = JSON.parse(text) as Msg;
    } catch {
      return refuse("protocol");
    }
    if (typeof m !== "object" || m === null || typeof (m as { t?: unknown }).t !== "string") return refuse("protocol");
    if (m.t === "bye") return close("bye");
    if (m.t === "hello") return onHello(m.token, m.ask === true);
    // Nothing but hello is looked at before the peer proved who it is. But traffic from a peer whose hello we never saw means the peer
    // verified US and its own hello was lost on the way (lf-e9: seen in Chromium when the answering side sends it the instant its data
    // channel opens): ask for it again, a bounded number of times, instead of both sides waiting forever on a half-open session.
    if (!peer) {
      if (helloAsks < MAX_HELLO_RESENDS) { helloAsks += 1; send({ t: "hello", token: self.token, ask: true }); }
      return;
    }
    if (m.t === "have") return onHave(m);
    if (m.t === "want") return onWant(m);
    if (m.t === "items") return onItems(m);
    if (m.t === "gone") return onGone(m);
    if (m.t === "rel_have") return onRelHave(m);
    if (m.t === "rel_want") return onRelWant(m);
    if (m.t === "rel_start") return onRelStart(m);
    if (m.t === "rel_chunk") return onRelChunk(m);
    if (m.t === "rel_none") { relayAsked = null; return; }
    if (m.t === "end") {
      pending.delete(`${m.project}|${m.kind}`);
      settle();
      return;
    }
  }

  link.onmessage = (text) => {
    chain = chain.then(() => handle(text)).catch(() => refuse("protocol"));
  };
  link.onclose = () => {
    if (state !== "closed") {
      state = "closed";
      pending.clear();
      readyResolve();
      while (waiters.length) waiters.shift()!();
      options.onClose?.();
    }
  };

  send({ t: "hello", token: self.token });

  return {
    get state() { return state; },
    get peer() { return peer; },
    get stats() { return stats; },
    get sharedProjects() { return [...shared]; },
    ready,
    async resync(timeoutMs = 60_000) {
      if (state !== "verified") return stats;
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      chain = chain.then(() => sendHave(true));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([done, new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
      if (timer) clearTimeout(timer);
      return stats;
    },
    close,
  };
}
