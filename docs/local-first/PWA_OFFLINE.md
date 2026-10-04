# PROJEXA offline and "stays signed in": what was built, and where it touches existing code

Owner requirements (2026-10-02): the COMPLETE software lives on the laptop as ONE versioned bundle (R1 no internet, R2 our server down);
once signed in the person stays signed in until they sign out (R9); the app is hard to lose from the browser (R10); the user never has to
think (R12); cost first, ease second, security third (R13-15). Register: `ct-aibridge/ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md`.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Release bundle | `scripts/make-release.mjs` (`postbuild`, `release:build`) | `public/_release/release.json` + one deterministic `px-<YYYY.MM.DD-NNN>.tar.gz` of `.next/static`, `public/` and the prerendered `/local`; `manifest_sha256` over canonical JSON (CONTRACT.md section 3). Harmless with no inputs; `--postbuild` never fails a deploy. |
| Verified install | `src/lib/local-first/release/installer.ts` | Verifies the manifest digest, the bundle and every file; writes Cache Storage `px-release-<version>`, `app:release` + file table in the device meta, switches the worker, drops the old cache, records the install. Any verification failure switches nothing. Partial update when fewer than half the files changed. |
| Service worker | `src/lib/local-first/release/sw-core.ts` (inlined by `src/app/sw.js/route.ts`) | Static files cache-first from the active release; app navigations get the `/local` shell offline / on network failure / on 5xx / first in local-first mode; never `/api/**`, never Supabase. |
| Connectivity | `src/lib/local-first/connectivity.ts` | `online` / `offline` / `server_down`; at most one probe per 30 s while down, none while up. Only UI: a small status marker. |
| Durable login | `src/lib/supabase/durable-auth.ts`, `src/lib/local-first/identity.ts` | A failed refresh never ends the session unless the server says the refresh token is revoked; identity mirrored in localStorage + IndexedDB; `signOutDeliberately()` is the only path that clears it. |
| Persistence | `src/lib/local-first/persistence.ts` | `navigator.storage.persist()` once, install prompt as one calm menu item, silent release re-install and workspace re-download when the browser evicted them. |
| Shell | `src/app/local/**`, `src/lib/local-first/shell/**` | Static `/local` + route table + the BOQ module. See `ROUTE_TABLE.md`. |
| Boot | `src/lib/local-first/boot.ts`, `src/components/local-first/LocalFirstBoot.tsx` | The quiet start-up, loaded as its own chunk after hydration. |

## Existing files that were changed (and why)

- `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts` -- the auth client's `fetch` is the durable wrapper (R9). The
  middleware additionally answers a person who HAS a session cookie, when the sign-in service cannot be reached, with a calm `503` (the worker
  turns a 5xx navigation into the shell) instead of redirecting to `/login`.
- `src/app/sw.js/route.ts` -- now inlines `sw-core.ts`. The old `projexa-shell-*` caches are deleted on activate.
- `src/app/layout.tsx` -- mounts `<LocalFirstBoot />`. `src/components/shell/AccountMenu.tsx` -- one `<InstallMenuItem />` (renders nothing unless the
  browser offered installation); the sign-out handler is **not** touched.
- `src/lib/authz/page-access.ts` -- `/local` and `/local/*` are public (the shell has no server to ask). `src/lib/nav-routes.ts` + its test -- the two new pages, with their reason.
- `package.json` -- `postbuild` and `release:build` scripts. `.gitignore` -- `/public/_release/`.

## For the engineer who owns sign-out

Call `signOutDeliberately({ auth: supabase.auth, store })` (`identity.ts`) from the sign-out handlers (`AccountMenu`, `AppTopbar`, `SettingsClient`)
instead of `supabase.auth.signOut()` alone. It clears the identity mirror, tells the worker to drop this person's release caches, and ends the
session even when the server cannot be reached (`signOut()` alone leaves the session in place when offline). Until then a sign-out still works online:
the unexpected `SIGNED_OUT` event makes the identity layer try to rebuild the session from its mirror, the server answers that the token is revoked,
and the mirror is cleared -- one wasted request, no surprise.

## Switching on

Local-first mode (`localStorage["px-local-first"] = "1"`, `setLocalFirstEnabled(true)` in `mode.ts`) is NOT switched on automatically: offline and
server-down already fall back to the shell without it. Turning it on is the owner's product decision (it changes every person's navigation).
