# PROGRESS -- task-20260727-182111-wire-full-veridian-module-chain-into-pro

Note: invocations 1-6 all failed instantly on OAuth session expiry (see
result.json) before doing any real work -- this is the first invocation that
actually started the task. Compliance-tracker repo work happens in an
isolated git worktree (`ct-worktree/`, branch `feat/projexa-full-module-chain-api`
off `origin/main`) rather than the shared `/opt/veridian/repos/compliance-tracker`
checkout, which has unrelated uncommitted WIP from other concurrent tasks that
must not be disturbed or swept into this PR.

## Investigation findings (SCOPE item 1)
- `veridian-ui-kit`'s `composer/ChainSelector.tsx` is REAL (not stale) -- a
  generic, reusable tree-rendering primitive (rchip/mchip rows over
  CapabilityNode[]), ported from compliance-tracker's own ChainSelector.
  compliance-tracker's local `src/components/veri-chat/ChainSelector.tsx` is
  ALSO real -- it's a further evolution (adds ChainSelectorDialog) that
  compliance-tracker kept local rather than upstreaming.
- PROJEXA already has a **documented, current** decision (see
  `src/components/veri-chat/VeriComposer.tsx` header comment) to keep its own
  local composer/chain-selector rather than adopt the shared package's
  `VeriComposer`: the shared component requires non-empty free text before
  dispatch, which conflicts with PROJEXA's deterministic (zero-text)
  dispatch model. This is a real, already-resolved conflict, not
  undiscovered duplication -- confirmed correct, no action needed there.
- Decision: path (b) from KNOWN_CONTEXT -- add a new authenticated route on
  compliance-tracker that reuses `buildCapabilityTree()` (the exact function
  compliance-tracker's own `/api/capability-tree` calls internally), and have
  PROJEXA's existing local composer/tree-merge logic consume it. No new/third
  chain-selection implementation.
- Precedent already exists for this exact "expose to PROJEXA via v1 API"
  pattern: `/api/v1/projexa/capability-tree` (Wave 130) already exposes
  `buildConstructionNodes()` (the construction-only subtree) the same way.
  New route follows the identical auth/shape convention, just calls
  `buildCapabilityTree()` (full tree) instead, and filters out the
  `construction_intelligence` branch (PROJEXA already owns that via its
  existing endpoint -- no duplicate source of truth for it).

## Completed
- [x] Investigation (above)
- [x] compliance-tracker: new route `src/app/api/v1/projexa/module-chain/route.ts`
      (worktree `ct-worktree/`, branch `feat/projexa-full-module-chain-api`,
      pushed to origin)
- [x] compliance-tracker: route test (auth/role/tenant-isolation) -- 7 pass
- [x] compliance-tracker: `tsc --noEmit` -- clean except 2 PRE-EXISTING
      unrelated errors (`@huggingface/transformers`, `@mlc-ai/web-llm` --
      not in package.json, not installed, not touched by this change;
      confirmed present before this task's edits too)
- [x] projexa: new proxy route `src/app/api/module-chain/route.ts`
- [x] projexa: merge module-chain tree into veri-chat-context.tsx alongside
      existing construction tree fetch (`fetchCapabilityTree()`, both
      fetches parallel + independently fault-tolerant)
- [x] projexa: VeriComposer.tsx -- renders new module chips automatically
      (chain-mode pills were already generic over `tree`'s top-level nodes),
      gated dispatch to construction-only leaves via `isDispatchableChain`
      (module-chain leaves are real-data browse-only for now; dispatching
      arbitrary GRC/ERP actions cross-tenant is a bigger, separately
      reviewable feature -- not required by SUCCESS_CRITERIA, documented in
      PR)
- [x] projexa: confirmed "not live project data" placeholder still accurate
      (Discuss-mode-only string; Discuss mode itself unchanged) -- left
      as-is, documented in PR
- [x] projexa: `veri-chat-context.test.ts` (merge/fault-tolerance) -- 4 pass
- [x] projexa: `tsc --noEmit` -- clean, 0 errors
- [x] projexa: `bun test` scoped to touched files -- 4 pass (whole-repo
      `bun test` also picks up e2e/*.spec.ts Playwright specs and fails on
      those -- pre-existing bun-vs-playwright test-runner collision,
      unrelated to this change, not touched)

- [x] Open PRs in both repos:
      - compliance-tracker: https://github.com/FChecklist/compliance-tracker/pull/609
        (branch `feat/projexa-full-module-chain-api`)
      - projexa: https://github.com/FChecklist/projexa/pull/59
        (this branch)

## Remaining
- [ ] Do NOT merge either PR -- requires a fresh supervisor audit first per
      task's EXPECTED_OUTPUT. Task is otherwise complete.

## Deliberately deferred (documented in PR, not silently dropped)
- Dispatching actions from the new VERI GRC AI / VERI ERP / etc chain modes
  (only browsing + drilling into real records is wired). Real cross-module
  dispatch from PROJEXA needs its own reviewed allowlist/auth surface
  (mirroring why `/api/v1/projexa/assistant` is deliberately NOT a generic
  `dispatchTool()` proxy) -- a bigger feature than this task's
  SUCCESS_CRITERIA (fetch/render module list + drill into real scoped
  records) requires.
- Multi-select (`PathSegment.multi`) chain nodes render as single-select in
  PROJEXA's local `ChainRows` (pre-existing limitation of PROJEXA's own
  local composer, not introduced by this task -- compliance-tracker's own
  ChainSelector supports mchip multi-select, PROJEXA's local port never
  did).
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
