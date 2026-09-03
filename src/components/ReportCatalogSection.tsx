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
import { FileBarChart, Search } from "lucide-react";
import { placeCatalogEntry } from "@/lib/report-registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportCatalogRunner } from "@/components/ReportCatalogRunner";
import type { Company } from "@/components/company-scope";

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

// R67 E-22 (R-224). WHAT THIS REPLACED, and why it was wrong.
//
// Every non-definition card carried one blanket sentence: "Runs on VERIDIAN
// own dashboard (<route>) -- not yet renderable inside PROJEXA, shown for
// visibility only." That sentence was FALSE for seventeen of these cards.
// Every entry whose id starts with "construction-" is one of the reports the
// Project Reports tab on this very screen already runs. The catalog was
// telling the reader they could not see a report that was one tab away.
//
// The card now states which of three things is true, from
// src/lib/report-registry.ts: "Runs here" with an Open action,
// "Runs in VERIDIAN - open there" with the link, or "Not built - data gap"
// with the reason. No card is a dead end and none of them overstates.
function CatalogCard({ entry, companies }: { entry: FullCatalogEntry; companies: Company[] }) {
  const [expanded, setExpanded] = useState(false);
  const placement = placeCatalogEntry(entry);

  return (
    <div className="rounded-lg border border-px-border p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-px-ink">{entry.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={entry.status} />
          <Badge
            variant="secondary"
            className={`text-[10px] ${placement.availability === "runs-here" ? "bg-px-teal/10 text-px-teal border-px-teal/30" : ""}`}
          >
            {placement.label}
          </Badge>
        </div>
      </div>
      <p className="text-xs text-px-muted mb-1.5">{entry.description}</p>

      {placement.runsInPlace ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-px-teal hover:text-px-ink transition-colors"
          >
            {expanded ? "Hide" : placement.action}
          </button>
          {expanded && entry.definitionId && (
            <ReportCatalogRunner
              definitionId={entry.definitionId}
              supportsCompanyScope={Boolean(entry.supportsCompanyScope)}
              companies={companies}
            />
          )}
        </>
      ) : placement.href && placement.availability === "runs-here" ? (
        <Link href={placement.href} className="text-xs font-medium text-px-teal hover:text-px-ink transition-colors">
          {placement.action} →
        </Link>
      ) : placement.href ? (
        // A VERIDIAN route is a different app the reader has no session in,
        // so it is stated as such rather than dressed up as an in-app link.
        <p className="text-[10.5px] text-px-muted/80">
          {placement.action}: <span className="font-mono">{placement.href}</span>
        </p>
      ) : (
        <p className="text-[10.5px] text-px-muted/80">{placement.note}</p>
      )}
    </div>
  );
}

export function ReportCatalogSection() {
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

  // R67 E-22: counted from the SAME placement function the cards render, so
  // the headline number and the badges can never disagree. It used to count
  // only report_definitions rows, which is why it under-reported by the
  // seventeen construction reports this app has always been able to run.
  const placements = useMemo(() => (catalog ?? []).map((e) => placeCatalogEntry(e)), [catalog]);
  const runnableHereCount = placements.filter((p) => p.availability === "runs-here").length;
  const veridianCount = placements.filter((p) => p.availability === "runs-in-veridian").length;
  const notBuiltCount = placements.filter((p) => p.availability === "not-built").length;

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-px-ink flex items-center gap-2">
          <FileBarChart className="size-4 text-px-teal" />
          Full Report and Analysis Catalog
        </CardTitle>
        <p className="text-xs text-px-muted">
          {catalog === null
            ? "Loading the full catalog..."
            : loadError
              ? "Could not load the catalog from VERIDIAN -- try again shortly."
              : `${catalog.length} report/analysis types across the platform -- ${runnableHereCount} run here, ${veridianCount} run in VERIDIAN, ${notBuiltCount} are not built yet. Every card says which it is.`}
        </p>
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
        {DOMAIN_ORDER.filter((domain) => byDomain[domain].length > 0).map((domain) => (
          <div key={domain}>
            <p className="text-xs font-semibold text-px-muted uppercase tracking-wide mb-2">
              {DOMAIN_LABELS[domain]} ({byDomain[domain].length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byDomain[domain].map((entry) => (
                <CatalogCard key={`${entry.source}-${entry.id}`} entry={entry} companies={companies} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
