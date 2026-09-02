"use client";

// R46 P8 seq128: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq134 established for
// variations.list (see PermitsListClient.tsx's and ChangeOrdersClient.tsx's
// header comments for the full history). This screen never adopted the
// kit's ListScreen component -- it's a plain shadcn Table -- so only the real
// data columns are registry-driven: COLUMNS is the fallback used when
// documents/page.tsx's server-side resolve of the documents.list
// screen_definitions row returns null (404/error), same "keep the
// hardcoded version behind a flag until verified" contract as permits and
// change-orders.
//
// R67 D-13 (audit R-037/R-038/R-042/R-043). What was wrong: the catch showed a
// toast and then fell through to the SAME branch the empty case renders, so a
// 500 or a 504 from VERIDIAN produced the sentence "No documents found for this
// project." -- a definite claim about the user's data made from a read that
// failed (the standing rule in src/lib/read-outcome.ts). The toast that carried
// the real reason was gone in four seconds; the false claim stayed on screen.
//
// There are now exactly FOUR branches and they are mutually exclusive: loading,
// loadError, zero rows, filtered zero rows. The empty-state wording can no
// longer appear over a failed GET, because loadError is checked first and the
// rows are cleared when it is set.
//
// R67 D-14 (audit R-039/R-044). The header was an unlabelled dropdown and a
// button called "+ Upload" -- a control that named the mechanism, next to a
// control that named nothing. It is now the standard trio every list screen in
// this product shares, in the same order: Filter | Export | + New Document.
// Filter opens a real inline bar (Category, File type, Added between, Relates
// to) with "Showing n of m" beside it; Export serialises exactly the rows on
// screen to CSV and says "Nothing to export" rather than producing an empty
// file.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Filter, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { slowLoadNotice, useElapsedMs } from "@/lib/slow-load";
import { DOCUMENT_CATEGORIES, describeFileSize, relatesToWord } from "@/lib/document-intake";
import { downloadCsv, rowsToCsv } from "@/lib/csv-export";
import DataLoadError from "@/components/DataLoadError";

