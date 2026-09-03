"use client";

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16). PROJEXA's equivalent of
// compliance-tracker's ReportDefinitionRunner.tsx (#375) -- the real
// "run it and see the result" panel for one report_definitions-backed
// catalog entry. Calls the PRE-EXISTING POST /api/reports/definitions/[id]/run
// proxy (-> VERIDIAN's executeReportDefinition() dispatcher). No execution
// logic lives here, this is a pure consumer.
//
// Honesty note (same as #375's own): executeReportDefinition returns the
// SAME {columns,rows,narrative?,note?} shape for every execution_type
// (deterministic_aggregation/deterministic_formula/ai_recipe/
// external_service) AND for a non-"built" definition (a clean
// {columns:["Note"],rows:[{Note:"not yet built"}]} rather than an error) --
// so this component renders whatever real shape comes back, including the
// "not built yet" case, without special-casing execution type or status.
//
// Reports pivot/chart UI (2026-07-27): result rendering goes through
// ReportResultView, which adds Table/Pivot/Chart view-mode tabs over the
// SAME {columns,rows} the inline table used to render alone -- pivoting and
// charting happen entirely client-side against this already-fetched result
// (pivot-utils.ts), never a second server call.
//
// R67 E-31 (R-264). WHAT WAS WRONG, and what this now does about it.
//
// 1. "RUN THIS REPORT" DID NOT RUN A REPORT. It expanded a panel of EMPTY
//    parameters -- blank From, blank To, and a project field captioned "only
//    needed for some project-scoped reports" -- and then waited for a second
//    click on a second button. Every one of those parameters has an obvious
//    correct default this app already knows: the current month to date, and
//    the project the shell is on. They are filled in before the reader sees
//    the card, and the report runs on arrival with them.
//
// 2. THE PARAMETERS WERE THE FIRST THING, NOT THE ANSWER. They now sit
//    collapsed behind "Edit parameters", and changing one re-runs -- the
//    reader edits a report they can see, rather than filling a form to earn
//    one.
//
// 3. A RUN HAD NO STATE AND NO BOUND. The panel showed a two-line skeleton
//    and could wait forever. It uses the shared useTimedRun hook now, so it
//    says how long it has been, offers Cancel, and gives up at 20 s with
//    somewhere to go next -- the same machine the Reports module and the Work
//    Progress Report use, so a slow report behaves identically wherever a
//    reader meets one.
//
// 4. AN EMPTY RESULT LOOKED LIKE A FAILURE. "No rows returned." says nothing
//    about WHY. It now names the subject and the window that were asked for:
//    "No attendance between 01-09-2026 and 02-09-2026" -- which points
//    straight at the fix, widening the range.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanySelector, type Company, type CompanyScope } from "@/components/company-scope";
import { Loader2 } from "lucide-react";
import { ReportResultView, type TabularReportResult } from "@/components/reports/ReportResultView";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { monthToDateRange } from "@/lib/report-registry";
import { formatDateDMY } from "@/lib/format-date";
import { timeoutSentence, useTimedRun } from "@/lib/use-timed-run";

/** The sentence an empty result gets. Exported so its wording is pinned by a test. */
export function emptyResultSentence(subject: string, from: string, to: string): string {
  return `No ${subject} between ${formatDateDMY(from)} and ${formatDateDMY(to)}`;
}

