# PROGRESS -- task-20260719-060409-projexa--build-real-search---notificatio

## Completed
- [x] Read compliance-tracker's search-command.tsx, /api/search route, search-service.ts
- [x] Read compliance-tracker's notifications schema/route + AppTopbar notification bell UI
- [x] Read veridian-ui-kit AppHeader.tsx slot contract (searchSlot/notificationSlot)
- [x] Read PROJEXA's real schema.ts, veridian-client.ts, AppTopbar.tsx, RFI/submittal/punch-list/project routes -- confirmed PROJEXA's construction entities live in VERIDIAN (proxied), not in PROJEXA's own Postgres; only todos/orgs/memberships are real local tables
- [x] Confirmed no live DB/Supabase credentials available in this environment (no .env.local, SUPABASE_ACCESS_TOKEN unauthorized) -- migration will be committed as the durable record, not applied live
- [x] Bootstrap ai-os/boss/ACTIVE-CLAIMS.yaml for PROJEXA (didn't exist before)
- [x] Design: search aggregates projects (name), RFIs (subject), submittals (title), punch list (description), change orders (title) via VERIDIAN proxy + in-app filtering, plus real local todos ILIKE
- [x] Design: notifications table (mirrors compliance-tracker shape + orgId), RLS following PROJEXA's own auth.uid()/memberships convention (not compliance-tracker's app_runtime/service_role convention)
- [x] Add `notifications` table to src/lib/db/schema.ts
- [x] Add drizzle/0011_notifications.sql migration
- [x] Build src/lib/services/search-service.ts (pure matching helpers + VERIDIAN/todos search)
- [x] Build src/lib/services/notification-service.ts (pure content builders + notifyOrgMembers)
- [x] Build src/app/api/search/route.ts
- [x] Build src/app/api/notifications/route.ts (GET) + src/app/api/notifications/[id]/read/route.ts (PATCH)
- [x] Build src/components/search-command.tsx (command palette, no semantic tab -- out of scope)
- [x] Build src/components/NotificationBell.tsx
- [x] Wire both into src/components/AppTopbar.tsx (searchSlot/notificationSlot)
- [x] Wire real notification triggers: RFI created (api/rfis POST), submittal status changed (api/submittals/[id] PATCH, also had to add projectId to SubmittalsClient's PATCH body), punch list item created (api/punch-list POST)
- [x] Add tests: search-service.test.ts, notification-service.test.ts (12 tests, all pass)
- [x] Attempted to add a `test` job to .github/workflows/ci.yml -- reverted: `git push` was rejected ("refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope"), this session's gh token doesn't have that scope. Tests exist and pass locally (`bun test`) but are NOT yet wired into CI -- disclosed in the PR description; whoever has `workflow` scope should add the 6-line job (see this commit's history for the exact diff) as a fast follow-up
- [x] bunx tsc --noEmit clean
- [x] bun run lint clean (1 pre-existing unrelated warning)
- [x] bun test clean (12 pass)
- [x] bun run build clean (verified /api/search + /api/notifications routes compile)
- [x] Dev-server smoke test: root/login 200, dashboard 307 (auth redirect, expected), /api/search + /api/notifications return 401 unauthenticated (not 500) -- no runtime exceptions from new wiring

## Remaining
- [ ] Push branch, open PR, post AUDIT comment, watch CI
- [ ] Owner sign-off (TIER2 -- new migration/schema, not self-merged)
- [ ] Someone with Supabase MCP/DB access must apply drizzle/0011_notifications.sql against PROJEXA's live Postgres before the notifications feature actually works end-to-end (disclosed in PR description)
