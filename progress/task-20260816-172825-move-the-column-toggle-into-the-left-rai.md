# PROGRESS -- task-20260816-172825-move-the-column-toggle-into-the-left-rai

## Completed

- [x] Read the authoritative mock `/tmp/projexa_layout_mock.html` -- confirmed
      real CSS `.shell { grid-template-columns: 10% 50% 40%; }`, matching the
      SPEC's stated proportions exactly.
- [x] Located the shared shell components (`veridian-ui-kit` repo, cloned at
      `/opt/veridian/repos/veridian-ui-kit`; worked from a scratch clone at
      `workspace/.ui-kit-work/` since `/opt/veridian/repos/*` is outside this
      worker's assigned workspace and Edit/Write there is hook-blocked).
      Confirmed `master` @ `1ec61a0` = tag `v0.3.3` (the version PROJEXA is
      currently pinned to).
- [x] Identified both real defects in `AppHeader.tsx`
      (`onToggleRightPanel` renders lucide's `PanelRight` icon + title
      "Toggle VERI Chat panel") and confirmed via `AppShellFrame.tsx` that
      this toggle really does control the wide MIDDLE assistant column, not
      a right strip -- exactly the stale semantics the SPEC describes.
- [x] Implemented the fix in `veridian-ui-kit`:
      - `AppHeader.tsx`: removed `onToggleRightPanel` prop and its
        `PanelRight` button entirely (no column-scoped control belongs in
        the full-width header).
      - `AppSidebar.tsx`: added `middleColumnToggle` prop -- a rail button
        rendered structurally inside the `<aside>` left column, pinned
        below the nav list (`shrink-0`, outside the scrollable `<nav>`) so
        it's always visible/clickable without scrolling even at the rail's
        ~10%-of-viewport width. Icon is lucide's `MessageSquare` (chat
        identity, not screen position) so it can't go stale again the way
        `PanelRight` did. `title` and `aria-label` are both set to the same
        computed string ("Show {label}"/"Hide {label}") plus
        `aria-pressed`, so accessible name/tooltip/icon all agree.
      - Column proportions untouched: `useResizableWidth` calls in both
        `AppSidebar.tsx` and `AppShellFrame.tsx` unchanged.
- [x] `bun run typecheck` (veridian-ui-kit, via `.ui-kit-work`) -- clean.
- [x] Opened https://github.com/FChecklist/veridian-ui-kit/pull/11 against
      `master`.

## Remaining

- [ ] Get a real independent audit of PR #11 (never self-certify) and merge
      only on PASS.
- [ ] Tag the merged commit as `v0.3.4` on `veridian-ui-kit`.
- [ ] Update PROJEXA's `AppTopbar.tsx`/`AppSidebar.tsx`/`(app)/layout.tsx` to
      stop passing `onToggleRightPanel` to `AppHeader` and instead wire
      `middleColumnToggle` into `AppSidebar`.
- [ ] Bump PROJEXA's `package.json` pin to
      `github:FChecklist/veridian-ui-kit#v0.3.4` and regenerate `bun.lock`.
- [ ] `bun run lint` + `tsc --noEmit` in PROJEXA -- clean.
- [ ] Real Playwright screenshots at a laptop viewport (toggle inside left
      rail, corrected icon/label, columns still 10/50/40) and a narrow
      viewport (no overlap/clipping), and confirm composer stays visible
      without scrolling.
- [ ] Open + audit + merge the PROJEXA PR (never self-certify).
- [ ] Record completion via
      `scripts/agent_work_briefing.py record-completion --umr-id
      UMR-20260816-171932-d5eb`.
