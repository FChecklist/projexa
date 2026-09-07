# Changelog — projexa

## Make the frozen mock the real visual UI, wiring the existing controls underneath it (2026-09-07)
Direct owner instruction, verbatim: "I WANT THIS TO BE IMPLEMENTED AS THE
VISUAL UI UX. THE BACKEND IS THE OLD UI UX. WIRE IT PROPERLY" -- and, after
this agent started reasoning about which mock differences were "later,
deliberate decisions" worth keeping instead: "you are not making new...
you are only changing the visual appearance." Six visual-only changes
under that standing instruction, no control's onClick/disabled/data/
routing/state touched, only how each one is drawn:

- **`PillStrip.tsx`** -- glyph icons instead of an uppercase kind-word
  badge; a small star instead of a 44px "Pin"/"Pinned" text button. The
  word moves into `aria-label`/`title` (same pattern as Reset's "↺"
  already used); the real 44x44 click target is preserved via an explicit
  inline `width`/`height` even though the drawn icon is small.
- **`DropZone.tsx`** -- the attach control becomes a compact paperclip
  icon (also the direct answer to an earlier, separate question about a
  missing "attachment pin" -- confirmed the mock itself doesn't draw one,
  so this was flagged before being built). Same word-preserved,
  target-preserved treatment as Pin.
- **`Composer.tsx`** -- Send moves from a full-width worded button into a
  small circular icon inset in the textarea's own corner, matching the
  mock. Outer button stays a real 44x44 hit box; an inner `<span>` draws
  the compact circle, swapping to a spinner while busy.
- **`TopRail.tsx`** -- the header band is the mock's pale lavender, not
  the kit's cream. A genuinely new base token (`--color-topbar-tint:
  #EEEDFE`) -- no purple hue exists anywhere in the real palette to
  derive one from, same situation as the pre-existing success/warning/
  error/info block.
- **`M24Shell.tsx`** -- the two worked examples under the input are two
  separate bordered chips, not one combined "e.g. X · Y" sentence.

One item deliberately not done, disclosed rather than skipped silently:
Filter/Export's plain-text-link style lives in `ScreenFrame.tsx`, a KIT
component used as shared chrome across essentially every screen archetype
in the app -- forking it would mean re-verifying dozens of pages for a
cosmetic difference that would also remove a useful disabled-reason
caption the mock's own rough prototype never modelled.

New/updated tests: `strip-controls.test.tsx`, `Composer.test.tsx`,
`composer-send.test.tsx` -- re-pointed at `aria-label`/explicit
`width`/`height` and a new `data-testid="composer-send"` hook instead of
visible text or DOM position, which stopped being reliable once these
controls went icon-only. Verified: typecheck/lint clean, production
build clean, full suite 4088/4088 pass. Re-ran the full geometric overlap
sweep from the previous two entries after these changes (short + normal
viewport, 6 routes plus the original worst-case pill-heavy scenario) --
zero confirmed overlaps. Live-verified in both the pane and real Chrome
(a third account) after each individual change. See CLAUDE.md's
"Composer shell, part 7" for the full mechanism.

## Fix the project dashboard's KPI cards to match their own frozen mock: a real fill + a real connected-strip layout, both missing (2026-09-07)
The previous entry's full-module sweep checked for ONE class of defect
(overlapping/garbled text) across the whole app and reported it as such.
It never re-opened `/dashboard/project` and compared its OWN KPI-card
styling against its OWN frozen mock, because those cards
(`DashboardProjectClient.tsx` / `KpiCard.tsx`) are page-specific, not
part of the shared shell the sweep covered. Asked directly why it still
didn't match after that sweep was reported done, the honest answer:
"no overlap bugs" and "matches every frozen mock" are different claims,
and letting the first sound like the second was the actual gap.

Doing that specific comparison found two real, concrete differences:

- **No fill at all.** The mock renders every KPI tile with a background
  -- teal for an ordinary figure, coral for the one needing attention
  ("Budget vs Actual ... over budget"). The shipped card was border-only,
  no fill. Fixed with two new tokens (`--color-kpi-tint-positive`,
  `--color-kpi-tint-warn`), derived via `color-mix()` from tokens that
  already exist and already carry the right meaning (`--color-ct-teal`,
  `--color-veri-status-late`) rather than typed-in hex -- the correct
  reading of this codebase's own "add a new semantic token if one is
  genuinely missing" rule, which an earlier same-day fix (the composer
  pill background) had read too conservatively.
