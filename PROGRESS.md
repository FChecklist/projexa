# PROGRESS -- task-20260727-190032-scope-of-works-revision-variation-tracki

## Completed
- Investigated cross-repo first, per this task's own instruction to check PR #596's file
  locations before deciding where the work belongs: PROJEXA's own `src/lib/db/schema.ts` and
  `AGENTS.md` confirm PROJEXA holds **no construction domain data of its own** -- BOQ/scope,
  revisions, work progress, everything, live in VERIDIAN (the `FChecklist/compliance-tracker`
  repo), reached only through `src/lib/veridian-client.ts`'s `callVeridian()` against
  `/api/v1/projexa/*`. A fresh clone of compliance-tracker (`/tmp/sow-task/ct`, NOT the shared,
  dirty `/opt/veridian/repos/compliance-tracker` checkout other tasks/automation use) confirmed
  PR #596 had already built most of the revision-chain plumbing this task's SCOPE section asked
  for (`constructionBoqs.parentBoqId`/`version`, `createBoqRevision()`, `diffLineItems()`/
  `compareBoq()` with a per-item `netVariation`, and a "warn if scope already executed" soft
  warning against `constructionWorkProgressEntries.percentComplete` -- the real work-progress
  data source the SCOPE section told me to look for before inventing a fake one; it already
  exists, so the "no-op-with-TODO" fallback the SCOPE section described was not needed).
- Real gaps closed on `compliance-tracker` (new branch
  `worker/task-20260727-190032-scope-of-works-revision-variation-tracki`, PR opened --
  **https://github.com/FChecklist/compliance-tracker/pull/605**, NOT merged, per this task's own
  "requires a fresh supervisor audit before merge; do not merge yourself"):
  1. The negative-variation guard was a warning only -- `createBoqRevision()` never looked at it,
     so a revision reducing/removing already-completed scope was applied silently unless a caller
     separately called compare afterwards. Now enforced as a real `409 ServiceError` inside the
     same DB transaction (a block rolls back the whole revision), with an explicit
     `allowScopeReductionOverride: true` escape hatch. `compareBoq()`'s warnings now reuse the
     exact same pure `findScopeReductionViolations()` helper, so they can't drift apart.
  2. `compareBoq()` only compared a revision against its immediate parent. Generalized to
     `compareBoq(ctx, boqId, { against })` -- `against` may be any BOQ id in the same project
     (the actual "compare various versions" requirement).
  3. No running total variation value was exposed. Added `computeTotalVariation()` (pure), read
     at compare time (matches this codebase's documented "no denormalized diff table" convention),
     returned as `totalVariation` on the comparison response.
  4. PROJEXA's stable-facing `/api/v1/projexa/scope/*` surface only re-exported list+create.
     Added the missing `GET .../scope/[id]`, `POST .../scope/[id]/revisions`,
     `GET .../scope/[id]/compare?against=` (thin re-exports of new `/api/v1/construction/boq/[id]/...`
     routes) -- this is the concrete reason SCOPE item 4 was still open even though the underlying
     service logic mostly already existed.
  Verified there (details in that repo's own PROGRESS.md/PR #605): `bun test
  construction-boq-service.test.ts` 19/19 (5 new pure tests for the two new helpers above), sibling
  BOQ-family service tests 35/35 no regressions, `NODE_OPTIONS=--max-old-space-size=6144 npx tsc
  --noEmit` clean, all 3 relevant CI coverage-gate scripts (terminology-guardrail,
  guardrail-presence, asset-registry-coverage) pass, eslint clean.
- Built the PROJEXA-side surface this task's SCOPE item 4 also asked for, in this repo:
  - `src/app/api/scope/[id]/route.ts` (GET, single BOQ), `src/app/api/scope/[id]/revisions/route.ts`
    (POST), `src/app/api/scope/[id]/compare/route.ts` (GET, `?against=` passthrough) -- thin proxies
    to the new VERIDIAN v1 endpoints above, same `requireAuth()` + `callVeridian()` pattern as the
    existing `src/app/api/scope/route.ts`.
  - Extended `src/components/ScopeClient.tsx` (the existing Scope of Work screen): a "Variation vs.
    prior" column showing each revision's `totalVariation` (fetched via the new compare proxy, color-
    coded +/-), a "New Revision" dialog (pre-fills the parent's current line items, lets the user
    edit/add/remove, submits to the new revisions proxy), and a "Compare" dialog (added/removed/
    changed line items + warnings + total variation for any revision vs. its parent). The revision
    dialog's 409 response is surfaced as the real block message with an "Apply anyway (override)"
    button that resubmits with `allowScopeReductionOverride: true` -- the UI-facing half of the
    Owner's "blocked or require explicit override, not silently applied" directive.
  - Tests: `src/app/api/scope/[id]/revisions/route.test.ts` (3: forwards body + 201 on success;
    a 409 scope-reduction block from VERIDIAN reaches the caller as a real 409 with VERIDIAN's own
    message -- the specific behavior this task's SUCCESS_CRITERIA asks to be proven; unauthenticated
    caller never reaches VERIDIAN) and `.../compare/route.test.ts` (3: no-`against` forwards with no
    query string, `?against=` passthrough, unauthenticated caller blocked). All mock `callVeridian`
    (matching this repo's existing `punch-list/[id]/route.test.ts` convention) -- no live DB/network.
- Verified in this repo: `bun test "src/app/api/scope/[id]/revisions/route.test.ts"
  "src/app/api/scope/[id]/compare/route.test.ts"` -- 6/6 pass. `bun test src` (excludes the
  `e2e/*.spec.ts` Playwright specs bun's runner otherwise mis-collects -- pre-existing, unrelated to
  this change) -- 56/56 pass, no regressions. `NODE_OPTIONS=--max-old-space-size=4096 npx tsc
  --noEmit` -- clean. `npx eslint` on every touched file -- 0 errors.
- Did NOT touch `computeHierarchicalAmount()`/breakdown-percentage logic (constraint honored --
  verified by reading the diff, not just by intent).
- Did NOT modify any cron entry or systemd `.timer` unit (constraint honored -- no such files
  anywhere in either diff).

## Remaining / honest limitations
- No separate "Rev0/Rev1/..." literal label column -- the existing, already-shipped convention
  (PR #596) is `version` (integer) + free-text `title`, and adding a parallel naming scheme on top
  felt like the premature-parallel-structure this repo's own conventions argue against. A `Rev${v-1}`
  display label is trivial to compute at read time if the Owner specifically wants that literal
  string; not added since SUCCESS_CRITERIA didn't ask for it and it wasn't otherwise necessary.
  ScopeClient does label the very first BOQ in a chain "Baseline (Rev0)" in the Variation column as
  a readability aid, without introducing a stored column.
- `submitBoq()`/`approveBoq()` (the existing approval workflow) were NOT re-exposed at the
  v1/projexa surface or in this screen -- out of scope for what SUCCESS_CRITERIA asks to be proven
  (revision creation + comparison + the negative-variation guard), and no approval-workflow UI was
  requested. Flagging so it isn't mistaken for an oversight.
- compliance-tracker PR #605 is open, not merged -- per this task's own instruction not to merge,
  it needs a fresh supervisor audit first.

## Verification commands (this repo)
- `bun test src` -- 56/56 pass
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` -- clean
- `git log --oneline -1 -- PROGRESS.md` -- this commit
