# PROGRESS -- task-20260817-024638-make-the-composer-visible-without-scroll

## Completed
- [x] Read prior task progress files (2026-08-16 arrangement + toggle tasks).
      Both used ONLY Playwright screenshots of hand-copied class strings
      (a synthetic harness), which is exactly what this SPEC forbids as
      evidence. Their claimed fixes must be re-verified against the REAL
      running app.
- [x] Read `src/app/(app)/layout.tsx` (real call site) and
      `src/components/veri-chat/VeriComposer.tsx` (real composer, has
      `shrink-0` on its own root div -- so the composer component itself is
      not obviously the bug; suspect the shared `AppShellFrame`/`PanelShell`
      flex/scroll wiring in the installed `veridian-ui-kit` package).

- [x] Installed bun 1.3.14 locally (`.bun/`), real `bun install` (642 pkgs),
      real `bun run build` (26.0s -- real baseline number for DEFECT THREE),
      real `bun run start -p 3100` -- genuine local production server, real
      Next.js router, real `(app)/layout.tsx`.
- [x] Real auth: found real seeded E2E test org + credentials in
      `PHASE1_SEED_REPORT.md`/`PHASE2_BATCH_B_FINDINGS.md`
      (`arjun.mehta@meridian-construction.e2e-test.projexa-ai.com` /
      `MeridianE2E2026!`, org "Meridian Construction Group"), PROJEXA's real
      public Supabase URL+publishable key (project `evpckeuxgvahguwsaeul`,
      also documented in PHASE1 report) in a gitignored `.env.local` (never
      committed). Logged in for real against PROJEXA's real production
      Supabase Auth over the network via Playwright/Chromium.
- [x] Loaded real `/schedule` at 1440x900, signed in -- REPRODUCED both
      defects live: `docScrollHeight` 2298px vs `viewportHeight` 900px,
      composer `<textarea>` real bounding box `y=2179.5` (off-screen), VERI
      Chat toggle real bounding box `y=2260` (off-screen) -- confirms the
      Owner's screenshot, disproves the prior task's synthetic-harness PASS.
- [x] ROOT CAUSE FOUND for DEFECT ONE + DEFECT TWO (one shared cause), with
      real computed-style evidence, not guesswork:
      - `node_modules/@fchecklist/veridian-ui-kit/src/shell/AppShellFrame.tsx:91`
        sets `className="flex h-screen flex-col overflow-hidden ..."` on the
        shell's outermost div -- this is supposed to cap the whole app at
        100vh so everything below (assistant column + composer, sidebar +
        toggle) scrolls internally, not the document.
      - Real computed style of that exact div in the running app:
        `height: 2298px` (NOT 100vh/900px) -- `h-screen` is not applying at
        all. Confirmed via `getComputedStyle` in a live Playwright session
        against the real running server.
      - Real cause: this file lives in `node_modules/@fchecklist/veridian-ui-kit`
        (installed via `github:` dependency), and `node_modules` is
        gitignored (`.gitignore:1`). Tailwind v4's automatic content
        detection explicitly skips gitignored paths, and PROJEXA's
        `src/app/globals.css` (`@import "tailwindcss";`, line 1) has no
        `@source` directive re-including the ui-kit's raw source. PROJEXA's
        `next.config.ts:13` `transpilePackages: ["@fchecklist/veridian-ui-kit"]`
        only makes Next.js/webpack COMPILE that raw `.tsx` -- it has zero
        effect on Tailwind's independent content-scanning step. Net effect:
        `h-screen`'s class name reaches the DOM, but no matching CSS rule is
        ever generated for it in the real build.
      - Confirmed directly in the built CSS (not inferred): grepped all 3
        real `.next/static/chunks/*.css` files -- zero `.h-screen{` rules
        anywhere, while `.min-h-screen{` (used by PROJEXA's own first-party
        `src/app/login/page.tsx:68` etc.) IS present (1 match) -- proves
        this is a content-scanning gap specific to node_modules-sourced
        classes, not a general Tailwind v4 breakage.
      - This explains DEFECT ONE (composer pushed down the whole document)
        AND DEFECT TWO directly: the toggle IS already structurally inside
        the left `<aside>` (prior task's PR #75 fix is real and correct --
        confirmed via DOM ancestry walk, no full-width header band
        involvement), but since the outer shell never gets capped at 100vh,
        the aside also grows to full content height instead of stretching
        to the viewport, so the toggle (pinned at the bottom of the aside)
        lands 2260px down the document -- practically unreachable without
        scrolling, which is the Owner's real complaint even though the
        literal "full-width header band" framing no longer applies.
      - This is also EXACTLY why the prior task's isolated Playwright
        harness passed: a hand-authored standalone HTML/JS harness with the
        same class STRINGS is first-party/tracked content Tailwind actually
        scans, so `h-screen` gets real CSS there -- the real app's classes
        come from a gitignored dependency and never reach Tailwind's scanner
        in the actual composed app.
- [x] Implemented fix: added a Tailwind v4 `@source` directive to
      `src/app/globals.css` pointing at the ui-kit's real installed source
      so ALL of its utility classes (not just `h-screen`) get generated.
      This is a PROJEXA-repo-only fix (its own Tailwind content-scanning
      config) -- no veridian-ui-kit change/tag/pin needed for DEFECT ONE/TWO.
- [x] Rebuilt + re-verified with real Playwright against the REAL installed
      v0.3.6 package (fresh `bun install` from the tag, not my earlier
      manual file copy): `docScrollHeight`=900=viewport (zero scroll),
      composer textarea bottom=804.5 (fully visible), toggle bbox y=862-892
      (fully visible), real `.click()` on the toggle correctly hides/shows
      the panel. Screenshots in `.run/evidence/` (gitignored, not committed
      -- reproducible any time via `.run/capture.mjs`/`inspect.mjs`).