type Doc = {
  id: string;
  name: string;
  category: string | null;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
  // R67 D-14: what the document is RELATED to, which is no longer always the
  // project it belongs to.
  linkedEntityType: string | null;
  linkedEntityId: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Category", field: "category", type: "text", importance: "High" },
  { label: "Type", field: "fileType", type: "text", importance: "High" },
  { label: "Size", field: "fileSize", type: "number", importance: "High" },
  { label: "Expiry", field: "expiryDate", type: "date", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

/**
 * Not part of the registry's column set -- it is not data the registry
 * describes. Appended when the registry row does not already carry it, the same
 * way DrawingsClient appends its File column.
 */
const RELATES_TO_COLUMN: ScreenColumn = { label: "Relates to", field: "__relatesTo", type: "text", importance: "Medium" };

/** "all" plus the shared list, so the filter and the create screen cannot drift. */
const FILTER_CATEGORIES = ["all", ...DOCUMENT_CATEGORIES];

/** "site photo" -- what a category reads as in a sentence. */
export function categoryWords(category: string): string {
  return category.replace(/_/g, " ");
}

/**
 * R67 D-13. The two empty states, which differ because they mean different
 * things: "you have not filed anything here yet" and "a filter is holding your
 * documents back". Neither is reachable over a failed read -- see the branch
 * order in the component below.
 */
export function emptyStateText(category: string, scopeName: string, otherFiltersActive: boolean = false): string {
  if (category !== "all") return `No ${categoryWords(category)} documents for ${scopeName}.`;
  // R67 D-14: the filter bar can also empty the list without touching Category
  // (a file type, a date range, a Relates to). Saying "No documents yet" then
  // would be the same false claim in a different costume.
  if (otherFiltersActive) return `No documents match this filter for ${scopeName}.`;
  return `No documents yet for ${scopeName}.`;
}

/**
 * R67 D-13. The backend's own words, verbatim, prefixed by what the user was
 * trying to do -- so veridian-client's "did not respond in time, on two
 * attempts" is recognisable across every screen that shows it. The full stop is
 * added only when the message does not already end in punctuation, so a message
 * that ends "Please retry." never renders "Please retry..".
 */
export function documentsLoadErrorText(err: unknown): string {
  const message = errorMessage(err, "Could not load documents");
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export type DocumentFilters = {
  category: string;
  fileType: string;
  addedFrom: string;
  addedTo: string;
  relatesTo: string;
};

export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = {
  category: "all",
  fileType: "",
  addedFrom: "",
  addedTo: "",
  relatesTo: "",
};

/**
 * The client-side half of the filter bar. Category is a backend parameter (it
 * always was); File type, Added between and Relates to are applied here over the
 * rows already in hand, which is also what makes Export honest -- it serialises
 * exactly what these rules leave on screen.
 *
 * Dates are compared as ISO prefixes rather than as Date objects: createdAt is
 * an ISO timestamp and the inputs are yyyy-mm-dd, so a lexical compare is both
 * correct and immune to the reader's time zone (the rule format-date.ts states).
 */
export function applyDocumentFilters(docs: Doc[], filters: DocumentFilters): Doc[] {
  return docs.filter((d) => {
    if (filters.fileType && !(d.fileType ?? "").toLowerCase().includes(filters.fileType.toLowerCase())) return false;
    const addedOn = d.createdAt.slice(0, 10);
    if (filters.addedFrom && addedOn < filters.addedFrom) return false;
    if (filters.addedTo && addedOn > filters.addedTo) return false;
    if (filters.relatesTo && (d.linkedEntityType ?? "") !== filters.relatesTo) return false;
    return true;
  });
}

export function hasActiveFilter(filters: DocumentFilters): boolean {
  return (
    filters.category !== "all" ||
    filters.fileType.trim() !== "" ||
    filters.addedFrom !== "" ||
    filters.addedTo !== "" ||
    filters.relatesTo !== ""
  );
}

/** The distinct file types actually present, so the filter offers real values. */
export function knownFileTypes(docs: Doc[]): string[] {
  return [...new Set(docs.map((d) => d.fileType).filter((t): t is string => !!t && !!t.trim()))].sort();
}

function formatSize(bytes: number | null) {
  if (bytes === null || bytes === undefined) return "—";
  return describeFileSize(bytes);
}

export default function DocumentsClient({
  projectId,
  projectName,
  fellBack,
  projects,
  registryColumns,
}: {
  projectId: string;
  /**
   * R67 D-13: the screen names the project it queried. Resolved server-side in
   * documents/page.tsx, which already had the project in hand and was throwing
   * away everything but its id.
   */
  projectName?: string;
  /** True when no ?projectId was asked for and the org's first project was used. */
  fellBack?: boolean;
  /** For the "Change project" switcher shown when the page fell back. */
  projects?: { id: string; name: string }[];
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DocumentFilters>(EMPTY_DOCUMENT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** id -> "Permit — BP-2026-0142", so the Relates to column never shows a cuid. */
  const [relatedLabels, setRelatedLabels] = useState<Record<string, string>>({});

  const base = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const columns = useMemo(
    () => [...base, ...(base.some((c) => c.field === RELATES_TO_COLUMN.field) ? [] : [RELATES_TO_COLUMN])],
    [base]
  );
  const scopeName = projectName ?? "this project";

  // "Still loading documents from VERIDIAN…" once the read has been running for
  // 3 s -- D-04's budget. A read that is merely slow is not an error, but a
  // screen that says nothing for twenty seconds is not honest either.
  const elapsedMs = useElapsedMs(loading);
  const slowNotice = loading ? slowLoadNotice("Still loading documents from VERIDIAN…", elapsedMs) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // R67 D-14: by project SCOPE, not by "linked to this project" -- a
      // document related to one of this project's permits still belongs here.
      const params = new URLSearchParams({ projectScopeId: projectId });
      if (filters.category !== "all") params.set("category", filters.category);
      const data = await fetchJson<{ documents?: Doc[] }>(`/api/documents?${params.toString()}`);
      setDocs(data.documents ?? []);
      setLoadError(null);
    } catch (err) {
      // Never an empty table where an error belongs: the rows are cleared AND
      // the table is withheld, so "there are none" and "we could not find out"
      // cannot look identical. No toast -- the reason must persist until it is
      // resolved or retried.
      setDocs([]);
      setLoadError(documentsLoadErrorText(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, filters.category]);

  useEffect(() => { void load(); }, [load]);

  // The names behind "Relates to". Three independent reads, each allowed to
  // fail on its own: a permit list that does not answer costs one column's
  // labels (the row still renders "Permit"), never the documents themselves.
  useEffect(() => {
    let cancelled = false;
    const scope = encodeURIComponent(projectId);
    (async () => {
      const [permits, rfis, moms] = await Promise.allSettled([
        fetchJson<{ permits?: { id: string; name: string; permitNumber: string | null }[] }>(`/api/permits?projectId=${scope}&all=true`),
        fetchJson<{ rfis?: { id: string; number: number; subject: string }[] }>(`/api/rfis?projectId=${scope}`),
        fetchJson<{ meetings?: { id: string; title: string }[] }>(`/api/moms?projectId=${scope}`),
      ]);
      if (cancelled) return;
      const labels: Record<string, string> = {};
      if (permits.status === "fulfilled") {
        for (const p of permits.value.permits ?? []) labels[p.id] = p.permitNumber ? `${p.name} (${p.permitNumber})` : p.name;
      }
      if (rfis.status === "fulfilled") {
        for (const r of rfis.value.rfis ?? []) labels[r.id] = `RFI ${r.number} — ${r.subject}`;
      }
      if (moms.status === "fulfilled") {
        for (const m of moms.value.meetings ?? []) labels[m.id] = m.title;
      }
      setRelatedLabels(labels);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const visible = useMemo(() => applyDocumentFilters(docs, filters), [docs, filters]);
  const fileTypes = useMemo(() => knownFileTypes(docs), [docs]);

  /** "Permit — BP-2026-0142", or the type alone until its name resolves. */
  function relatesToText(d: Doc): string {
    if (!d.linkedEntityType) return "—";
    if (d.linkedEntityType === "project") return projectName ? `Project — ${projectName}` : "Project";
    const label = d.linkedEntityId ? relatedLabels[d.linkedEntityId] : undefined;
    return label ? `${relatesToWord(d.linkedEntityType)} — ${label}` : relatesToWord(d.linkedEntityType);
  }

  // Per-field cell renderer -- this screen isn't built on the kit's ListScreen,
  // so unlike PermitsListClient there's no generic column-type-driven renderer
  // to hand columns to. A registry row can still reorder/relabel the data
  // columns live (the hard-stop test); the cell value for each known field is
  // this project's own formatting logic, looked up by field name so reordering
  // does not change what renders.
  function renderDocumentCell(field: string, d: Doc) {
    switch (field) {
      case "name":
        return (
          <span className="flex items-center gap-2 font-medium">
            <FileText className="size-4 text-px-muted" />{d.name}
          </span>
        );
      case "category":
        return d.category ? <Badge variant="outline">{categoryWords(d.category)}</Badge> : <span className="text-px-muted">—</span>;
      case "fileType":
        return <span className="text-px-muted">{d.fileType ?? "—"}</span>;
      case "fileSize":
        return <span className="text-px-muted">{formatSize(d.fileSize)}</span>;
      case "expiryDate":
        return <span className="text-px-muted">{d.expiryDate ? formatDate(d.expiryDate) : "—"}</span>;
      case "createdAt":
        return <span className="text-px-muted">{formatDate(d.createdAt)}</span>;
      case "__relatesTo":
        return <span className="text-px-muted">{relatesToText(d)}</span>;
      default:
        return String((d as unknown as Record<string, unknown>)[field] ?? "—");
    }
  }

  function exportVisible() {
    const csv = rowsToCsv(
      ["Name", "Category", "Type", "Size", "Relates to", "Expiry", "Added"],
      visible.map((d) => [
        d.name,
        d.category ? categoryWords(d.category) : "",
        d.fileType ?? "",
        formatSize(d.fileSize),
        relatesToText(d),
        d.expiryDate ? formatDate(d.expiryDate) : "",
        formatDate(d.createdAt),
      ])
    );
    downloadCsv(`documents-${projectId}.csv`, csv);
  }

  const exportDisabledReason = loading ? "Still loading" : visible.length === 0 ? "Nothing to export" : undefined;
  const filtered = hasActiveFilter(filters);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-px-muted">
          Documents that belong to this project — the ones filed against the project itself and the ones filed against
          one of its permits, RFIs or meetings. The Relates to column says which.
        </p>
        {/* GLOBAL: Filter | Export | + New, same order, every screen. This
            route has no ScreenFrame yet (see D-13's note on the message band),
            so the trio is drawn here rather than by the frame. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ct-border2 px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud"
          >
            <Filter className="size-3.5" aria-hidden />
            Filter
          </button>
          <button
            type="button"
            onClick={exportVisible}
            disabled={!!exportDisabledReason}
            title={exportDisabledReason}
            className="inline-flex items-center gap-1.5 rounded-md border border-ct-border2 px-2.5 py-1.5 text-[13px] text-ct-navy hover:bg-ct-cloud disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <Download className="size-3.5" aria-hidden />
            Export
            {exportDisabledReason && <span className="text-[11px] text-ct-muted">({exportDisabledReason})</span>}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}
            className="inline-flex items-center gap-1.5 rounded-md bg-ct-navy px-2.5 py-1.5 text-[13px] text-white hover:opacity-90"
          >
            <Plus className="size-3.5" aria-hidden />
            New Document
          </button>
        </div>
      </div>

      {/* R67 D-13: when the page fell back to the org's first project, the
          screen says so and offers a real way to change it, rather than showing
          one project's documents under a rail that still reads "All projects". */}
      {fellBack && projectName && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-[12.5px] text-px-muted">
            Showing {projectName} (first project). Choose a project in the top rail to switch.
          </p>
          {projects && projects.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setSwitching((open) => !open)}
                className="text-[12.5px] underline underline-offset-2 text-px-muted hover:text-ct-navy"
              >
                Change project
              </button>
              {switching && (
                <select
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => router.push(`/documents?projectId=${e.target.value}`)}
                  className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
                >
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </>
          )}
        </div>
      )}

      {filterOpen && (
        <div className="flex flex-wrap items-end gap-4 rounded-md border border-ct-border px-4 py-3">
          <div className="space-y-1">
            <label htmlFor="documents-filter-category" className="block text-[12.5px] text-ct-muted">Category</label>
            <select
              id="documents-filter-category"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              {FILTER_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c === "all" ? "All categories" : categoryWords(c)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="documents-filter-filetype" className="block text-[12.5px] text-ct-muted">File type</label>
            <select
              id="documents-filter-filetype"
              value={filters.fileType}
              onChange={(e) => setFilters({ ...filters, fileType: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              <option value="">All</option>
              {fileTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <span className="block text-[12.5px] text-ct-muted">Added between</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Added from"
                value={filters.addedFrom}
                onChange={(e) => setFilters({ ...filters, addedFrom: e.target.value })}
                className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
              />
              <span className="text-[12.5px] text-ct-muted">and</span>
              <input
                type="date"
                aria-label="Added to"
                value={filters.addedTo}
                onChange={(e) => setFilters({ ...filters, addedTo: e.target.value })}
                className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="documents-filter-relates" className="block text-[12.5px] text-ct-muted">Relates to</label>
            <select
              id="documents-filter-relates"
              value={filters.relatesTo}
              onChange={(e) => setFilters({ ...filters, relatesTo: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              <option value="">All</option>
              <option value="project">Project</option>
              <option value="permit">Permit</option>
              <option value="rfi">RFI</option>
              <option value="mom">Minutes of Meeting</option>
            </select>
          </div>
          {filtered && (
            <div className="flex items-center gap-3 pb-1.5">
              <span className="text-[12.5px] text-ct-muted">Showing {visible.length} of {docs.length}</span>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_DOCUMENT_FILTERS)}
                className="text-[12.5px] text-ct-muted underline underline-offset-2 hover:text-ct-navy"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            // Branch 1 -- LOADING. A skeleton carrying the REAL column headers,
            // so the shape of what is coming is already on screen and nothing
            // moves under the reader's cursor when the rows arrive.
            <div aria-busy="true">
              <Table>
                <TableHeader>
                  <TableRow>{columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {[0, 1, 2].map((row) => (
                    <TableRow key={row}>
                      {columns.map((col) => (
                        <TableCell key={col.field}>
                          <span className="block h-3.5 w-24 animate-pulse rounded bg-px-cloud" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {slowNotice && <p className="px-4 pb-4 text-[12.5px] text-px-muted">{slowNotice}</p>}
            </div>
          ) : loadError ? (
            // Branch 2 -- ERROR. The backend's own words, and a Retry that is
            // ignored while a request is already in flight.
            <div role="alert" className="space-y-2 rounded-md border border-px-error-border bg-px-error-light p-4 text-sm text-px-error">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="underline underline-offset-2 disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          ) : visible.length === 0 ? (
            // Branches 3 and 4 -- EMPTY, reachable only after a read that
            // SUCCEEDED, and worded differently depending on whether a filter is
            // holding rows back.
            <p className="py-10 text-center text-sm text-px-muted">
              {emptyStateText(filters.category, scopeName, filtered)}{" "}
              {filtered ? (
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_DOCUMENT_FILTERS)}
                  className="underline underline-offset-2 hover:text-ct-navy"
                >
                  Clear filter
                </button>
              ) : (
                <Link href={`/documents/upload?projectId=${projectId}`} className="underline underline-offset-2 hover:text-ct-navy">
                  + New Document
                </Link>
              )}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no way to view/
                  // download an uploaded file again existed before this).
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/documents/${d.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderDocumentCell(col.field, d)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* The persistent message band this route will have once ScreenFrame is
          adopted here. Until then it is DataLoadError under the card, carrying
          the same backend text and the same Retry, with the error count beside
          it -- so the reason survives after the reader scrolls past the table. */}
      {loadError && (
        <div className="space-y-1.5">
          <p className="text-[12.5px] text-px-error">1 error</p>
          <DataLoadError messages={[loadError]} onRetry={() => void load()} />
        </div>
      )}
    </div>
  );
}