export function ReportCatalogRunner({
  definitionId,
  supportsCompanyScope,
  companies,
  projectId: initialProjectId,
  subject,
}: {
  definitionId: string;
  supportsCompanyScope: boolean;
  companies: Company[];
  /** R67 E-31: the project the shell is on, pre-filled before the card is seen. */
  projectId?: string | null;
  /** R67 E-31: what this report is ABOUT, for the empty-range sentence ("No attendance between ..."). */
  subject: string;
}) {
  // Computed once, at mount: a card that stays open across midnight must not
  // silently change the range it says it ran.
  const [range] = useState(() => monthToDateRange());
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [showParameters, setShowParameters] = useState(false);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });
  const [filterParams, setFilterParams] = useState<Record<string, string>>({
    // The same two names the definitions themselves read (see ReportFilters'
    // own header) -- so the default range is a real filter, not a decoration.
    startDate: range.from,
    endDate: range.to,
  });

  const run = useTimedRun<TabularReportResult>();
  const startRun = run.run;
  const result = run.result;

  const runReport = useCallback(
    async (overrides: { params?: Record<string, string>; projectId?: string; companyId?: string | null } = {}) => {
      const paramSet = overrides.params ?? filterParams;
      const project = overrides.projectId ?? projectId;
      const companyId = overrides.companyId !== undefined ? overrides.companyId : scope.companyId;

      await startRun(async (signal) => {
        const params: Record<string, unknown> = { ...paramSet };
        if (project.trim()) params.projectId = project.trim();
        if (supportsCompanyScope && companyId) params.companyId = companyId;
        const res = await fetch(`/api/reports/definitions/${encodeURIComponent(definitionId)}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ params }),
          signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || data?.error || `the report service answered ${res.status}`);
        return data as TabularReportResult;
      });
    },
    [definitionId, filterParams, projectId, scope.companyId, supportsCompanyScope, startRun]
  );

  // RUN ON ARRIVAL. The card is only mounted once the reader has pressed
  // "Run this report", so this IS that click being honoured -- with the
  // defaults already in place, rather than a second button to find.
  // Deliberately mount-only (`runReport` is NOT a dependency): every later run
  // is triggered by a parameter change, which passes its own override rather
  // than waiting for state to settle. With runReport as a dependency this would
  // re-run on every keystroke in the project field.
  useEffect(() => {
    void runReport();
  }, []);

  const running = run.state === "running";
  const failed = run.state === "failed" || run.state === "timeout";
  const failureMessage =
    run.state === "timeout"
      ? `${timeoutSentence()} Narrow the date range and run it again.`
      : `Could not run this report — ${run.error ?? "the service did not answer"}`;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-px-border p-2.5 bg-muted/20">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-px-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Running… {run.elapsedSeconds} s
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => run.cancel()}>
              Cancel
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowParameters((v) => !v)}
            className="text-[11px] text-px-muted underline underline-offset-2 hover:text-px-ink"
          >
            {showParameters ? "Hide parameters" : "Edit parameters"}
          </button>
        )}
        {!running && (
          // The range the numbers on screen actually describe, said in words,
          // so the reader does not have to open the panel to find out.
          <span className="text-[11px] text-px-muted">
            {formatDateDMY(range.from)} to {formatDateDMY(range.to)}
          </span>
        )}
      </div>

      {showParameters && (
        <div className="space-y-2 rounded-md border border-px-border bg-white p-2">
          <ReportFilters
            initialStartDate={range.from}
            initialEndDate={range.to}
            onChange={(params) => {
              setFilterParams(params);
              void runReport({ params });
            }}
          />
          <div className="flex flex-wrap items-end gap-2">
            {supportsCompanyScope && (
              <CompanySelector
                companies={companies}
                scope={scope}
                onChange={(next) => {
                  setScope(next);
                  void runReport({ companyId: next.companyId });
                }}
                showConsolidateToggle={false}
              />
            )}
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                onBlur={(e) => void runReport({ projectId: e.target.value })}
                placeholder="every project"
                className="h-8 w-52 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void runReport()}>
              Run again
            </Button>
          </div>
        </div>
      )}

      {running && (
        <div className="space-y-1.5 pt-1" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {!running && failed && (
        <div className="space-y-2 rounded p-2 border border-px-error-border bg-px-error-light">
          <p role="alert" className="text-xs text-px-error">{failureMessage}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runReport()}>
            Run again
          </Button>
        </div>
      )}

      {!running && run.state === "cancelled" && !result && (
        <p className="pt-1 text-xs text-px-muted">Cancelled. Nothing was run.</p>
      )}

      {!running && !failed && result && (
        <div className="pt-1">
          {result.rows.length === 0 ? (
            // R67 E-31: WHICH subject, and over WHICH window. "No rows
            // returned." leaves the reader unable to tell an empty month from
            // a broken report.
            <p className="py-4 text-center text-xs text-px-muted" data-testid="catalog-empty-result">
              {emptyResultSentence(subject, range.from, range.to)}
            </p>
          ) : (
            <ReportResultView result={result} />
          )}
        </div>
      )}
    </div>
  );
}