- [x] Found a SECOND real bug while verifying DEFECT TWO: even after the
      `h-screen` CSS fix, the toggle was still off-screen (y=2169) because
      `veridian-ui-kit`'s `AppSidebar.tsx` put `overflow-y-auto` on the
      whole `<aside>` (logo+nav+toggle as one scroll region) instead of on
      `<nav>` alone, sweeping the toggle into the nav's own scroll on
      PROJEXA's real 34-item nav. Fixed in veridian-ui-kit PR #15 (merged
      `038c205`, independent audit PASS), version-bumped to 0.3.6 in PR #16
      (merged `193bf48`), tagged `v0.3.6` (verified via GitHub Contents API
      before tagging).
- [x] DEFECT THREE -- real measurements, no guessing:
      - Local prod build (`bun run build`): consistently ~25-27s across 4
        separate real runs -- a real, one-time BUILD-time cost, confirmed
        NOT the dominant contributor to page-load latency (see below).
      - Local prod server (`bun run start`), real login, real `/schedule`:
        TTFB 188-222ms, total load 283-333ms (3 consecutive real runs).
      - REAL DEPLOYED SITE (https://projexa-ai.com), same real account,
        same `/schedule` route, 3 consecutive warm runs: TTFB 2611-3807ms,
        total load 2765-3999ms -- ~12-15x slower than local for the exact
        same app code (including the same transpilePackages/raw-source
        architecture), which rules out transpilePackages/build architecture
        as the dominant runtime cause (it's a build-time cost only --
        `next build`/Vercel pre-compile everything, nothing re-transpiles
        per request).
      - Real cause identified via `x-vercel-id` response header:
        `fra1::iad1::...` -- the deployed serverless function executes in
        `iad1` (US East/Virginia), while PROJEXA's real Supabase project
        (`evpckeuxgvahguwsaeul`) is in `ap-south-1` (Mumbai) (confirmed via
        `src/lib/db/index.ts`'s own comment + the real pooler hostname in
        PHASE1_SEED_REPORT.md). No `vercel.json` exists in the repo to pin
        a region -- Vercel is using its default. This cross-region
        round-trip (US East <-> Mumbai, on every middleware auth check +
        every DB/API call) is the real, measured, DOMINANT contributor to
        the Owner's "very slow" page loads -- not a regression from the
        recent shell changes (which are client-side only), and not the
        `transpilePackages` architecture (real but build-time-only cost).
      - PROPOSED FIX (not applied in this task, per SPEC's own instruction
        not to attempt a large performance rewrite -- this is an infra/
        deploy-config change, not something verifiable without real deploy
        access): add a `vercel.json` with `"regions": ["bom1"]` (Vercel's
        Mumbai region) or the nearest available region to the project's
        real Vercel plan, to co-locate the serverless function with
        Supabase `ap-south-1`. Secondary, smaller finding worth a follow-up:
        the shared `AppSidebar`'s 34 nav links each trigger a Next.js
        `Link` RSC prefetch on render (confirmed in the real deployed
        site's resource timing -- 14 parallel `?_rsc=` requests, 170-410ms
        each) -- real added server-side load on every page view, a much
        smaller contributor than the region mismatch but real and free to
        fix later (e.g. `prefetch={false}` on rarely-visited nav items).
- [x] Opened, independently audited (PASS via a fast targeted audit), and
      merged https://github.com/FChecklist/projexa/pull/77
      (commit `07c2432`).
- [x] Record completion via agent_work_briefing.py record-completion.

## Summary for the record

- veridian-ui-kit: PR #15 (`038c205`, AppSidebar scroll-region fix) + PR #16
  (`193bf48`, version bump) merged to `master`; tag `v0.3.6` created at
  `193bf48`.
- projexa: PR #77 (`07c2432`, Tailwind `@source` fix + pin bump to
  `v0.3.6` + regenerated `bun.lock`) merged to `main`.
- Root cause of DEFECT ONE + half of DEFECT TWO: PROJEXA's
  `src/app/globals.css` had no Tailwind v4 `@source` directive for
  `node_modules/@fchecklist/veridian-ui-kit/src` (gitignored, so
  Tailwind's auto content-detection skipped it) -- `AppShellFrame.tsx`'s
  `h-screen` class reached the DOM with zero generated CSS, confirmed
  directly in the real built `.next/static/chunks/*.css` (0 matches for
  `.h-screen{}`, 1 match for `.min-h-screen{}` from PROJEXA's own tracked
  source) -- NOT a bug in the shared component's JSX/class names
  themselves, a Tailwind content-scanning config gap in the consuming app.
- Root cause of the rest of DEFECT TWO: `veridian-ui-kit`'s
  `AppSidebar.tsx` had `overflow-y-auto` on the whole `<aside>` instead of
  on `<nav>` alone, sweeping the pinned toggle into the nav's own scroll
  on a real long nav list.
- DEFECT THREE: real dominant cause is a Vercel/Supabase region mismatch
  (`iad1` vs `ap-south-1`), not the recent shell changes and not
  `transpilePackages`; reported with real numbers, fix proposed
  (`vercel.json` region pin) but not applied (infra change, out of this
  task's verifiable scope).
- All verification was against the REAL running app (real `bun install`,
  real `bun run build`/`start`, real login with the real seeded E2E test
  account, real Playwright measurements/clicks against the real DOM) --
  no synthetic/hand-copied-classname harness used anywhere in this task.
