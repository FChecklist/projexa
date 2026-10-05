# PROJEXA static files on free Cloudflare Pages (AUDIT-100 B60, A3)

**Status (2026-10-06): built, proved, deployed, switched OFF.** The capability is in `main`, the free Pages project `projexa-static`
is live at https://projexa-static.pages.dev and serves the current live release byte for byte. Production still serves every static
file from Vercel, because the switch below is the owner's (it changes what Vercel deploys, and one optional part needs DNS).

## What moves, what stays

| Moves to Pages (when switched on) | Stays on Vercel |
|---|---|
| `/_next/static/**` (all code, CSS, fonts of a build) | login and every app page, `/local` (the shell page), `/sw.js` (a service worker must be same-origin) |
| `/_release/release.json` and the one bundle `/_release/px-<v>.tar.gz` (the 2.8 MB one-time install) | every `/api/**` proxy |
| the logo the app's chrome shows (`/logo-mark.svg`) | `/manifest.webmanifest`, marketing photos through `/_next/image` |

No DNS change, no paid step: `projexa-static.pages.dev` is a free `*.pages.dev` address (Pages free plan: unlimited static requests
and bandwidth, 500 deploys a month, 20,000 files per deploy; a release is ~390 files).

## How it works: ONE switch, `NEXT_PUBLIC_PX_STATIC_BASE`

Unset or not an absolute http(s) URL = today's behaviour, byte for byte (`src/lib/local-first/release/release-constants.ts`
`normalizeStaticBase`). Set to `https://projexa-static.pages.dev`:

1. `next.config.ts` sets it as `assetPrefix`: every page asks Pages for `/_next/static/**`.
2. The installer (`installer.ts`) reads `release.json`, the bundle and changed files from Pages, with `?px-install=1` instead of the
   `X-Px-Install` header (a custom header would make every request a CORS preflight) and no credentials. **Every byte is still checked
   against the manifest**; the cache keys stay the app-origin paths, so nothing else on the laptop changes.
3. The service worker (`sw-core.ts`, config from `src/app/sw.js/route.ts`) answers requests for the Pages origin from the installed
   release exactly like same-origin static files, so an installed laptop works offline with the code on Pages. The installer's own
   requests and `release.json` are never answered from the cache. Any other cross-origin request is untouched, as before.
4. `postbuild` runs `scripts/publish-static-pages.mjs` after `make-release.mjs`: with the switch off it prints "skipped" and does nothing;
   with it on it stages this build's verified release (`scripts/stage-static-pages.mjs`), keeps the previous release's code files (a
   person with a page of the previous build open still loads its lazy chunks), and uploads with `wrangler pages deploy`. **Any failure
   fails the build**, so a Vercel deployment whose pages point at code Pages does not have never goes live.
5. Release hashes are of content, so the registry, the manifest digest and `min_compatible` are unchanged: Pages changes WHERE the
   bytes come from, never WHAT they are.

`_headers` (written by the stage script): `Access-Control-Allow-Origin: *` on every file (public build output, no credentials, and the
app has several origins: apex, www, previews), `public, max-age=31536000, immutable` on `/_next/static/*` and `/_release/*`,
`no-cache` on `/_release/release.json`, and a `404.html` so a missing file is a real 404 (without it Pages answers unknown paths with
200 and the index page).

## Proof

* Unit (CI, `bun test --isolate`): `src/lib/local-first/release/static-host.test.ts`, 23 tests: the switch, installer URLs, a full install
  and a partial update against two hosts (no release file asked of the app origin, no preflight header, no credentials, app-origin cache
  keys), a dropped bundle / changed file and one wrong byte refused with nothing switched, the worker serving the static host offline
  (both as `createSwCore` and as the inlined script the route serves), the installer's own requests passing through, a path prefix,
  no static host = old behaviour, the upload folder byte-exact with the right `_headers`, the stage refusing a wrong byte / lying
  manifest, and the postbuild step a no-op with the switch off. **Seen to fail**: with the worker's static-origin branch removed, 5
  fail; with the installer ignoring the static base, 4 fail.
