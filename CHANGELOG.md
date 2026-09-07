# Changelog — projexa

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