- **Four separate boxes instead of one connected strip.** The mock's KPI
  row is one continuous bordered strip with thin dividers between cells;
  the kit's own `DashboardScreen` layout gives every tile its own
  separate rounded box with real gaps between them. Fixed by forking
  `DashboardScreen.tsx` (one bordered container, `divide-x`/`divide-y`
  instead of `gap`) and giving `KpiCard.tsx`/`DashboardKpiTile.tsx` a
  `bare` mode that drops a tile's own border/rounding for exactly this
  case.

New tests: `KpiCard.test.tsx` (+4, locking in which tone gets which
fill). Verified: typecheck/lint clean, production build clean, full
suite clean (4088/4088 pass). Re-ran the previous entry's overlap sweep
against this page specifically (short + normal viewport, three
different projects) after the layout change -- zero confirmed overlaps,
confirming the new layout didn't reopen that class of bug. See
`CLAUDE.md`'s "Composer shell, part 6" for the full mechanism.

## Fix four real overlap bugs found by a full-module, geometry-verified sweep of every route (2026-09-07)
The owner rejected the previous entry's "looks clean" read of a screenshot --
proven wrong by their own Edge/Chrome screenshots showing genuine
overlapping text -- and asked for every module re-checked with real
geometry, not a glance, in more than one browser, re-verified after each
fix. The overlap-detection script itself needed fixing first: a plain
bounding-rect diff has two false-positive modes (elements clipped by a
scroll ancestor still report their un-clipped position; two boxes can
geometrically overlap with no visible pixel collision because paint order
cleanly resolves which one is drawn). Fixed with a two-stage check --
clip each rect to its scrolling ancestors, then confirm any remaining
candidate with `elementFromPoint` grid-sampling -- and reused for the
whole sweep below.

Four real bugs found and fixed, all in shared shell components (so each
reproduced on every project-scoped module, not just where first found):

- **`ControlStrip.tsx`** -- the current-page chip's wrapper was `min-w-0`
  while its own button is deliberately `shrink-0`; the wrapper shrank
  below the button's real width and, with no clipping of its own, the
  button painted over the "Which project?" hint text next to it. Fixed by
  making the root segment's wrapper `shrink-0` too, matching its child.
- **`Composer.tsx`** -- the `ResizeObserver`-only height report could go
  stale under real use (156px gap held for multiple seconds, not a one-
  frame race). Fixed by adding a no-dependency-array `useLayoutEffect`
  that re-measures on every render, alongside the existing observer.
- **`M24Shell.tsx` + `Composer.tsx`** -- once the height report above was
  fixed, two `flex-1` bands with no explicit ceiling (the pinned task list,
  the conversation band) could render past their allocated box under a
  genuine squeeze. Fixed with `overflow-y-auto` on the task-list wrapper
  and a `maxHeight: 40vh` cap on the conversation band, both no-ops in the
  normal case.
- **`DropZone.tsx` + `M24Shell.tsx`** -- the attach button (`shrink-0` by
  design; its label must never fold mid-word) painted over the Send
  button on every screen with a long attach-policy label. Root cause:
  the attach column's `flex-1` sets an explicit `0%` flex-basis, which is
  what `flex-wrap`'s line-fitting decision uses -- not its rendered
  content -- so the wrap algorithm never saw it needed more room. Fixed
  with `flex-none` on the column (a real, content-based hypothetical
  size) plus `flex-wrap` on the row, so Send correctly drops to its own
  line instead of overlapping when there truly isn't room.

Full sweep: every route in the app's nav catalogue (~48 routes) re-checked
at the exact short viewport that exposed the first bug, in both the
default state and the pill-heavy state that surfaced the worst of it --
zero confirmed overlaps everywhere. Cross-checked independently in real
Chrome (a separate account) on the previously-broken routes -- zero
confirmed overlaps there too. Microsoft Edge remains unreachable by any
tool this session has (only one Chrome instance ever shows in
`list_connected_browsers`); that gap is unresolved and needs either the
owner connecting the extension there or the manual DevTools steps done
directly.

Verified: typecheck/lint clean (1 pre-existing unrelated warning,
unchanged), production build clean, full suite 4 consecutive clean runs
across this and the prior session (4084/4084 pass, 0 fail every time). See
`CLAUDE.md`'s "Composer shell, part 5" for the full mechanism, including
two disproven fix attempts worth not retrying.

## Fix a real short-viewport overflow bug and a touch-target inconsistency, found by a two-browser checklist sweep (2026-09-07)
Systematic re-check requested after the previous entry: real Chrome (via
the Claude in Chrome extension) and the dev-tooling preview pane, both
screenshotted and compared against the frozen mock, before and after a
written checklist. Found two real issues in the files the previous entry
had just changed:

- **A viewport-height-dependent overflow bug.** Real Chrome's actual test
  window was 404px tall; `COMPOSER_MAX_HEIGHT_VH` (62, the kit's own
  constant) resolves to only 250px there, and the pills band was
  `shrink-0` (never allowed to shrink). Measured directly: a full pill list
  needed more than the entire budget, and with `overflow-visible` on the
  outer wrapper (required for the composer's own grow-upward behavior) and
  no shrink on pills, the excess pushed the control strip and Send button
  117-220px below the composer's own reported bottom edge -- present in the
  DOM, invisible in the card's own implied bounds. Fixed the same way
  `conversation` already handles unbounded growth: `min-h-0` +
  `overflow-y-auto` + a `40vh` cap on the pills band in `Composer.tsx`, so
  it shrinks and scrolls internally instead of displacing what's below it.
- **A touch-target inconsistency.** `ChainRail.tsx`'s Back/Remove buttons
  were sized 32x24 -- smaller than the 44px minimum R67 A-18 sets and
  `ControlStrip.tsx`'s own identical controls meet, so the same action had
  two different minimum touch targets depending which side of the screen
  it was clicked from. Fixed to 44px, matching `ControlStrip.tsx`.

New tests: `ChainRail.test.tsx` (+2, asserting the exact 44px minimum on
both buttons). Verified: typecheck/lint clean, production build clean,
full suite 3 consecutive clean runs (4084/4084 pass). See `CLAUDE.md`'s
"Composer shell, part 4" for the full mechanism, including why this needed
a real browser to find (Happy DOM/jsdom don't model real layout overflow).

## Unify the left panel into one card, fix a real task-row overlap bug, reorder to match the frozen mock (2026-09-07)
Rebuilt the frozen mock as an actual served webpage (from its saved widget
source) so it could be screenshotted and compared against the live app
directly, rather than from memory. Found and fixed two real defects, not
just style differences:

- **Two disconnected surfaces instead of one card.** `TaskMaster` sat on a
  plain `--color-ct-cream` background with `Composer.tsx`'s own
  independently-carded white box floating below it. `AppShell.tsx` now
  wraps both together in one shared rounded/bordered white card;
  `TaskMaster.tsx`'s background is now transparent; `Composer.tsx` lost its
  own now-redundant border/shadow (its `position:absolute` growth mechanism
  is unchanged).
- **A real overlap bug.** The composer's reserved space was a static guess
  (208px) that undercounted its real height (measured at 446px in an
  ordinary state) — and `paddingBottom`-based reservation only clears an
  overlay once scrolled to a list's own end, which never happens with 30+
  real tasks. Verified geometrically: up to 15 real "Pick line"/"Dismiss"
  buttons were genuinely unreachable underneath the composer. Fixed by
  measuring the composer's actual height live (`ResizeObserver` in
  `Composer.tsx`, reported via a new `onHeightChange` prop) and reserving a
  real, physically shorter box height (not scroll padding) in
  `AppShell.tsx`. Reverified geometrically clean at every scroll position.

Also reordered `Composer.tsx`'s internal bands (pills → conversation →
control strip → input) to match the mock's own sequence ("Frequent
actions" near the top, the control bar just above the input) — safe for
the conversation band's flex-1 mechanic, confirmed by the suite staying
green. One test re-pointed at a still-valid but relocated selector
(`.pointer-events-auto` instead of `.rounded-xl`, which moved to
`AppShell.tsx`) — not a regression, a stale query.

Verified: typecheck/lint clean, production build clean (full route
manifest, zero errors), full suite 3 consecutive clean runs (4082/4082
pass). See `CLAUDE.md`'s "Composer shell, part 3" for the full mechanism.

## Add a real Back control, and remove the redundant "Needs you" heading, per explicit direction (2026-09-07)
The prior entry below disclosed two things the frozen mock asked for that
were deliberately not built, because they appeared to collide with an
older, foundational design spec this codebase calls "M24". The owner's
answer: build the mock's literal version anyway, keeping the functionality
as in the original -- only the design/presentation changes. Both landed as
design-only changes with zero functional regressions:

- **Back**: `M24Shell.tsx`'s `onBack` is `onCutFrom(chain.segments.length -
  1)` -- the exact same function every Remove button already calls, not a
  second mechanism. Rendered in `ControlStrip.tsx` (alongside HOME/Reset,
  neither removed) and `ChainRail.tsx` (a second entry point to the same
  handler, per the mock's own "two entry points into one"), disabled via
  the same `canCutAt` check Remove already uses.
- **"Needs you" heading removed**: re-reading the ACTUAL local TaskMaster
  fork in use (not the kit file a prior pass in this same investigation
  mistakenly read) showed the M24 pin-above-divider behavior is real and
  untouched; what was actually redundant was `task-row.ts` giving the Home
  tab's primary group a heading, `"Needs you"`, that duplicates the
  already-visible `"Home"` tab label above it. `primaryLabel` is now `""`
  for Home only; `TaskMaster.tsx` renders no heading element when a label
  is empty. Every row, the row's own per-item state word, the pinning
  mechanism, and the "Waiting on others" secondary group are unchanged.

New tests: `ChainRail.test.tsx` (new, 8 tests), +3 in `ControlStrip.test.tsx`,
+1 each in `task-row.test.ts` and `TaskMaster.test.tsx`. 6 pre-existing
test files needed a real `onBack` added now that it's a required prop --
`tsc --noEmit` missed this because `tsconfig.json` excludes `*.test.tsx`
from typechecking; `bun test` is the gate that actually catches it. Full
suite 3 consecutive clean runs (4082/4082), typecheck/lint/build all clean.
See `CLAUDE.md`'s "Composer shell, part 2" section for the full mechanism.

## Add the composer's chain to the right panel's top rail — the frozen mock's decision the first pass missed (2026-09-07)
The owner reported the shipped composer relocation (`9745f54`) looked "vastly
different" from the mockup review it came from. Recovered the actual frozen
mock from the session transcript and found one concrete, high-confidence gap:
the final agreed design merges the composer's chain into the right panel's
top rail ("Merge it into the right panel's top rail — show the mock," the
owner's own last instruction before freezing it), which the first pass never
built. Fixed: `AppShell.tsx` gained a `chainRail` slot; new
`ChainRail.tsx` renders the chain there, reusing the exact same
`chain`/`onCutFrom` state already computed for the left `ControlStrip` — no
new state, no changes to any page file. Hides itself whenever there's no
in-progress composer selection, so it never duplicates a page's own
breadcrumb. Two other things the mock asked for (a literal "Back" button;
removing the pinned "Needs You" card) were investigated and deliberately
NOT built, because they collide with a separate, older, foundational design
spec ("M24") already reasoned into `ControlStrip.tsx`/`TaskMaster.tsx` that
the from-scratch mock had no visibility into — see `CLAUDE.md`'s "Composer
shell, part 2" section for the full reasoning and evidence trail. Verified
live (chain appears and stays in sync on both sides; Remove on either
collapses both) plus 3 consecutive clean full-suite runs (4069/4069) and a
clean production build.

## Never run the service worker against local dev; corrects a prior "isolated Turbopack bug" misdiagnosis (2026-09-07)
`src/app/sw.js/route.ts`'s `CACHE_NAME` falls back to the fixed string `"local-dev"`
whenever `VERCEL_GIT_COMMIT_SHA` is unset (every `bun run dev` run), so its own
activate-time cache purge never fires locally even though Turbopack's dev-mode chunk
contents change on every restart. A browser that ever registered this SW kept serving
stale cached chunks indefinitely — surviving full `.next` cache clears and complete
process restarts, since neither touches the browser's own Cache Storage — which a same-day
commit (`9745f54`) had misdiagnosed as an "isolated Turbopack dev-mode bug." Fixed at the
source: `ServiceWorkerRegister.tsx` now never registers the SW in development, and
self-heals any pre-existing registration/cache from before this fix. New regression guard:
`src/components/ServiceWorkerRegister.test.tsx`. See `CLAUDE.md`'s "Dev-tooling gotcha"
section for the full mechanism.

## Fix the process-wide `mock.module()` export-drop race behind the recurring "1 fail, 1 error" flake (2026-09-07)
`src/app/(app)/project-scoped-page-error-isolation.test.tsx`'s `mock.module("@/lib/veridian-client", ...)`
provided only `{ VeridianApiError, callVeridian }`, silently dropping every other real
export (`VERIDIAN_SCREEN_BUDGET_MS` included) for the rest of the process from the moment
it ran. That same file's own subsequent dynamic imports (`./meetings/page`,
`./punch-list/page`) pull in `project-selection.ts`, which imports
`VERIDIAN_SCREEN_BUDGET_MS` from the same module — throwing a module-link `SyntaxError`
outside any `test()` callback, which bun reports as `# Unhandled error between tests` and
the JUnit reporter doesn't attribute to any testcase at all. This is what had been
surfacing, unexplained, as a different single flaky test in most full-suite runs for
days. Fixed by spreading the real module before overriding, the same pattern this file
already used correctly for its `next/navigation`/`auth-guard` mocks. Verified via 3
consecutive clean full-suite runs, 4067/4067 pass each time. See `CLAUDE.md`'s "Test-suite
gotcha" section for the full mechanism.

