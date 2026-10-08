# Release signing: what exists and what the owner must do

## What this is, in plain words
Every release of the app can carry a signature (`release.sig.json`, next to `release.json`). An installed laptop checks the signature against a
public key built into the app. A release not made with the owner's secret key is refused (once checking is switched on, see below), and laptops
only hand each other (relay) releases whose signature checked out.

* Algorithm: ES256 (ECDSA P-256). Key id: `px-release-2026-10-08`.
* Public key (in the repo, `src/lib/release-dist/pinned-keys.ts`, `BUILTIN_RELEASE_KEYS`). Its sha256 fingerprint:
  `3d2c2c63e5ea7ba76538369e4b3eb744b8e29479de9559b4efb4689b1875a8de`.
* The build signs when the environment variable `PX_RELEASE_SIGNING_KEY` holds the private key (`scripts/make-release.mjs`, run by `postbuild`).
  Without it the build prints "NOT signed" and carries on, so builds and CI never fail for want of the secret.

## Where the private key is (this laptop)
`C:\Users\Dell\.projexa-release-signing\release-signing-private.pem`

It is outside every repository, was never printed, and is in no git history, log, memory file or chat.

## BACK IT UP (owner, now)
Copy that one file to somewhere safe that is not this laptop (a password manager's secure-note/attachment, or an encrypted USB stick).
Without it **nobody can sign a new release**; the only recovery would be a new key pinned through a new app build, which laptops
that only accept signed releases could not receive. Do not email it, do not put it in a chat, a repo, a ticket or a shared drive.

## Put the secret where releases are built (owner only; an agent must not paste it)
The value is the whole text of the .pem file (open it in Notepad, select all, copy). It also works base64-encoded if a field dislikes line breaks.

1. **Vercel (production build of `projexa`)**: vercel.com, open the `projexa` project, **Settings**, **Environment Variables**, **Add New**.
   Key `PX_RELEASE_SIGNING_KEY`, Value: paste the PEM text, tick **Production** only, mark it **Sensitive**, **Save**.
   Optional second variable `PX_RELEASE_KID` = `px-release-2026-10-08` (this is already the default).
2. **GitHub Actions, only if CI builds the release**: GitHub, repository `FChecklist/projexa`, **Settings**, **Secrets and variables**, **Actions**,
   **New repository secret**. Name `PX_RELEASE_SIGNING_KEY`, Secret: the PEM text.
3. The next build that runs `postbuild` now writes `public/_release/release.sig.json`. Check the build log for "signed with key px-release-2026-10-08".

## Switching enforcement on (after the first signed release is live)
Until then laptops **check** a signature when one exists (a wrong one always refuses) but still install an unsigned release.
Once a signed release is live, set the build variable `NEXT_PUBLIC_PX_SIGNATURE_REQUIRED_FROM` (Vercel, same page, a normal non-secret variable) to
that release's version (for example `2026.10.09-120`). Builds from then on refuse any release of that version or newer that is unsigned or wrongly signed.

### Why it works this way (it cannot lock existing laptops out)
* The key is pinned in the app, but a laptop only starts demanding signatures from the version in `SIGNATURE_REQUIRED_FROM`, a value baked into the
  app build, not read from the release (whoever can write to the file host cannot turn the check off by editing the manifest).
* Default is "not yet required". So if the secret is missing or forgotten, an unsigned release still installs everywhere, nobody is stuck on an old version.
* A signature that is present but wrong, or made by another key, is **always** refused, even before enforcement. A stale signature from an older
  release is deleted at every build, so it never sits next to a new manifest.
* Following a registry-advertised download address and the peer relay need verified signatures, so the address is only followed once enforcement is on.
* Trade-off, stated plainly: until you switch enforcement on, a stranger who could write to the file host could still publish an unsigned release.
  Switching it on is the step that closes that; do it as soon as the first signed release has installed on your own laptop.

## Rotating the key
1. Generate a new pair: `node scripts/ops/generate-release-signing-key.mjs --out <new private file> --kid px-release-<date>` (it prints the public JWK only).
2. Add the new public key to `BUILTIN_RELEASE_KEYS` **next to** the old one. Build and publish that release **signed with the old key**.
3. After laptops have installed it, switch `PX_RELEASE_SIGNING_KEY` (and `PX_RELEASE_KID`) to the new key. Remove the old public key in a later release.
