# Release pick-up, origin and peer relay (P4, 2026-10-08)

Implements the three open items of `ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md`. Choices where the spec was silent are marked CHOICE.

## 1. Installer hook (signature) and pick-up of the next release

- `installer.ts`: after the manifest digest and the "already installed" answers, and before one byte of the release is fetched or written, the installer
  checks `release.sig.json` (`SIGNATURE_FILE`) with `verifyRelease` against the keys this build pins. Anything but `ok` fails with `manifest_signature`, and
  nothing switches. CHOICE: the check sits after the "current" early return, so a laptop that already has the release does not fetch a signature file on every
  six-hour check.
- Keys: `NEXT_PUBLIC_PX_RELEASE_KEYS` at build time, a JSON array of `{kid, jwk}` (public ES256 JWKs; a JWK with a private part is ignored)
  (`src/lib/release-dist/pinned-keys.ts`). No key pinned = the installer behaves exactly as before. Creating the keypair is still the owner's decision.
- An installed laptop already picks up the next release without re-preparing: the install touches only `px-release-<version>` in Cache Storage, `app:release`,
  `app:files` and the service worker pointer; the unchanged files are copied from the old cache (partial mode when fewer than half changed) and only changed
  files are downloaded. `release-update.test.ts` holds this: one changed file = one download, no bundle request, and not one other meta key changes or appears.

## 2. RELEASE_ORIGIN in projexa-sync (repository `compliance-tracker`, `supabase/functions/projexa-sync`)

- Optional secret `PX_RELEASE_ORIGIN` (plain https, a path is fine; anything else is ignored and the default `https://projexa-ai.com` stays).
- `/release/register` reads `<origin>/_release/release.json`; `/release/current` returns `origin` so laptops know where the bytes live.
- Laptop side (`persistence.ts`): a build that pins a signing key uses the advertised origin as the install base. CHOICE: a build with no pinned key ignores it,
  because then a wrong origin could serve a self-consistent malicious release; with a pinned key a wrong origin can only withhold an update.
- Not set by this change: setting the secret and creating the bucket are owner actions.

## 3. Peer relay of signed release bundles

- Messages (only after the peer hello verified, and only when this build pins a key): `rel_have`, `rel_want`, `rel_start`, `rel_chunk`, `rel_none`
  (`peer/protocol.ts`). Chunks are 192 KB; the bundle is at most 32 MB; one request per session per direction.
- A receiver accepts a package only through `release/relay.ts` `accept()`: manifest shape and digest, a signature that names this manifest and verifies under a
  pinned key, a version strictly newer than the installed one (no downgrade by replaying an old signed release), and `verifyBundleBytes` (bundle size and sha256,
  every file present, none unlisted, every file size and sha256) - the same function the download path uses.
- A laptop never relays an unverified bundle: a package enters the store only through `keep()` (same checks), and `serve()`/`offer()` verify it again at the moment of
  sending, so a damaged or tampered store is not passed on. CHOICE: the verified bundle is kept in the device meta (`app:relay-bundle`, about 3 MB) after a full
  install; a partial install has no whole bundle, so that laptop relays nothing until its next full one.
- An accepted package is parked in `app:relay-pending` and the `px-release-relayed` event starts a boot pass, which installs it with `installRelease({ supplied })`
  - verified a third time, no network needed. A package that fails for a reason a retry would not fix is dropped; a transient failure (storage, switch) is retried.

## Not done / needs the owner

- No signing keypair exists yet, so nothing is pinned: until the owner generates one and sets `NEXT_PUBLIC_PX_RELEASE_KEYS`, the signature check and the relay stay off.
- `PX_RELEASE_ORIGIN` is not set and no bucket exists. The `/local` HTML shell for a first install still needs an HTML host (spec, owner decision 3).
- Nothing was run against a real browser, real WebRTC link or the live service; the tests use in-memory links and fakes.
