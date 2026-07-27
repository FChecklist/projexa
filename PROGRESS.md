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
