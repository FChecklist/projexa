# PROJEXA — Agent Context

## What this is (R66 code-quality fix, 2026-09-01: summarized from AGENTS.md,
## which has the fuller version -- read that for the complete picture)

Construction/architecture/interior-design PM product: Next.js 16 (App
Router) + TypeScript strict + Tailwind 4 + Drizzle ORM (`postgres.js`)
against Supabase Postgres, `bun` as package manager. Carries **no
construction domain data of its own** — schedule, BOQ, RFIs, punch lists,
mood boards, FF&E, floor plans, etc. are all read/written through
`src/lib/veridian-client.ts`, a single proxy client calling VERIDIAN AI
OS's (`FChecklist/compliance-tracker`) `/api/v1/projexa/*` API surface
with a Bearer API key. This repo's own Drizzle schema
(`src/lib/db/schema.ts`) holds only tenant/auth plumbing
(`organizations`, `memberships`) and PROJEXA's own
chat/todo/assistant-history tables.

## This is a SEPARATE app from `FChecklist/compliance-tracker` — not a skin of it

**Added 2026-09-01, after a real multi-hour session confused these two apps** and spent a
full debugging cycle looking for PROJEXA's real, current UI inside `compliance-tracker`'s
own pages instead of here. Domain data (schedule/BOQ/RFIs/etc.) is proxied through
`compliance-tracker`'s API (see "What this is" above) — but the **UI, screens, and this
repo's own tenant/auth data are independent**. If someone reports "PROJEXA's UI looks old"
or asks to verify "the real UI/UX we agreed on", the correct codebase to run and check is
**this repo**, not `compliance-tracker`.

- **Local dev runs on port 3100** (`bun run dev`, see `package.json`'s `dev` script) —
  `compliance-tracker`'s local dev server (port 3000) will never show you this app's UI.
- **Real Supabase project: `evpckeuxgvahguwsaeul`** (named "projexa" in the Supabase
  dashboard/API, `ACTIVE_HEALTHY`) — this is where `NEXT_PUBLIC_SUPABASE_URL` should
  point and where this repo's own `auth.users`/tenant tables (`organizations`,
  `memberships`) live. This is a **different** Supabase project from
  `compliance-tracker`'s own `pcrjmlpuqsbocqfwoxod` ("verdian-ai") — do not assume a
  migration or schema check against one project says anything about the other.
- **`vercel env pull` reliably returns empty/placeholder values for this project's
  secrets** (reproduced twice, 2026-09-01) — do not trust it for local env setup. If a
  working `.env.local` exists from a prior local checkout, prefer copying real values
  from that over a fresh `vercel env pull`.
- Shares `@fchecklist/veridian-ui-kit` with `compliance-tracker` for shell components
  (`AppSidebar`/`AppHeader` equivalents) — but this repo's own product screens
  (construction/interior-design PM UI, the "real-screen conversion" waves) are built
  independently on top of that shared kit, not copied from `compliance-tracker`.

## R76 state (2026-09-06) — Vercel deploy lockdown

**Vercel credits are exhausted. The owner's requirement: Vercel stays a customer-facing
production surface ONLY — never used to dev/test/deploy-to-check — and no future session
(this one or any other, human-triggered or automated) may spend credits again without the
owner's own explicit act.** Full binding policy: `platform.crr_ruling` id `R76-RULING-01`
in compliance-tracker's Supabase project (`pcrjmlpuqsbocqfwoxod`) — this repo has no
`crr_ruling` table of its own, that policy governs both repos. Full record:
compliance-tracker's `platform.claude_log` id 288 (progress) and its Phase 7 close row.

**Do not deploy to Vercel from this repo under any circumstance, including to test that
the lockdown itself works — test it locally** (`bun test src/lib/vercel-lockdown.test.ts`,
plus local error-injection of the ignore command, exactly as this block did). Do not
create a deployment via CLI/dashboard/API, do not change any Vercel project/dashboard
setting, and do not set the `OWNER_DEPLOY_APPROVAL` env var yourself under any
circumstance — only the owner may set it, directly in the Vercel dashboard, and only to
that exact day's UTC date.

Unlike compliance-tracker, this repo's `vercel.json` had NEITHER layer before R76 — both
were added fresh:
- **Layer 1** — `vercel.json` gained `"git": {"deploymentEnabled": {"*": false}}`.
  Previously absent entirely, which defaults every unspecified branch to enabled.
- **Layer 2** — `vercel.json`'s `ignoreCommand` requires `OWNER_DEPLOY_APPROVAL` to equal
  that exact day's UTC date (`sh -c '[ -n "$OWNER_DEPLOY_APPROVAL" ] && [ "$OWNER_DEPLOY_APPROVAL" = "$(date -u +%Y-%m-%d)" ] && exit 1; exit 0'`)
  — fails closed on unset/empty/wrong-date/malformed-date, proceeds only on an exact
  match. Replaced the old chore/docs-skip command, which did the opposite (proceeded on
  any real code change) and was incompatible with a fail-closed gate.
