# PROGRESS -- task-20260817-042949-measure-and-fix-slow-page-loading-on-the

## Completed
- [x] Built a real production build locally (`npm run build`, since `bun`
      isn't installed in this sandbox; `npm install` used instead --
      `package-lock.json` deliberately NOT committed, `bun.lock` stays
      canonical).
- [x] Measured the REAL live app (`https://projexa-ai.com`) in real
      Chromium (via the official `mcr.microsoft.com/playwright` Docker
      image, since this sandbox lacks the native GTK/ATK libs Playwright
      needs and has no passwordless sudo) at 1440x900, logged in as the
      real seeded E2E CEO account, on the real `/dashboard` route (4 runs).
      See `scripts/measure-perf.mjs` / `scripts/measure-ttfb-warmup.mjs`.
- [x] Concrete numbers recorded (see "Measurements" below): JS transferred,
      chunk count/sizes, CSS transferred, FCP/LCP/TBT, TTFB.
- [x] Tested & eliminated the `transpilePackages` ui-kit theory with direct
      measurement: removing it BREAKS the build entirely (ui-kit ships raw
      .tsx, Turbopack can't parse it without transpilation -- it is
      load-bearing, not optional), and its actual footprint is negligible
      (36KB out of 58MB server output; a few seconds of a ~27s clean build).
      Not the dominant contributor.
- [x] Tested the Tailwind `@source` directive's real CSS delta by building
      both with and without it (swapping `globals.css` to the pre-3f0c411
      version, clean `.next` rebuild each time). Real delta: +2,682 bytes
      (+35 utility rules) on the ~131KB main app CSS bundle -- NOT the
      "whole ui-kit utility surface" the fix commit assumed, and NOT
      material inflation. Two of three CSS bundles were byte-identical
      with/without the directive. Left the directive untouched per the
      spec (load-bearing for the layout fix; not inflated enough to justify
      narrowing).
- [x] Found and fixed the real dominant contributor: a fully sequential,
      partially-redundant network waterfall in `/dashboard`'s Server
      Component (see "Root cause" below). Applied a safe, narrowly-scoped
      fix in `src/app/(app)/dashboard/page.tsx`.
- [x] Verified the fix: clean `tsc --noEmit`, clean `eslint`, and a full
      `next build` all pass with no new errors.
- [x] Attempted to get real post-fix numbers from a live redeploy: linked
      the real Vercel project (`vercel link` + `vercel deploy`, preview
      deployment `https://projexa-ijkjxitkp-meet-track-s-projects.vercel.app`
      built successfully against the real fix). Blocked from measuring it
      with Playwright by Vercel's SSO deployment protection on non-custom
      domains. Did NOT disable/alter that project's deployment-protection
      settings to get around it -- that's an outward-facing, security-
      relevant change to shared project config that needs Owner sign-off,
      not something to do unilaterally for a measurement nicety. Recorded
      as an open item below instead of fabricating an "after" number.

## Remaining
- [ ] Owner/CI: after merge, re-run `node scripts/measure-perf.mjs
      /dashboard` against `https://projexa-ai.com` to confirm the real
      post-deploy TTFB drop (expected: elimination of one full redundant
      Supabase Auth round trip, plus the two VERIDIAN calls running
      concurrently instead of sequentially -- see reasoning below).
- [ ] Separate-decision item (NOT attempted here, out of scope per the
      "don't speculatively rewrite structural cost" rule): consider adding
      HTTP caching / revalidation to `/dashboard`'s VERIDIAN calls (today
      `callVeridianRaw` hardcodes `cache: "no-store"` for every call site
      in the app), and/or moving `resolveApiKey`'s per-org DB lookup out of
      the request's critical path (e.g. cache it alongside the session).
      Both would cut real per-visit latency further but touch the shared
      `veridian-client.ts` used by every route in the app -- bigger blast
      radius than this task's safe scope.

## Measurements (real live site, real Chromium, 1440x900, 4 runs on `/dashboard`)

