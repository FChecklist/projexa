# PROJEXA — Agent Context

## What this is (R66 code-quality fix, 2026-09-01: summarized from AGENTS.md,
## which has the fuller version -- read that for the complete picture)

Construction/architecture/interior-design PM product: Next.js 16 (App
Router) + TypeScript strict + Tailwind 4 + Drizzle ORM (`postgres.js`)
against Supabase Postgres, `bun` as package manager. Carries **no
construction domain data of its own** — schedule, BOQ, RFIs, punch lists,
mood boards, FF&E, floor plans, etc. are all read/written through
`src/lib/veridian-client.ts`, a single proxy client calling VERIDIAN AI
OS's (`FChecklist/compliance-tracker`) `/api/v1/projexa/*` API surface
with a Bearer API key. This repo's own Drizzle schema
(`src/lib/db/schema.ts`) holds only tenant/auth plumbing
(`organizations`, `memberships`) and PROJEXA's own
chat/todo/assistant-history tables.

## This is a SEPARATE app from `FChecklist/compliance-tracker` — not a skin of it

**Added 2026-09-01, after a real multi-hour session confused these two apps** and spent a
full debugging cycle looking for PROJEXA's real, current UI inside `compliance-tracker`'s
own pages instead of here. Domain data (schedule/BOQ/RFIs/etc.) is proxied through
`compliance-tracker`'s API (see "What this is" above) — but the **UI, screens, and this
repo's own tenant/auth data are independent**. If someone reports "PROJEXA's UI looks old"
or asks to verify "the real UI/UX we agreed on", the correct codebase to run and check is
**this repo**, not `compliance-tracker`.

- **Local dev runs on port 3100** (`bun run dev`, see `package.json`'s `dev` script) —
  `compliance-tracker`'s local dev server (port 3000) will never show you this app's UI.
- **Real Supabase project: `evpckeuxgvahguwsaeul`** (named "projexa" in the Supabase
  dashboard/API, `ACTIVE_HEALTHY`) — this is where `NEXT_PUBLIC_SUPABASE_URL` should
  point and where this repo's own `auth.users`/tenant tables (`organizations`,
  `memberships`) live. This is a **different** Supabase project from
  `compliance-tracker`'s own `pcrjmlpuqsbocqfwoxod` ("verdian-ai") — do not assume a
  migration or schema check against one project says anything about the other.
- **`vercel env pull` reliably returns empty/placeholder values for this project's
  secrets** (reproduced twice, 2026-09-01) — do not trust it for local env setup. If a
  working `.env.local` exists from a prior local checkout, prefer copying real values
  from that over a fresh `vercel env pull`.
- Shares `@fchecklist/veridian-ui-kit` with `compliance-tracker` for shell components
  (`AppSidebar`/`AppHeader` equivalents) — but this repo's own product screens
  (construction/interior-design PM UI, the "real-screen conversion" waves) are built
  independently on top of that shared kit, not copied from `compliance-tracker`.

## R76 state (2026-09-06) — Vercel deploy lockdown

**Vercel credits are exhausted. The owner's requirement: Vercel stays a customer-facing
production surface ONLY — never used to dev/test/deploy-to-check — and no future session
(this one or any other, human-triggered or automated) may spend credits again without the
owner's own explicit act.** Full binding policy: `platform.crr_ruling` id `R76-RULING-01`
in compliance-tracker's Supabase project (`pcrjmlpuqsbocqfwoxod`) — this repo has no
`crr_ruling` table of its own, that policy governs both repos. Full record:
compliance-tracker's `platform.claude_log` id 288 (progress) and its Phase 7 close row.

**Do not deploy to Vercel from this repo under any circumstance, including to test that
the lockdown itself works — test it locally** (`bun test src/lib/vercel-lockdown.test.ts`,
plus local error-injection of the ignore command, exactly as this block did). Do not
create a deployment via CLI/dashboard/API, do not change any Vercel project/dashboard
setting, and do not set the `OWNER_DEPLOY_APPROVAL` env var yourself under any
circumstance — only the owner may set it, directly in the Vercel dashboard, and only to
that exact day's UTC date.

