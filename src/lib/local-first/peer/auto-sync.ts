// LOCAL-FIRST AUTO-SYNC: puts the pieces together for one signed-in person on one laptop, with every dependency injected.
//
//   attestation (attest.ts, cached)  ->  signalling hub (signalling.ts)  ->  peer network (network.ts)  ->  status (status.ts)
//                                                        scheduler (scheduler.ts): server step (server-step.ts) || peer step
//
// It runs in ONE tab per browser (the caller holds a Web Lock for that, see peer-shared.ts): two tabs share one IndexedDB,
// so a second tab joining as a peer would only sync the database with itself.

import { createAttestationSource, type AttestationSource } from "./attest";
import { createLocalDbPeerStore } from "./localdb-store";
import { createPeerNetwork, type OpenLink, type PeerNetwork } from "./network";
import { createSyncScheduler, type SchedulerClock, type StepResult, type SyncScheduler } from "./scheduler";
import { createSignalHub, type SignalProvider } from "./signalling";
import { setPeerStatus } from "./status";
import type { LocalDb } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";

export type AutoSyncDeps = {
  userId: string;
  /** Stable id of this laptop on the signalling channel (<= 64 chars). */
  selfId: string;
  db: LocalDb;
  fetchAttest: () => Promise<unknown>;
  remoteProviders: SignalProvider[];
  localProviders?: SignalProvider[];
  openLink: OpenLink;
  /** The server half of a run (createServerStep). Absent: peers only. */
  serverStep?: () => Promise<StepResult>;
  isVisible: () => boolean;
  isOnline: () => boolean;
  clock?: SchedulerClock;
  locks?: LockManager | null;
  now?: () => number;
  foreignOrg?: (data: unknown, org: string) => boolean;
  allowedKinds?: readonly string[];
};

export type AutoSync = {
  scheduler: SyncScheduler;
  attestation: AttestationSource;
  /** The peer network, once an attestation exists (null before). */
  network(): PeerNetwork | null;
  stop(): void;
};

export function createAutoSync(d: AutoSyncDeps): AutoSync {
  const now = d.now ?? (() => Date.now());
  const attestation = createAttestationSource({ meta: d.db, fetchAttest: d.fetchAttest, now, userId: d.userId });
  let net: PeerNetwork | null = null;
  let netOrg: string | null = null;
  let noPeer: readonly string[] = [];
  let stopped = false;

  /** Builds the network the first time a valid attestation exists (or again if the organisation changed). */
  async function ensureNetwork(): Promise<PeerNetwork | null> {
    // lf-e9: the manifest's never-share organisation kinds (peer_shareable: false), refreshed on every run; each new link reads them
    try {
      noPeer = (await d.db.getMeta<StoredManifest>(MANIFEST_KEY))?.orgNoPeerKinds ?? [];
    } catch {
      /* keep the last known list */
    }
    const self = await attestation.current();
    if (!self) return net;
    if (net && netOrg === self.claims.org) return net;
    net?.close();
    netOrg = self.claims.org;
    const hub = createSignalHub({ channel: self.channel, selfId: d.selfId, remote: d.remoteProviders, local: d.localProviders });
    net = createPeerNetwork({
      selfId: d.selfId, hub, keys: attestation.keys, store: createLocalDbPeerStore(d.db, self.claims.org), openLink: d.openLink, now,
      getSelf: () => attestation.current(), foreignOrg: d.foreignOrg, allowedKinds: d.allowedKinds, noPeerKinds: () => noPeer,
      onChange: (peers) => setPeerStatus({ peers }),
      onPeerVerified: () => { void scheduler.trigger("peer"); },
      onRows: () => setPeerStatus({ lastPeerSyncAt: now() }),
    });
    return net;
  }

  const scheduler = createSyncScheduler({
    clock: d.clock, locks: d.locks,
    isVisible: d.isVisible, isOnline: d.isOnline,
    peersConnected: () => net?.verifiedCount() ?? 0,
    serverStep: async () => {
      const r = d.serverStep ? await d.serverStep() : undefined;
      await attestation.refresh();
      return r;
    },
    peerStep: async () => {
      const n = await ensureNetwork();
      if (!n) return { changed: false };
      const r = await n.syncAll();
      if (r.peers > 0) setPeerStatus({ lastPeerSyncAt: now() });
      return { changed: r.accepted > 0 };
    },
    // after every run: (re)join -- an attestation fetched later starts the network, a dropped signalling provider is re-raced,
    // and the announce lets a laptop that came up meanwhile find us (one tiny signalling message per run)
    onRun: () => { void join(); },
  });

  // The network is joined on start (from the cached attestation, so it works with our server down) and re-announced after
  // every run; the scheduler's peer step only runs when a peer is connected, so joining is done here, not there.
  async function join() {
    if (stopped) return;
    const n = await ensureNetwork();
    await n?.start();
  }

  void attestation.refresh().then(join).finally(() => { if (!stopped) scheduler.start(); });

  return {
    scheduler,
    attestation,
    network: () => net,
    stop() {
      stopped = true;
      scheduler.stop();
      net?.close();
      net = null;
      setPeerStatus({ peers: 0 });
    },
  };
}
