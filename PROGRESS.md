# PROGRESS -- task-20260719-034948-migrate-projexa-to-consume-veridian-ui-k

## Completed
- [x] Registered claim in compliance-tracker's ai-os/boss/ACTIVE-CLAIMS.yaml (the cross-repo shared registry -- projexa itself has no ai-os/boss dir), via compliance-tracker#473 (merged). No collisions found.
- [x] Read compliance-tracker PR #471 (merged) diff in full -- the proven precedent.
- [x] Checked out veridian-ui-kit at v0.2.2 (v0.2.0 + 2 upstream bugfixes compliance-tracker found: AppShellFrame h-screen clipping, AppSidebar duplicate-key) and read every file under src/shell/, src/composer/, src/panel/, src/context/, plus README.md, in full.
- [x] Read PROJEXA's own real current implementation in full (layout.tsx, AppSidebar.tsx, AppTopbar.tsx, VeriComposer.tsx, VeriChatPanel.tsx, veri-chat-context.tsx, dashboard/page.tsx, sidebar-context.tsx, SettingsClient.tsx, api/organization/route.ts) and confirmed via grep: no search mechanism, no notifications system anywhere in the codebase.
- [x] Bumped package.json to @fchecklist/veridian-ui-kit v0.2.2 (matching compliance-tracker's own final pin), bun install clean.
- [x] veri-chat-context.tsx rewritten as a thin wrapper around createVeriChatContext() -- activeQueryId/openQuery kept as PROJEXA's own layered state (not the factory's activeTaskId/openTask, which has an incompatible composerMode side-effect PROJEXA's query flow never had); discussMessages/appendDiscussMessage layered the same way. openConversation/setComposerMode/closeThread all wrapped to keep both state slices in sync exactly as the original single-context version did.
- [x] AppSidebar.tsx rewritten to use the shared AppSidebar for the generic shell/style, with PROJEXA's real 10 nav sections (Overview/Execution/Field/Design/Resources/Sales/GRC/Finance/HR/Intelligence) converted to NavSection/NavItem data. ProjectSwitcher kept as a real sibling above the shared component (disclosed reorder -- no slot for it between logo/nav in the shared component). Mobile Sheet trigger kept fully decoupled from desktop collapsed state (unlike compliance-tracker's own coupled pattern) so a mobile user can never get stranded; now auto-closes via a pathname effect since it's mounted once, not per-page.
- [x] New src/components/PageHeading.tsx + swept all 41 page.tsx files: removed per-page `<AppTopbar title="X"/>` (AppHeader is now a single global mount, not per-page), replaced with `<PageHeading title="X"/>` inside each page's own `<main>`. Dashboard (home route) drops the heading entirely since HomeGreeting already provides one.
- [x] AppTopbar.tsx rewritten to wrap the shared AppHeader, mounted once from layout.tsx: real user-menu (Supabase signOut, matching SettingsClient.tsx's own pattern, real email from /api/organization), real org contextLabel, real working right-panel-toggle (new panelCollapsed state in layout.tsx), real MobileSidebarTrigger relocated into extraActions (same header placement as before). searchSlot/notificationSlot explicitly passed `false` (not omitted) to suppress AppHeader's own decorative-dead-button fallback, since PROJEXA has neither a real search mechanism nor a notifications system.
- [x] theme-toggle.tsx restyled for the new light header (was styled for the old dark bg-px-ink bar).
- [x] VeriChatPanel.tsx rewritten to use the shared PanelShell for its outer chrome/tabs only (overview/queries/chats/todo); all real list/thread rendering (QueryList/ChatList/TodoPanel/QueryThread/ConvoThread/Overview) kept local, unchanged.
- [x] VeriComposer.tsx: investigated adopting the shared VeriComposer, found a real, confirmed blocker (its onDispatch requires non-empty free text before a completed chain is sendable; PROJEXA's real dispatch is deterministic codeReference+fixedInputs with zero required text) -- kept local per this task's "report the blocker" instruction, documented in the file's own header comment. Types still flow from the shared package transitively.
- [x] src/app/(app)/layout.tsx rewritten to use AppShellFrame (sidebar/header/composer/panel/homeRoute="/dashboard") in place of the hand-rolled flex/ResizablePanelGroup layout.
- [x] Simplified away sidebar-context.tsx (Context+Provider) once this migration left it with exactly one real consumer -- replaced with plain useState in layout.tsx's ShellBody.
- [x] bunx tsc --noEmit: 0 errors. bun run lint: 0 errors (1 pre-existing unrelated warning in ui/data-table.tsx). bun run build: succeeds, every route compiles. bun test: this repo has zero test files / no test script defined in package.json (pre-existing, confirmed via grep -- not introduced by this change); `bun test` exits 1 with "0 test files matching" rather than a real failure.
- [x] Confirmed this repo's own ci.yml only defines Lint/Type Check/Build jobs (no Unit Tests/E2E Tests jobs exist) and this repo has no GitHub branch protection configured (403 on the branches/main/protection API, matching compliance-tracker's ACTIVE-CLAIMS.yaml note that projexa has "no CI/branch-protection in that repo").

- [x] Pushed branch, opened FChecklist/projexa PR #42
- [x] Posted AUDIT: PASS comment
- [x] Watched CI: Lint, Type Check, Build, Vercel preview deploy all green
- [x] Self-merged PR #42 (TIER1 -- no schema/migration touched), squash, branch deleted
- [x] Moved ACTIVE-CLAIMS.yaml entry to recently_completed via compliance-tracker PR #474 (merged)

## Remaining
- [ ] None -- task complete. Final report delivered to Owner in this session's closing message.
