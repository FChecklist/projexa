// LOCAL-FIRST release RELAY (ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md, "Peer relay"; docs/local-first/RELEASE_RELAY.md).
//
// A laptop that cannot reach the release host (or whose host is out of free quota) can still pick up the next release from a laptop of the same
// organisation that already has it, over the verified peer link (peer/protocol.ts `rel_*` messages). A peer is never trusted for anything: the
// bytes it hands over are held to EXACTLY the standard a download is --
//   * the manifest parses and its own digest matches (manifestDigestOk);
//   * its detached release signature names this manifest and verifies under a PINNED key (verifyRelease). With no pinned key the relay is OFF:
//     a relayed release is accepted only if a key we pinned signed it, whatever the peer says;
//   * its version is strictly newer than the installed one (a replayed old, validly signed release cannot downgrade a laptop);
//   * the bundle's size and sha256 match the manifest, every listed file is present with the right size and sha256, no unlisted file
//     (verifyBundleBytes, the same function the installer's download path calls).
// A laptop never relays what it did not verify: the only way a package enters the relay store is `keep()`, which runs the same checks, and `serve()`
// runs them again before every send (so a store damaged on disk, or tampered with, is not passed on).
//
// What happens to an accepted package: it is parked in the device meta (`app:relay-pending`), and the next boot pass installs it with
// installRelease({ supplied }) -- which verifies everything a third time -- even with no network. Local data (the person's workspace, outbox,
// identity) is not touched by an install: only the release cache, `app:release` and `app:files` change.
import { manifestDigestOk, parseManifest, verifyBundleBytes, type MetaStore } from "./installer";
import type { Gunzip } from "./bundle";
import type { ReleaseManifest } from "./release-client";
import { verifyRelease, type ReleaseSignature, type TrustedReleaseKey } from "../../release-dist/signed-manifest";

/** Device meta keys of the relay. */
export const RELAY_KEEP_KEY = "app:relay-bundle";
export const RELAY_PENDING_KEY = "app:relay-pending";
/** Fired on window when a verified package was parked, so the boot pass installs it now instead of at the next start. */
export const RELEASE_RELAYED_EVENT = "px-release-relayed";
/** A bundle larger than this is never relayed or accepted (the real one is about 3 MB). */
export const MAX_RELAY_BUNDLE_BYTES = 32 * 1024 * 1024;

export type RelayPackage = { manifest: ReleaseManifest; signature: ReleaseSignature; bundle: Uint8Array };
export type RelayOffer = { version: string; manifest_sha256: string; size: number };
export type RelayRefusal = "no_keys" | "malformed" | "manifest_digest" | "signature" | "not_newer" | "too_large" | "bundle" | "storage";
export type RelayVerdict = { ok: true } | { ok: false; reason: RelayRefusal };

export type RelayDeps = {
  /** The device meta store. */
  meta: MetaStore;
  /** The release-signing public keys this build pins (pinned-keys.ts). Empty: the relay is off. */
  keys: readonly TrustedReleaseKey[];
  /** The release this laptop runs now (null: none). */
  installedVersion: () => Promise<string | null>;
  gunzip?: Gunzip;
};

export type ReleaseRelay = {
  /** What this laptop could hand a peer (verified again right now), or null. */
  offer(): Promise<RelayOffer | null>;
  /** Would this laptop take a release offered by a peer? Cheap: no bytes involved. */
  wants(offer: { version: string; manifest_sha256: string }): Promise<boolean>;
  /** The package for exactly this manifest, re-verified, or null. */
  serve(manifestSha256: string): Promise<RelayPackage | null>;
  /** Verifies a package received from a peer and, when it passes, parks it for the next install. Never installs anything itself. */
  accept(pkg: RelayPackage): Promise<RelayVerdict>;
  /** Remembers a release this laptop just installed from a verified download, so it can pass it on. Verifies first. */
  keep(pkg: RelayPackage): Promise<RelayVerdict>;
};

