"use client";

// R67 E-16 (R-150). DESIGN STUDIO > COST ANALYSIS.
//
// compliance-tracker's designerTimesheetReport has computed four Budget-vs-
// Actual breakdowns since PR #597 -- by category, by designer, by project and
// by designer status -- and not one PROJEXA screen showed any of them. This is
// that screen. Every figure below arrives already computed by the report;
// nothing here re-derives money.
//
// THE RULES IT OBEYS, all of them decided in src/lib/design-studio-cost-analysis.ts
// so they can be asserted without a browser:
//   * a row with NO budget is not a row that is 100 % under budget -- it is
//     drawn as a hatch and labelled "no budget set", never as a zero bar;
//   * a bar's direction is carried by the WORD "over"/"under" and an arrow
//     glyph, never by colour alone;
//   * sections sort worst-overrun first, because that is what the reader came
//     for -- not alphabetically by label;
//   * a bar is scaled against its OWN section's largest figure, because a
//     designer's budget and a whole project's budget are not comparable
//     magnitudes and one huge project would flatten every other bar.
//
// A SORTED HORIZONTAL PAIRED BAR, never a pie: the reader is comparing two
// magnitudes per row across a ranked list, which a pie cannot show at all.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Play } from "lucide-react";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { ExportShareActions } from "@/components/ExportShareActions";
import { formatDecimal } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import { taskErrorSentence } from "@/lib/task-errors";
import {
  barScale,
  barWidthPercent,
  costAnalysisSection,
  COST_ANALYSIS_SECTIONS,
  currentMonth,
  sectionEmptyMessage,
  sortByVariance,
  varianceVerdict,
  type CostAnalysisRow,
  type CostAnalysisSectionId,
  type DesignerTimesheetPayload,
} from "@/lib/design-studio-cost-analysis";

const MONEY_CELL = "text-right tabular-nums whitespace-nowrap";

/**
 * One section: the sorted paired bars, then the numeric table under them. The
 * bars are a picture of the table directly beneath, not a second dataset --
 * they are built from the same rows in the same order.
 */
