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
- [ ] Rebuild, re-verify with real Playwright screenshots at 1440x900 (zero
      scroll, composer visible, toggle visible+clickable in left rail).
- [ ] DEFECT THREE: measure real deployed site load + local prod build,
      identify dominant contributor, report with numbers.
- [ ] Open PR against projexa, get real independent audit, merge.
- [ ] Record completion via agent_work_briefing.py record-completion.