/** The one verification every route (peer, download, our own store) goes through. `requireNewer` is off only for our own already-installed release. */
export async function verifyRelayPackage(
  pkg: unknown,
  o: { keys: readonly TrustedReleaseKey[]; installedVersion: string | null; requireNewer: boolean; gunzip?: Gunzip },
): Promise<RelayVerdict> {
  if (o.keys.length === 0) return { ok: false, reason: "no_keys" };
  const p = pkg as Partial<RelayPackage> | null;
  if (!p || typeof p !== "object" || !(p.bundle instanceof Uint8Array) || !p.manifest || !p.signature) return { ok: false, reason: "malformed" };
  let manifest: ReleaseManifest;
  try {
    manifest = parseManifest(p.manifest);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (p.bundle.length > MAX_RELAY_BUNDLE_BYTES) return { ok: false, reason: "too_large" };
  if (!(await manifestDigestOk(manifest))) return { ok: false, reason: "manifest_digest" };
  const sig = await verifyRelease(manifest, p.signature, o.keys);
  if (!sig.ok) return { ok: false, reason: "signature" };
  if (o.requireNewer && o.installedVersion !== null && !(manifest.release_version > o.installedVersion)) return { ok: false, reason: "not_newer" };
  try {
    await verifyBundleBytes(manifest, p.bundle, o.gunzip);
  } catch {
    return { ok: false, reason: "bundle" };
  }
  return { ok: true };
}

export function createReleaseRelay(deps: RelayDeps): ReleaseRelay {
  const stored = async (): Promise<RelayPackage | null> => {
    const v = await deps.meta.getMeta<RelayPackage>(RELAY_KEEP_KEY).catch(() => undefined);
    return v ?? null;
  };
  const verified = async (): Promise<RelayPackage | null> => {
    const pkg = await stored();
    if (!pkg) return null;
    const verdict = await verifyRelayPackage(pkg, { keys: deps.keys, installedVersion: null, requireNewer: false, gunzip: deps.gunzip });
    return verdict.ok ? pkg : null;
  };
  return {
    async offer() {
      const pkg = await verified();
      return pkg ? { version: pkg.manifest.release_version, manifest_sha256: pkg.manifest.manifest_sha256, size: pkg.bundle.length } : null;
    },
    async wants(offer) {
      if (deps.keys.length === 0) return false;
      if (typeof offer.version !== "string" || !/^\d{4}\.\d{2}\.\d{2}-\d{3}$/.test(offer.version) || typeof offer.manifest_sha256 !== "string") return false;
      const installed = await deps.installedVersion();
      if (installed !== null && !(offer.version > installed)) return false;
      const pending = await deps.meta.getMeta<RelayPackage>(RELAY_PENDING_KEY).catch(() => undefined);
      if (pending && pending.manifest.release_version >= offer.version) return false;
      return true;
    },
    async serve(manifestSha256) {
      const pkg = await verified();
      return pkg && pkg.manifest.manifest_sha256 === manifestSha256 ? pkg : null;
    },
    async accept(pkg) {
      const verdict = await verifyRelayPackage(pkg, { keys: deps.keys, installedVersion: await deps.installedVersion(), requireNewer: true, gunzip: deps.gunzip });
      if (!verdict.ok) return verdict;
      try {
        await deps.meta.setMeta(RELAY_PENDING_KEY, pkg);
      } catch {
        return { ok: false, reason: "storage" };
      }
      return verdict;
    },
    async keep(pkg) {
      const verdict = await verifyRelayPackage(pkg, { keys: deps.keys, installedVersion: null, requireNewer: false, gunzip: deps.gunzip });
      if (!verdict.ok) return verdict;
      try {
        await deps.meta.setMeta(RELAY_KEEP_KEY, pkg);
      } catch {
        return { ok: false, reason: "storage" };
      }
      return verdict;
    },
  };
}
