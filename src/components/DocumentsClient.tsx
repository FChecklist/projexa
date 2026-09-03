"use client";

// R67 MERGE (lane D0 x lane F2). Both lanes rewrote this list's data path:
// lane D0 onto useListRead()/PaneState, lane F2 onto useModuleList()/
// ListScreenFrame. Under decision D-11 the version on main is canonical, so
// useListRead() and PaneState stay and lane F2's two distinct capabilities are
// folded into them rather than duplicated beside them:
//
//   * F-18's SERVER-SEEDED FIRST PAINT. The page fetched these rows already,
//     inside its Suspense boundary; `initial` hands them straight to the hook,
//     which then makes no round trip on first paint. A server-side failure
//     seeds the error state -- never a spinner, never an empty table.
//   * F-18's SHARED COLUMN CONSTANTS. The fallback labels come from
//     src/lib/module-list-columns.ts, the same list the page's loading skeleton
//     draws, so a skeleton head and a table head can no longer disagree.
//
// F-31's machine-readable data-state was folded into PaneState itself, so it
// covers this screen (and every other) without a second wrapper.

// R46 P8 seq128: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq134 established for
// variations.list (see PermitsListClient.tsx's and ChangeOrdersClient.tsx's
// header comments for the full history). This screen never adopted the
// kit's ListScreen component -- it's a plain shadcn Table with its own
// category filter (kept exactly as-is, outside the registry-driven table)
// -- so only the 6 real data columns (Name/Category/Type/Size/Expiry/Added)
// are registry-driven: COLUMNS is now the fallback used when
// documents/page.tsx's server-side resolve of the documents.list
// screen_definitions row returns null (404/error), same "keep the
// hardcoded version behind a flag until verified" contract as permits and
// change-orders.
// R67 D-55 / D-65 -- THE FAULT THIS SCREEN CARRIED. load() caught its
// failure into a TOAST and left `docs` at [], so a 504 produced
//
//     No documents found for this project.
//
// on a project with forty documents, with the only contradiction being a
// notification that faded after four seconds. R-184's words for it: "'No
// documents found for this project.' after a 504". The empty sentence is
// now reachable only through PaneState's mayShowEmptyState(), which takes
// the read's OUTCOME and not the row count.
// R67 D-13/D-14/D-15 (lane D1, folded onto this canonical data layer). Lane D1
// rewrote the same screen against its own fetch loop. Its BRANCHING half is
// already served here -- PaneState's mayShowEmptyState() gates the empty
// sentence on the read's outcome, which is the same rule D-13's four
// mutually-exclusive branches implemented -- so what is folded in is what this
// version did not have:
//
//   * D-14 -- the standard header trio Filter | Export | + New Document, in the
//     order every list screen in this product uses, replacing an unlabelled
//     category dropdown beside a button called "+ Upload" (a control naming the
//     mechanism, next to a control naming nothing). Filter opens a real inline
//     bar (Category, File type, Added between, Relates to) with "Showing n of m"
//     beside it; Export serialises exactly the rows on screen and says
//     "Nothing to export" rather than writing an empty file.
//   * D-14 -- project SCOPE, not "linked directly to this project": a document
//     filed against one of this project's permits still belongs here. The URL
//     below and module-list-source.ts's server prefetch must stay identical or
//     F-18's seeded first paint stops matching.
//   * D-15 -- a "View" word column. The row's only affordance was
//     `cursor: pointer`, which is a shape the mouse takes, not a word, and is
//     invisible to anyone reading the screen rather than hovering it. The
//     whole-row click stays as the fast path.
//   * A "Relates to" column, resolved to real names rather than cuids.
//
// NOT folded in: lane D1's own `fellBack` banner. That fact now lives on the
// page's heading (PageHeading contextNote="auto-selected"), one place instead
// of two, so it is not restated inside the pane.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download, FileText, Filter, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import PaneState from "@/components/PaneState";
import { recordCountLabel } from "@/lib/pane-state";
import { useListRead } from "@/lib/use-list-read";
import { DOCUMENTS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";
import { fetchJson } from "@/lib/fetch-json";
import { DOCUMENT_CATEGORIES, describeFileSize, relatesToWord } from "@/lib/document-intake";
import { downloadCsv, toCsv } from "@/lib/csv-export";

// Exported so documents/page.tsx can type the rows it fetches server-side.
export type Doc = {
  id: string;
  name: string;
  // R67 D-13: nullable. A document filed with no category is a real state and
  // rendering it as an empty Badge (or crashing on .replace) is not.
  category: string | null;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;


/** "all" plus the shared list, so the filter and the create screen cannot drift. */
const CATEGORIES = ["all", ...DOCUMENT_CATEGORIES];

/**
 * Not part of the registry's column set -- it is not data the registry
 * describes. Appended when the registry row does not already carry it, the same
 * way DrawingsClient appends its File column.
 */
const RELATES_TO_COLUMN: ScreenColumn = { label: "Relates to", field: "__relatesTo", type: "text", importance: "Medium" };

/**
 * R67 D-15 (audit R-036). The row's only affordance was `cursor: pointer` -- a
 * shape the mouse takes, which is not a word and is invisible to anyone reading
 * the screen rather than hovering it. The rule in this product is that every
 * action is a word. The whole-row click stays as the fast path.
 */
const VIEW_COLUMN: ScreenColumn = { label: "View", field: "__view", type: "text", importance: "Medium" };

/** "site photo" -- what a category reads as in a sentence. */
export function categoryWords(category: string): string {
  return category.replace(/_/g, " ");
}

/**
 * R67 D-61 (swept at the merge). This was a second, byte-for-byte copy of
 * describeFileSize() -- which this file ALREADY imports for the CSV export, so
 * the table and the export were formatting the same number through two
 * functions that only happened to agree. The shared one wins; this is now the
 * null guard around it.
 *
 * One deliberate behaviour change: a genuinely zero-byte file used to render
 * the en-dash, because `!bytes` cannot tell 0 from null. It now reads "0 B",
 * which is what it is -- the en-dash is reserved for a size we were not told.
 */
function formatSize(bytes: number | null) {
  return bytes === null ? "—" : describeFileSize(bytes);
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
 * R67 D-14. The client-side half of the filter bar. Category is a backend
 * parameter (it always was); File type, Added between and Relates to are applied
 * here over the rows already in hand, which is also what makes Export honest --
 * it serialises exactly what these rules leave on screen.
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

/**
 * R67 D-13. The two empty states, which differ because they mean different
 * things: "you have not filed anything here yet" and "a filter is holding your
 * documents back". Neither is reachable over a failed read -- PaneState's
 * mayShowEmptyState() gates on the read's outcome, not on the row count.
 */
export function emptyStateText(category: string, scopeName: string, otherFiltersActive: boolean = false): string {
  if (category !== "all") return `No ${categoryWords(category)} documents for ${scopeName}.`;
  // R67 D-14: the filter bar can also empty the list without touching Category
  // (a file type, a date range, a Relates to). Saying "No documents yet" then
  // would be the same false claim in a different costume.
  if (otherFiltersActive) return `No documents match this filter for ${scopeName}.`;
  return `No documents yet for ${scopeName}.`;
}

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 6 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderDocumentCell(field: string, d: Doc, relatesTo: (d: Doc) => string) {
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
      return <span className="text-px-muted">{relatesTo(d)}</span>;
    case "__view":
      // R67 D-15. stopPropagation so the word and the row are one navigation,
      // not two.
      return (
        <Link
          href={`/documents/${d.id}`}
          onClick={(e) => e.stopPropagation()}
          className="underline underline-offset-2"
        >
          View
        </Link>
      );
    default: {
      // R67 D-15: an empty value is an en dash on every column, never the
      // literal "null" and never a default that looks like real data.
      const value = (d as unknown as Record<string, unknown>)[field];
      return value === null || value === undefined || value === "" ? "—" : String(value);
    }
  }
}

export default function DocumentsClient({
  projectId,
  projectName,
  registryColumns,
  initial = null,
}: {
  projectId: string;
  projectName?: string | null;
  registryColumns?: RegistryColumn[] | null;
  /**
   * R67 F-18: what documents/page.tsx already fetched on the server for this
   * project. Present, the hook starts ANSWERED and makes no round trip on
   * first paint; a server-side failure starts it in the error state, never on
   * a spinner and never on an empty table. Only the first url is seeded, so a
   * project switch or a filter change still reads normally.
   */
  initial?: ModuleListInitial<Doc>;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<DocumentFilters>(EMPTY_DOCUMENT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  /** id -> "Permit — BP-2026-0142", so the Relates to column never shows a cuid. */
  const [relatedLabels, setRelatedLabels] = useState<Record<string, string>>({});

  const base = registryColumns && registryColumns.length > 0 ? registryColumns : DOCUMENTS_LIST_COLUMNS;
  // R67 D-14/D-15: two columns the registry does not describe, appended when
  // the registry row does not already carry them. "View" is always last -- it
  // is the row's own affordance, not data about it.
  const columns = useMemo(
    () => [
      ...base,
      ...(base.some((c) => c.field === RELATES_TO_COLUMN.field) ? [] : [RELATES_TO_COLUMN]),
      ...(base.some((c) => c.field === VIEW_COLUMN.field) ? [] : [VIEW_COLUMN]),
    ],
    [base]
  );
  const scopeName = projectName ?? "this project";

  const url = useMemo(() => {
    // R67 D-14: by project SCOPE, not "linked directly to this project". This
    // MUST stay identical to module-list-source.ts's fetchDocumentsList URL or
    // the server-seeded `initial` stops matching and F-18's zero-round-trip
    // first paint is silently lost.
    const params = new URLSearchParams({ projectScopeId: projectId });
    if (filters.category !== "all") params.set("category", filters.category);
    return `/api/documents?${params.toString()}`;
  }, [projectId, filters.category]);

  const read = useListRead<Doc>({
    url,
    select: (body) => (body as { documents?: Doc[] })?.documents,
    // The page prefetches the DEFAULT ("all categories") read only; changing
    // the category is exactly the case that should go to the network.
    initial,
  });
  const docs = read.rows;

  // R67 D-14. The names behind "Relates to". Three independent reads, each
  // allowed to fail on its own: a permit list that does not answer costs one
  // column's labels (the row still renders "Permit"), never the documents.
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
  const filtered = hasActiveFilter(filters);

  /** "Permit — BP-2026-0142", or the type alone until its name resolves. */
  function relatesToText(d: Doc): string {
    if (!d.linkedEntityType) return "—";
    if (d.linkedEntityType === "project") return projectName ? `Project — ${projectName}` : "Project";
    const label = d.linkedEntityId ? relatedLabels[d.linkedEntityId] : undefined;
    return label ? `${relatesToWord(d.linkedEntityType)} — ${label}` : relatesToWord(d.linkedEntityType);
  }

  function exportVisible() {
    const csv = toCsv(
      ["Name", "Category", "Type", "Size", "Relates to", "Expiry", "Added"],
      visible.map((d) => [
        d.name,
        d.category ? categoryWords(d.category) : "",
        d.fileType ?? "",
        // R67 D-13: fileSize is nullable on the wire, and describeFileSize()
        // takes a real number. An unknown size exports as blank -- never "0 B",
        // which is a measurement nobody made.
        d.fileSize === null ? "" : describeFileSize(d.fileSize),
        relatesToText(d),
        d.expiryDate ? formatDate(d.expiryDate) : "",
        formatDate(d.createdAt),
      ])
    );
    downloadCsv(`documents-${projectId}.csv`, csv);
  }

  const exportDisabledReason =
    read.status === "loading" ? "Still loading" : visible.length === 0 ? "Nothing to export" : undefined;

  // A filtered read that comes back empty is NOT "this project has no
  // documents" -- it is "no permits, in this project". Saying the first over
  // the second is how a user concludes the upload never landed.
  const emptyMessage = emptyStateText(filters.category, scopeName, filtered);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-px-muted">
          Documents that belong to this project — the ones filed against the project itself and the ones filed against
          one of its permits, RFIs or meetings. The Relates to column says which.
        </p>
        {/* R67 D-14. GLOBAL: Filter | Export | + New, same order, every screen.
            This replaces an unlabelled category dropdown beside a button called
            "+ Upload" -- a control naming the mechanism, next to one naming
            nothing. */}
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
          <Button size="sm" onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}>
            <Plus className="size-4" /> New Document
          </Button>
        </div>
      </div>

      {filterOpen && (
        <div className="flex flex-wrap items-end gap-4 rounded-md border border-ct-border px-4 py-3">
          <div className="space-y-1">
            <label htmlFor="documents-filter-category" className="block text-[12.5px] text-ct-muted">Category</label>
            <Select
              value={filters.category}
              onValueChange={(value) => setFilters({ ...filters, category: value })}
            >
              <SelectTrigger id="documents-filter-category" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c === "all" ? "All categories" : categoryWords(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <p className="px-1 text-[12px] text-px-muted">{recordCountLabel(read.status, visible.length)}</p>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <PaneState
            status={read.status}
            entity="documents"
            projectName={projectName}
            startedAt={read.startedAt}
            error={read.error}
            rowCount={visible.length}
            skeletonColumns={columns.map((col) => col.label)}
            emptyMessage={emptyMessage}
            emptyAction={
              // R67 D-14: when a FILTER is what emptied the list, the way out is
              // to clear it, not to file another document.
              filtered ? (
                <Button size="sm" variant="outline" onClick={() => setFilters(EMPTY_DOCUMENT_FILTERS)}>
                  Clear filter
                </Button>
              ) : (
                <Button size="sm" onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}>
                  <Plus className="size-4" /> New Document
                </Button>
              )
            }
            lastLoadedAt={read.loadedAt}
            onRetry={read.reload}
          >
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
                  // R67 D-15: the row click is the FAST path; the "View" column
                  // is the word that says so out loud.
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/documents/${d.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderDocumentCell(col.field, d, relatesToText)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PaneState>
        </CardContent>
      </Card>
    </div>
  );
}
