# R-96 closure note: Scope of Work as a real screen (2026-10-08)

Requirement R-96: "Scope of work in a project must be a real, usable concept in PROJEXA."

## What was built

- A **Scope of Work** tab, now the first (default) tab of `/scope`. No new route, no new nav entry, no new API route (Vercel route inventory unchanged).
  `?tab=boq`, `?tab=budget`, `?tab=variance` and `?tab=revenue-budget-actual` still open the tabs they always did.
- `src/components/ScopeOverviewClient.tsx` shows, for the selected project and in plain words:
  the current approved Scope of Work (title, version, status, total, line count; if nothing is approved it says so),
  earlier versions with status, what changed since the original (signed change vs previous and vs original),
  change orders waiting for approval (project-wide, stated on screen: they are not tied to one BOQ version),
  and links to Open BOQ, Create a revision, Compare revisions (only when there is an earlier version).
  Empty project: a plain sentence plus New and Import.
- `src/lib/scope-overview.ts` holds the pure rules. The two variation rules were moved out of `ScopeClient.tsx` so the BOQ list and the overview cannot disagree.
- Data: the same headers-only list the BOQ tab already holds (`include=variation,compare,headers`); the only own read is the existing `GET /api/change-orders`.
- Money: `useOrgMoney`, shown only where the payload carries a figure. A role whose payload has none sees the em-dash, never a zero.
- Offline: the tab needs a connection and says so in one sentence. The laptop copy keeps its own Scope of Work (BOQ) list screen.

## Closing test (R74-RULING-03)

- (a) committed: `src/components/ScopeOverviewClient.test.tsx` (10 tests).
- (b) renders the real component; the BOQ rows come in as the real list payload shape.
- (c) failure observed with throwaway mutants, then reverted: reversing the "earlier versions" order fails `current is the highest approved revision`; turning the money guard into `money(v ?? 0)` fails `a role whose payload carries no money sees em-dashes`.
- (d) record the commit SHA of the commit carrying this note when the PM pushes.
- (e) the screen has no write path; "persisted" here means the figures are read back from the list payload and change orders are read from the route (asserted).
- (f) record against requirement R-96 in `platform.sumeet_requirements`: file above, run date 2026-10-08.

## Not done

- Not wired into the laptop shell's own route table; offline it keeps the BOQ list.
- Not verified in a browser (no dev server in this session); verified by component tests and tsc only.
- Change orders are not linked to a BOQ version because the existing data has no such link.
