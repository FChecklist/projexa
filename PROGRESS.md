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

## Remaining
- [ ] compliance-tracker: new route `src/app/api/v1/projexa/module-chain/route.ts`
- [ ] compliance-tracker: route test (auth/role/tenant-isolation)
- [ ] projexa: new proxy route `src/app/api/module-chain/route.ts`
- [ ] projexa: merge module-chain tree into veri-chat-context.tsx alongside
      existing construction tree fetch
- [ ] projexa: VeriComposer.tsx -- render new module chips, gate dispatch to
      construction-only leaves (module-chain leaves are real-data browse-only
      for now; dispatching arbitrary GRC/ERP actions cross-tenant is a bigger,
      separately-reviewable feature, not required by SUCCESS_CRITERIA)
- [ ] projexa: confirm "not live project data" placeholder still accurate
      (Discuss-mode-only string, Discuss mode itself unchanged) -- document
      in PR
- [ ] tests + typecheck in both repos
- [ ] PRs opened
