"use client";

// PROJEXA Reports and Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16). Org-scoped browsing/search/run
// surface over VERIDIAN full report_definitions + static catalog
// (getFullReportCatalog(), report-engine-service.ts) -- the ~230-entry
// catalog compliance-tracker own #375 already exposed on its internal
// /reports page, ported here via the new GET /api/reports/catalog proxy.
// Deliberately a SEPARATE section from the existing fixed 17-report list
// above it (ReportsClient.tsx) rather than a replacement -- the fixed list
// is project-scoped construction reports (needs an active project), this
// section is org-wide catalog browsing that works with or without one.
//
// Two entry sources, mirroring compliance-tracker ReportCatalogList.tsx:
//  - "static"     -- one of the 26 pre-Priority-11 hand-catalogued report
//                     services (ERP financials, the 17 construction reports
//                     already covered by the fixed list above, 4 cron-only
//                     AI-ops reports, 1 custom-report section). Every one of
//                     these has a REAL route, but it is a compliance-tracker
//                     URL (session-auth pages like /erp/reports, or a
//                     cron-secret-gated internal endpoint) -- PROJEXA has no
//                     session there, so these are shown as read-only info
//                     cards (name/description/where it runs), never a
//                     clickable cross-app link that would just 401. Honest
//                     "not yet viewable here" state, not a broken click.
//  - "definition" -- a real report_definitions row, runnable end-to-end via
//                     ReportCatalogRunner.tsx, which POSTs to the pre-
//                     existing /api/reports/definitions/[id]/run proxy.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileBarChart, Play, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportCatalogRunner } from "@/components/ReportCatalogRunner";
import type { Company } from "@/components/company-scope";
// R67 E-04 (R-079): the ONE place that says where a report name goes -- shared
// with the Project Reports picker, so the two tabs cannot drift apart again.
import { catalogDestination, catalogSlug, monthToDate } from "@/lib/report-destinations";

/**
 * R67 E-14 (R-132 / R-139): what a card says about a report PROJEXA genuinely
 * cannot render. "Not yet viewable here" said nothing about where it CAN be
 * read; this names the surface.
 */
export const NOT_AVAILABLE_HERE = "Not available in PROJEXA yet — runs on the VERIDIAN dashboard";

/** The badge on an entry the Reports and Analysis Engine runs inside PROJEXA. */
export const RUNS_HERE_BADGE = "Runs here";

/** The button that hands a catalog entry to the sibling tab that can really run it. */
export const OPEN_IN_PROJECT_REPORTS = "Open in Project Reports";

type ReportDomain = "compliance" | "ERP" | "construction" | "AI-ops" | "custom";

// Mirrors report-engine-service.ts FullCatalogEntry -- a type-only local
// copy (same reasoning as compliance-tracker own ReportCatalogList.tsx:
// this is a client component, the real server type lives in a DB-touching
// file that must never be imported into browser code).
type FullCatalogEntry = {
  id: string;
  name: string;
  description: string;
  domain: ReportDomain;
  route: string;
  routeNote: string;
  directlyNavigable: boolean;
  source: "static" | "definition";
  definitionId?: string;
  status?: "built" | "data_gap" | "planned";
  supportsCompanyScope?: boolean;
};

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  compliance: "Compliance",
  ERP: "ERP / Finance",
  construction: "Construction (PROJEXA)",
  "AI-ops": "AI Ops",
  custom: "Custom Reports",
};

const DOMAIN_ORDER: ReportDomain[] = ["construction", "ERP", "compliance", "custom", "AI-ops"];

const STATUS_FILTERS = ["all", "built", "data_gap", "planned"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  built: "Built",
  data_gap: "Data Gap",
  planned: "Planned",
};

function StatusBadge({ status }: { status?: "built" | "data_gap" | "planned" }) {
  if (!status || status === "built") return null;
  return (
    <Badge variant="outline" className={`text-[10px] shrink-0 ${status === "data_gap" ? "border-amber-400 text-amber-700" : "border-slate-400 text-slate-600"}`}>
      {status === "data_gap" ? "Data Gap" : "Planned"}
    </Badge>
  );
}

