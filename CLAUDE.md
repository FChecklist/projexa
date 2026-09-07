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

**Two things the mockup asked for that were deliberately NOT built, found while investigating this** — a real, evidence-based tension between the mockup conversation (this session) and a separate, older, foundational, already-shipped design spec this codebase calls "M24" (referenced dozens of times across `ControlStrip.tsx`/`TaskMaster.tsx`/`M24Shell.tsx`'s own comments), which the mockup — a fresh, from-scratch prototype — had no visibility into:

1. **A separate "Back" button.** The mock's final control set was "All modules | Tasks | Back | Home." But the kit's own `cutChainFrom()` doc comment says, verbatim: *"M24's replacement for a Back button, 'shown on the thing being removed'."* Per-segment Remove — which now exists on both sides — already lets a user jump back N steps in one click, which a literal one-step-at-a-time Back button would not improve on. Adding one anyway would be exactly the kind of duplicate control `ControlStrip.tsx`'s own header explicitly reasons against ("ONE INSTRUCTION, NOT TWO"; the History button was removed for the same reason). Not built, on the strength of that existing reasoning — flagged here rather than silently dropped.
2. **Removing "Needs You" as a persistent left-panel card.** The mock's later iterations treat a fixed "Needs You" card as a duplicate of its own chip, and remove it. `TaskMaster.tsx`'s own header comment says the opposite, deliberately: *"PIN THE 'NEEDS YOU' GROUP so it is never the part that scrolls under the expanded composer. GROUPED BY WHOSE MOVE IT IS, NOT BY DATE."* This is a considered, foundational, cross-cutting design (independent of which status tab is active), not the same "duplicate card + chip for one concept" bug the mock was reacting to. Removing it to match the mock would trade one real feature for a wireframe that didn't know this one already existed — the opposite of "keep functionalities, features same." Not built, for the same reason.

Both are disclosed here rather than silently resolved either way, since they involve reconciling two design authorities that never talked to each other. If the owner wants the mock's literal version regardless (add Back anyway, retire the pinned group anyway), that is a reachable, bounded follow-up — say so and it gets built.

Live-verified: selecting a project then a module in the composer shows the chain (`Harbor View Corporate HQ - Interior Fit-out › Work Progress`, with a working Remove) at the top of the right pane, in sync with the identical chain on the left; clicking Remove on either side collapses both together. Full suite (`bun test --isolate`) 3 consecutive clean runs, 4069/4069 pass; typecheck and production build both clean.

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
