# PROGRESS -- task-20260727-130122-fix-pr-53-audit-findings--punch-list-pat

## Completed
- [x] Read full audit verdict on PR #53 (FAIL, medium severity) -- confirmed matches KNOWN_CONTEXT exactly: (1) punch-list/[id] PATCH missing requireRole gate, (2) no role-assignment mechanism exists, defaulting 'member' role would 403-lock existing users on merge.
- [x] Located actual PR branch checked out in a separate task worktree: /opt/veridian/ai-os/tasks/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model/workspace (branch worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model). Worked there directly since the fix had to land on PR #53, not a new PR.
- [x] Fix 1: added `requireRole(ctx, ROLE_GROUPS.FIELD)` gate to punch-list/[id]/route.ts PATCH, matching sibling POST route exactly.
- [x] Fix 2: added `ROLE_GROUPS.ORG_ADMIN = ["owner","admin"]` to auth-guard.ts, `PATCH /api/org-members/[id]` route (gated to ORG_ADMIN) letting an owner/admin reassign any member's role, plus a role-select control in SettingsClient.tsx's existing Team table (visible only to owner/admin viewers).
- [x] Item 3 decided: did NOT add 'member' back into either ROLE_GROUP transitionally -- owner/admin are unaffected by the regression and can immediately self-serve promote members via the new mechanism on merge, so no user is silently locked out with zero recovery path. Loosening enforcement was explicitly avoided per the task's constraints. Justification is now in the PR description's new "Audit-fix round" section.
- [x] New tests: src/app/api/punch-list/[id]/route.test.ts (3/3, client_viewer/member 403, site_engineer 200) and src/app/api/org-members/[id]/route.test.ts (5/5, owner/admin can reassign, non-admins 403, invalid role 400).
- [x] `npx tsc --noEmit` clean. `find src -name "*.test.ts" | xargs bun test`: 35/35 pass. `bun run lint`: 0 errors (1 pre-existing unrelated warning). Full unqualified `bun test` still hits the branch's pre-existing, documented e2e/*.spec.ts-vs-bun-glob collision -- unrelated, unchanged, not introduced by this fix.
- [x] Updated the PR-branch's own repo PROGRESS.md with an "Audit-fix round" entry.
- [x] Committed (77de705) and pushed to worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model.
- [x] Updated PR #53's description (via `gh api ... -X PATCH`, since `gh pr edit` errored on an unrelated Projects-classic GraphQL deprecation bug) with an explicit "Audit-fix round" section covering both findings and the regression-recovery justification.

## Remaining
- [ ] None for this task's scope. Do NOT merge -- requires a fresh supervisor audit per AGENTS.md Rule 7c before PR #53 can land.