function CostAnalysisSection({
  id,
  heading,
  itemLabel,
  rows,
  money,
  onSelect,
  selected,
}: {
  id: CostAnalysisSectionId;
  heading: string;
  /** The first column's name. Stated by the section, never derived from its heading. */
  itemLabel: string;
  rows: CostAnalysisRow[];
  money: (value: number | null) => string;
  /** Clicking a bar filters the Timesheet tab to that category or designer. */
  onSelect?: (row: CostAnalysisRow) => void;
  selected: string | null;
}) {
  const sorted = sortByVariance(rows);
  const scale = barScale(sorted);
  const hasAnyBudget = sorted.some((r) => r.budget !== null);
  const empty = sectionEmptyMessage(sorted, hasAnyBudget);

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-3 p-4">
        <h3 className="font-heading text-base text-px-ink" data-testid={`cost-analysis-heading-${id}`}>
          {heading}
        </h3>

        {empty ? (
          <p className="py-6 text-center text-sm text-px-muted" data-testid={`cost-analysis-empty-${id}`}>
            {empty}
          </p>
        ) : (
          <>
            <ul className="space-y-2" data-testid={`cost-analysis-bars-${id}`}>
              {sorted.map((row) => {
                const verdict = varianceVerdict(row);
                const isSelected = selected === row.key;
                const bar = (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[12.5px] text-px-ink">{row.label}</span>
                      {/* The GLYPH and the WORD, both. A printout, a greyscale
                          screenshot and a colour-blind reader all get the state. */}
                      <span className="text-[12px] text-px-muted" data-testid="cost-analysis-verdict">
                        <span aria-hidden>{verdict.glyph}</span>{" "}
                        {verdict.kind === "no-budget"
                          ? verdict.word
                          : verdict.kind === "on"
                            ? verdict.word
                            : `${money(verdict.amount)} ${verdict.word}`}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {/* Budget on top, Actual beneath -- the pair, always in
                          the same order, so a reader comparing two rows is
                          comparing the same two things. */}
                      {row.budget === null ? (
                        <div
                          role="img"
                          aria-label={`${row.label}: no budget set`}
                          data-testid="cost-analysis-bar-hatched"
                          className="h-2 rounded-sm border border-px-border"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(45deg, var(--color-ct-cloud) 0 4px, transparent 4px 8px)",
                          }}
                        />
                      ) : (
                        <div className="h-2 rounded-sm bg-px-cloud">
                          <div
                            className="h-2 rounded-sm"
                            data-testid="cost-analysis-bar-budget"
                            style={{
                              width: `${barWidthPercent(row.budget, scale)}%`,
                              backgroundColor: "var(--color-chart-1)",
                            }}
                          />
                        </div>
                      )}
                      <div className="h-2 rounded-sm bg-px-cloud">
                        <div
                          className="h-2 rounded-sm"
                          data-testid="cost-analysis-bar-actual"
                          style={{
                            width: `${barWidthPercent(row.actual, scale)}%`,
                            backgroundColor: "var(--color-chart-2)",
                          }}
                        />
                      </div>
                    </div>
                  </>
                );
                return (
                  <li key={row.key}>
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(row)}
                        aria-pressed={isSelected}
                        data-testid="cost-analysis-bar-row"
                        className={`block w-full cursor-pointer space-y-1 rounded-md border p-2 text-left transition-colors hover:bg-px-cloud/40 ${
                          isSelected ? "border-px-teal" : "border-transparent"
                        }`}
                      >
                        {bar}
                      </button>
                    ) : (
                      <div className="space-y-1 p-2">{bar}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{itemLabel}</TableHead>
                    <TableHead className={MONEY_CELL}>Budget</TableHead>
                    <TableHead className={MONEY_CELL}>Actual</TableHead>
                    <TableHead className={MONEY_CELL}>Variance</TableHead>
                    <TableHead className={MONEY_CELL}>Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => {
                    const verdict = varianceVerdict(row);
                    return (
                      <TableRow key={row.key}>
                        <TableCell>{row.label}</TableCell>
                        {/* An absent budget is the en dash the money formatter
                            already renders for "no figure" -- never AED 0.00. */}
                        <TableCell className={MONEY_CELL}>{money(row.budget)}</TableCell>
                        <TableCell className={MONEY_CELL}>{money(row.actual)}</TableCell>
                        <TableCell className={MONEY_CELL}>
                          {verdict.kind === "no-budget" ? money(null) : `${verdict.glyph} ${money(verdict.amount)}`}
                        </TableCell>
                        <TableCell className={MONEY_CELL}>
                          {row.hours === null ? money(null) : formatDecimal(row.hours)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DesignStudioCostAnalysisClient({
  projectId,
  projectName = "this project",
}: {
  projectId: string;
  projectName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgMoney = useOrgMoney();
  const money = useCallback((value: number | null) => orgMoney.money(value), [orgMoney]);

  const defaults = currentMonth();
  const [from, setFrom] = useState(searchParams.get("from") || defaults.from);
  const [to, setTo] = useState(searchParams.get("to") || defaults.to);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DesignerTimesheetPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const run = useCallback(
    async (window: { from: string; to: string }) => {
      setLoading(true);
      setError(null);
      try {
        // The EXISTING generic report proxy, which already forwards every query
        // param to compliance-tracker's /reports/<name>. A second proxy at
        // /api/design-studio/cost-analysis would be one more surface stating
        // where this report comes from, which is the exact defect R-079 records
        // about the Work Progress Report.
        const qs = new URLSearchParams({ projectId, from: window.from, to: window.to });
        const res = await fetch(`/api/reports/designer-timesheet?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "");
        setPayload(data as DesignerTimesheetPayload);
      } catch (err) {
        setError(taskErrorSentence(err instanceof Error ? err.message : null, "The report service didn't answer"));
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  // Runs on arrival with the current month, so the screen answers rather than
  // asking. The resolved window is written back into the URL, which is what
  // makes a run shareable and Back-able.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "cost-analysis");
    params.set("projectId", projectId);
    params.set("from", from);
    params.set("to", to);
    router.replace(`/design-studio?${params.toString()}`, { scroll: false });
    void run({ from, to });
    // Mount only, deliberately: `run` and the date state change on every
    // keystroke in the two date fields, and depending on them here would re-run
    // the report on each one. Every later run goes through rerun().
  }, []);

  function rerun() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "cost-analysis");
    params.set("projectId", projectId);
    params.set("from", from);
    params.set("to", to);
    router.replace(`/design-studio?${params.toString()}`, { scroll: false });
    void run({ from, to });
  }

  /**
   * Clicking a bar filters the Timesheet tab to that category or designer --
   * the item's own words. Category and designer are the two cuts the timesheet
   * grid can really be filtered by; a project or a designer-status row filters
   * nothing there, so those two sections are read-only rather than offering a
   * click that would do nothing.
   */
  function selectRow(section: CostAnalysisSectionId, row: CostAnalysisRow) {
    setSelected(row.key);
    const params = new URLSearchParams({ tab: "timesheet", projectId, from, to });
    if (section === "category") params.set("category", row.label);
    if (section === "designer") params.set("designerId", row.key);
    router.push(`/design-studio?${params.toString()}`);
  }

  const exportParams = new URLSearchParams({ projectId, from, to });

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="cost-analysis-from">From</Label>
            <Input id="cost-analysis-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost-analysis-to">To</Label>
            <Input id="cost-analysis-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={rerun} disabled={loading} data-testid="cost-analysis-run">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
          </Button>
          {/* Header actions: Filter | Export, with "+ New" suppressed -- there
              is nothing to create on a report. Filter is the period bar to the
              left, already open, so it is not repeated as a button that opens
              what is already on screen. */}
          <ExportShareActions
            canExport={!loading && payload !== null}
            exportReason={loading ? "Wait for the report to finish" : payload === null ? "Run the report first" : null}
            title={`${projectName} — Design cost analysis ${from} to ${to}`}
            pdfHref={`/api/reports/designer-timesheet/export?format=pdf&${exportParams.toString()}`}
            xlsxHref={`/api/reports/designer-timesheet/export?format=xlsx&${exportParams.toString()}`}
            csvHref={`/api/reports/designer-timesheet/export?format=csv&${exportParams.toString()}`}
          />
        </CardContent>
      </Card>

      {/* The window the report really covered, echoed back by the service --
          so the screen captions what it got, not what it asked for. */}
      <p className="text-[12.5px] text-px-muted" data-testid="cost-analysis-caption">
        {payload?.period?.from && payload?.period?.to
          ? `Showing ${payload.period.from} to ${payload.period.to} · approved hours only`
          : `Showing ${from} to ${to} · approved hours only`}
      </p>

      {error && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="space-y-2 p-4" role="alert" data-testid="cost-analysis-error">
            <p className="text-sm text-px-error">Could not run Design cost analysis: {error}</p>
            <Button variant="outline" size="sm" onClick={rerun}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3" data-testid="cost-analysis-skeleton">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : payload ? (
        <div className="space-y-4">
          {COST_ANALYSIS_SECTIONS.map(({ id, heading, itemLabel }) => (
            <CostAnalysisSection
              key={id}
              id={id}
              heading={heading}
              itemLabel={itemLabel}
              rows={costAnalysisSection(payload, id)}
              money={money}
              selected={selected}
              onSelect={
                id === "category" || id === "designer" ? (row) => selectRow(id, row) : undefined
              }
            />
          ))}
          <p className="text-[12px] text-px-muted">
            Budget lines are set per designer under{" "}
            <Link href="/budgets" className="underline">Budgets</Link>; the by-category cut has no
            budget dimension in the source, so its budget column is an en dash rather than a zero.
          </p>
        </div>
      ) : null}

      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}
