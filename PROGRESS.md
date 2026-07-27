# PROGRESS -- task-20260727-130122-fix-pr-53-audit-findings--punch-list-pat

## Completed
- [x] Read full audit verdict on PR #53 (FAIL, medium severity) -- confirmed matches KNOWN_CONTEXT exactly: (1) punch-list/[id] PATCH missing requireRole gate, (2) no role-assignment mechanism exists, defaulting 'member' role would 403-lock existing users on merge.
- [x] Located actual PR branch checked out in a separate task worktree: /opt/veridian/ai-os/tasks/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model/workspace (branch worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model). Working there directly since the fix must land on PR #53, not a new PR.
- [x] Fix 1: added `requireRole(ctx, ROLE_GROUPS.FIELD)` gate to punch-list/[id]/route.ts PATCH, matching sibling POST route exactly.

## Remaining
- [ ] Fix 2: build PATCH /api/org-members/[id] role-assignment route, gated to owner/admin only.
- [ ] Decide/justify item 3 (recovery path vs. keeping 'member' transitionally in a ROLE_GROUP) and state explicitly in PR description.
- [ ] Add/extend tests: punch-list PATCH rejects client_viewer/accepts site_engineer; org-members PATCH allows owner/admin, rejects others.
- [ ] Maybe add minimal Settings UI role-select (Team table already exists in SettingsClient.tsx with a Select component available in the design system).
- [ ] `npx tsc --noEmit` clean, `bun test` passing.
- [ ] Update repo PROGRESS.md (in the PR branch) with new entries documenting this fix.
- [ ] Commit + push to worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model.
- [ ] Do NOT merge -- requires fresh supervisor audit per AGENTS.md Rule 7c.