* Real browser (`e2e/lf-static-host.spec.ts`, `bunx playwright test -c playwright.static-host.config.ts`; CI job "Offline e2e
  (local-first)"): a production build made WITH the switch pointing at `e2e/support/static-host-server.mjs` (a different origin
  standing in for Pages, serving the folder the real stage script writes, with the same `_headers` rules). Measured 2026-10-06
  (`ai-os/audit37/evidence/static-pages-e2e-2026-10-06.txt`): over sign-in, install, daily use, reload and offline, **0 static files
  from the app origin**; 58 requests to the static host, 159 static-host addresses answered from the laptop's verified copy; the BOQ
  and the shell open with the network OFF; a static host that drops the bundle (`bundle_unreachable`) or serves one wrong byte
  (`bundle_hash`) is refused with nothing installed, and the real bytes install on the next start. **Seen to fail**: with the worker's
  static-host branch disabled in the built app, the offline step fails (0 of 3 BOQ lines); with the variable missing at `next start`
  time, 6 static files came from the app origin and the measurement failed.
* The REAL Pages host: `bun scripts/verify/static-pages-live.mjs` (read-only) -> `ai-os/audit37/evidence/static-pages-2026-10-05T19-36-12-226Z.json`:
  the live release `2026.10.05-796` (git `edfabc66`, the one https://projexa-ai.com serves) deployed to Pages from the verified live
  bundle; **383 of 383 files and the bundle byte-identical** (sha256 and size) to the manifest the app origin serves; CORS, immutable
  code, revalidated `release.json`, JavaScript content type, `?px-install=1` served and a real 404 all as required. The registry had
  not registered 796 yet when this ran (registration is lazy: the first signed-in laptop that asks registers what the app origin
  serves); re-run with `--require-registered` once it has. **Seen to fail**: the same check against a preview deployment
  (`b60-negative.projexa-static.pages.dev`) with ONE byte changed in one chunk and the logo removed reported exactly those 2 files
  bad, exit 1 (`static-pages-NEGATIVE-broken-preview-2026-10-05.json`).

## The owner's switch (3 steps, Vercel project `projexa`, Production environment)

1. Add `NEXT_PUBLIC_PX_STATIC_BASE` = `https://projexa-static.pages.dev` (a Vercel env var is present at build AND at run time, which
   is required: Next.js applies `assetPrefix` partly at render time; measured on the rig, a server started without it served half
   the page's assets from the app origin).
2. Add `CLOUDFLARE_API_TOKEN` (a token limited to *Cloudflare Pages: Edit*) and `CLOUDFLARE_ACCOUNT_ID`, so the build can upload.
3. Redeploy. The build uploads its static files to Pages before the deployment goes live (a failed upload fails the build).

Optional, needs DNS (owner only): add the custom domain `static.projexa-ai.com` to the Pages project (Pages > projexa-static > Custom
domains; it asks for one CNAME record to `projexa-static.pages.dev`), then change step 1 to `https://static.projexa-ai.com`.

**Undo**: delete the variable of step 1 and redeploy; everything is served by Vercel again (laptops keep working throughout: their
code is in their own verified copy, whichever host it came from).

Known trade-off: a laptop that installed from one host and an app built for the other still works (the worker serves both from the
same cache keys), but its NEXT update downloads only the changed files from the new host, as any update does.

## Re-deploying the Pages project by hand (no Vercel involved)

```
node scripts/stage-static-pages.mjs --from https://projexa-ai.com --out ../static-pages-upload   # verified copy of the live release
npx --yes wrangler@3 pages deploy ../static-pages-upload --project-name projexa-static --branch main --commit-dirty=true
SUPABASE_ACCESS_TOKEN=... bun scripts/verify/static-pages-live.mjs                              # the read-only check
```
(`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from the environment; never printed.)
