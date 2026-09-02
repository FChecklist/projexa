"use client";

// Wave 143 (Drawings & 3D module): DWG file uploads + 3D walkthrough
// files/links, per project -- documents rows with category='drawing' |
// 'drawing_3d'.
//
// R67 D-10 (audit R-028/R-033). The landing used to show two equal-weight
// buttons -- one containing the words "3D Walkthrough", one opening a form
// whose Kind field ALSO offers "3D Walkthrough" -- so the screen asked the
// user to choose between two doors to the same thing without saying how they
// differed. It is now the standard bar every list screen in this product
// shares, in the same order: Filter | Export | + New (the frame draws the
// plus, so the label is the plain word "New" -- C01-13). The 3D builder is a
// TAB, not a rival primary action, and it carries the one line that says what
// it is for.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ListScreen,
  ScreenFrame,
  type FieldMessage,
  type ScreenColumn,
} from "@fchecklist/veridian-ui-kit/screens";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";
import { readListFilters, writeListFilters } from "@/lib/list-view-state";
import { takeScreenMessage } from "@/lib/screen-message";
import { statusPresentation } from "@/lib/drawing-status";
import DataLoadError from "@/components/DataLoadError";

type Drawing = {
  id: string;
  name: string;
  kind: "dwg" | "3d_walkthrough";
  discipline: string | null;
  isExternalLink: boolean;
  documentUrl: string | null;
  createdAt: string;
  // R67 D-12: the four fields that answer "is this the one I build from?".
  drawingNo: string | null;
  rev: string | null;
  status: string;
  supersedesId: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// intentionally the same fields as ScreenColumn (R46 P8 seq127, same
// pattern as PermitsListClient.tsx / R43 seq2).
export type RegistryColumn = ScreenColumn;

const FUNCTION_ID = "drawings.list";

// Fallback only: page.tsx prefers the compliance.screen_definitions row for
// drawings.list when one exists.
// R67 D-12: Name | Drawing No. | Rev | Kind | Discipline | Status | Added --
// seven High columns, which is exactly the M28 cap ListScreen enforces. The
// registry row carrying the same set for databases that have one ships as
// drizzle/0528_r67_drawings_list_columns.sql in compliance-tracker.
const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Drawing No.", field: "drawingNo", type: "text", importance: "High" },
  { label: "Rev", field: "rev", type: "text", importance: "High" },
  { label: "Kind", field: "kind", type: "text", importance: "High" },
  { label: "Discipline", field: "discipline", type: "text", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

// Not part of the registry's column set: this is not data the registry
// describes, it is how a row says what it can do. Medium importance because
// ListScreen caps High columns at 7 and silently drops the overflow.
const FILE_COLUMN: ScreenColumn = { label: "File", field: "__file", type: "text", importance: "Medium" };

export type DrawingFilters = { kind: string; discipline: string; status: string };

/**
 * R67 D-12: "Current only" is ON by default, so the register opens on the build
 * set -- the drawings people are actually building from -- rather than on every
 * revision ever uploaded. It is a removable chip, and "Showing n of m" beside it
 * says how many rows it is holding back, so nothing is hidden silently.
 */
export const DEFAULT_FILTERS: DrawingFilters = { kind: "", discipline: "", status: "current" };

export const EMPTY_FILTERS: DrawingFilters = { kind: "", discipline: "", status: "" };

/** The Kind filter's options, in the register's own vocabulary. */
export const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "dwg", label: "DWG" },
  { value: "3d_walkthrough", label: "3D Walkthrough" },
];

export function hasActiveFilter(filters: DrawingFilters): boolean {
  return filters.kind !== "" || filters.discipline.trim() !== "" || filters.status !== "";
}

/** The query string the list and the export both use -- one filter, two calls. */
export function drawingQuery(projectId: string, filters: DrawingFilters): string {
  const params = new URLSearchParams({ projectId });
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.discipline.trim()) params.set("discipline", filters.discipline.trim());
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

/** "Kind: DWG" / "Discipline: MEP" -- what the removable chips say. */
export function activeFilterChips(filters: DrawingFilters): { key: keyof DrawingFilters; label: string }[] {
  const chips: { key: keyof DrawingFilters; label: string }[] = [];
  if (filters.kind) {
    chips.push({
      key: "kind",
      label: `Kind: ${KIND_OPTIONS.find((o) => o.value === filters.kind)?.label ?? filters.kind}`,
    });
  }
  if (filters.discipline.trim()) chips.push({ key: "discipline", label: `Discipline: ${filters.discipline.trim()}` });
  if (filters.status === "current") chips.push({ key: "status", label: "Current only" });
  else if (filters.status) chips.push({ key: "status", label: `Status: ${filters.status}` });
  return chips;
}

