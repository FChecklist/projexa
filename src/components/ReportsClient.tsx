"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileSpreadsheet, FileText, Link2, Loader2, MessageCircle, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { ReportOutput } from "@/components/ReportOutput";
import { ReportCatalogSection } from "@/components/ReportCatalogSection";
import { useOrgMoney } from "@/lib/use-org-money";
import { isHostedReport, reportDestination } from "@/lib/report-destinations";
// R67 E-17 (R-175): the composed index -- what renders a report, what it takes,
// whether it exports, and the parameters it opens with.
import { registryDestination } from "@/lib/report-registry";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { useShellMessage } from "@/components/shell/shell-messages";
import { taskErrorSentence } from "@/lib/task-errors";
import {
  readReportRunParams,
  reportRunSearchParams,
  reportTitleBlock,
  reportResultToCsv,
  isStaleRun,
  runningLine,
  CANCEL_VISIBLE_AFTER_MS,
  RUN_BUDGET_MS,
  RUN_TIMEOUT_MESSAGE,
  NO_PROJECT_MESSAGE,
  UNKNOWN_REPORT_MESSAGE,
  dayLabel,
  type ReportRunParams,
} from "@/lib/report-run";
import {
  ALL_OPTION_LABEL,
  ALL_OPTION_VALUE,
  applyClientFilters,
  missingPrerequisites,
  periodNote,
  reportParameters,
  runButtonLabel,
  unappliedFilterNote,
  weekStartFieldError,
  WHOLE_PROJECT_PERIOD,
} from "@/lib/report-parameters";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { ProjectStatusCard } from "@/components/reports/ProjectStatusCard";
import { isPlainObject, noRowsMessage, reportSchema } from "@/lib/report-schema";

import {
  BREAKUP_SOURCE_REPORT,
  exportDisabledReason,
  reportExportHref,
  shareDisabledReason,
  whatsappHref,
} from "@/lib/report-document-actions";

/**
 * R67 E-13 (R-131): a Project Status with no BOQ budget lines is a real state
 * with a real next step, not a blank table.
 */
const NO_BUDGET_LINES_MESSAGE = "No budget lines yet — set budgets on the BOQ screen";

// R46 P8 seq126 (M28 registry-model proof, REPORT archetype -- function_id
// "reports.report"): intentionally the same fields as ScreenColumn so a
// registry row (compliance.screen_definitions) can be passed straight in
// with no reshaping, same pattern as ScopeClient's RegistryColumn.
export type RegistryColumn = ScreenColumn;

