# PROGRESS -- task-20260727-133855-fix-pr-53--last-owner-admin-demotion-pro

This branch is built on top of `worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model`
(PR #53), merged in locally to get access to the `PATCH /api/org-members/[id]` endpoint this task
fixes. Per this task's instructions, PR #53's branch itself was NOT touched -- only merged *from*,
locally, into this task's own branch, which is what gets pushed/PR'd.

## Inherited from PR #53 branch (not redone here)
- [x] PROJEXA role model (`memberships.role`: owner|admin|pm|site_engineer|member|client_viewer),
      `requireRole()`/`ROLE_GROUPS` gating on project-budgets/schedule-baselines/change-orders/
      purchase-orders/site-diary/punch-list routes.
- [x] Audit-fix round (commit `77de705`): punch-list PATCH `ROLE_GROUPS.FIELD` gate, and the new
      `PATCH /api/org-members/[id]` role-assignment endpoint (`ROLE_GROUPS.ORG_ADMIN`) so owner/admin
      can promote members to the new roles.

## This task: fix last-owner/admin demotion/removal gap
- [ ] Search codebase for every endpoint that can change or remove a membership's role.
- [ ] Add a "last owner/admin" guard to each one found.
- [ ] Tests: sole owner/admin cannot be demoted; org with multiple owners/admins can demote one.
- [ ] `npx tsc --noEmit` clean, `bun test` passing.
- [ ] Push this branch, open PR noting it should land on top of PR #53.

## Remaining
- [ ] (see checklist above)
