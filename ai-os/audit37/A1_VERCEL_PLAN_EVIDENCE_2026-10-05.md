# A1: Vercel is on the free Hobby plan (evidence, read 2026-10-05)

Audit row A1 (AUDIT_100_CHECKLIST.md): "Vercel on the Hobby (free) plan". Read-only: nothing on Vercel was changed, no deployment was made, no
billing or purchase call was made.

## What was read

| Question | Read-only means | Answer |
|---|---|---|
| Which team, which projects? | Vercel MCP `list_teams`, `list_projects` | One team, `VERIDIAN` (`veridian-ai-os`). Two projects: `veridian-compliance-ai`, `projexa`. |
| What plan is the team on? | `GET /v2/teams/<team id>` through the signed-in Vercel CLI (`vercel api`), field `billing.plan` | **`hobby`**. `billing.addons` is empty, `billing.period` is null (no paid period). Re-runnable: `node scripts/verify/vercel-plan-check.mjs` (exit 0 only for Hobby with no add-on); its logic is covered by `src/lib/vercel-plan-check.test.ts`. |
| Is anything billed now? | Vercel MCP `list_billing_charges`, one-day windows (never pasted, summarised by script) | 2026-10-04 and 2026-09-29: `costs_not_found` (no charges recorded for the day). |
| Was it ever billed? | same, one day: 2026-09-17 | **USD 2.59 for that one day**: Build CPU Minutes 1.27, a `Pro` seat line 0.645, Speed Insights Plus 0.645, Fluid Active CPU 0.009, Observability Events 0.007, Fast Origin Transfer 0.004. The `Pro` line shows the team was on a paid plan that day and Speed Insights Plus was on (the owner memory note PROJEXA-COST-001 records the Speed Insights Plus charge). It is history, not the present: on 2026-10-05 the plan reads `hobby`. |
| Is the project serving? | Vercel MCP `get_project` (projexa) | `live: false`, latest deployment `CANCELED` (consistent with the ignore command in vercel.json skipping builds). Domains attached: projexa-ai.com, www.projexa-ai.com and the .vercel.app names. |

## Result

A1 is evidenced: plan = Hobby, no paid add-on, no charge on the two recent days sampled. What this evidence does NOT cover (and so A1 is "VERIFIED
for the plan tier, today", not for ever): a month-to-date total (the billing endpoint is per day, up to 4 MB a day when charges exist) and the
Vercel dashboard's own usage meters (Edge requests, Fluid compute, bandwidth), which need the owner's login. Owner step, 1 minute: Vercel dashboard ->
Team VERIDIAN -> Usage -> read "Fluid Active CPU", "Function Invocations", "Fast Data Transfer" for the month; they should sit well inside the Hobby
allowances (see ai-os/audit37/VERCEL_ROUTE_PLAN.md for the measured invocation counts that predict this).

Notes for whoever re-runs it: `vercel api /v2/teams/...` needs `MSYS_NO_PATHCONV=1` under Git Bash (the path is otherwise rewritten to a Windows path).