Unlike compliance-tracker, this repo's `vercel.json` had NEITHER layer before R76 — both
were added fresh:
- **Layer 1** — `vercel.json` gained `"git": {"deploymentEnabled": {"*": false}}`.
  Previously absent entirely, which defaults every unspecified branch to enabled.
- **Layer 2** — `vercel.json`'s `ignoreCommand` requires `OWNER_DEPLOY_APPROVAL` to equal
  that exact day's UTC date (`sh -c '[ -n "$OWNER_DEPLOY_APPROVAL" ] && [ "$OWNER_DEPLOY_APPROVAL" = "$(date -u +%Y-%m-%d)" ] && exit 1; exit 0'`)
  — fails closed on unset/empty/wrong-date/malformed-date, proceeds only on an exact
  match. Replaced the old chore/docs-skip command, which did the opposite (proceeded on
  any real code change) and was incompatible with a fail-closed gate.
- **Layer 3** — `src/lib/vercel-lockdown.test.ts` is a checked-in drift guard (same
  pattern as compliance-tracker's `authz-gap-inventory.test.ts`): fails CI the moment
  Layer 1 or Layer 2 weaken, proven via 4 planted-weakening tests each individually
  caught then restored. `.github/workflows/ci.yml`'s Test job has an independent
  `test -f src/lib/vercel-lockdown.test.ts` step guarding against the test file itself
  being deleted — that step doesn't depend on the file's own content to fire.
- **Layer 4** (this section, plus `VERCEL_DEPLOY_OWNER_GUIDE.md` at repo root) — the
  durable record so a future session/agent knows the policy without re-deriving it.

**Layer 0 (removing the Vercel token from the machine, disconnecting the Vercel MCP
connection) is an OWNER action, not done by this block** — filed as an urgent item in the
owner register (see `VERCEL_DEPLOY_OWNER_GUIDE.md`). Until done, Layers 1-3 stop the
ordinary git-push and CI-config paths; they do not revoke the credential itself.

**The `dashboard-hierarchy-no-ffe-redirect.test.ts` / "Company Dashboard" gap noted here
by R76 is now FIXED (2026-09-07, commit `9745f54`)** — resolved by restoring, not
retiring: `/dashboard/hierarchy` was confirmed by direct read to still be a full, working,
recently-improved page (org resolution, a real empty state, the Company→Department→Project
drill-down), not reduced to a redirect like its sibling `/dashboard/overview` actually was —
so the nav entry was restored rather than the test weakened. `F_023` is green.

## Composer/Task Master shell — `AppShell.tsx` joined the fork, 2026-09-07

After an extensive owner-directed UI/UX review, `AppShell.tsx` was forked from
`@fchecklist/veridian-ui-kit/shell` into `src/components/shell/AppShell.tsx` — the same
established pattern already used for `Composer.tsx`/`ControlStrip.tsx`/`TopRail.tsx`/
`PillStrip.tsx` (the kit is a pinned, unpublished git dependency with no source in this
repo; a `node_modules` edit is erased on the next `bun install --frozen-lockfile`).

**What changed:** WHERE the composer (chat box) mounts, nothing else. The kit's original
docks the composer as a full-width `position:absolute` overlay spanning both the Task
Master pane and the routed ERP pane. The owner's direction was to confine it to the left
(Task Master) pane instead. The fork makes the `<aside>` `position:relative` and mounts
`{composer}` as its own child rather than a sibling of the aside+main row — `Composer.tsx`
itself needed zero changes, since its existing `absolute inset-x-0 bottom-0` simply
resolves against a narrower positioned ancestor now. `LEFT_PANE_PERCENT` (30/70) and every
other shell file are untouched. Full before/after reasoning and verification: see the
`9745f54` commit message, and (delivered to the owner, not checked into this repo)
`PROJEXA_UI_UX_Change_Document_Part1.md`/`Part2.md`.

Two real, pre-existing nav bugs were found and fixed alongside this (not part of the
repositioning itself): the Company Dashboard restoration above, and a genuine duplicate
"Design Studio" nav entry (same `/design-studio` href added twice by two different
commits — a real duplicate-React-key bug) removed, per `nav-routes.test.ts`'s own
allowlist.

**Applying this to other VERIDIAN AI OS products:** the real fix belongs in
`@fchecklist/veridian-ui-kit` itself, a separate repository this codebase has no write
access to. Any other product consuming that kit's `AppShell`/`Composer`/`TaskMaster` shell
needs the identical fork applied in its own repo until the kit is fixed at the source —
not confirmed to include `compliance-tracker`, whose own shell (`AppSidebar`/`AppHeader`)
predates and is architecturally distinct from this M24 kit pattern.

## Composer shell, part 2 — the right-panel chain rail (2026-09-07, closing a real gap the first pass missed)

The composer-relocation fork above (`AppShell.tsx`, `2026-09-07`) implemented the mockup review's headline change (where the composer mounts) but stopped short of the review's actual final decision. The owner's own words, the last instruction before "freeze this mock": **"Merge it into the right panel's top rail — show the mock."** The frozen mock (recovered directly from the session transcript when the owner reported the shipped shell looked "vastly different" from what was agreed) shows the composer's chain-so-far — the same sentence `ControlStrip.tsx` already renders on the left, each segment removable — ALSO visible at the top of the right (ERP) pane. The first implementation pass never built that half.

**Fixed**: `AppShell.tsx` gained a new optional `chainRail` slot, rendered inside `<main>` above `{children}`, sticky so it stays visible while the routed screen scrolls beneath it. `ChainRail.tsx` (new file) renders the chain there — reusing the exact same `chain`/`onCutFrom`/`canCutAt` state M24Shell.tsx already computes for the left `<Composer>`, so this is zero new state and zero changes to any of the ~90 page files under `src/app/(app)`. It renders nothing when `chain.segments.length <= 1` (the common case — no in-progress composer selection), so a page's own existing breadcrumb/`PageHeading` stays the only navigation line most of the time; the rail only appears once the user has actually built something via the composer, exactly the case the frozen mock demonstrated.

**Two things the mockup asked for, initially NOT built, then built anyway on explicit direction** — the two collided with a separate, older, foundational, already-shipped design spec this codebase calls "M24" (referenced dozens of times across `ControlStrip.tsx`/`TaskMaster.tsx`/`M24Shell.tsx`'s own comments), which the mockup — a fresh, from-scratch prototype — had no visibility into. Both tradeoffs were disclosed; the owner's answer was "build the mock's literal version anyway... but keep the functionality as in original, only the design is changing":

1. **A dedicated "Back" button — built (`ControlStrip.tsx`, `ChainRail.tsx`, `Composer.tsx`, `M24Shell.tsx`).** The kit's own `cutChainFrom()` doc comment calls per-segment Remove *"M24's replacement for a Back button"* — true, and Remove is untouched, kept exactly as it was. Back is NOT a second mechanism: `M24Shell.tsx`'s `onBack` is one line, `onCutFrom(chain.segments.length - 1)` — the identical function every Remove button already calls, aimed at the last segment, so it carries every side effect Remove already has (including clearing a draft that just says the removed word) for free. It renders on both sides (`ControlStrip.tsx` next to HOME/Reset; `ChainRail.tsx` as a second entry point, per the mock's own words: *"I didn't build two separate systems, just two entry points into one"*), disabled via the same `canCutAt` check Remove uses, so it is greyed out in exactly the cases removing the last segment would already refuse.
2. **Removing "Needs You" as a redundant heading — built (`task-row.ts`, `TaskMaster.tsx`).** Re-reading the ACTUAL fork in use (`src/components/shell/TaskMaster.tsx` — M24Shell.tsx imports its own local fork here, not the kit's TaskMaster, which an earlier pass in this same investigation mistakenly read instead) showed the M24 pinning rule is real but is not what the owner was reacting to: the Home tab's primary group is genuinely pinned above its divider ONLY while a `secondary` group exists, exactly the M24 behaviour, and that mechanism is completely untouched. What the owner was reacting to was `task-row.ts`'s `tabView()` giving that group its own heading text, `"Needs you"` — a second name for what the already-visible, already-selected `"Home"` tab label directly above it says. Fixed as a pure label change: Home's `primaryLabel` is now `""`, and `TaskMaster.tsx`'s `Group` renders no heading element at all when a label is empty (not an empty, oddly-padded one). Every row, the row's own per-item "Needs you" state word (a different, legitimate thing — C-13's colour-blind-safe glyph label), the pinning behaviour, the secondary "Waiting on others" heading, and the badge counts are all byte-for-byte unchanged.

New/updated tests: `ControlStrip.test.tsx` (+3: Back enabled/calls-through, disabled on root-only, disabled on empty), `ChainRail.test.tsx` (new file, 8 tests: hidden on the common path, segments+Remove, word-not-glyph, Back's two enabled/disabled cases), `task-row.test.ts` (+1: Home's `primaryLabel` is `""`, every other tab's is untouched), `TaskMaster.test.tsx` (+1: an empty label renders no heading, the row's own state word and a real secondary label are unaffected). The 6 pre-existing test files that render `<Composer>`/`<ControlStrip>` directly (`Composer.test.tsx`, `composer-modes.test.tsx`, `composer-send.test.tsx`, `ControlStrip.test.tsx`, `object-strip.test.tsx`, `strip-controls.test.tsx`) all needed a real `onBack` passed in now that it is a required prop — `tsc --noEmit` did not catch this on its own, because `tsconfig.json` excludes `**/*.test.tsx` from typechecking entirely; `bun test` is what actually exercises these paths, which is why it, not `tsc`, is the gate that matters here.

Live-verified: selecting a project then a module shows the chain and a working, correctly-enabled Back on both sides; clicking Back removes exactly the last segment and both sides update in sync; a root-only/empty chain correctly disables (ControlStrip) or fully hides (ChainRail) Back; the Home tab's task list no longer shows a redundant "Needs you" heading while its rows, badges and the "Waiting on others" group are unchanged. Full suite (`bun test --isolate`) 3 consecutive clean runs, 4082/4082 pass; typecheck, lint, and production build all clean.

## Composer shell, part 3 — one unified card, a real overlap bug, and reordering to match the frozen mock (2026-09-07)

The owner reported the shell still looked "vastly different" after parts 1-2 above, and asked directly: render the frozen mock as a real page and compare it against the running app, rather than describing the difference in prose. Done — the mock's saved widget source was rebuilt as an actual HTML file (with the CDS design-token values it depends on) and served through the dev server so it could be screenshotted and inspected exactly like the live app. That comparison found two genuine defects, not just a style gap:

1. **Two disconnected surfaces instead of one card — fixed (`AppShell.tsx`, `TaskMaster.tsx`, `Composer.tsx`).** The frozen mock's left pane is one continuous white card — Frequent actions, the chip row, the control bar, and the input all share one border/background. The shipped shell had `TaskMaster` on a plain `--color-ct-cream` background with `Composer.tsx`'s own independently-carded white rounded box floating below it — two panels, not the mock's one. Fixed by moving the card chrome up a level: `AppShell.tsx`'s aside now wraps `{taskMaster}` and `{composer}` together in ONE rounded/bordered white container; `TaskMaster.tsx`'s background changed from `--color-ct-cream` to `transparent`; `Composer.tsx`'s root lost its own now-redundant border/shadow/white-background but kept its `position:absolute inset-x-0 bottom-0` growth mechanism completely unchanged, just anchored to the new shared wrapper.

2. **A real, measurable overlap bug, found while verifying #1 — fixed (`AppShell.tsx`, `Composer.tsx`, `M24Shell.tsx`).** The space reserved for the composer inside the task list's scroll container was `paddingBottom: COMPOSER_RESTING_HEIGHT + composerReserveExtra` — a static guess (208px) baked in since the very first AppShell fork. The composer's real height is not static: it grows with however many ranked pills are showing, whether a "Do again" recent-chain row is present, and whether any pill without a chosen project prints its own "Choose project" sub-line. Measured live in one ordinary state (Home tab, several pills): the composer rendered at 446px against a 208px reservation. Critically, `paddingBottom` on a scrollable container only clears an overlay once scrolled to the container's own end — with 30-40+ real task rows (far more than one screen), rows at a normal, unscrolled position rendered in the same fixed screen region the composer occupies, and the composer's z-index covered them: verified geometrically that up to 15 real "Pick line"/"Dismiss"/"Choose project" buttons were genuinely unreachable underneath it, at multiple scroll positions. Fixed at the root: `Composer.tsx` now measures its own actual rendered height with a `ResizeObserver` on its root (not a wrapper — an absolutely-positioned child contributes zero height to an ordinary parent, so the observer has to sit on the real box) and reports it via a new `onHeightChange` prop; `M24Shell.tsx` stores that in `composerHeight` state and feeds `Math.max(COMPOSER_PILLS_BAND_RESERVE, composerHeight - COMPOSER_RESTING_HEIGHT)` to `AppShell.tsx` as `composerReserveExtra`. `AppShell.tsx` itself also changed HOW that reservation is applied: from `paddingBottom` (virtual, only helps at the scroll-end) to an explicit `height: calc(100% - Xpx)` on the task-list box (a real, physically shorter box, so its own content can never extend into the composer's region at ANY scroll position). Reverified geometrically after the fix: the task-list box and the composer box share an exact, zero-gap boundary (down to sub-pixel floating-point noise, not a real overlap) at both the top and the very end of a long scroll.

3. **Reordered to match the mock's actual vertical sequence (`Composer.tsx`).** The mock's own order is Frequent actions (near the top) → chip row → the four-control bar "right above the chat box" → input. The shipped composer had it backwards: control strip first, pills lower down. Reordered to pills → conversation → control strip → input. Safe for the conversation band's `flex-1` grow-upward mechanic: flexbox gives a flex-1 child whatever space is left over regardless of its position among `shrink-0` siblings in the same column, so this changed visual order only, not the sizing math (confirmed by the full suite staying green through the change).

One test needed updating, not because of a regression but a stale selector: `Composer.test.tsx`'s "the message region renders above the box, outside it" test identified "the box" via `.rounded-xl` — a class that moved to `AppShell.tsx` in change #1 above. Re-pointed at `.pointer-events-auto`, the one class that has identified this exact box both before and after the move (the wrapper above it is deliberately `pointer-events-none`). The rule the test protects — the message region sits as a sibling before the box, never inside it — is unchanged.

Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean (full ~90-route manifest, zero errors), full suite 3 consecutive clean runs (4082/4082 pass, 0 fail every time). Live-verified in the browser at multiple scroll positions with real data (38 tasks on the Home tab) using geometric intersection checks against actual bounding rects, not just a screenshot glance — the technique that caught defect #2 in the first place, since a screenshot alone reads a correctly-adjoined boundary and a genuinely overlapping one as visually similar at this data volume.

## Composer shell, part 4 — a two-browser, viewport-height sweep found a real overflow bug part 3 missed (2026-09-07)

The owner asked for a properly systematic re-check after part 3: both a real Chrome (via the Claude in Chrome extension, not just the dev-tooling preview pane) and the pane itself, screenshots, direct comparison against the frozen mock, and a written checklist before and after — not another single pass. Doing that surfaced one more genuine defect and one accessibility inconsistency, both in the two files part 3 had just changed.

**A real overflow bug, viewport-height-dependent — fixed (`Composer.tsx`).** Real Chrome's actual window in this test had a 404px inner height (a real, if short, browser window — not a contrived edge case). `COMPOSER_MAX_HEIGHT_VH` (the kit's own constant, 62) resolves to only 250px there, and the pills band ("Frequent actions") was `shrink-0` — always rendered at its full natural height, never allowed to shrink. On a tall viewport that's harmless (62vh comfortably covers everything); at 404px, a full pill list alone needed more than the entire 250px budget, and with the outer composer wrapper's `overflow-visible` (required so the box can grow upward past its resting height) and no shrink on the pills band, the excess didn't scroll or clip — it pushed the control strip and the Send button DOWN, past the composer's own reported bottom edge. Measured directly in real Chrome: the control strip and input rendered 117-220px below where the composer's own box claimed to end -- present in the DOM and reachable by scrolling the raw page, but invisible in the space the visible card implied they occupied. Confirmed the mechanism, then reproduced and reverified the fix in the pane at an equivalent viewport (450px) since the real Chrome window became inaccessible (minimized by the OS/user mid-session, outside any tool's control) before a second pass was possible there. Fixed the same way `conversation` already handles its own unbounded growth: `min-h-0` (overrides the content-based automatic minimum size that `overflow:visible` flex items get by default) + `overflow-y-auto` + an explicit `maxHeight: 40vh` safety cap, so pills shrink and scroll internally instead of displacing the control strip and input. `PillStrip.tsx` itself is untouched -- only its container in `Composer.tsx` is bounded now.

**A real accessibility inconsistency — fixed (`ChainRail.tsx`).** `ChainRail.tsx` (part 2's new file) sized its Back and Remove buttons at 32x24 to keep the right-panel rail visually thin. R67 A-18 sets a 44px minimum touch target, and `ControlStrip.tsx`'s own (x)/HOME/Reset/Back all meet it — meaning the exact same action (removing a chain segment) had two different minimum touch targets depending on which side of the screen it was clicked from. Fixed to the same 44px minimum, same as `ControlStrip.tsx` already does ("the row's own padding comes down as the controls in it grow to their 44px minimum, so the strip stays one band rather than becoming two") — the rail is now ~57px tall at rest instead of ~32px, a small, correct cost for a consistent, non-regressive touch target.

New/updated tests: `ChainRail.test.tsx` (+2: Back and Remove both assert `minWidth`/`minHeight` of exactly `44px`, locking the fix in so it can't silently regress again). No test needed updating for the pills fix — none of the existing suite renders the composer at a constrained viewport height (Happy DOM/jsdom don't model real layout overflow the way a real browser does), which is exactly why this needed a real-browser pass to find in the first place, not just `bun test`.

Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean, full suite 3 consecutive clean runs (4084/4084 pass, 0 fail every time). Live-verified geometrically (bounding-rect measurements, not a screenshot glance) at both a normal viewport and the reproduced 450px short one: pills band now correctly shrinks and scrolls, control strip and input stay fully contained inside the composer's own box in both cases, and Remove/Back still function correctly (segment removal, chain-rail auto-hide) after the touch-target resize.

## Dev-tooling gotcha: the app's own service worker must never run against local dev (found + fixed 2026-09-07 — corrects a prior misdiagnosis)

A commit this same day (`9745f54`, verifying the AppShell/nav fixes above) had documented
`/dashboard` intermittently failing under `next dev`'s Turbopack compiler with "Module ...
was instantiated ... but the module factory is not available" as an **isolated Turbopack
dev-mode bug** — surviving full `.next` cache clears and complete process restarts, so
judged non-blocking dev-tooling noise. **That diagnosis was wrong.** The real cause: this
app's own service worker (`src/app/sw.js/route.ts`, registered by
`ServiceWorkerRegister.tsx`) derives its `CACHE_NAME` from `VERCEL_GIT_COMMIT_SHA`, falling
back to the fixed literal string `"local-dev"` whenever that's unset — true for every
`bun run dev` run. Its own `activate` handler purges any cache whose name isn't the current
`CACHE_NAME`, but since that name never changes between local dev-server restarts, the purge
never fires locally, even though Turbopack's dev-mode `/_next/static/*` chunk contents DO
change on every restart (unlike production's genuinely content-hashed, immutable chunk
URLs, which is the only case this SW's cache-first logic was designed for). A browser that
had ever registered this SW kept serving an old cached chunk — one built before
`AppSidebar.tsx`'s `DraftingCompass` import was removed — no matter how many times the
dev server or `.next` cache was reset, because neither touches the browser's own Cache
Storage. Confirmed directly: `navigator.serviceWorker.getRegistrations()` showed a live
registration at scope `http://localhost:3100/` backing a cache literally named
`projexa-shell-local-dev`; unregistering it and deleting that cache fixed the page
immediately, with zero source changes. **Fixed at the source**, not just worked around:
`ServiceWorkerRegister.tsx` now never calls `register()` in `NODE_ENV === "development"` —
instead it unregisters any existing registration and deletes any `projexa-shell-*` cache on
mount, so a developer who already has a poisoned registration from before this fix is
self-healed on their next page load with no manual console commands needed. Regression
guard: `src/components/ServiceWorkerRegister.test.tsx`. The SW's own stated purpose (an
offline app shell for a field site worker with no signal) is a production concern with zero
meaning on `localhost`, so there is no tradeoff here — it should never have run in dev.

## Test-suite gotcha: `mock.module()` on a real module must spread it, or `bun test --isolate` still isn't safe against it (found + fixed 2026-09-07)

`bun test`'s `mock.module()` replaces a module **for the rest of the process** the moment
it runs — `--isolate` (see Commands below) only isolates *some* leakage patterns, not
this one, because the hazard here is inside a single file's own dynamic-import chain, not
cross-file leakage. If a test does
`mock.module("@/some/real-module", () => ({ oneExport: fakeImpl }))` instead of
`mock.module("@/some/real-module", () => ({ ...(await import("@/some/real-module")),
oneExport: fakeImpl }))`, every OTHER real export of that module silently disappears for
any code that imports it afterward — including the test file's own subsequent dynamic
imports.

Found live in `src/app/(app)/project-scoped-page-error-isolation.test.tsx`: its
`mock.module("@/lib/veridian-client", ...)` provided only `{ VeridianApiError,
callVeridian }`, dropping `VERIDIAN_SCREEN_BUDGET_MS` (and every other real export). That
same file's own dynamic imports two lines later (`./meetings/page`, `./punch-list/page`)
pull in `project-selection.ts`, which imports `VERIDIAN_SCREEN_BUDGET_MS` from the same
module — so it threw `SyntaxError: Export named 'VERIDIAN_SCREEN_BUDGET_MS' not found`
at module-link time, **outside any single `test()` callback**. bun logs that as
`# Unhandled error between tests` and the JUnit reporter (`--reporter=junit`) doesn't
attribute it to any testcase at all (`failures="0"` in its own root tag even while the
console reporter shows "1 fail, 1 error") — which is exactly why this had been surfacing
across full-suite runs for days as an unexplained, seemingly-random single flake, a
different specific test implicated each run. It wasn't random: it was this one file's
own mock, racing against whichever other test happened to import the same real module's
other exports first. Fixed by spreading the real module first, same pattern this exact
file already used correctly for its `next/navigation` and `@/lib/supabase/auth-guard`
mocks two blocks above (see that file's own comments). Confirmed via 3 consecutive clean
full-suite runs (4067/4067 pass, 0 fail each time) after the fix, versus the prior best of
4061/4062 across 6+ runs before it. If a future `mock.module()` call on a real (not
synthetic) module ever provides only a subset of that module's exports, apply the same
fix — don't assume `--isolate` alone covers it.

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server (**port 3100**)
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