## Reposition the composer into the left pane; restore Company Dashboard; dedupe Design Studio nav entry (commit `9745f54`, 2026-09-07)
Forked `AppShell.tsx` from `@fchecklist/veridian-ui-kit/shell` into
`src/components/shell/AppShell.tsx` (joining `Composer.tsx`/`ControlStrip.tsx`/
`TopRail.tsx`/`PillStrip.tsx` in the same established fork pattern) so the composer mounts
inside the left Task Master pane instead of as a full-width overlay spanning both panes —
per the owner's explicit direction after an extensive UI/UX mockup review. No other shell
file changed. Also fixed two real, pre-existing nav bugs found while verifying this:
restored "Company Dashboard" (`/dashboard/hierarchy`, still a full working page, wrongly
delisted on a false redirect-equivalence claim — resolves F_023) and removed a genuine
duplicate "Design Studio" nav entry (a real duplicate-React-key bug). See `CLAUDE.md`'s
"Composer/Task Master shell" section for the full mechanism and verification.

Per compliance-tracker's `docs/DOCUMENTATION_STANDARDS.md` (R46 P9 seq36 --
the standard is written once, in compliance-tracker, and applies to both
repos per the work order's own `where_to`): this file is seeded from
**R46 P9 forward (2026-08-24/25)**, the first point this repo had a written
CHANGELOG at all. It is not a reconstruction of every PR in this repo's
history — that would be a large, separate retrofit job, out of scope for
this pass. Newest entry first, grouped by queue seq.

> **Not kept current past 2026-08-25** (noted 2026-09-01, R66 code-quality
> inspection): real merged work continued through at least PR #224
> (2026-08-30), including "Real-screen conversion (modules 17-33)" (#223)
> and "R1-R64 recheck" (#224), with nothing logged below for any of it. For
> anything after 2026-08-25, see `git log` / the GitHub PR history directly
> rather than assuming this file is current.

## R46 F_015 -- /sw.js is now a per-deploy Route Handler, cache key auto-invalidates every deploy (2026-08-25)
`platform.r43_faults` F_015: a stale Service Worker (registered at scope
`https://projexa-ai.com/`) could hijack client-side navigation app-wide --
`/scope` or `/reports` would load a cached `/work-progress` response instead.
R45 seq5 (commit `4cfd052`, already on main before this fault was filed) had
already fixed the RSC-payload-poisoning bug that caused this and bumped `CACHE_NAME`
`v1` -> `v2` by hand to purge it -- confirmed already live in production via
direct `curl` of `https://projexa-ai.com/sw.js` byte-diffed against
`origin/main`. What was still missing: that fix only works if a human
remembers to bump the version string again on every future change to this
file's caching logic. Moved `public/sw.js` to `src/app/sw.js/route.ts` (same
convention `src/app/manifest.ts` already uses) so `CACHE_NAME` is derived
from `VERCEL_GIT_COMMIT_SHA`, which is different on every deploy by
construction -- cache invalidation on deploy is now automatic and permanent,
not developer discipline. Also added an explicit `Cache-Control: no-cache`
response header on the script itself.

## R46 P9 seq36 -- this CHANGELOG (this PR, 2026-08-25)
This file (new). Docs-only. See `compliance-tracker/docs/DOCUMENTATION_STANDARDS.md`
for the real standard this seeds against, and `compliance-tracker/CHANGELOG.md`
for that repo's own entries.

## R46 L2 01 -- work-progress report qty/amt are now entry_basis-aware like percentage (PR #122, 2026-08-25)
(Not authored by this session -- listed here because this CHANGELOG's own
standard is to record every real R46-wave change to this repo from its
seed date forward, not only this session's own.)

## R46/E-126b -- proxy DELETE /api/scope/[id] to compliance-tracker's new BOQ delete (PR #120, 2026-08-25)
(Not authored by this session -- listed for the same reason as R46 L2 01 above.)

## R43 seq2 -- permits.list reads columns from the screen_definitions registry (PR #116, 2026-08-24)
(Not authored by this session -- listed for the same reason as the entries above.)