// Fallback + canonical list of report VALUES (the API path segment each
// report actually runs against -- never registry-driven, changing these
// would break /api/reports/[reportName]). Mirrors the registry seed 1:1 for
// LABEL text, so there is no visible difference between "resolved from the
// DB" and this hardcoded default (M28: keep the hardcoded version behind a
// flag until verified).
const DEFAULT_REPORT_COLUMNS: ScreenColumn[] = [
  { field: "project-status", label: "Project Status", type: "text", importance: "High" },
  { field: "project-completion", label: "Project Completion", type: "text", importance: "High" },
  { field: "work-progress", label: "Work Progress", type: "text", importance: "High" },
  { field: "category-progress", label: "Category Progress", type: "text", importance: "High" },
  { field: "weekly-project", label: "Weekly Project (needs week start)", type: "text", importance: "High" },
  { field: "attendance", label: "Attendance", type: "text", importance: "High" },
  { field: "manpower-cost", label: "Manpower Cost", type: "text", importance: "High" },
  { field: "site-picture", label: "Site Picture Log", type: "text", importance: "High" },
  { field: "scope", label: "Scope (BOQ)", type: "text", importance: "High" },
  { field: "budget-summary", label: "Budget Summary", type: "text", importance: "High" },
  { field: "budget-vs-actual", label: "Budget vs Actual", type: "text", importance: "High" },
  { field: "material-consumption", label: "Material Consumption", type: "text", importance: "High" },
  { field: "vendor-cost", label: "Vendor Cost", type: "text", importance: "High" },
  { field: "designer-timesheet", label: "Designer Timesheet", type: "text", importance: "High" },
  { field: "kpi", label: "KPI", type: "text", importance: "High" },
  { field: "revenue", label: "Revenue", type: "text", importance: "High" },
  { field: "expense", label: "Expense", type: "text", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

// Builds the picker's {value,label} list: VALUES always come from
// DEFAULT_REPORT_COLUMNS (the fixed, never-registry-driven set of report
// API paths this page knows how to run); LABELS resolve against the
// registry row when present, else the same hardcoded text. Only what the
// user reads changes -- report selection, execution, and the Full Catalog
// tab are untouched, same "labels only" contract as boq.custom.
function buildReports(registryColumns: RegistryColumn[] | null | undefined): { value: string; label: string }[] {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_REPORT_COLUMNS;
  return DEFAULT_REPORT_COLUMNS.map((c) => ({ value: c.field, label: columnLabel(columns, c.field, c.label) }));
}

// CONS-02 (R46 P4 consistency sweep): project-status's own response
// legitimately returns two differently-derived, intentionally-distinct
// percent-complete fields on one payload (percentByValue: value-weighted
// against the current BOQ; progressPercent: flat average of each
// activity's latest logged percentComplete, no BOQ scoping -- both real,
// both documented in construction-dashboard-service.ts#getProjectDashboard()).
// ReportOutput's generic renderer otherwise shows bare JSON key names, so
// this page previously showed "percentByValue" and "progressPercent" next
// to each other with nothing telling a real user they measure different
// things. Keyed by report value so only project-status is affected; every
// other report keeps ReportOutput's default bare-key-name display untouched.
//
// R55_REPORTS_RUN_REPORT_RAW_DUMP_01: project-status's remaining fields
// (budget/revenue/expenses/contractValue/projectValue/earnedValue/
// delayedTaskCount/photoCount/taskCount/projectId/projectName) had no entry
// here either, so the same raw-camelCase-key-as-label defect applied to
// all of them, not just the two percent fields above. Adding real labels
// for the rest closes that gap the same way.
//
// R67 E-13 (R-131/R-138): the project-status entry MOVED, it was not deleted.
// A label map alone could not fix what R-131 records -- the fields still had no
// ORDER, no bands, three money formats, a raw cuid printed as a field, and two
// percentages whose disagreement was explained only in a code comment. All of
// that now lives in src/components/report-format.ts, rendered by
// reports/ProjectStatusCard.tsx. This map stays for any other report that wants
// labels without a card of its own.
const REPORT_FIELD_LABELS: Record<string, Record<string, string>> = {};

// R55_REPORTS_CONTRACTVALUE_NO_AED_01 / R67 G-05 (R-260): contractValue used to
// render as a bare number with no currency token, and the first fix prefixed the
// label onto the RAW value, so the same figure came back "AED 4500000" on one
// report and "AED 4500000.5" on another. Both are now handled by
// report-format.ts's one formatter -- bound to the org's currency, one shape per
// FIELD -- so the per-key formatter override this file used to build is gone
// rather than left as a second way to format the same number.

// Priority 17 follow-on (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16, Owner: "look at the PROJEXA reports
// gaps and fill it. For customer facing app, reports and analysis is
// important."): this page previously offered ONLY the fixed 17-report list
// below (ProjectReportsPanel) -- a real, working, project-scoped view over
// construction-reports-service.ts, kept as-is, not regressed. EXTENDED
// (not replaced) with a second tab, "Full Catalog", covering the ~230-entry
// report_definitions catalog (report-engine-service.ts's
// getFullReportCatalog()/executeReportDefinition()) that no PROJEXA page
// consumed before this. The two are genuinely different, both kept: this
// fixed list needs an active project and only covers 17 construction
// reports; the catalog tab is org-wide, searchable, and covers every
// report/analysis type across the whole platform (ERP, compliance,
// AI-ops, custom, plus these same 17 construction reports again via their
// own report_definitions rows where they exist there too).
/** The report the panel opens on when the URL names none. */
export const DEFAULT_REPORT_NAME = "project-status";

/** R67 E-11: the two lookups the Category and Vendor selects are populated from. */
type CategoryOption = { id: string; name: string };
type VendorOption = { id: string; vendorName?: string | null; name?: string | null; supplierName?: string | null };

function vendorLabel(v: VendorOption): string {
  return v.vendorName || v.name || v.supplierName || v.id;
}

function ProjectReportsPanel({
  projectId,
  projectName,
  reports,
  initialRun,
  unknownReportSlug = null,
  handoff = null,
}: {
  /**
   * R67 E-11: nullable. The card renders WITH the rail on "All projects" -- the
   * primary reads "Run Report (select a project)" and is disabled, which is what
   * tells the reader what to fix. Hiding the whole card behind a sentence left
   * them with a fact and no control.
   */
  projectId: string | null;
  /** So the title block and the running line can name the project, not its cuid. */
  projectName: string | null;
  reports: { value: string; label: string }[];
  /** R67 E-09: the whole run comes from the URL -- report, period, week start. */
  initialRun: ReportRunParams;
  /** The ?report= slug the URL named when this screen does not have it. */
  unknownReportSlug?: string | null;
  /**
   * R67 E-14 (R-132): a report handed over from the Full Catalog. The nonce is
   * what makes "open the same report again" a real event rather than a no-op --
   * a reader pressing the same card twice expects it to run twice.
   */
  handoff?: { slug: string; nonce: number } | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState<ReportRunParams>(initialRun);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  // R67 E-04 (R-079) and E-10 (R-129): an EXPLICIT status, replacing the
  // ranOnce/loading pair. The old pair tested ranOnce BEFORE loading, so on a
  // first run the panel kept showing "Pick a report and click Run Report."
  // while the button was already spinning -- the running state was literally
  // unreachable. That string is deleted from this file, so it can never sit on
  // screen during a request again. `timeout` is its own state because "it is
  // still going" and "we stopped waiting" are different things to be told.
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error" | "timeout">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  // R67 E-09: Filter reopens the parameter card. It is open until a run
  // succeeds, then folds away -- the reader came for the result, not the form.
  const [parametersOpen, setParametersOpen] = useState(true);
  // R67 E-12 (R-136): the document reports back when its rows do not add up to
  // the total the report states, and Export carries THAT sentence as its reason.
  const [tieMessage, setTieMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const orgMoney = useOrgMoney();
  const abortRef = useRef<AbortController | null>(null);

  const currentLabel = reports.find((r) => r.value === run.report)?.label ?? run.report;
  const hosted = isHostedReport(run.report);
  // R67 E-11: what THIS report takes -- read off the real handler, not guessed.
  const spec = reportParameters(run.report);
  const missing = missingPrerequisites(run.report, { projectId, weekStart: run.weekStart });
  const weekStartError = weekStartFieldError(run.report, run.weekStart);
  const blockedReason = missing.length > 0 || weekStartError !== null;
  const titleBlock = ranAt
    ? reportTitleBlock({
        reportLabel: currentLabel,
        projectName,
        from: run.from,
        to: run.to,
        ranAt,
        // A report the period does not touch must not be captioned with one.
        periodText: spec.needsDateRange ? undefined : WHOLE_PROJECT_PERIOD,
      })
    : null;
  const chosenVendor = run.vendorId ? vendors.find((v) => v.id === run.vendorId) ?? null : null;
  const filterState = {
    category: run.category,
    vendorId: run.vendorId,
    vendorName: chosenVendor ? vendorLabel(chosenVendor) : null,
  };
  // R67 E-11: applied HERE for every handler that does not filter yet -- and the
  // outcome says which filters actually found a field, so an unchanged table is
  // never left looking like a broken control.
  const filtered = result === null ? null : applyClientFilters(result, filterState);
  const shownResult = filtered ? filtered.result : null;
  const filterNote = filtered ? unappliedFilterNote(filterState, filtered) : null;
  // R67 E-12: the report's own document, where one is described. A slug with no
  // schema keeps the generic grid -- inventing a document for a payload nobody
  // described would be a worse lie than the raw keys.
  const schema = reportSchema(run.report);

  // R67 E-10 (R-133): the failure lives in the shell's message area, which
  // does not vanish on a timer the way the toast this replaces did.
  useShellMessage(
    "reports.run",
    status === "error" || status === "timeout"
      ? { tone: "error", text: `Could not run ${currentLabel}: ${errorText ?? RUN_TIMEOUT_MESSAGE}` }
      : null
  );

  // R67 E-11: the Category and Vendor selects are populated from the org's real
  // lists -- GET /api/scope/categories and GET /api/vendors -- so the card can
  // never offer a category nobody uses or a vendor nobody has. Either lookup
  // failing costs the reader that one FILTER, never the report: the select
  // simply offers "All" and nothing else.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/scope/categories")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("categories"))))
      .then((d) => { if (!cancelled) setCategories(Array.isArray(d.categories) ? d.categories : []); })
      .catch(() => { if (!cancelled) setCategories([]); });
    fetch("/api/vendors")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("vendors"))))
      .then((d) => { if (!cancelled) setVendors(Array.isArray(d.vendors) ? d.vendors : []); })
      .catch(() => { if (!cancelled) setVendors([]); });
    return () => { cancelled = true; };
  }, []);

  // The elapsed-seconds counter. A reader watching a spinner cannot tell a slow
  // report from a hung one; a number that keeps moving can.
  useEffect(() => {
    if (status !== "running") return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [status]);

  // R67 E-09: a result older than five minutes is still shown and is no longer
  // presented as current -- the reader decides whether to re-run it.
  useEffect(() => {
    if (!ranAt) return;
    setStale(isStaleRun(ranAt));
    const id = setInterval(() => setStale(isStaleRun(ranAt)), 30000);
    return () => clearInterval(id);
  }, [ranAt]);

  // Priority 19 (Dubai 50-user E2E test + fix pass, "GAP -- Reports" entry):
  // guards against an out-of-order/stale fetch response overwriting a more
  // recent one's state -- e.g. the user switches the report type and clicks
  // "Run Report" again before the first request resolves; without this, a
  // slower first response landing after a faster second one would silently
  // clobber the correct, more recent result. Bumped at the start of every
  // runReport() call; any resolving fetch whose captured generation no longer
  // matches the latest is dropped instead of touching state.
  const requestGeneration = useRef(0);

  function cancelRun() {
    abortRef.current?.abort();
    abortRef.current = null;
    // Bumping the generation makes any in-flight response a stale one, so a
    // request that resolves after the abort cannot commit state.
    requestGeneration.current += 1;
    setStatus(result === null ? "idle" : "success");
  }

  const runReport = useCallback(async (next: ReportRunParams = run) => {
    // R67 E-11 (R-130): a run the backend would answer 400 to never leaves this
    // function. The primary that would have started it is disabled and says
    // what is missing, so this is a belt-and-braces guard for the programmatic
    // callers (Retry, the catalog's "Open in Project Reports"), not the reader's
    // only protection.
    if (!projectId) return;
    if (missingPrerequisites(next.report, { projectId, weekStart: next.weekStart }).length > 0) return;
    if (weekStartFieldError(next.report, next.weekStart)) return;

    // R67 E-04 (R-079) and binding decision D-02: a report with a screen of
    // its own NAVIGATES; it must not be fetched here. Fetching the Work
    // Progress report from this panel is the 24.3 s spinner that renders
    // nothing, measured in the audit -- the same report renders in 2.7 s with
    // exports at /work-progress?tab=report.
    const destination = reportDestination(next.report, {
      projectId,
      from: next.from,
      to: next.to,
      weekStart: next.weekStart,
      category: next.category,
      vendorId: next.vendorId,
    });
    if (destination.kind === "navigate") {
      router.push(destination.href);
      return;
    }

    // R67 E-09: the URL IS the state, so a run survives navigation, sharing
    // and Back. replace, not push -- a re-run is not a new place.
    router.replace(`?${reportRunSearchParams({ ...next, projectId }).toString()}`, { scroll: false });

    const myGeneration = ++requestGeneration.current;
    const controller = new AbortController();
    abortRef.current = controller;
    // R67 E-10: the 20 s client budget. A request still in flight then is
    // aborted and SAID SO, rather than spinning until the reader gives up.
    const budget = setTimeout(() => controller.abort(new DOMException("budget", "TimeoutError")), RUN_BUDGET_MS);
    setStatus("running");
    setErrorText(null);
    setShareUrl(null);
    try {
      // R67 E-12 (R-136): a report whose own payload does not carry the rows its
      // document prints fetches them ALONGSIDE, in the same run -- Project
      // Status is dashboard scalars, and the table under it is the BOQ's budget
      // line by line. Two sequential runs would put a second spinner in front of
      // a reader who pressed once.
      const breakupReport = BREAKUP_SOURCE_REPORT[next.report];
      const [res, breakupRes] = await Promise.all([
        fetch(destination.path, { signal: controller.signal }),
        breakupReport
          ? fetch(`/api/reports/${breakupReport}?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
          : Promise.resolve(null),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "");
      if (myGeneration !== requestGeneration.current) return; // a newer request has since superseded this one
      // The breakup is the DOCUMENT, not the report: if it fails the figures
      // above it are still true and are still shown, with the table's own empty
      // state saying there are no lines rather than the whole run erroring.
      const breakupBody = breakupRes && breakupRes.ok ? await breakupRes.json() : null;
      // Only a payload that really carries rows becomes the document's rows.
      // Anything else leaves the figures above the table exactly as the report
      // stated them, and the table shows its own empty state.
      const breakup = breakupBody && Array.isArray(breakupBody.lines) ? breakupBody : null;
      setResult(
        breakup
          ? {
              ...data,
              // ROOT lines only, the same rule every BOQ money roll-up in this
              // product follows: a weighted sub-task's amount is derived from
              // its parent, so printing both would show a table that does not
              // add up to its own last row.
              lines: (breakup.lines as { isRootLine?: boolean }[]).filter((l) => l.isRootLine !== false),
              totalBudget: breakup.totalBudget,
            }
          : data
      );
      setRanAt(new Date());
      setStale(false);
      setStatus("success");
      setParametersOpen(false);
    } catch (err) {
      if (myGeneration !== requestGeneration.current) return;
      if (err instanceof DOMException && err.name === "TimeoutError") {
        setErrorText(RUN_TIMEOUT_MESSAGE);
        setStatus("timeout");
        return;
      }
      // An abort is the reader's own decision, not a failure to report back at
      // them.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // D-03: whatever came back, the reader is shown a SENTENCE -- never a
      // code, a parameter name or a host:port.
      setErrorText(taskErrorSentence(err instanceof Error ? err.message : null, "The report service didn't answer"));
      setStatus("error");
    } finally {
      clearTimeout(budget);
      if (myGeneration === requestGeneration.current) abortRef.current = null;
    }
  }, [projectId, router, run]);

  // R67 E-10 (R-129): the report runs ON ARRIVAL with month-to-date
  // parameters. A report that lives on its own screen is the one exception --
  // pushing a reader to another route the instant they open Reports would take
  // the decision away from them, so its own hint and Open Report stay.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || hosted) return;
    // R67 E-11: and not when a prerequisite is missing -- an automatic run into
    // a 400 would put a rose error card in front of a reader who has not yet
    // done anything wrong.
    if (blockedReason) return;
    autoRan.current = true;
    void runReport(initialRun);
    // Deliberately once, on arrival: runReport's identity changes with every
    // parameter edit, and depending on it here would re-run the report on
    // every keystroke in the date fields. The `autoRan` ref is what makes that
    // safe and visible, rather than an omitted dependency nobody can see.
  }, [hosted, initialRun, runReport]);

  function updateRun(patch: Partial<ReportRunParams>) {
    setRun((prev) => ({ ...prev, ...patch }));
  }

  // R67 E-14 (R-132): the Full Catalog's "Open in Project Reports" preselects
  // the report AND runs it. Pressing a card and then having to press Run Report
  // would be the same two-surfaces-one-report confusion in a new shape.
  const handoffNonce = handoff?.nonce ?? null;
  useEffect(() => {
    if (!handoff) return;
    const next = { ...run, report: handoff.slug };
    setRun(next);
    void runReport(next);
    // Deliberately keyed on the nonce alone: `run` changes on every parameter
    // edit, and depending on it here would re-run the handoff on each keystroke.
  }, [handoffNonce]);

  function exportCsv() {
    // The rows ON SCREEN, filters and all -- an exported file that disagrees
    // with the table it came from is worse than no export.
    if (shownResult === null) return;
    const blob = new Blob([reportResultToCsv(shownResult, titleBlock ?? currentLabel)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.report}-${projectId}-${run.from}-to-${run.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function runUrl(): string {
    return `${window.location.origin}${window.location.pathname}?${reportRunSearchParams({ ...run, projectId }).toString()}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(runUrl());
      toast.success("Link copied — it opens this report, with these parameters, for anyone signed in to your organisation.");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  // R67 E-12 (R-136): a REAL public link, minted through compliance-tracker's
  // own signed-link service and only for a report whose public page can render
  // it. Item E-09 could only copy the in-app URL because project-status had no
  // public renderer; it has one now, so this is the link that actually opens for
  // whoever it is sent to.
  async function createShareLink(): Promise<string | null> {
    if (shareUrl) return shareUrl;
    if (!projectId) return null;
    setSharing(true);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(run.report)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, from: run.from, to: run.to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "");
      setShareUrl(data.url);
      return data.url as string;
    } catch (err) {
      toast.error(taskErrorSentence(err instanceof Error ? err.message : null, "Couldn't create the share link"));
      return null;
    } finally {
      setSharing(false);
    }
  }

  async function shareLink() {
    const url = await createShareLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public link copied — it is read-only and expires in 7 days.");
    } catch {
      toast.success(url);
    }
  }

  async function shareOnWhatsApp() {
    const url = (await createShareLink()) ?? runUrl();
    window.open(whatsappHref(titleBlock ?? currentLabel, url), "_blank", "noopener,noreferrer");
  }

  const exportReason = exportDisabledReason({
    hasResult: shownResult !== null,
    serverExport: schema?.serverExport === true,
    tieMessage,
  });
  const shareReason = shareDisabledReason(run.report, shownResult !== null);
  const exportParams = { projectId: projectId ?? "", category: run.category, vendorId: run.vendorId };

  return (
    <div className="space-y-4">
      {/* R67 E-09: the shell's right-pane header actions, with "+ New"
          suppressed -- there is nothing to create here. Every disabled control
          carries its reason in words beside it; none of them is hidden. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setParametersOpen((v) => !v)} data-testid="reports-filter">
          <SlidersHorizontal className="size-4" /> Filter
        </Button>
        {/* R67 E-12 (R-136): Export is SERVER-SIDE. PROJEXA has no PDF or XLSX
            library and must not gain one -- VERIDIAN builds the bytes from the
            same schema this screen renders the table from, so the file and the
            table cannot disagree. Each format is a real link, disabled with its
            reason in words when the document is not exportable. */}
        {(["pdf", "xlsx", "csv"] as const).map((format) => {
          const Icon = format === "pdf" ? FileText : format === "xlsx" ? FileSpreadsheet : Download;
          const label = `Export ${format.toUpperCase()}`;
          // A report with no schema still gets its CSV, built in the browser
          // from the rows on screen (item E-09) -- taking that away would leave
          // fifteen reports with no export at all, which is not a fix.
          if (format === "csv" && schema?.serverExport !== true) {
            return (
              <Button
                key={format}
                variant="outline"
                size="sm"
                disabled={shownResult === null}
                title={shownResult === null ? "Run the report first" : undefined}
                onClick={exportCsv}
                data-testid="reports-export-csv"
              >
                <Icon className="size-4" /> {label}
              </Button>
            );
          }
          return exportReason ? (
            <Button key={format} variant="outline" size="sm" disabled title={exportReason} data-testid={`reports-export-${format}`}>
              <Icon className="size-4" /> {label}
            </Button>
          ) : (
            <Button key={format} variant="outline" size="sm" asChild data-testid={`reports-export-${format}`}>
              <a href={reportExportHref(run.report, format, exportParams)}>
                <Icon className="size-4" /> {label}
              </a>
            </Button>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(shareReason) || sharing}
          title={shareReason ?? undefined}
          onClick={shareLink}
          data-testid="reports-share"
        >
          <Link2 className="size-4" /> Share
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={shownResult === null || sharing}
          onClick={shareOnWhatsApp}
          data-testid="reports-whatsapp"
        >
          <MessageCircle className="size-4" /> Send to WhatsApp
        </Button>
        {/* Every disabled control carries its reason in words beside it, never
            only in a tooltip nobody hovers. */}
        {exportReason && <span className="text-[12px] text-px-muted" data-testid="reports-export-reason">{exportReason}</span>}
        {shareReason && (
          <Button variant="ghost" size="sm" onClick={copyLink} data-testid="reports-copy-link">Copy link instead</Button>
        )}
      </div>

      {unknownReportSlug && (
        <p role="alert" className="text-[12.5px] text-px-error" data-testid="reports-unknown-slug">{UNKNOWN_REPORT_MESSAGE}</p>
      )}

      {parametersOpen && (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            {/* R67 E-11 (R-130): the project is READ-ONLY here and says where it
                is changed. The card used to carry no project at all while the
                top rail carried one, so the two could -- and did -- disagree
                about which project a run described. One source, named. */}
            <p
              className="inline-flex items-center rounded-full border border-px-teal/30 bg-px-teal/10 px-3 py-1 text-[12px] text-px-ink"
              data-testid="reports-project-chip"
            >
              {projectName
                ? `Project: ${projectName} — change in the top rail`
                : "No project selected — choose one in the top rail"}
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Report</Label>
                <Select value={run.report} onValueChange={(v) => updateRun({ report: v })}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>{reports.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-from">From</Label>
                <Input id="report-from" type="date" value={run.from} onChange={(e) => updateRun({ from: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-to">To</Label>
                <Input id="report-to" type="date" value={run.to} onChange={(e) => updateRun({ to: e.target.value })} />
              </div>
              {spec.needsWeekStart && (
                <div className="space-y-1.5">
                  <Label htmlFor="report-week-start">Week Start</Label>
                  <Input
                    id="report-week-start"
                    type="date"
                    value={run.weekStart}
                    aria-invalid={weekStartError !== null}
                    aria-describedby={weekStartError ? "report-week-start-error" : undefined}
                    onChange={(e) => updateRun({ weekStart: e.target.value })}
                  />
                  {/* The message AT the field, where the value was typed -- not
                      in a tooltip and not only on the button. */}
                  {weekStartError && (
                    <p id="report-week-start-error" role="alert" className="text-[12px] text-px-error" data-testid="reports-week-start-error">
                      {weekStartError}
                    </p>
                  )}
                </div>
              )}
              {spec.supportsCategory && (
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={run.category ?? ALL_OPTION_VALUE}
                    onValueChange={(v) => updateRun({ category: v === ALL_OPTION_VALUE ? null : v })}
                  >
                    <SelectTrigger className="w-48" data-testid="reports-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_OPTION_VALUE}>{ALL_OPTION_LABEL}</SelectItem>
                      {categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {spec.supportsVendor && (
                <div className="space-y-1.5">
                  <Label>Vendor</Label>
                  <Select
                    value={run.vendorId ?? ALL_OPTION_VALUE}
                    onValueChange={(v) => updateRun({ vendorId: v === ALL_OPTION_VALUE ? null : v })}
                  >
                    <SelectTrigger className="w-48" data-testid="reports-vendor"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_OPTION_VALUE}>{ALL_OPTION_LABEL}</SelectItem>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{vendorLabel(v)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                onClick={() => runReport()}
                disabled={status === "running" || blockedReason}
                data-testid="reports-run"
              >
                {status === "running" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {/* The primary says what pressing it does -- and, when it cannot
                    be pressed, what is missing. For a report that lives on its
                    own screen, that is opening THAT screen, named. */}
                {runButtonLabel(run.report, missing, hosted)}
              </Button>
            </div>

            {/* One line, under the select, that changes with the selection: a
                report name is a slug until something says what it answers. */}
            {spec.description && (
              <p className="text-[12px] text-px-muted" data-testid="reports-description">{spec.description}</p>
            )}
            {/* Most of these reports take a projectId and nothing else. Saying
                so beats leaving two date fields that quietly do nothing. */}
            {periodNote(currentLabel, spec) && (
              <p className="text-[12px] text-px-muted" data-testid="reports-period-note">{periodNote(currentLabel, spec)}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="space-y-3 p-4">
          {/* R67 E-09: the title block, above the result, naming what this run
              IS -- so a screenshot of it is self-describing. */}
          {titleBlock && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] font-medium text-px-ink" data-testid="reports-title-block">{titleBlock}</p>
              {stale && (
                <span className="rounded-full border border-px-border px-2 py-0.5 text-[11px] text-px-muted" data-testid="reports-stale">
                  More than 5 minutes old — re-run to refresh
                </span>
              )}
            </div>
          )}

          {/* The status is evaluated in ONE order -- running, then timeout,
              then error, then a result, then idle -- so no combination of
              flags can put an idle prompt on screen while a request is in
              flight. */}
          {status === "running" ? (
            <div className="space-y-3">
              <div className="space-y-2 py-4 text-center" data-testid="reports-running">
                <p className="text-sm text-px-ink">{runningLine(currentLabel, projectName)}</p>
                <p className="text-xs text-px-muted">{elapsed} s</p>
                {/* Cancel appears only once the run has outlasted a normal one. */}
                {elapsed * 1000 >= CANCEL_VISIBLE_AFTER_MS && (
                  <Button variant="ghost" size="sm" onClick={cancelRun} data-testid="reports-cancel">Cancel</Button>
                )}
              </div>
              <div className="space-y-2" data-testid="reports-skeleton">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
              {/* The last good result stays visible, dimmed -- a re-run must
                  not blank the screen the reader is still reading. */}
              {shownResult !== null && (
                <div className="opacity-50" data-testid="reports-previous-result">
                  {/* The SAME renderer as the live result -- a dimmed copy that
                      looked different from what it is a copy of would be a
                      second document, not a previous one. */}
                  {run.report === "project-status" && isPlainObject(shownResult) ? (
                    <ProjectStatusCard data={shownResult} format={orgMoney.format} financialsRedacted={shownResult.financialsRedacted === true} />
                  ) : (
                    <ReportOutput data={shownResult} fieldLabels={REPORT_FIELD_LABELS[run.report]} omitKeys={schema ? [schema.rowsKey] : undefined} />
                  )}
                </div>
              )}
            </div>
          ) : status === "timeout" ? (
            <div className="space-y-3 rounded-md border border-px-error-border bg-px-error-light p-4" role="alert" data-testid="reports-timeout">
              <p className="text-sm text-px-error">{RUN_TIMEOUT_MESSAGE}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => runReport()} data-testid="reports-retry">
                  <RotateCcw className="size-4" /> Retry
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/work-progress?tab=report&projectId=${encodeURIComponent(projectId ?? "")}`}>Open Work Progress &gt; Report</Link>
                </Button>
              </div>
            </div>
          ) : status === "error" ? (
            // The BACKEND's own sentence, and a way to try again -- never a
            // generic "could not generate this report" that says nothing about
            // what failed.
            <div className="space-y-3 rounded-md border border-px-error-border bg-px-error-light p-4" role="alert" data-testid="reports-error">
              <p className="text-sm text-px-error">Could not run {currentLabel}: {errorText}</p>
              <Button variant="outline" size="sm" onClick={() => runReport()} data-testid="reports-retry">
                <RotateCcw className="size-4" /> Retry
              </Button>
            </div>
          ) : shownResult !== null ? (
            <>
              {/* A filter that had nothing to bite on is SAID, so an unchanged
                  table never reads as a broken control. */}
              {filterNote && (
                <p className="text-[12px] text-px-muted" data-testid="reports-filter-note">{filterNote}</p>
              )}
              {/* R67 E-13 (R-131/R-138): Project Status has an ORDER, three
                  bands and two figures that need a sentence -- none of which
                  survives ReportOutput's Object.entries. Every other report
                  keeps the generic renderer. */}
              {run.report === "project-status" && isPlainObject(shownResult) ? (
                <ProjectStatusCard
                  data={shownResult}
                  format={orgMoney.format}
                  financialsRedacted={shownResult.financialsRedacted === true}
                />
              ) : (
                <ReportOutput
                  data={shownResult}
                  fieldLabels={REPORT_FIELD_LABELS[run.report]}
                  omitKeys={schema ? [schema.rowsKey] : undefined}
                />
              )}
              {/* R67 E-12 (R-136): the report's own document, rendered from the
                  schema rather than from whatever keys the payload happened to
                  carry -- and from the SAME description the exported file is
                  built from. */}
              {schema && (
                <ReportDocument
                  schema={schema}
                  payload={shownResult}
                  format={orgMoney.format}
                  emptyMessage={
                    run.report === "project-status"
                      ? NO_BUDGET_LINES_MESSAGE
                      : noRowsMessage(dayLabel(run.from), dayLabel(run.to), projectName)
                  }
                  emptyAction={run.report === "project-status" ? { href: "/scope", label: "Open the BOQ screen" } : undefined}
                  onTieMessage={setTieMessage}
                />
              )}
            </>
          ) : !projectId ? (
            // R67 E-09/E-11: the reader is told what to DO, at the control that
            // does it -- the top rail -- with the card above still on screen so
            // they can see what they will get once they have.
            <p className="py-10 text-center text-sm text-px-muted" data-testid="reports-no-project">{NO_PROJECT_MESSAGE}</p>
          ) : hosted ? (
            <p className="py-10 text-center text-sm text-px-muted" data-testid="reports-hosted-hint">
              {currentLabel} runs on its own screen -- press {runButtonLabel(run.report, [], true)}.
            </p>
          ) : (
            <p className="py-10 text-center text-sm text-px-muted">Choose a report above.</p>
          )}
        </CardContent>
      </Card>
      {/* R67 G-05: once, at the foot -- explains the warning glyph on every
          unlabelled figure above, and renders nothing when a currency is set. */}
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}

// Priority 17 follow-on: projectId is now nullable -- the org-wide catalog
// tab does not need one. Only this "Project Reports" tab needs an active
// project; it now shows its own honest empty state instead of the whole
// page refusing to render (see reports/page.tsx).
//
// R46 P8 seq126: registryColumns is resolved server-side in reports/page.tsx
// (compliance.screen_definitions, function_id "reports.report", archetype
// REPORT) and only relabels the report picker -- null/missing is not fatal,
// buildReports() falls back to DEFAULT_REPORT_COLUMNS.
export default function ReportsClient({
  projectId,
  projectName = null,
  registryColumns,
}: {
  projectId: string | null;
  /** R67 E-09: so the title block and the running line can name the project, never its cuid. */
  projectName?: string | null;
  registryColumns?: RegistryColumn[] | null;
}) {
  const reports = buildReports(registryColumns);
  // R67 E-04 / E-09: the WHOLE run is part of the URL, not private React state
  // -- so a link opens on that run, Back restores it, and a run survives
  // navigation. An unknown slug still selects a real report (selecting nothing
  // would be a dead screen) AND says so, rather than silently pretending the
  // reader asked for the default.
  const searchParams = useSearchParams();
  const requested = searchParams.get("report");
  const known = Boolean(requested && reports.some((r) => r.value === requested));
  const initialRun = readReportRunParams(new URLSearchParams(searchParams.toString()), {
    report: known ? requested! : DEFAULT_REPORT_NAME,
    projectId,
  });

  // R67 E-14 (R-132): the Tabs value and the picker's selected slug are OWNED
  // HERE, not one in each tab. They were independent state before, which is how
  // the Full Catalog came to say "Not yet viewable here" about a report its
  // sibling tab was running two clicks away.
  const router = useRouter();
  const [tab, setTab] = useState(projectId ? "project" : "catalog");
  const [handoff, setHandoff] = useState<{ slug: string; nonce: number } | null>(null);

  function openProjectReport(slug: string) {
    // D-02: a report with a screen of its own is NAVIGATED to, from the catalog
    // exactly as from the picker -- one destination per name.
    //
    // R67 E-17 (R-175): through the registry, so the card opens the report in
    // the SAME state the picker would. The defaults are the report's own, and
    // a report that ignores a period is not handed one.
    if (projectId) {
      const destination = registryDestination(slug, { projectId });
      if (destination?.kind === "navigate") {
        router.push(destination.href);
        return;
      }
    }
    setTab("project");
    setHandoff({ slug, nonce: Date.now() });
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="project">Project Reports</TabsTrigger>
        <TabsTrigger value="catalog">Full Catalog</TabsTrigger>
      </TabsList>
      <TabsContent value="project">
        {/* R67 E-11 (R-130): the panel renders WITHOUT a project too. It used to
            be replaced by a sentence, which left the reader a fact and no
            control; now the parameter card is there, the project chip says
            there is no project, and the primary reads "Run Report (select a
            project)" and is disabled -- the same disabled-with-reason pattern
            /labour/new uses. The sentence is still there, in the result area. */}
        <ProjectReportsPanel
          projectId={projectId}
          projectName={projectName}
          reports={reports}
          initialRun={{ ...initialRun, report: known ? initialRun.report : DEFAULT_REPORT_NAME }}
          unknownReportSlug={requested && !known ? requested : null}
          handoff={handoff}
        />
      </TabsContent>
      <TabsContent value="catalog">
        <ReportCatalogSection projectId={projectId} onOpenProjectReport={openProjectReport} />
      </TabsContent>
    </Tabs>
  );
}
