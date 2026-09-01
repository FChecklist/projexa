# Changelog — projexa

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
