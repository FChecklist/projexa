# PROGRESS -- task-20260727-133855-fix-pr-53--last-owner-admin-demotion-pro

This branch is built on top of `worker/task-20260727-122935-projexa-e2e--pm-site-engineer-role-model`
(PR #53), merged in locally to get access to the `PATCH /api/org-members/[id]` endpoint this task
fixes. Per this task's instructions, PR #53's branch itself was NOT touched -- only merged *from*,
locally, into this task's own branch, which is what gets pushed/PR'd. **This PR is intended to land
on top of PR #53, not standalone against `main`** (a human should reconcile ordering/rebasing).

## Inherited from PR #53 branch (not redone here)
- [x] PROJEXA role model (`memberships.role`: owner|admin|pm|site_engineer|member|client_viewer),
      `requireRole()`/`ROLE_GROUPS` gating on project-budgets/schedule-baselines/change-orders/
      purchase-orders/site-diary/punch-list routes.
- [x] Audit-fix round (commit `77de705`): punch-list PATCH `ROLE_GROUPS.FIELD` gate, and the new
      `PATCH /api/org-members/[id]` role-assignment endpoint (`ROLE_GROUPS.ORG_ADMIN`) so owner/admin
      can promote members to the new roles.

## This task: fix last-owner/admin demotion gap
- [x] Searched the whole codebase for every endpoint that can change or remove a membership's role:
      `grep -rl "memberships" src/app/api` -> `org-members/[id]/route.ts` (PATCH, changes role),
      `org-members/route.ts` (GET only, no mutation), `org/provision/route.ts` (INSERTs the initial
      `owner` membership only when a user has none yet -- never updates/removes an existing one).
      Also checked every `DELETE` handler in `src/app/api` (`schedule/sprints/[id]/issues`,
      `timesheets/[id]`, `floor-plans/.../rooms/[roomId]`, `floor-plans/.../placements/[placementId]`,
      `todos/[id]`) -- none touch `memberships`. **`PATCH /api/org-members/[id]` is the only real
      endpoint that can demote/remove an owner/admin membership**, and no membership-removal
      (DELETE) route exists at all.
- [x] Added the last-owner/admin guard to `src/app/api/org-members/[id]/route.ts`: before applying a
      role change, fetches the target membership's *current* role; if it's currently owner/admin and
      the new role would NOT be owner/admin, counts OTHER owner/admin memberships in the org
      (excluding the target row itself). If that count is 0, rejects with `409` and a specific
      message ("every organization must keep at least one owner or admin") instead of applying the
      change. Reassignments that stay within the owner/admin group (owner<->admin), and reassignments
      of members who are already non-owner/admin, are never blocked -- the guard only fires on the
      actual last-one-out transition.
- [x] Tests added to `src/app/api/org-members/[id]/route.test.ts` (5 new, 10/10 total in this file):
      sole owner demoted to member -> 409; sole admin demoted to client_viewer -> 409; one of
      *several* owners/admins demoted -> 200 (guard doesn't over-block); owner<->admin reassignment
      of the sole owner/admin -> 200 (still admin-group, not a real demotion); reassigning an
      already-non-owner/admin member -> 200 (guard correctly not triggered).
- [x] `npx tsc --noEmit`: clean. `find src -name "*.test.ts" | xargs bun test`: 40/40 pass across 6
      files (up from 35/35 pre-fix). Unqualified `bun test` still hits the same pre-existing,
      unrelated e2e/*.spec.ts-vs-bun-test-glob Playwright collision noted in the prior audit round --
      confirmed present on this branch before this change too, not introduced here.
      `npx eslint` on the changed files: 0 errors/warnings.

## Remaining
- [ ] Await supervisor audit + reconciliation with PR #53 (this branch is not meant to merge
      standalone -- it depends on PR #53's `org-members/[id]` endpoint).
