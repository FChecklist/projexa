# Changelog — projexa

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
