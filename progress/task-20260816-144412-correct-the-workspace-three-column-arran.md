# PROGRESS -- task-20260816-144412-correct-the-workspace-three-column-arran

## Completed

- [x] Verified the authoritative mock (`/tmp/projexa_layout_mock.html`, md5
      `e5dffb722bb868d487b1f4d5c6bd313f` -- matches the SPEC's stated hash)
      and extracted its real spec: `.shell { grid-template-columns: 10% 50% 40%; }`,
      `.workspace` (middle) genuinely contains task rows/day dividers/suggestion
      chips/composer, `.erp` (right) genuinely contains the module surface.
- [x] Established, with real evidence, that the fix belongs in the SHARED
      `veridian-ui-kit` package (`AppShellFrame.tsx`), not in projexa's own
      page composition: read PROJEXA's only `AppShellFrame` call site
      (`src/app/(app)/layout.tsx`) and confirmed it already passes
      semantically-correct props (`children` = routed module/page,
      `panel` = `<VeriChatPanel />`, the real assistant with
      Overview/Queries/Chats/To Do tabs + task list). The shared component
      itself wired `children`+`composer` into the wide flexible middle slot
      and `panel` into the narrow resizable right slot -- exactly backwards
      from the Owner's spec -- so projexa needed zero call-site changes.
- [x] Checked the real current pin: `package.json` already had
      `github:FChecklist/veridian-ui-kit#v0.3.2` -- confirmed via
      `git fetch --tags` that v0.3.2 (commit `fbe59dc`) really was the
      latest published tag at task start (not behind).
- [x] Implemented the fix in `veridian-ui-kit` (`src/shell/AppShellFrame.tsx`):
      swapped which slot `panel`+`composer` vs `children` render in, so the
      assistant (`panel`) + anchored `composer` is now the wide ~50% middle
      column, and the routed module/page content (`children`) is the
      narrower ~40% right column with its own `overflow-y-auto` (raw page
      content doesn't self-manage scroll the way `PanelShell` does). The
      10/50/40 proportion itself was already correct (sidebar
      `useResizableWidth` default 10%, the other side's existing 320-640px/
      ~40%-default bounds) -- only the content assignment was backwards.
      `homeRoute` merge behavior (dashboard page + inline thread, no
      separate assistant column) is functionally unchanged -- same JSX
      branch, re-labeled.
- [x] `npm run typecheck` (veridian-ui-kit) -- clean.
- [x] Opened, audited, and merged
      https://github.com/FChecklist/veridian-ui-kit/pull/9 (the arrangement
      fix) -- real subagent audit verdict: **PASS** (walked both `isHome`
      branches, confirmed no double-scroll/duplicate-render/regression, one
      stale comment flagged and fixed before merge in the same PR). Merge
      commit `ab8a1b2`.
- [x] Opened and merged
      https://github.com/FChecklist/veridian-ui-kit/pull/10 (version bump
      0.3.2 -> 0.3.3, trivial one-line change, no separate audit needed).
      Merge commit `1ec61a0`.
- [x] Tagged `v0.3.3` on `veridian-ui-kit` pointing at `1ec61a0` (verified
      via GitHub Contents API that this exact commit's `package.json` reads
      `"version": "0.3.3"` before tagging -- first attempt tagged the wrong
      SHA, `git api` DELETE + recreate corrected it before use).
- [x] Bumped projexa's real dependency pin
      (`package.json`: `@fchecklist/veridian-ui-kit` ->
      `github:FChecklist/veridian-ui-kit#v0.3.3`) and regenerated `bun.lock`
      via a real `bun install` (installed `bun` 1.3.14 locally since it
      wasn't preinstalled) -- confirmed `bun.lock`'s resolved entry now reads
      `#1ec61a0` (was `#fbe59dc`) and `node_modules/@fchecklist/veridian-ui-kit`
      on disk is genuinely version `0.3.3` with the fixed `AppShellFrame.tsx`.
- [x] `bun run lint` (projexa) -- 0 errors (4 pre-existing warnings,
      unrelated to this change). `tsc --noEmit` (projexa) -- clean.
- [x] Real Playwright screenshots (Chromium, via the box's existing
      `LD_LIBRARY_PATH` GTK-lib shim at
      `/opt/veridian/workspace/browser-tools/local-libs/...`) of the EXACT
      Tailwind class strings the real, post-fix components emit
      (`AppShellFrame.tsx`, `PanelShell.tsx`, `VeriComposer.tsx`,
      `AppSidebar.tsx`), before vs. after, at 1440x900 (laptop) and
      1024x768 (narrow) -- confirms: composer fully visible with **zero
      scrolling** at 1440x900, assistant is the wide primary surface with
      its task list + composer, module content is the right independently-
      scrollable column (proved with 40 tall filler rows that never push
      the composer), and no column overlap at 1024px.

## Remaining

- [ ] None for this task's SUCCESS_CRITERIA. Optional follow-ups noted but
      out of scope (icon-only, not an arrangement/functionality defect):
      `AppHeader`'s `onToggleRightPanel` button still uses lucide's
      `PanelRight` icon/label ("Toggle VERI Chat panel"), which is now a
      minor semantic mismatch since that toggle controls the wide middle
      assistant column, not a right strip -- flagged by the PR #9 audit,
      deliberately not changed here per the "layout correction, not a
      redesign" scope boundary.
