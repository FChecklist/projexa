# Pivot Table / Chart UI -- Tech Decision (2026-07-27)

Owner directive: `CRITICAL_ERP_REPORTING_MODULE_WITH_AI_API_INTEGRATION`,
`phase_2_projexa_thin_client_wiring`. Task: build PROJEXA's pivot-table/chart
reporting UI. This document records the two build-vs-adopt decisions made
along the way, with the same evidence-first rigor the initiative's prior
tech-decision docs (e.g. `BROWSER_LITE_LLM_TECH_DECISION`) use: state the
claim, verify it against the real codebase, decide, justify.

## Decision 1: adopt `src/components/ui/chart.tsx` as-is, do not replace it

**Claim to verify**: the task spec (written before this investigation) says
compliance-tracker has a shadcn/Recharts chart wrapper at
`src/components/ui/chart.tsx` that is real but unused, and asks whether
PROJEXA should adopt or replace it.

**What's actually true, verified 2026-07-27**:

- PROJEXA **already has its own copy** of this file
  (`src/components/ui/chart.tsx`, 350 lines) plus `recharts@^2.15.4` in
  `package.json` -- neither was added by this task. `git blame`/history shows
  both came in with an earlier shadcn scaffold pass, not from
  compliance-tracker.
- `grep -rn "components/ui/chart\|ChartContainer\|ChartTooltip" src` (excluding
  the file itself) returned **zero matches** before this task -- confirmed
  dead scaffolding, exactly like compliance-tracker's own copy, not proven
  infrastructure.
- Diffed PROJEXA's copy against compliance-tracker's: functionally identical
  (`ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartLegend`/
  `ChartLegendContent`/`ChartStyle`, same CSS-variable-per-series theming
  mechanism). The only differences are a few TypeScript prop-type
  signatures reflecting a slightly older `recharts` type version
  (`React.ComponentProps<typeof RechartsPrimitive.Tooltip>` vs.
  compliance-tracker's newer `RechartsPrimitive.TooltipContentProps<...>`)
  -- cosmetic, not a functional gap. It compiles clean under this repo's own
  `tsc --noEmit` once given a real consumer (verified as part of this task).

**Decision**: adopt PROJEXA's own `chart.tsx` unchanged. Do not port
compliance-tracker's copy, and do not hand-roll a new Recharts wrapper --
that would be duplicating real, working, already-present code for no reason.
This task's actual chart components (`ReportChart.tsx`) are the first real
consumer either repo has ever had for this wrapper.

## Decision 2: `report_definitions` has no formal per-row parameter schema -- filters are generic, not schema-derived

**Claim to verify**: the spec asks whether dynamic filter dropdowns can be
derived from a parameter schema carried on `report_definitions` rows.

**What's actually true, verified 2026-07-27** (read
`compliance-tracker/src/lib/db/schema.ts`'s `reportDefinitions` table and
`report-engine-service.ts` end to end):

- The `reportDefinitions` Drizzle table has no `paramsSchema`/`filters`
  column of any kind. Its only per-row execution-shape data is
  `executionConfig` (jsonb, shape depends on `executionType`).
- The one place any params structure exists at all is
  `ExternalServiceConfig.requiredParams?: string[]` -- an untyped list of
  parameter *names* (no type, no label, no default, no valid-values list),
  and only for the `external_service` execution type. The other three
  execution types (`deterministic_aggregation`, `deterministic_formula`,
  `ai_recipe`) have no declared params at all; call sites just know from
  reading the code that e.g. some formulas read `params.projectId` or
  `params.days`.
- `FullCatalogEntry` (what `getFullReportCatalog()` actually returns to any
  client, PROJEXA included) does **not** expose `executionConfig` or
  `requiredParams` at all -- confirmed by reading its type definition and
  `getFullReportCatalog()`'s mapping function. This is correct thin-client
  behavior (VERIDIAN doesn't leak its internal execution config to PROJEXA),
  but it also means PROJEXA has no schema to introspect even if one existed
  server-side.

**Decision**: `ReportFilters.tsx` does not attempt to synthesize dropdowns
from a schema that doesn't exist. Instead it offers real, generic,
re-triggering controls: a date range (`startDate`/`endDate`, names several
existing definitions already read) plus a free-form key/value list for
everything else (`projectId`, `companyId`, `days`, `weekStart`, ...). Every
change re-POSTs `/api/reports/definitions/[id]/run` with the new `params`
object -- this is never client-side filtering of an already-fetched result.
If a future change adds a real declared params schema to `report_definitions`
(a natural follow-on for the sibling `reporting_api_gateway` task), this
component is the one place to swap the generic key/value list for
schema-driven controls.

## Chart color palette: existing `--chart-1..5` tokens failed validation, replaced

Not a build-vs-adopt decision, but worth recording: PROJEXA's `globals.css`
already defined `--chart-1` through `--chart-5` (unused anywhere in `src`,
confirmed via grep, before this task). Running the dataviz skill's
validator against them:

```
node scripts/validate_palette.js "#F5820A,#0E7C6E,#2563EB,#7C3AED,#E67E22" --mode light
 [FAIL] Chroma floor     #0E7C6E below floor (reads gray)
 [FAIL] CVD separation   #7C3AED vs #2563EB ΔE 0.4 (deutan) -- functionally identical to a deuteranope
 [FAIL] Normal-vision floor  same pair ΔE 12.4, below the 15 floor
```

Replaced with the dataviz skill's validated 5-slot categorical order
(blue/orange/aqua/yellow/magenta), which passes every check in both light
and dark mode (dark had no override before this change -- confirmed via
grep, meaning dark mode was silently reusing the light hexes against a dark
surface, unvalidated). See `src/app/globals.css` for the values and full
validator output in the surrounding comments.

## What was built (scope, for cross-reference)

- `src/components/reports/pivot-utils.ts` -- pure client-side group-by/
  sum/avg/count over a bounded `report_definitions` execution result. No DB
  access, no network calls: the only place aggregation math happens
  anywhere in this change (`STRICT_THIN_CLIENT_EXTENSION`).
- `src/components/reports/PivotTable.tsx` -- row/column/value field
  selection + aggregation picker, built on `pivot-utils.ts`.
- `src/components/reports/ReportChart.tsx` -- bar/line/pie over the same
  data, using the adopted `chart.tsx` wrapper.
- `src/components/reports/ReportResultView.tsx` -- Table/Pivot/Chart tab
  switcher over one `{columns, rows}` result.
- `src/components/reports/ReportFilters.tsx` -- the generic filter controls
  described above.
- Wired into `ReportCatalogRunner.tsx` (the report_definitions catalog
  runner -- covers all domains: Sales/CRM, ERP, construction, interior
  design, compliance, custom) and into `ReportOutput.tsx`'s array-of-objects
  branch (the fixed 17-report project list), so both existing entry points
  gain Table/Pivot/Chart view modes without removing the original renderer.