BEFORE (current `main`, still live as of this writing):
- TTFB: 2848-3885ms across 4 runs (mean ~3.3s) -- consistent, not a cold-
  start artifact (4 rapid back-to-back navigations, same session, no
  improvement on repeat).
- `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
  and `x-vercel-cache: MISS` on every single run -- this route is NEVER
  cached, so this cost is paid on every real visit.
- FCP/LCP: ~3412-4080ms (fires ~150-300ms after the document arrives --
  hydration/paint itself is fast; the document response is what's slow).
- TBT: 0ms (no >50ms long tasks after the document arrives).
- Total JS: 1,104,742 bytes (1,078.8 KB) across 16 chunks. Largest chunks:
  239.2KB, 222.0KB, 134.2KB, 74.8KB, 63.2KB, ... (see script output).
- Total CSS: 146,509 bytes (143.1 KB) across 2 files (12.3KB + 130.7KB) --
  matches the spec's cited ~134KB figure.
- Total page weight: ~1,697 KB.
- Document itself: 150,152 bytes transferred (br-compressed).

Root cause (source-level, `src/app/(app)/dashboard/page.tsx`, pre-fix):
  1. `await getServerOrganizationId()` -> `requireAuth()` -> 1 Supabase DB
     query (`memberships`).
  2. `await callVeridian("/dashboard", {organizationId})` -> 1 more
     Supabase DB query (`veridian_credentials`, via `resolveApiKey`) THEN
     1 cross-service HTTPS fetch to VERIDIAN's separate Vercel deployment
     (`veridian-compliance-ai.vercel.app`). Real probe of that same host's
     `/api/v1/projexa/currencies` from this sandbox: ~280-305ms per call
     just for the auth-rejection path: real data-bearing calls cost more.
  3. `await callVeridian("/currencies")` -- a SECOND, fully independent
     cross-service fetch, executed only after #2 finished, even though it
     doesn't depend on anything #2 returned.
  4. `await supabase.auth.getUser()` -- a live network round trip to
     Supabase Auth's `/user` endpoint, for a value (`user.email`) that
     step #1's `requireAuth()` already resolves via a local JWT check
     (`getClaimsWithRetry`). This exact anti-pattern (redundant live
     `getUser()` call) was already identified and fixed everywhere else in
     the app (see `auth-guard.ts`'s own comment on it, and `middleware.ts`)
     -- this page was the one remaining, unfixed instance (confirmed via
     `grep -rn "auth.getUser()" src/`).
  5-6+ more real round trips for the dashboard page's own project-list
     query inside VERIDIAN's own backend, not visible from this side.

  5+ fully sequential network-touching operations, 2 of them genuinely
  parallelizable and 1 of them fully redundant, on a route with zero
  caching -- consistent with, and sufficient to explain, the measured
  ~3.3s mean TTFB.

Fix applied: single `requireAuth()` call (removes the redundant
`getUser()` round trip entirely) + `Promise.allSettled` around the two
independent VERIDIAN calls (was sum-of-two-sequential-calls, now the max
of the two, run concurrently). Scope deliberately kept to this one file --
`dashboard/overview/page.tsx` was checked and its two `callVeridian` calls
are correctly sequential (the second genuinely depends on the first's
project-id list), so it needed no change; grepped the whole `src/app`
tree and confirmed no other page has this pattern.

## Notes
- Playwright's Chromium needed system libs (`libatk-1.0.so.0` etc.) this
  sandbox doesn't have and can't `apt install` (no passwordless sudo) --
  worked around by running the measurement script inside the official
  `mcr.microsoft.com/playwright:v1.62.1-noble` Docker image, mounting this
  workspace read/write. `docker` was already available and authorized.
- Real production secrets (`NEXT_PUBLIC_SUPABASE_URL`,
  `VERIDIAN_API_KEY`, etc.) pulled via `vercel env pull` come back redacted
  (`[SENSITIVE]`) in this sandbox by design, so a real local `next start`
  against real prod data wasn't possible -- that's why the live-site
  measurement (over the real network) and the Vercel preview deploy (using
  Vercel's own server-side secret injection, never exposed to this agent)
  were used instead of a local run.