export default function DrawingsClient({
  projectId,
  projectName,
  fellBack,
  registryColumns,
}: {
  projectId: string;
  /** D-07's rule, applied here too: a screen names the project it queried. */
  projectName?: string;
  fellBack?: boolean;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const base = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const columns = [...base, ...(base.some((c) => c.field === FILE_COLUMN.field) ? [] : [FILE_COLUMN])];

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DrawingFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [knownDisciplines, setKnownDisciplines] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  // R67 D-11: the receipt handed over by a Remove or a Dispose on the object
  // page ("AR-101 Rev B removed"). A persistent message in this screen's own
  // band, read once, never a toast.
  useEffect(() => {
    const handed = takeScreenMessage("drawings.list");
    if (handed) setMessages([handed]);
  }, []);

  // Back restores the filters. Read AFTER mount, never during render: the
  // server has no sessionStorage, so reading it in the render body is a real
  // hydration mismatch on every back-navigation (the kit's ListScreen carries
  // the same note about the sort/scroll half of this rule).
  useEffect(() => {
    const saved = readListFilters(FUNCTION_ID);
    // `status` is written on every change, including when the chip is turned
    // off (as "all"), so an absent key means "never filtered here" -- keep the
    // default -- while a stored "all" means the user deliberately removed it.
    if (saved.kind || saved.discipline || saved.status) {
      setFilters({
        kind: saved.kind ?? "",
        discipline: saved.discipline ?? "",
        status: saved.status === "all" ? "" : saved.status ?? DEFAULT_FILTERS.status,
      });
      setFilterOpen(true);
    }
  }, []);

  const load = useCallback(
    async (active: DrawingFilters) => {
      setLoading(true);
      try {
        const data = await fetchJson<{ drawings: Drawing[] }>(`/api/drawings?${drawingQuery(projectId, active)}`);
        const rows = data.drawings ?? [];
        setDrawings(rows);
        setLoadError(null);
        // Clear an error this load has just disproved -- but NOT a receipt the
        // object page handed over a moment ago, which this load would otherwise
        // wipe before it was ever read.
        setMessages((prev) => prev.filter((m) => m.level !== "error"));
      } catch (err) {
        // Never an empty table where an error belongs. The rows are cleared AND
        // the table is withheld -- an empty register and a failed request must
        // not look identical -- and the backend's own words are shown, in the
        // body with a Retry and in the frame's persistent band.
        setDrawings([]);
        setLoadError(errorMessage(err, "Couldn't load drawings"));
        setMessages([{ level: "error", text: errorMessage(err, "Couldn't load drawings") }]);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void load(filters);
  }, [load, filters]);

  // The unfiltered register, once per project. R67 D-12 turns the "Current
  // only" chip ON by default, so the rows on screen are filtered from the very
  // first load -- which means the list itself can no longer be the source of
  // either figure this needs: the "of m" in "Showing n of m" (how many rows the
  // filter is holding back) or the full set of Disciplines to offer. One extra
  // read, not one per filter change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<{ drawings: Drawing[] }>(`/api/drawings?${drawingQuery(projectId, EMPTY_FILTERS)}`);
        if (cancelled) return;
        const rows = data.drawings ?? [];
        setTotalCount(rows.length);
        setKnownDisciplines(
          [...new Set(rows.map((d) => d.discipline).filter((d): d is string => !!d && !!d.trim()))].sort()
        );
      } catch {
        // A failed overview costs the "of m" figure and the Discipline options,
        // nothing else -- the register itself has its own error path above, and
        // reporting the same outage twice helps nobody.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function applyFilters(next: DrawingFilters) {
    setFilters(next);
    writeListFilters(FUNCTION_ID, {
      kind: next.kind,
      discipline: next.discipline.trim(),
      // "all" rather than "" so that turning the DEFAULT chip off is itself
      // remembered: an empty value is dropped by writeListFilters, which would
      // restore the default on the way back.
      status: next.status || "all",
    });
  }

  // PROJEXA has no XLSX library and must not gain one -- the workbook is built
  // by VERIDIAN and relayed byte-for-byte (/api/drawings/export). The filters
  // go with it, so what is exported is what is on screen.
  async function exportRegister() {
    setExporting(true);
    try {
      const res = await fetch(`/api/drawings/export?${drawingQuery(projectId, filters)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessages([{ level: "error", text: body.error ?? `Couldn't export the register (HTTP ${res.status})` }]);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `drawings-${projectId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't export the register") }]);
    } finally {
      setExporting(false);
    }
  }

  const chips = activeFilterChips(filters);

  return (
    <ScreenFrame
      breadcrumb="Drawings & 3D"
      filterAction={{
        label: "Filter",
        onClick: () => setFilterOpen((open) => !open),
      }}
      exportAction={{
        label: "Export",
        onClick: () => void exportRegister(),
        // Disabled by condition with the reason beside it, never a click that
        // produces an empty spreadsheet.
        disabledReason: loading ? "Still loading" : drawings.length === 0 ? "No rows to export" : exporting ? "Exporting…" : undefined,
      }}
      newAction={{ label: "New", onClick: () => router.push(`/drawings/new?projectId=${projectId}`) }}
      messages={messages}
    >
      {/* R67 D-10: the 3D builder is a second VIEW of this project's space, not
          a second way to add a drawing. One line says which is which. */}
      <div className="border-b border-ct-border px-4 pt-3">
        <div role="tablist" aria-label="Drawings views" className="flex items-center gap-4">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="border-b-2 border-ct-teal pb-1.5 text-[13px] font-medium text-ct-navy"
          >
            Drawings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            onClick={() => router.push(`/floor-plans?projectId=${projectId}`)}
            className="border-b-2 border-transparent pb-1.5 text-[13px] text-ct-muted hover:text-ct-navy"
          >
            Floor plans (3D builder)
          </button>
        </div>
        <p className="py-2 text-[12.5px] text-ct-muted">
          Build a walkable 3D model from room layouts. To add a walkthrough file or link, use + New and choose 3D
          Walkthrough.
        </p>
      </div>

      {fellBack && projectName && (
        <p role="status" className="px-4 pt-3 text-[12.5px] text-ct-muted">
          Showing {projectName} (first project). Choose a project in the top rail to switch.
        </p>
      )}

      {filterOpen && (
        <div className="flex flex-wrap items-end gap-4 border-b border-ct-border px-4 py-3">
          <div className="space-y-1">
            <label htmlFor="drawings-filter-kind" className="block text-[12.5px] text-ct-muted">Kind</label>
            <select
              id="drawings-filter-kind"
              value={filters.kind}
              onChange={(e) => applyFilters({ ...filters, kind: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="drawings-filter-status" className="block text-[12.5px] text-ct-muted">Status</label>
            <select
              id="drawings-filter-status"
              value={filters.status}
              onChange={(e) => applyFilters({ ...filters, status: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              <option value="">All</option>
              <option value="current">Current only</option>
              <option value="for_approval">For approval</option>
              <option value="superseded">Superseded</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="drawings-filter-discipline" className="block text-[12.5px] text-ct-muted">Discipline</label>
            <select
              id="drawings-filter-discipline"
              value={filters.discipline}
              onChange={(e) => applyFilters({ ...filters, discipline: e.target.value })}
              className="rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              <option value="">All</option>
              {knownDisciplines.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-ct-border2 px-2.5 py-1 text-[12.5px] text-ct-navy">
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={() => applyFilters({ ...filters, [chip.key]: "" })}
                className="text-ct-muted hover:text-ct-navy"
              >
                ×
              </button>
            </span>
          ))}
          <span className="text-[12.5px] text-ct-muted">
            Showing {drawings.length} of {totalCount ?? drawings.length}
          </span>
          <button
            type="button"
            onClick={() => applyFilters(EMPTY_FILTERS)}
            className="text-[12.5px] text-ct-muted underline underline-offset-2 hover:text-ct-navy"
          >
            Clear all
          </button>
        </div>
      )}

      {loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
      ) : loadError ? (
        <div className="px-4 py-3">
          <DataLoadError messages={[loadError]} onRetry={() => void load(filters)} />
        </div>
      ) : (
        <ListScreen
          functionId={FUNCTION_ID}
          columns={columns}
          rows={drawings as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          onRowClick={(row) => router.push(`/drawings/${row.id}?projectId=${projectId}`)}
          emptyStateLabel={
            hasActiveFilter(filters)
              ? filters.status === "current" && !filters.kind && !filters.discipline.trim()
                ? "No current drawings yet. Remove the Current only filter to see revisions awaiting approval."
                : "No drawings match this filter."
              : projectName
                ? `No drawings yet for ${projectName}.`
                : "No drawings or 3D walkthroughs yet."
          }
          renderCell={{
            kind: (row) => <span>{(row as unknown as Drawing).kind === "3d_walkthrough" ? "3D Walkthrough" : "DWG"}</span>,
            drawingNo: (row) => <span>{(row as unknown as Drawing).drawingNo ?? "—"}</span>,
            rev: (row) => <span>{(row as unknown as Drawing).rev ?? "—"}</span>,
            // Glyph AND word, never a bare colour (WS-G): a colour alone is
            // unreadable to a colour-blind user and meaningless to anyone who
            // has not been told the code.
            status: (row) => {
              const presentation = statusPresentation((row as unknown as Drawing).status);
              return (
                <span className={presentation.className}>
                  <span aria-hidden>{presentation.glyph}</span> {presentation.word}
                </span>
              );
            },
            discipline: (row) => <span className="text-ct-muted">{(row as unknown as Drawing).discipline ?? "—"}</span>,
            createdAt: (row) => <span className="text-ct-muted">{formatDate((row as unknown as Drawing).createdAt)}</span>,
            __file: (row) => {
              const drawing = row as unknown as Drawing;
              if (!drawing.documentUrl) return <span className="text-ct-muted">—</span>;
              // Every action is a word, never an icon alone; stopPropagation so
              // opening the file does not also open the row behind it.
              return (
                <a
                  href={drawing.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="underline underline-offset-2"
                >
                  Open
                </a>
              );
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