function CatalogCard({
  entry,
  companies,
  projectId,
  pickerSlugs,
  onOpenProjectReport,
}: {
  entry: FullCatalogEntry;
  companies: Company[];
  projectId: string | null;
  /**
   * R67 E-14: the slugs the sibling Project Reports tab really knows how to run.
   * Passed down rather than imported so there is ONE list, owned by the screen
   * that owns the picker -- which is what stops the two tabs contradicting each
   * other about the same report.
   */
  pickerSlugs: ReadonlySet<string>;
  onOpenProjectReport?: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // R67 E-04 (R-079): "the Full Catalog says 'Not yet viewable here'" was the
  // third of three contradicting answers to "where is my Work Progress
  // Report?" -- said about a report the reader can run in 2.7 s one tab away.
  // A card whose route resolves to a PROJEXA screen now says so and offers the
  // way in. Everything else keeps the honest "runs on VERIDIAN's dashboard"
  // note, because claiming a screen for a report that has none is the same
  // defect facing the other way.
  //
  // Needs a project: these are project-scoped construction reports, and a link
  // without one would land on a screen that cannot answer.
  const period = monthToDate();
  const hosted = projectId ? catalogDestination(entry.route, { projectId, from: period.from, to: period.to }) : null;
  // R67 E-14 (R-132): the picker's slug is the LAST SEGMENT of the entry's own
  // route -- "/api/construction/reports/attendance" is the same report the
  // picker calls "attendance". Deriving it is what lets a card and a picker
  // entry agree about one report instead of being two independent lists.
  const slug = catalogSlug(entry.route);
  const inPicker = Boolean(slug && !hosted && projectId && pickerSlugs.has(slug) && onOpenProjectReport);

  return (
    <div className="rounded-lg border border-px-border p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-px-ink">{entry.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={entry.status} />
          {hosted && (
            <Badge variant="secondary" className="text-[10px] bg-px-teal/10 text-px-teal border-px-teal/30" data-testid="catalog-runs-here">
              {hosted.label}
            </Badge>
          )}
          {/* R67 E-14 (R-139): "Engine" named the machinery, not the fact the
              reader needs. This is the same badge the hosted cards carry, so
              "it runs here" reads the same way wherever it is true. */}
          {(inPicker || (!hosted && entry.source === "definition")) && (
            <Badge variant="secondary" className="text-[10px] bg-px-teal/10 text-px-teal border-px-teal/30" data-testid="catalog-engine-badge">
              {RUNS_HERE_BADGE}
            </Badge>
          )}
        </div>
      </div>
      <p className="text-xs text-px-muted mb-1.5">{entry.description}</p>

      {hosted ? (
        <Link href={hosted.href} className="inline-flex items-center gap-1 text-xs font-medium text-px-teal hover:text-px-ink" data-testid="catalog-open-link">
          <ExternalLink className="size-3.5" /> Open
        </Link>
      ) : inPicker ? (
        // R-132: the card used to carry "Not yet viewable here" about a report
        // its own sibling tab runs. It now hands the reader across, preselected
        // and running, rather than telling them it cannot be read.
        <Button
          size="sm"
          className="h-7 bg-px-teal text-white hover:bg-px-teal/90"
          onClick={() => onOpenProjectReport!(slug!)}
          data-testid="catalog-open-in-project-reports"
        >
          <Play className="size-3.5" /> {OPEN_IN_PROJECT_REPORTS}
        </Button>
      ) : entry.source === "static" ? (
        <p className="text-[10.5px] text-px-muted/80" data-testid="catalog-not-available">
          {NOT_AVAILABLE_HERE} ({entry.route}).
        </p>
      ) : (
        <>
          {/* R-139: the standard primary, not a text link that looks like prose. */}
          <Button variant="outline" size="sm" className="h-7" onClick={() => setExpanded((v) => !v)} data-testid="catalog-run-report">
            {expanded ? "Hide" : (<><Play className="size-3.5" /> Run Report</>)}
          </Button>
          {expanded && entry.definitionId && (
            <ReportCatalogRunner
              definitionId={entry.definitionId}
              supportsCompanyScope={Boolean(entry.supportsCompanyScope)}
              companies={companies}
            />
          )}
        </>
      )}
    </div>
  );
}

// R67 E-04: the catalog needs the selected project so a "Runs here" card can
// link somewhere that can actually answer. Optional, so a caller with no
// project still renders every card -- just without the shortcut.
export function ReportCatalogSection({
  projectId = null,
  pickerSlugs,
  onOpenProjectReport,
}: {
  projectId?: string | null;
  /** R67 E-14: the sibling tab's real slug list, owned by ReportsClient. */
  pickerSlugs?: ReadonlySet<string>;
  onOpenProjectReport?: (slug: string) => void;
} = {}) {
  const slugs = pickerSlugs ?? new Set<string>();
  const [catalog, setCatalog] = useState<FullCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    // R46 F_028 hardening: this route's default tab (no active project --
    // see reports/page.tsx/ReportsClient.tsx's own header comments) fires
    // these two fetches unconditionally, unlike every sibling project-scoped
    // page which mounts no client component at all once resolveSelectedProject
    // has already failed server-side. Both proxy routes (api/reports/catalog,
    // api/companies) already catch their own VERIDIAN error and return a
    // non-2xx JSON error body (see their route.ts files) rather than throwing,
    // so `fetch()` itself never rejects on a VERIDIAN timeout -- checking
    // `res.ok` here (matching ProjectSwitcher.tsx's identical pattern for the
    // same underlying VERIDIAN call) treats that error body as an error
    // immediately, instead of relying solely on shape-sniffing a `catalog`/
    // `companies` key that a genuinely malformed or future response shape
    // might satisfy by accident. `cancelled` avoids committing either fetch's
    // result after this component has unmounted (e.g. the user switched back
    // to the "Project Reports" tab before either resolved).
    fetch("/api/reports/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog fetch failed (${r.status})`))))
      .then((d) => {
        if (cancelled) return;
        if (!Array.isArray(d.catalog)) { setLoadError(true); setCatalog([]); return; }
        setCatalog(d.catalog);
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setCatalog([]); } });
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`companies fetch failed (${r.status})`))))
      .then((d) => { if (!cancelled) setCompanies(Array.isArray(d.companies) ? d.companies : []); })
      .catch(() => { if (!cancelled) setCompanies([]); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => {
      if (statusFilter !== "all" && (e.status ?? "built") !== statusFilter) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog, search, statusFilter]);

  // R46 F_028 real root cause (confirmed live against production, 2026-08-25:
  // this exact line threw "Cannot read properties of undefined (reading
  // 'push')" on a real click of the Full Catalog tab, which is the crash
  // F_028 describes -- caught by reports/error.tsx's new boundary instead of
  // taking down the whole page, but the actual bug is right here). `entry`
  // is real JSON from VERIDIAN's own /reports/catalog response (see
  // api/reports/catalog/route.ts), cast to the `FullCatalogEntry` type at
  // the type level only -- TypeScript's `ReportDomain` union is never
  // enforced at runtime, so a `domain` value VERIDIAN returns that isn't one
  // of this UI's 5 known buckets (a new catalog domain added upstream,
  // malformed data, anything) makes `grouped[entry.domain]` undefined, and
  // `.push()` on that throws. Guarding the lookup means an unrecognized
  // domain's entries are dropped from this grouped-by-domain view (they
  // still count toward definitionCount/runnableHereCount above) instead of
  // crashing the page -- the honest fix, not a blanket try/catch.
  const byDomain = useMemo(() => {
    const grouped: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] };
    for (const entry of filtered) {
      const bucket = grouped[entry.domain];
      if (bucket) bucket.push(entry);
    }
    return grouped;
  }, [filtered]);

  const definitionCount = catalog?.filter((e) => e.source === "definition").length ?? 0;
  const runnableHereCount = catalog?.filter((e) => e.source === "definition" && (e.status ?? "built") === "built").length ?? 0;

  // R67 E-14 (R-132): a fit-out contractor opened this tab and was handed 264
  // cards, most of them about an ERP they do not use. Construction is the
  // default and the rest is one closed disclosure -- counted from the real
  // catalog, never a number typed into a sentence.
  const constructionEntries = catalog?.filter((e) => e.domain === "construction") ?? [];
  const runHereCount = constructionEntries.filter((e) => {
    const slug = catalogSlug(e.route);
    return Boolean(slug && slugs.has(slug));
  }).length;
  const otherDomainCount = (catalog?.length ?? 0) - constructionEntries.length;
  const otherDomains = DOMAIN_ORDER.filter((d) => d !== "construction" && byDomain[d].length > 0);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-px-ink flex items-center gap-2">
          <FileBarChart className="size-4 text-px-teal" />
          Full Report and Analysis Catalog
        </CardTitle>
        {/* R67 E-14 (R-132): the sentence a fit-out contractor needs, in their
            own terms -- how many construction reports there are and how many of
            them run here with their project -- rather than a platform-wide
            count of an engine they never think about. Every number is counted
            from the real catalog. */}
        <p className="text-xs text-px-muted" data-testid="catalog-header-sentence">
          {catalog === null
            ? "Loading the full catalog..."
            : loadError
              ? "Could not load the catalog from VERIDIAN -- try again shortly."
              : `${constructionEntries.length} construction reports — ${runHereCount} run here with your project; the rest run on the VERIDIAN dashboard.`}
        </p>
        {catalog !== null && !loadError && (
          <p className="text-[11px] text-px-muted/80">
            {`Beyond construction, ${otherDomainCount} platform reports — ${runnableHereCount} of ${definitionCount} of them run live here through the Reports and Analysis Engine.`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-px-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports and analyses..."
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="flex gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  statusFilter === s ? "bg-px-ink text-white border-px-ink" : "border-px-border text-px-muted hover:bg-muted/50"
                }`}
              >
                {STATUS_FILTER_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {catalog === null && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {catalog !== null && filtered.length === 0 && (
          <p className="text-sm text-px-muted py-6 text-center">No reports or analyses match this search and filter.</p>
        )}
        {/* Construction first and open, because that is what this product is. */}
        {byDomain.construction.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-px-muted uppercase tracking-wide mb-2">
              {DOMAIN_LABELS.construction} ({byDomain.construction.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byDomain.construction.map((entry) => (
                <CatalogCard
                  key={`${entry.source}-${entry.id}`}
                  entry={entry}
                  companies={companies}
                  projectId={projectId}
                  pickerSlugs={slugs}
                  onOpenProjectReport={onOpenProjectReport}
                />
              ))}
            </div>
          </div>
        )}
        {/* ...and everything else behind ONE closed disclosure, so the rest of
            the platform is reachable without being handed to someone who came
            for a BOQ. */}
        {otherDomains.length > 0 && (
          <details data-testid="catalog-other-domains">
            <summary className="cursor-pointer text-xs font-semibold text-px-muted uppercase tracking-wide">
              Other platform reports ({otherDomains.reduce((n, d) => n + byDomain[d].length, 0)})
            </summary>
            <div className="space-y-5 pt-3">
              {otherDomains.map((domain) => (
                <div key={domain}>
                  <p className="text-xs font-semibold text-px-muted uppercase tracking-wide mb-2">
                    {DOMAIN_LABELS[domain]} ({byDomain[domain].length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {byDomain[domain].map((entry) => (
                      <CatalogCard
                        key={`${entry.source}-${entry.id}`}
                        entry={entry}
                        companies={companies}
                        projectId={projectId}
                        pickerSlugs={slugs}
                        onOpenProjectReport={onOpenProjectReport}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
