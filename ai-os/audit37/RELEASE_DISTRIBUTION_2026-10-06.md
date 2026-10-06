# Release distribution without Vercel or Cloudflare (2026-10-06)

## How releases work today (read from code, not from the other session)

1. `scripts/make-release.mjs` (run by `postbuild`) writes `public/_release/release.json` (version `YYYY.MM.DD-NNN`, git sha, every file with size + sha256,
   `manifest_sha256` = sha256 of the canonical JSON without itself) and ONE deterministic bundle `public/_release/px-<version>.tar.gz`.
   Real size of a recent release (fixture manifest-n1): bundle 2.77 MB gz, 385 files, 8.85 MB raw.
2. The files are served by the app origin (Vercel) at `/_release/**`, or, when `NEXT_PUBLIC_PX_STATIC_BASE` is set at build time, by that static
   host (today designed for a Cloudflare Pages project: `scripts/stage-static-pages.mjs`, `publish-static-pages.mjs`, `STATIC_ON_CLOUDFLARE_PAGES.md`).
   The installer already accepts ANY absolute http(s) base with a path prefix (`normalizeStaticBase`, `installFetchUrl`, `?px-install=1`, CORS, credentials omitted).
3. How an installed laptop learns of a new version: `runLocalFirstBoot` (`src/lib/local-first/persistence.ts`) runs on boot while online; it is "due" when
   nothing is installed, the installed cache is missing, or 6 h passed since the last check. Then `installRelease` (installer.ts) fetches
   `/_release/release.json`, checks the manifest digest, and if `manifest_sha256` differs it downloads (full bundle, or only changed files when fewer than
   half changed), verifies EVERY file's sha256/size, writes `px-release-<version>` to Cache Storage, asks the service worker to switch, deletes the old cache.
   Any failure switches nothing. The registry (Supabase Edge `projexa-sync`, `RELEASE_MANIFEST_URL = https://projexa-ai.com/_release/release.json`) is
   only a numbering/telemetry ledger (`/release/register`, `/release/current`, `/install`); the laptop does NOT decide from it.
4. Gap found: the digest only proves the manifest agrees with itself. Anyone who can write to the host can publish a different self-consistent release,
   and the registry also fetches from projexa-ai.com (Vercel). Moving the host to a public bucket makes this a real exposure, hence the signature below.

## Design

| Item | Choice |
|---|---|
| Where the code is served from | A PUBLIC Supabase Storage bucket `projexa-release` in the existing project. Set `NEXT_PUBLIC_PX_STATIC_BASE=https://pcrjmlpuqsbocqfwoxod.supabase.co/storage/v1/object/public/projexa-release` (path prefix is supported). Same relative paths as the app origin, so no hash, cache key or registry change. The `/local` shell page is still an app page (unchanged, see "unknowns"). |
| How a laptop learns of a release | Unchanged mechanism (6 h poll + on boot), only the manifest URL moves to the bucket. |
| Trust | `release.sig.json` next to `release.json`: ES256 signature over `px-release-v1 \n version \n manifest_sha256`. Public key(s) pinned in the app build; private key only on the owner's release machine. Implemented and tested: `src/lib/release-dist/signed-manifest.ts`. Verification must run right after `manifestDigestOk` and refuse (`nothing switches`) on any result but ok. |
| Layout | Immutable (`max-age=31536000, immutable`): `_next/static/**`, `_release/px-<ver>.tar.gz`, `_release/releases/<ver>/release.json` + `.sig.json`. Mutable (`no-cache`): `_release/release.json`, `_release/release.sig.json`. Upload order: immutable first, the two pointers last. Plan code: `src/lib/release-dist/storage-plan.ts`, CLI `scripts/publish-release-storage.mjs` (dry run by default). |
| Rollback | `planRollback(<ver>)` rewrites the two mutable keys from the kept per-version copies. Laptops install whatever the pointer names (older versions are accepted by the installer: only same-version-different-content is refused), so they follow the rollback at their next check (at most 6 h, or at next boot when due). The old bundle must still exist: keep the last N releases (`prunable()` never offers the newest two; deleting is an owner decision). |
| Free-tier limits (Supabase Free, to be verified in the dashboard before relying on them) | ~1 GB storage: a release adds roughly 3 MB bundle + only NEW hashed static files (about 3 to 9 MB), i.e. 80+ releases. ~5 GB egress/month: ~1,700 full installs/month; most updates are partial (changed files only). Public-bucket downloads are cached by the Supabase CDN. If egress is exceeded the app keeps working from the installed cache; only updates pause. |
| Peer relay | Not built: a laptop could hand the signed bundle to another laptop (same transport as peer sync). With the signature + digest verification any peer is untrusted-safe. Next slice, needs the offline session (peer code lives in `src/lib/local-first/**`). |

## Implemented in this slice (PR on projexa)

- `src/lib/release-dist/signed-manifest.ts` + `storage-plan.ts` + tests (`bun test --isolate src/lib/release-dist`; mutation-checked: making verify always-ok fails the forged-key test).
- `scripts/publish-release-storage.mjs`: dry-run plan; `--apply` signs and uploads (needs `SUPABASE_SERVICE_ROLE_KEY`, `PX_RELEASE_SIGNING_JWK`). NOT run: no release was published, nothing created or deleted.

## Not done / hand-off (installer lives in a tree I was told not to edit)

1. Installer hook (offline session, `src/lib/local-first/release/installer.ts`): after `manifestDigestOk`, if pinned keys exist, fetch `where("/_release/release.sig.json")` and call `verifyRelease`; on not ok throw `InstallError("manifest_signature")` (add to `InstallFailure`). Pinned keys empty = current behaviour.
2. Registry `RELEASE_ORIGIN` in `projexa-sync` (`handler.ts:96`, offline session) should read from the bucket too.
3. A `.github` workflow or local script to run stage -> publish after each release (needs the owner's signing key; never in CI secrets without a decision).

## Unknowns

- Whether Supabase serves `.js`/`.css` from a public bucket with correct `Content-Type` plus `nosniff` for `<script>` loading when used as `assetPrefix` (JSON/fetch path is safe: the installer rebuilds Response types). The memory note says HTML is forced to text/plain on `*.supabase.co`; scripts/CSS must be tested once with a throwaway object before switching `assetPrefix`.
- Exact current Free-plan numbers (check dashboard).
- Whether the `/local` shell (an app page) can be served from the bucket: HTML is sandboxed as text/plain there, so the shell page still needs a host that serves HTML (the installed cache covers offline; first install needs the app origin).

## OWNER decisions

1. Approve generating the release signing keypair (private key stays on the owner's machine; public JWK pinned in the build).
2. Approve creating the public bucket `projexa-release` (free; no paid step) and which Supabase project (default: the existing one).
3. Where the first-install HTML shell comes from once Vercel is off (GitHub Pages is the only free HTML host outside Vercel/Cloudflare; owner call).
4. Retention (how many old releases to keep) and permission before any deletion.
