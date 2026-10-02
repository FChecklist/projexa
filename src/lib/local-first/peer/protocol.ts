// LOCAL-FIRST PEERS: the conversation two laptops hold over one data channel (CONTRACT.md section 4).
//
//   both sides  -> hello {token}                     the peer's 24 h attestation, signed by OUR server
//   both sides  -> have  {projects: {p: {kind: {n, digest}}}, reply}
//                                                    what I hold that I may share, only for projects in BOTH tokens
//   receiver    -> want  {project, kind, known:[[id, version]...], done}
//                                                    sent only for a (project, kind) whose digest differs; `known` may span messages
//   sender      -> items {rows: SignedRow[]}         rows newer than `known`, in batches of at most maxBatchBytes
//   sender      -> end   {project, kind}
//   either      -> bye   {reason}                    then the link is closed
//
// Rules (each has a test in protocol.test.ts, and the first five a planted-bug check):
//   * a hello is accepted only when the token verifies under a key we hold, is unexpired, and names the SAME org and the SAME
//     view class as ours; anything else is a bye and NOTHING of ours is ever sent (have/items wait for a verified hello);
//   * a row is accepted only when its server signature verifies for OUR org, its project is in both tokens, it is not a
//     tombstone, its version is strictly higher than the local serverVersion, and the local record is not dirty;
//   * lf-e9: a row that carries the px3 signature (`sig3`, it commits to the view class the row was cut for) must verify for OUR
//     view class, or it is refused as `wrong_view` (px3.test.ts); a row with only px2 is still accepted until every server sends px3;
//   * the sender hands over only rows with a valid server signature and no pending local edit (local-db.ts isShareable),
//     and never a version or a deletion of its own (a signed row cannot be altered: its version is inside the signature);
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

export const MAX_MESSAGE_BYTES = 512 * 1024;
export const DEFAULT_BATCH_BYTES = 64 * 1024;
export const KNOWN_PER_MESSAGE = 2000;
/** lf-e9: how often a session asks for a lost hello again, and how often it answers such an ask (bounded: never a loop). */
export const MAX_HELLO_RESENDS = 3;

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
};

export type RejectReason = "bad_signature" | "wrong_view" | "not_shared" | "tombstone" | "not_newer" | "dirty" | "foreign_org" | "malformed";

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
  | { t: "end"; project: string; kind: string }
  | { t: "bye"; reason: string };

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