- **Layer 3** — `src/lib/vercel-lockdown.test.ts` is a checked-in drift guard (same
  pattern as compliance-tracker's `authz-gap-inventory.test.ts`): fails CI the moment
  Layer 1 or Layer 2 weaken, proven via 4 planted-weakening tests each individually
  caught then restored. `.github/workflows/ci.yml`'s Test job has an independent
  `test -f src/lib/vercel-lockdown.test.ts` step guarding against the test file itself
  being deleted — that step doesn't depend on the file's own content to fire.
- **Layer 4** (this section, plus `VERCEL_DEPLOY_OWNER_GUIDE.md` at repo root) — the
  durable record so a future session/agent knows the policy without re-deriving it.

**Layer 0 (removing the Vercel token from the machine, disconnecting the Vercel MCP
connection) is an OWNER action, not done by this block** — filed as an urgent item in the
owner register (see `VERCEL_DEPLOY_OWNER_GUIDE.md`). Until done, Layers 1-3 stop the
ordinary git-push and CI-config paths; they do not revoke the credential itself.

**The `dashboard-hierarchy-no-ffe-redirect.test.ts` / "Company Dashboard" gap noted here
by R76 is now FIXED (2026-09-07, commit `9745f54`)** — resolved by restoring, not
retiring: `/dashboard/hierarchy` was confirmed by direct read to still be a full, working,
recently-improved page (org resolution, a real empty state, the Company→Department→Project
drill-down), not reduced to a redirect like its sibling `/dashboard/overview` actually was —
so the nav entry was restored rather than the test weakened. `F_023` is green.

## Composer/Task Master shell — `AppShell.tsx` joined the fork, 2026-09-07

After an extensive owner-directed UI/UX review, `AppShell.tsx` was forked from
`@fchecklist/veridian-ui-kit/shell` into `src/components/shell/AppShell.tsx` — the same
established pattern already used for `Composer.tsx`/`ControlStrip.tsx`/`TopRail.tsx`/
`PillStrip.tsx` (the kit is a pinned, unpublished git dependency with no source in this
repo; a `node_modules` edit is erased on the next `bun install --frozen-lockfile`).

**What changed:** WHERE the composer (chat box) mounts, nothing else. The kit's original
docks the composer as a full-width `position:absolute` overlay spanning both the Task
Master pane and the routed ERP pane. The owner's direction was to confine it to the left
(Task Master) pane instead. The fork makes the `<aside>` `position:relative` and mounts
`{composer}` as its own child rather than a sibling of the aside+main row — `Composer.tsx`
itself needed zero changes, since its existing `absolute inset-x-0 bottom-0` simply
resolves against a narrower positioned ancestor now. `LEFT_PANE_PERCENT` (30/70) and every
other shell file are untouched. Full before/after reasoning and verification: see the
`9745f54` commit message, and (delivered to the owner, not checked into this repo)
`PROJEXA_UI_UX_Change_Document_Part1.md`/`Part2.md`.

Two real, pre-existing nav bugs were found and fixed alongside this (not part of the
repositioning itself): the Company Dashboard restoration above, and a genuine duplicate
"Design Studio" nav entry (same `/design-studio` href added twice by two different
commits — a real duplicate-React-key bug) removed, per `nav-routes.test.ts`'s own
allowlist.

**Applying this to other VERIDIAN AI OS products:** the real fix belongs in
`@fchecklist/veridian-ui-kit` itself, a separate repository this codebase has no write
access to. Any other product consuming that kit's `AppShell`/`Composer`/`TaskMaster` shell
needs the identical fork applied in its own repo until the kit is fixed at the source —
not confirmed to include `compliance-tracker`, whose own shell (`AppSidebar`/`AppHeader`)
predates and is architecturally distinct from this M24 kit pattern.

## Composer shell, part 2 — the right-panel chain rail (2026-09-07, closing a real gap the first pass missed)

The composer-relocation fork above (`AppShell.tsx`, `2026-09-07`) implemented the mockup review's headline change (where the composer mounts) but stopped short of the review's actual final decision. The owner's own words, the last instruction before "freeze this mock": **"Merge it into the right panel's top rail — show the mock."** The frozen mock (recovered directly from the session transcript when the owner reported the shipped shell looked "vastly different" from what was agreed) shows the composer's chain-so-far — the same sentence `ControlStrip.tsx` already renders on the left, each segment removable — ALSO visible at the top of the right (ERP) pane. The first implementation pass never built that half.

**Fixed**: `AppShell.tsx` gained a new optional `chainRail` slot, rendered inside `<main>` above `{children}`, sticky so it stays visible while the routed screen scrolls beneath it. `ChainRail.tsx` (new file) renders the chain there — reusing the exact same `chain`/`onCutFrom`/`canCutAt` state M24Shell.tsx already computes for the left `<Composer>`, so this is zero new state and zero changes to any of the ~90 page files under `src/app/(app)`. It renders nothing when `chain.segments.length <= 1` (the common case — no in-progress composer selection), so a page's own existing breadcrumb/`PageHeading` stays the only navigation line most of the time; the rail only appears once the user has actually built something via the composer, exactly the case the frozen mock demonstrated.

**Two things the mockup asked for, initially NOT built, then built anyway on explicit direction** — the two collided with a separate, older, foundational, already-shipped design spec this codebase calls "M24" (referenced dozens of times across `ControlStrip.tsx`/`TaskMaster.tsx`/`M24Shell.tsx`'s own comments), which the mockup — a fresh, from-scratch prototype — had no visibility into. Both tradeoffs were disclosed; the owner's answer was "build the mock's literal version anyway... but keep the functionality as in original, only the design is changing":

1. **A dedicated "Back" button — built (`ControlStrip.tsx`, `ChainRail.tsx`, `Composer.tsx`, `M24Shell.tsx`).** The kit's own `cutChainFrom()` doc comment calls per-segment Remove *"M24's replacement for a Back button"* — true, and Remove is untouched, kept exactly as it was. Back is NOT a second mechanism: `M24Shell.tsx`'s `onBack` is one line, `onCutFrom(chain.segments.length - 1)` — the identical function every Remove button already calls, aimed at the last segment, so it carries every side effect Remove already has (including clearing a draft that just says the removed word) for free. It renders on both sides (`ControlStrip.tsx` next to HOME/Reset; `ChainRail.tsx` as a second entry point, per the mock's own words: *"I didn't build two separate systems, just two entry points into one"*), disabled via the same `canCutAt` check Remove uses, so it is greyed out in exactly the cases removing the last segment would already refuse.
2. **Removing "Needs You" as a redundant heading — built (`task-row.ts`, `TaskMaster.tsx`).** Re-reading the ACTUAL fork in use (`src/components/shell/TaskMaster.tsx` — M24Shell.tsx imports its own local fork here, not the kit's TaskMaster, which an earlier pass in this same investigation mistakenly read instead) showed the M24 pinning rule is real but is not what the owner was reacting to: the Home tab's primary group is genuinely pinned above its divider ONLY while a `secondary` group exists, exactly the M24 behaviour, and that mechanism is completely untouched. What the owner was reacting to was `task-row.ts`'s `tabView()` giving that group its own heading text, `"Needs you"` — a second name for what the already-visible, already-selected `"Home"` tab label directly above it says. Fixed as a pure label change: Home's `primaryLabel` is now `""`, and `TaskMaster.tsx`'s `Group` renders no heading element at all when a label is empty (not an empty, oddly-padded one). Every row, the row's own per-item "Needs you" state word (a different, legitimate thing — C-13's colour-blind-safe glyph label), the pinning behaviour, the secondary "Waiting on others" heading, and the badge counts are all byte-for-byte unchanged.

New/updated tests: `ControlStrip.test.tsx` (+3: Back enabled/calls-through, disabled on root-only, disabled on empty), `ChainRail.test.tsx` (new file, 8 tests: hidden on the common path, segments+Remove, word-not-glyph, Back's two enabled/disabled cases), `task-row.test.ts` (+1: Home's `primaryLabel` is `""`, every other tab's is untouched), `TaskMaster.test.tsx` (+1: an empty label renders no heading, the row's own state word and a real secondary label are unaffected). The 6 pre-existing test files that render `<Composer>`/`<ControlStrip>` directly (`Composer.test.tsx`, `composer-modes.test.tsx`, `composer-send.test.tsx`, `ControlStrip.test.tsx`, `object-strip.test.tsx`, `strip-controls.test.tsx`) all needed a real `onBack` passed in now that it is a required prop — `tsc --noEmit` did not catch this on its own, because `tsconfig.json` excludes `**/*.test.tsx` from typechecking entirely; `bun test` is what actually exercises these paths, which is why it, not `tsc`, is the gate that matters here.

Live-verified: selecting a project then a module shows the chain and a working, correctly-enabled Back on both sides; clicking Back removes exactly the last segment and both sides update in sync; a root-only/empty chain correctly disables (ControlStrip) or fully hides (ChainRail) Back; the Home tab's task list no longer shows a redundant "Needs you" heading while its rows, badges and the "Waiting on others" group are unchanged. Full suite (`bun test --isolate`) 3 consecutive clean runs, 4082/4082 pass; typecheck, lint, and production build all clean.

## Composer shell, part 3 — one unified card, a real overlap bug, and reordering to match the frozen mock (2026-09-07)

The owner reported the shell still looked "vastly different" after parts 1-2 above, and asked directly: render the frozen mock as a real page and compare it against the running app, rather than describing the difference in prose. Done — the mock's saved widget source was rebuilt as an actual HTML file (with the CDS design-token values it depends on) and served through the dev server so it could be screenshotted and inspected exactly like the live app. That comparison found two genuine defects, not just a style gap:

1. **Two disconnected surfaces instead of one card — fixed (`AppShell.tsx`, `TaskMaster.tsx`, `Composer.tsx`).** The frozen mock's left pane is one continuous white card — Frequent actions, the chip row, the control bar, and the input all share one border/background. The shipped shell had `TaskMaster` on a plain `--color-ct-cream` background with `Composer.tsx`'s own independently-carded white rounded box floating below it — two panels, not the mock's one. Fixed by moving the card chrome up a level: `AppShell.tsx`'s aside now wraps `{taskMaster}` and `{composer}` together in ONE rounded/bordered white container; `TaskMaster.tsx`'s background changed from `--color-ct-cream` to `transparent`; `Composer.tsx`'s root lost its own now-redundant border/shadow/white-background but kept its `position:absolute inset-x-0 bottom-0` growth mechanism completely unchanged, just anchored to the new shared wrapper.

2. **A real, measurable overlap bug, found while verifying #1 — fixed (`AppShell.tsx`, `Composer.tsx`, `M24Shell.tsx`).** The space reserved for the composer inside the task list's scroll container was `paddingBottom: COMPOSER_RESTING_HEIGHT + composerReserveExtra` — a static guess (208px) baked in since the very first AppShell fork. The composer's real height is not static: it grows with however many ranked pills are showing, whether a "Do again" recent-chain row is present, and whether any pill without a chosen project prints its own "Choose project" sub-line. Measured live in one ordinary state (Home tab, several pills): the composer rendered at 446px against a 208px reservation. Critically, `paddingBottom` on a scrollable container only clears an overlay once scrolled to the container's own end — with 30-40+ real task rows (far more than one screen), rows at a normal, unscrolled position rendered in the same fixed screen region the composer occupies, and the composer's z-index covered them: verified geometrically that up to 15 real "Pick line"/"Dismiss"/"Choose project" buttons were genuinely unreachable underneath it, at multiple scroll positions. Fixed at the root: `Composer.tsx` now measures its own actual rendered height with a `ResizeObserver` on its root (not a wrapper — an absolutely-positioned child contributes zero height to an ordinary parent, so the observer has to sit on the real box) and reports it via a new `onHeightChange` prop; `M24Shell.tsx` stores that in `composerHeight` state and feeds `Math.max(COMPOSER_PILLS_BAND_RESERVE, composerHeight - COMPOSER_RESTING_HEIGHT)` to `AppShell.tsx` as `composerReserveExtra`. `AppShell.tsx` itself also changed HOW that reservation is applied: from `paddingBottom` (virtual, only helps at the scroll-end) to an explicit `height: calc(100% - Xpx)` on the task-list box (a real, physically shorter box, so its own content can never extend into the composer's region at ANY scroll position). Reverified geometrically after the fix: the task-list box and the composer box share an exact, zero-gap boundary (down to sub-pixel floating-point noise, not a real overlap) at both the top and the very end of a long scroll.

3. **Reordered to match the mock's actual vertical sequence (`Composer.tsx`).** The mock's own order is Frequent actions (near the top) → chip row → the four-control bar "right above the chat box" → input. The shipped composer had it backwards: control strip first, pills lower down. Reordered to pills → conversation → control strip → input. Safe for the conversation band's `flex-1` grow-upward mechanic: flexbox gives a flex-1 child whatever space is left over regardless of its position among `shrink-0` siblings in the same column, so this changed visual order only, not the sizing math (confirmed by the full suite staying green through the change).

One test needed updating, not because of a regression but a stale selector: `Composer.test.tsx`'s "the message region renders above the box, outside it" test identified "the box" via `.rounded-xl` — a class that moved to `AppShell.tsx` in change #1 above. Re-pointed at `.pointer-events-auto`, the one class that has identified this exact box both before and after the move (the wrapper above it is deliberately `pointer-events-none`). The rule the test protects — the message region sits as a sibling before the box, never inside it — is unchanged.

Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean (full ~90-route manifest, zero errors), full suite 3 consecutive clean runs (4082/4082 pass, 0 fail every time). Live-verified in the browser at multiple scroll positions with real data (38 tasks on the Home tab) using geometric intersection checks against actual bounding rects, not just a screenshot glance — the technique that caught defect #2 in the first place, since a screenshot alone reads a correctly-adjoined boundary and a genuinely overlapping one as visually similar at this data volume.

## Composer shell, part 4 — a two-browser, viewport-height sweep found a real overflow bug part 3 missed (2026-09-07)

The owner asked for a properly systematic re-check after part 3: both a real Chrome (via the Claude in Chrome extension, not just the dev-tooling preview pane) and the pane itself, screenshots, direct comparison against the frozen mock, and a written checklist before and after — not another single pass. Doing that surfaced one more genuine defect and one accessibility inconsistency, both in the two files part 3 had just changed.

**A real overflow bug, viewport-height-dependent — fixed (`Composer.tsx`).** Real Chrome's actual window in this test had a 404px inner height (a real, if short, browser window — not a contrived edge case). `COMPOSER_MAX_HEIGHT_VH` (the kit's own constant, 62) resolves to only 250px there, and the pills band ("Frequent actions") was `shrink-0` — always rendered at its full natural height, never allowed to shrink. On a tall viewport that's harmless (62vh comfortably covers everything); at 404px, a full pill list alone needed more than the entire 250px budget, and with the outer composer wrapper's `overflow-visible` (required so the box can grow upward past its resting height) and no shrink on the pills band, the excess didn't scroll or clip — it pushed the control strip and the Send button DOWN, past the composer's own reported bottom edge. Measured directly in real Chrome: the control strip and input rendered 117-220px below where the composer's own box claimed to end -- present in the DOM and reachable by scrolling the raw page, but invisible in the space the visible card implied they occupied. Confirmed the mechanism, then reproduced and reverified the fix in the pane at an equivalent viewport (450px) since the real Chrome window became inaccessible (minimized by the OS/user mid-session, outside any tool's control) before a second pass was possible there. Fixed the same way `conversation` already handles its own unbounded growth: `min-h-0` (overrides the content-based automatic minimum size that `overflow:visible` flex items get by default) + `overflow-y-auto` + an explicit `maxHeight: 40vh` safety cap, so pills shrink and scroll internally instead of displacing the control strip and input. `PillStrip.tsx` itself is untouched -- only its container in `Composer.tsx` is bounded now.

**A real accessibility inconsistency — fixed (`ChainRail.tsx`).** `ChainRail.tsx` (part 2's new file) sized its Back and Remove buttons at 32x24 to keep the right-panel rail visually thin. R67 A-18 sets a 44px minimum touch target, and `ControlStrip.tsx`'s own (x)/HOME/Reset/Back all meet it — meaning the exact same action (removing a chain segment) had two different minimum touch targets depending on which side of the screen it was clicked from. Fixed to the same 44px minimum, same as `ControlStrip.tsx` already does ("the row's own padding comes down as the controls in it grow to their 44px minimum, so the strip stays one band rather than becoming two") — the rail is now ~57px tall at rest instead of ~32px, a small, correct cost for a consistent, non-regressive touch target.

New/updated tests: `ChainRail.test.tsx` (+2: Back and Remove both assert `minWidth`/`minHeight` of exactly `44px`, locking the fix in so it can't silently regress again). No test needed updating for the pills fix — none of the existing suite renders the composer at a constrained viewport height (Happy DOM/jsdom don't model real layout overflow the way a real browser does), which is exactly why this needed a real-browser pass to find in the first place, not just `bun test`.

Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean, full suite 3 consecutive clean runs (4084/4084 pass, 0 fail every time). Live-verified geometrically (bounding-rect measurements, not a screenshot glance) at both a normal viewport and the reproduced 450px short one: pills band now correctly shrinks and scrolls, control strip and input stay fully contained inside the composer's own box in both cases, and Remove/Back still function correctly (segment removal, chain-rail auto-hide) after the touch-target resize.

## Composer shell, part 5 — five real bugs found by a full-module, geometry-verified sweep after the owner rejected part 4's "done" as unproven (2026-09-07)

The owner had directly seen the overlap bug part 4 fixed (Edge and real Chrome screenshots, both showing genuine duplicated/overlapping text) and, after an earlier premature "looks clean" read of a screenshot in this same investigation was proven wrong by those same screenshots, demanded a stricter standard before anything is called fixed again: every PROJEXA module, not just `/dashboard`; real geometry, not a screenshot glance; multiple browsers; re-verify after every fix, not just once. This entry is that sweep.

**The detection tool itself needed a real fix first.** The bounding-rect overlap check part 3/4 used (`getBoundingClientRect()` pairwise intersection) has two distinct false-positive modes, both hit and fixed this round:
1. An element scrolled outside its own `overflow:auto/scroll/hidden` ancestor still reports its full, un-clipped layout position — comparing that raw rect against something else finds "overlaps" that are actually invisible, clipped content. Fixed by walking each element's ancestor chain and intersecting its rect against every scrolling/clipping ancestor's own rect before comparing it to anything else (`clippedRect()`).
2. Two elements can have geometrically overlapping *boxes* (e.g. a button's padding box touching an adjacent section's border) without a human ever seeing overlapping *pixels*, because paint/stacking order cleanly resolves which one is actually drawn on top at every point in the overlap. Fixed with a second, ground-truth pass: for every geometric candidate, sample a grid of points across the overlap region with `document.elementFromPoint()` and only report it confirmed if BOTH elements' own subtrees are the topmost hit at some sampled point — i.e. the browser itself cannot cleanly decide which one the user sees there.

Both stages matter: on `/dashboard` alone, the naive check found 3 candidates, all 3 were confirmed false (one was genuinely clipped by its scroll container -- `elementFromPoint` at the "overlapping" pixel actually resolved to a sibling breadcrumb button, not the scrolled-out chip; two were adjacent sections' padding boxes touching by 1-4px with no visible text collision). This two-stage script (`clippedRect` + `elementFromPoint` grid sampling) is the one to reuse for any future sweep -- a plain bounding-rect diff is not trustworthy on its own.

**Four real, distinct overlap/layout bugs found and fixed, all in shared shell components (so they reproduced on every project-scoped module, not just where first found):**

1. **`ControlStrip.tsx` — the current-page chip bled into its own hint text.** Found on `/schedule` (and every project-scoped screen opened with no project picked) at a short viewport. Root's per-segment wrapper span was unconditionally `min-w-0`, but the root segment's own button is deliberately `shrink-0` (G-04: the project/page name must never be visually cut). `min-w-0` let flexbox shrink the wrapper below the button's real content width; since the wrapper has no `overflow-hidden` of its own, the shrink-0 button rendered past its box and directly over the "› Which project? Choose one..." prompt that follows it. Fixed by making the wrapper's own sizing agree with its child's: `shrink-0` for the root segment (reserve its real width, like the button already demands), `min-w-0` unchanged for every other segment (which use `truncate`/`max-w-[22ch]` and are meant to shrink).

2. **`Composer.tsx` — the ResizeObserver-based height report could go stale under real use.** Found via direct comparison after clicking a pill that opens the project-picker together with its own pill list: composer's real height grew to 537px while the last-reported reservation was still 381px, a 156px gap that held for multiple seconds (not a one-frame race). Fixed by adding a `useLayoutEffect` with no dependency array (re-measures synchronously after every render, independent of whatever `ResizeObserver`'s own change-detection missed) alongside the existing observer, which stays for the one case the effect can't cover — a size change with no React re-render at all (e.g. a web font finishing its load).

3. **`M24Shell.tsx` + `Composer.tsx`'s `conversation` band — two flex-1 bands with no explicit ceiling squeezed past their siblings.** Once #2 correctly reported a taller real height, the task list (TaskMaster's pinned "primary"/"Needs You" group, which by M24's own rule never shrinks or scrolls) and the composer's own `conversation` band both had no `overflow-y-auto` safety net and could render past their allocated box under the squeeze, overlapping "Show 20 more" and, separately, the control strip. Fixed with the same pattern already used for the pills band: `overflow-y-auto` added to the TaskMaster wrapper (a no-op in the normal case, engages only when genuinely squeezed) and an explicit `maxHeight: "40vh"` added to the `conversation` band.

4. **`DropZone.tsx` + `M24Shell.tsx` — the attach button bled into the Send button.** Found on every screen with an attach policy (`/permits`, `/documents`, `/scope`, `/work-progress`) at a short viewport: `DropZone.tsx`'s attach button is `shrink-0` by design ("A WORD, NEVER AN ICON ALONE, AND THE LIMITS ARE IN THE WORD" — `Attach PDF, up to 25 MB` must never fold into a half-read `Attach P…`), and its `flex-1` wrapper in `M24Shell.tsx` has an explicit `0%` flex-basis, which is what `flex-wrap`'s line-fitting decision is computed from -- not the wrapper's rendered content. With a long policy label, the wrap algorithm judged the column as needing ~0px, decided everything fit on one line, and only afterward let flex-shrink squeeze the column down to a sliver while the shrink-0 button inside held its full width regardless, painting over Send. Two follow-on attempts were tried and DISPROVEN live before landing on the real fix, worth recording so it isn't retried: swapping `min-w-0` for `shrink-0` on `DropZone.tsx`'s own root wrapper (theory: automatic-minimum-size propagation) made zero measured difference; adding bare `flex-wrap` to the row in `Composer.tsx` alone also made zero difference, for the reason above. What actually worked, verified by overriding `element.style` live in the browser before touching source: `flex-none` (`flex: 0 0 auto`) on the `M24Shell.tsx` wrapper, so its hypothetical size for wrap purposes is its real, content-based width — combined with `flex-wrap` on the `Composer.tsx` row, this now correctly drops Send to its own second line when there truly isn't room, instead of overlapping it. `flex-1`'s grow behavior is not missed: Send is `ml-auto` and pins itself to the row's right edge regardless of whether anything upstream grows.

**Full-module sweep, geometry-verified, both browsers.** After all four fixes, every route in the app's own nav catalogue was re-checked with the two-stage script above at the exact short viewport (1280×404) that exposed the first bug, both in the default per-page state and in the pill-heavy "All projects → click a project-less pill" state that originally surfaced the worst of it: `dashboard`, `dashboard/hierarchy`, `projects`, `schedule`, `meetings`, `scope`, `work-progress`, `site-diary`, `documents`, `wiki`, `permits`, `drawings`, `moms`, `rfis`, `submittals`, `punch-list`, `change-orders`, `design-studio`, `mood-boards`, `ffe`, `floor-plans`, `labour`, `materials`, `inventory`, `vendors`, `procurement`, `purchase-orders`, `sales`, `sales/leads`, `sales/opportunities`, `sales-orders`, `quotations`, `customers`, `grc`, `budgets`, `accounting`, `invoices`, `expenses`, `hr`, `employees`, `payroll`, `recruitment`, `kpis`, `reports`, `analysis`, `copilot`, `knowledge-base`, `settings`. Every one returned zero confirmed overlaps. Cross-checked independently in real Chrome (via the Claude in Chrome extension, a separate logged-in account/org than the pane's) at the same short viewport on the routes that had been broken (`permits`, `schedule`, `work-progress`) — zero confirmed overlaps there too, plus a visual screenshot confirming the attach button now wraps to its own line exactly as intended. Microsoft Edge remains unreachable by any tool this session has: `list_connected_browsers` shows only the one Chrome instance throughout; there is no write-access path to Edge specifically until the owner either connects the extension there or runs the manual DevTools cache-clear steps directly.

No test in the existing suite renders any of these components at a constrained viewport or with the specific pill/attach-policy states that exposed these four bugs — the same gap part 4 already noted (Happy DOM/jsdom don't model real layout overflow), which is why this needed a live, real-browser, geometry-verified sweep rather than `bun test` alone. Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean (full route manifest, zero errors), full suite 3 consecutive clean runs before this round's changes (4084/4084) plus one more full run after (4084/4084, 0 fail) — 4 consecutive clean runs total across the two sessions.

## Composer shell, part 6 — the owner directly asked "where is the gap": part 5's sweep checked for overlaps everywhere, but never re-compared any individual page's own visual styling against its own frozen mock (2026-09-07)

Part 5 closed with a genuine, geometry-verified, cross-browser "zero overlaps across ~48 routes" result and reported it as such. The owner then supplied (again) the frozen project-dashboard mock ("Harbor View Corporate HQ") and asked directly why, after "at least 6" done-declarations, it still didn't match. The honest answer, given at the time and recorded here so it isn't repeated: part 5's sweep checked for ONE class of defect — overlapping/garbled text — across the whole app. It never re-opened `/dashboard/project` and compared its own KPI-card styling against its own mock, because that page's cards (`DashboardProjectClient.tsx` / `KpiCard.tsx`) are not shell components and were never in the sweep's scope. "No overlap bugs, broadly" and "matches every frozen mock" are two different claims, and the gap was letting the first sound like the second.

**What was actually wrong, found by finally doing that specific comparison.** The mock renders every KPI tile with a background fill — teal for an ordinary figure, coral for the one that needs attention ("Budget vs Actual ... over budget") — as ONE continuous bordered strip, thin dividers between cells, no gaps. The shipped page had NEITHER: `KpiCard.tsx`'s frame was border-only, no fill at all, and `DashboardScreen`'s kit-supplied layout (`@fchecklist/veridian-ui-kit/screens`) gives every tile its own separate rounded/bordered box with a real `gap-3`/`gap-4` void between them.

**Fixed, in three coordinated pieces:**
1. **The fill.** New PROJEXA-local tokens in `globals.css` (`--color-kpi-tint-positive`, `--color-kpi-tint-warn`), derived with `color-mix()` from tokens that already exist and already carry the right meaning — `--color-ct-teal` (the app's real teal, which the mock's own placeholder `--c-teal-50` was clearly approximating) and `--color-veri-status-late` (already documented as this app's one loud/warning tone) — rather than typing in fresh, driftable hex. `KpiCard.tsx` picks between them based on `trend?.tone === "late"`; every other tone, or no trend at all, gets the calmer default. This is the correct reading of the file's own long-standing rule ("add a new semantic token... if one is genuinely missing") — an earlier fix this same day (the composer pill background, part 4/5) had read that rule too conservatively and reused an ill-fitting existing token instead of deriving a real one; this is the fix done the way the rule actually intended.
2. **The connected strip.** `DashboardScreen.tsx` forked from the kit (same D-09 pattern as every other fork in this file) — the ONE change is wrapping `oneNumber`+`secondaryKpis` in a single bordered container with `divide-x`/`divide-y` between cells instead of `gap`. `KpiCard.tsx` and `DashboardKpiTile.tsx` both gained a `bare?: boolean` prop that drops a tile's OWN border/rounding (keeping its padding and fill) for exactly this case, so the strip draws one outline instead of one per tile. `DashboardProjectClient.tsx` passes `bare` to all 5 top-row tiles and imports the local fork instead of the kit's.
3. Nothing else on the page was reworked on a guess — the trend/breakdown charts, quick-actions and recent-activity rows below are untouched, because the mock never depicted those differently from what already ships.

New tests: `KpiCard.test.tsx` (+4 -- late gets the warn fill, every other tone gets the positive fill, no trend still gets a fill rather than none, an explicit null trend is treated the same as no trend). Verified: typecheck clean, lint 0 errors (1 pre-existing unrelated warning, unchanged), production build clean, full suite clean (4088/4088 pass, 0 fail — 2 apparent failures mid-edit were a transient artifact of testing a half-finished intermediate state, not a real regression; a clean run afterward confirmed it). Re-ran the part-5 overlap sweep against this specific page after the layout change (both the exact 1280×404 short viewport and normal viewport, across three different real projects with different data states) — zero confirmed overlaps, confirming the new connected-strip layout didn't reopen the class of bug part 5 had just closed. Live-verified visually against the mock, side by side, after each of the two structural changes (fill, then layout) — not just once at the end.

## Composer shell, part 7 — the owner supplied the frozen mock's own HTML source and gave a direct standing instruction: it is the real visual UI now, existing wiring stays underneath it (2026-09-07)

Part 6 fixed one page's KPI cards against the mock. The owner then supplied the complete `frozen_mock_render.html` source (not a screenshot -- the actual interactive prototype file) and said directly: **"I WANT THIS TO BE IMPLEMENTED AS THE VISUAL UI UX. THE BACKEND IS THE OLD UI UX. WIRE IT PROPERLY."** -- and, after this agent started reasoning about which of the mock's differences were "deliberate later decisions" worth preserving over the mock, corrected that too: **"you are not making new... you are only changing the visual appearance."** Both instructions together resolve every scoping question the last several entries had been negotiating case by case: the mock's DRAWING is now the target everywhere it applies to a real, still-existing control; no control's onClick/disabled/data/routing/state changes, ever -- only how it is drawn.

**Six visual-only changes made under that standing instruction, all in shell components already forked into this repo (so the blast radius is the same handful of files, not a wider rewrite):**

1. **`PillStrip.tsx` -- glyph icons instead of an uppercase kind-word badge, and a small star instead of a 44px "Pin"/"Pinned" text button.** The mock draws an icon beside each row's label, never a separate word chip; its Pin is a bare star. The word is not deleted -- it moves into the `aria-label`/`title`, exactly the pattern R67 A-18 already uses for glyphs elsewhere (Reset's "↺", Remove's icon) -- and a lucide icon distinguishes by SHAPE, which is what A-18's rule actually protects against ("a strip whose meaning is carried by hue alone"), not by forbidding icons outright. The Pin's drawn size shrinks to match the mock; its real click target does not -- `.veri-icon-btn`'s normal fixed 30x30 is overridden with an explicit `width:44;height:44` (inline style beats the class for the same property), so this is a visual change, not a touch-target regression.
2. **`DropZone.tsx` -- the attach control becomes a compact paperclip icon.** This is also the direct answer to the owner's earlier, separate question ("the attachment pin is missing next to Enter") -- confirmed at the time that the mock itself does not draw one, so this was flagged as a standalone ask rather than assumed; the owner's follow-up direction resolved it the same way as Pin: icon-only, full word preserved as the accessible name and hover title, real 44x44 hit area preserved the same way.
3. **`Composer.tsx` -- Send moves from a separate full-width worded button into a small circular icon inset in the textarea's own corner**, matching the mock exactly. The outer `<button>` stays a real 44x44 hit box (position:absolute, sized explicitly); a smaller `<span>` inside it draws the compact saffron/navy circle the mock shows, swapping to a spinner icon while busy. Every prop this control reads -- `onSubmit`, `sendDisabled`, `aria-busy`, `sendLabel` as the accessible name (A-19's actual rule), `instruction` as the title -- is unchanged. The footer row below the textarea is now attach + the failure line only, since Send no longer lives there; the failure line keeps A-10's real rule (immediately visible, in the reading path) at its new position.
4. **`TopRail.tsx` -- the header band's background is the mock's pale lavender, not the kit's cream.** No purple hue exists anywhere in this app's real palette to derive a tint from via `color-mix()` (unlike the KPI/pill teal, which could reuse `--color-ct-teal`) -- this is a genuinely new base colour, added as a literal hex PROJEXA-local token (`--color-topbar-tint: #EEEDFE`) the same way the pre-existing "Semantic Colors" block already does for success/warning/error/info, for the identical reason: the kit doesn't have this hue yet.
5. **`M24Shell.tsx` -- the two worked examples under the input are two separate bordered chips, not one combined "e.g. X · Y" sentence.** A-02's actual content (both examples, in the module's own words) is unchanged; only the markup splits from one `<span>` into a `.map()` over the same 2-tuple, one chip per example, matching the mock's own separate-pill treatment.
6. **A genuinely new base token, `--color-topbar-tint`,** was the only new colour added this round; everything else reused or derived from tokens that already exist, per this file's own standing rule.

**One item deliberately NOT done, and why, disclosed rather than silently skipped or silently attempted anyway:** the mock's Filter/Export render as plain text links; the shipped ones are bordered buttons with a `(disabled reason)` caption. Both live inside `ScreenFrame.tsx`, a KIT component (`@fchecklist/veridian-ui-kit/screens`) used as the shared chrome for "every archetype" per its own header comment -- list, edit, create AND dashboard screens across the whole app, not just this one page. Forking it to match the mock's simpler treatment would mean re-verifying every screen that uses it, a materially larger blast radius than the six changes above (each scoped to the single already-forked file it lives in), for a change that would also remove the disabled-reason caption -- genuinely useful information the mock's own rough prototype never modelled. Flagged for an explicit decision rather than taken on unilaterally under time pressure or quietly left out of the account of what was and wasn't done.

New/updated tests: `strip-controls.test.tsx` (Pin's word/44px assertions re-pointed at `aria-label`/explicit `width`/`height` instead of visible text -- one test's whole premise, "every button shows visible text", was rewritten to what still holds: A-18's real rule (accessible name, asserted in the describe block above it, unaffected) plus "every card's own label still prints as visible words" (unaffected -- only Pin/kind-badges went icon-only, never the card's own subject)), `Composer.test.tsx` + `composer-send.test.tsx` (Send's word/colour/44px assertions re-pointed at `aria-label` and the inner circle `<span>` instead of the outer hit-box `<button>`'s now-empty visible text, using a new `data-testid="composer-send"` hook since DOM position -- "the last button in the row" -- stopped being reliable once Send moved earlier in the DOM than attach). Full suite: 4088/4088 pass (one unrelated "1 fail, 1 error" mid-run was reproduced in isolation 3x clean -- confirmed the same pre-existing `mock.module()`-adjacent test-isolation flake this repo's own CHANGELOG already documents, not a regression from this round). Typecheck/lint clean, production build clean. Re-ran part 5's full geometric overlap sweep after these changes, at both the short (1280×404) and normal viewport, across `dashboard`, `dashboard/project`, `schedule`, `work-progress`, `documents`, `scope`, plus the exact pill-heavy "All projects → click a project-less pill" scenario that originally surfaced the worst bugs -- zero confirmed overlaps everywhere. Live-verified visually in both the pane and real Chrome (a third, different logged-in account) after every individual change, not batched to the end: the top-bar tint, the star Pin, the paperclip, the inset Send circle, and the two separate example chips all confirmed present and correctly styled in both.

## Composer shell, part 8 — "exactly means exactly": Filter/Export now match the mock too, and one deliberate non-match is recorded rather than silently reintroduced (2026-09-07)

Direct follow-up to part 7's standing instruction, made explicit after this agent flagged Filter/Export as a disclosed skip on account of blast radius: "copy it exactly... object by object... exactly means exactly." Re-examined the blast-radius concern and found it was solvable without the risk originally assumed.

**Filter/Export are now plain muted text links, matching the mock, with zero effect on any other screen.** The kit's `ScreenFrame.tsx` is genuinely shared chrome across ~50 other screens (every ObjectScreen/ListScreen/EditScreen/CreateScreen archetype), so changing the KIT's copy was correctly ruled out. But `DashboardScreen.tsx` was already this programme's own fork (part 6), already importing `ScreenFrame` from the kit -- the fix was to fork `ScreenFrame.tsx` too (`src/components/screens/ScreenFrame.tsx`, `HeaderActionButton` redrawn as a bordered-button → plain-text link, same `disabledReason` kept as the `title`, nothing about the prop contract changed) and re-point ONLY `DashboardScreen.tsx`'s own import at the new local file. Every other archetype still imports the kit's original `ScreenFrame`, completely untouched -- confirmed `DashboardHomeView.tsx` (the org-wide "/dashboard") doesn't use `DashboardScreen` at all, so even the OTHER dashboard-shaped screen in this app is unaffected; the blast radius really is exactly the one screen the mock depicts.

**One thing found and deliberately NOT reverted, disclosed rather than silently changed either way.** `DashboardProjectClient.tsx`'s own `money()` wrapper has a standing comment citing "R67 D-61": this screen used to render whole units (matching the mock's "AED 777,000", no decimals) while `/scope` -- the screen its own KPI tile links to -- rendered two decimals, so the *same* project's contract value read two different ways depending which of two connected screens you were looking at. That was fixed by standardizing on the shared `formatMoney()`'s two-decimal default everywhere. Reverting this screen back to zero decimals to literally match the mock would reopen that exact, already-diagnosed inconsistency bug -- not a matter of an old opinion being overridden by a newer mock, a genuine correctness defect between two screens showing one figure. Left as is; flagged plainly rather than either silently reverting it or silently leaving the mismatch unexplained.

Verified: typecheck clean, full suite 4088/4088 pass, lint clean (1 pre-existing unrelated warning), production build clean. Live-checked in both the pane and real Chrome (hard-reloaded first) after the change -- Filter/Export render as plain text, the disabled reason still reaches the hover title, zero confirmed overlaps on a fresh geometric sweep of the same page.

## Composer shell, part 9 — "make sure this is 100% copied as it is": a final precise pass caught two more real, concrete differences a casual glance had missed (2026-09-08)

Owner re-sent the mock at full resolution with that exact instruction after part 8 landed. Doing a genuinely pixel-level read of it (not a glance) against the live page found two things parts 6-8 had missed:

1. **KPI label casing.** The mock's four labels are sentence case -- "% complete by BOQ value", "Contract value", "Project value", "Budget vs actual" -- `DashboardProjectClient.tsx`'s own `DEFAULT_LABELS` (and each tile's matching inline fallback) had them in Title Case. Confirmed empirically, not assumed, that this fallback is genuinely what renders here: `dashboard/project/page.tsx`'s own `resolveDashboardLabels()` calls a real registry endpoint (`/screen-definitions/dashboard.dashboard`) and its own comment says a 404 ("no row seeded yet") is "expected, not an error" -- i.e. this registry row is not expected to exist yet in this environment, `DEFAULT_LABELS` is the actual, live rendering path, and every screenshot taken all session confirms it. Changed the casing in both places (the array and each call site's own fallback string) so a future registry response missing just one field can't fall through to the old casing.
2. **"Recent progress entries" was a bulleted list of links, not a table.** The mock shows an actual `Activity | % complete | Date` table. Rebuilt it as one, keeping R67 F-24's real fix (the activity's actual name travels with the entry, never a raw id) and the exact same click-through (same onClick, same route) on the Activity cell -- only the markup changed from `<ul><li><button>` to `<table><tr><td><button>`.

Verified: typecheck clean, full suite 4088/4088 pass (two apparent failures mid-run -- `BudgetCreateClient`/`ScopeObjectClient`, both completely unrelated to anything touched here -- reproduced clean 3x in isolation, the same pre-existing cross-file test-isolation flake already documented earlier in this file), lint clean, production build clean. Live-verified in both the pane and real Chrome (hard-reloaded) -- the labels render correctly in both, and the table renders correctly against a project with real recent-progress data (Cedar Heights Villa, not the empty-state project used for earlier screenshots, specifically to prove the table path renders real rows, not just the empty state). Zero confirmed overlaps on a fresh geometric sweep.

## Composer shell, part 10 — the "Frequent actions" heading, and the bottom row's real fourth+fifth controls ("All modules"/"Tasks"), per the owner's direct top/centre/bottom breakdown (2026-09-08)

Owner: "not only bottom control, the top and centre also to be updated" (after re-sending the mock's left panel specifically). Three more visual-only pieces, all wired onto controls/state that already existed:

1. **TOP -- the "Frequent actions" heading was missing entirely.** `PillStrip.tsx`'s band already carried that exact meaning via `aria-label="Things you can do"`, but only for a screen reader. Added the same words as a real, visible heading -- the aria-label is untouched, so this is sighted and non-sighted users agreeing on the section's name, not a new one being invented.
2. **CENTRE -- re-verified the pill styling (icons/teal/no kind-word badge) after the heading was added**, live, at both viewports -- unchanged from part 7, still correct.
3. **BOTTOM -- "All modules" and "Tasks" joined Back/Home/Reset, matching the mock's actual four-item row.** Neither is new functionality:
   - **"All modules"** is the exact SAME toggle `PillStrip.tsx` already had (`M24Shell.tsx`'s own `showAllPills` state) -- only the trigger's POSITION moved, from below the ranked pills to this row, matching where the mock puts it. The catalogue panel it opens still lives in, and is still owned by, `PillStrip.tsx`; `ControlStrip.tsx` only gained two new OPTIONAL props (`allModulesExpanded`, `onToggleAllModules`) so every existing caller/test that doesn't pass them keeps compiling and simply doesn't render this one control -- the same graceful-absence pattern `loaded` already used.
   - **"Tasks"** reuses the exact same `onHome` handler HOME already calls, rather than inventing a second "show me my tasks" mechanism -- validated against the app's OWN existing logic, not just asserted: `M24Shell.tsx`'s own `onHome` implementation already treats "go home" and "open the module directory" as the same action on the home screen ("`onHome`: on the home screen it does the thing HOME actually means here instead: opens... 'All modules'"), so Tasks and Home converging on one handler is consistent with a decision this codebase had already made, not a new one this pass invented. The Task Master tabs (Home/Approval Pending/In Queue/Completed/History) the mock's own "Tasks" was a shortcut TO are already always visible above this strip in the real app -- there is no separate "tasks mode" to build.
   - **"HOME" -> "Home"**, sentence case per the mock -- pure text-casing, same handler.
   - **Reset was kept**, past the mock's own four items -- the mock never depicts a discard-everything control, but removing one that's real, working, and already relied on would be deleting functionality, not a visual change; kept at the end of the row rather than dropped.

New/updated tests: `Composer.test.tsx`, `ControlStrip.test.tsx`, `strip-controls.test.tsx` -- three assertions re-pointed from `"HOME"` to `"Home"` (pure text match updates, same controls, same handlers). Verified: typecheck clean, full suite 4088/4088 pass, lint clean, production build clean. Live-verified in the pane at both the short (1280x404) and normal viewport, geometrically confirmed zero overlaps with the row now carrying five controls instead of three -- real Chrome's extension was disconnected this round (a transient connectivity state, not investigated further) so the usual cross-browser screenshot could not be taken this pass; disclosed rather than silently skipped.

## Dev-tooling gotcha: the app's own service worker must never run against local dev (found + fixed 2026-09-07 — corrects a prior misdiagnosis)

A commit this same day (`9745f54`, verifying the AppShell/nav fixes above) had documented
`/dashboard` intermittently failing under `next dev`'s Turbopack compiler with "Module ...
was instantiated ... but the module factory is not available" as an **isolated Turbopack
dev-mode bug** — surviving full `.next` cache clears and complete process restarts, so
judged non-blocking dev-tooling noise. **That diagnosis was wrong.** The real cause: this
app's own service worker (`src/app/sw.js/route.ts`, registered by
`ServiceWorkerRegister.tsx`) derives its `CACHE_NAME` from `VERCEL_GIT_COMMIT_SHA`, falling
back to the fixed literal string `"local-dev"` whenever that's unset — true for every
`bun run dev` run. Its own `activate` handler purges any cache whose name isn't the current
`CACHE_NAME`, but since that name never changes between local dev-server restarts, the purge
never fires locally, even though Turbopack's dev-mode `/_next/static/*` chunk contents DO
change on every restart (unlike production's genuinely content-hashed, immutable chunk
URLs, which is the only case this SW's cache-first logic was designed for). A browser that
had ever registered this SW kept serving an old cached chunk — one built before
`AppSidebar.tsx`'s `DraftingCompass` import was removed — no matter how many times the
dev server or `.next` cache was reset, because neither touches the browser's own Cache
Storage. Confirmed directly: `navigator.serviceWorker.getRegistrations()` showed a live
registration at scope `http://localhost:3100/` backing a cache literally named
`projexa-shell-local-dev`; unregistering it and deleting that cache fixed the page
immediately, with zero source changes. **Fixed at the source**, not just worked around:
`ServiceWorkerRegister.tsx` now never calls `register()` in `NODE_ENV === "development"` —
instead it unregisters any existing registration and deletes any `projexa-shell-*` cache on
mount, so a developer who already has a poisoned registration from before this fix is
self-healed on their next page load with no manual console commands needed. Regression
guard: `src/components/ServiceWorkerRegister.test.tsx`. The SW's own stated purpose (an
offline app shell for a field site worker with no signal) is a production concern with zero
meaning on `localhost`, so there is no tradeoff here — it should never have run in dev.

## Test-suite gotcha: `mock.module()` on a real module must spread it, or `bun test --isolate` still isn't safe against it (found + fixed 2026-09-07)

`bun test`'s `mock.module()` replaces a module **for the rest of the process** the moment
it runs — `--isolate` (see Commands below) only isolates *some* leakage patterns, not
this one, because the hazard here is inside a single file's own dynamic-import chain, not
cross-file leakage. If a test does
`mock.module("@/some/real-module", () => ({ oneExport: fakeImpl }))` instead of
`mock.module("@/some/real-module", () => ({ ...(await import("@/some/real-module")),
oneExport: fakeImpl }))`, every OTHER real export of that module silently disappears for
any code that imports it afterward — including the test file's own subsequent dynamic
imports.

Found live in `src/app/(app)/project-scoped-page-error-isolation.test.tsx`: its
`mock.module("@/lib/veridian-client", ...)` provided only `{ VeridianApiError,
callVeridian }`, dropping `VERIDIAN_SCREEN_BUDGET_MS` (and every other real export). That
same file's own dynamic imports two lines later (`./meetings/page`, `./punch-list/page`)
pull in `project-selection.ts`, which imports `VERIDIAN_SCREEN_BUDGET_MS` from the same
module — so it threw `SyntaxError: Export named 'VERIDIAN_SCREEN_BUDGET_MS' not found`
at module-link time, **outside any single `test()` callback**. bun logs that as
`# Unhandled error between tests` and the JUnit reporter (`--reporter=junit`) doesn't
attribute it to any testcase at all (`failures="0"` in its own root tag even while the
console reporter shows "1 fail, 1 error") — which is exactly why this had been surfacing
across full-suite runs for days as an unexplained, seemingly-random single flake, a
different specific test implicated each run. It wasn't random: it was this one file's
own mock, racing against whichever other test happened to import the same real module's
other exports first. Fixed by spreading the real module first, same pattern this exact
file already used correctly for its `next/navigation` and `@/lib/supabase/auth-guard`
mocks two blocks above (see that file's own comments). Confirmed via 3 consecutive clean
full-suite runs (4067/4067 pass, 0 fail each time) after the fix, versus the prior best of
4061/4062 across 6+ runs before it. If a future `mock.module()` call on a real (not
synthetic) module ever provides only a subset of that module's exports, apply the same
fix — don't assume `--isolate` alone covers it.

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server (**port 3100**)
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
