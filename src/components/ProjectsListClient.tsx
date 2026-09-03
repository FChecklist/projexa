"use client";

// R67 D-69 (audit R-261/R-300). PROJEXA had no Projects list.
//
// Projects were reachable in exactly two places: a table at the bottom of the
// home dashboard, and a cycling switcher in the top rail. Neither is a list --
// the home table is one card on a page about something else, and the switcher
// shows one project at a time with no figures at all. So the entity every other
// entity in this product nests under was the only one with no landing of its
// own, and "show me my projects, filtered, and give me the file" had no answer.
//
// This is the standard list archetype the rest of the modules use: the kit's
// ScreenFrame with Filter | Export | New in that DOM order, the kit's ListScreen
// underneath (which brings back-restores-filters-and-scroll for free), and the
// same four states every list in this lane now renders -- loading, error, empty,
// filtered-empty -- kept mutually exclusive so an empty-state sentence can never
// appear over a failed read.
//
// It reads the EXISTING /api/projects proxy. No new endpoint: D-69's own row
// spec (name, % complete, contract value, status) is answerable from the fields
// VERIDIAN's /dashboard already returns per project, which that proxy was
// discarding until this item.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ListScreen, ScreenFrame, type FieldMessage, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import DataLoadError from "@/components/DataLoadError";
// R67 D-61/D-62: the money helpers are lane G-05's shared modules. D-61
// briefly shipped its own format-money.ts plus a useCurrencyCode() hook in
// @/lib/currency; G-05's format-money.ts + useOrgMoney() landed on main first
// and are a superset (three-state currency: not-asked / none / a code), so the
// D-61 copies were dropped at the merge and these call sites moved across.
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import { formatNumber } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import { downloadCsv, rowsToCsv } from "@/lib/csv-export";
import {
  PROJECT_EXPORT_HEADERS,
  PROJECT_STATUS_OPTIONS,
  filterProjects,
  percentBarWidth,
  projectExportRows,
  projectStatusPresentation,
  type ProjectRow,
} from "@/lib/project-list";

const FUNCTION_ID = "projects.list";

// Five columns, well inside ListScreen's M28 cap of seven High.
const COLUMNS: ScreenColumn[] = [
  { label: "Project", field: "name", type: "text", importance: "High" },
  { label: "% complete", field: "percentByValue", type: "number", importance: "High" },
  { label: "Contract value", field: "contractValue", type: "number", importance: "High" },
  { label: "Project value", field: "projectValue", type: "number", importance: "High" },
  { label: "Status", field: "__status", type: "text", importance: "High" },
];

export default function ProjectsListClient() {
  const router = useRouter();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("");
  const { money } = useOrgMoney();
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The rows are CLEARED on failure, so the empty-state sentence below
        // can never be rendered over a read that did not succeed.
        setRows([]);
        setLoadError(body.error ?? `Couldn't load your projects (HTTP ${res.status})`);
        return;
      }
      setRows((body.projects ?? []) as ProjectRow[]);
      setLoadError(null);
    } catch (err) {
      setRows([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load your projects");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => filterProjects(rows, status), [rows, status]);
  const messages: FieldMessage[] = loadError ? [{ level: "error", text: loadError }] : [];

  return (
    <ScreenFrame
      breadcrumb="Projects"
      filterAction={{ label: "Filter", onClick: () => setFilterOpen((open) => !open) }}
      exportAction={{
        label: "Export",
        onClick: () => downloadCsv("projects.csv", rowsToCsv(PROJECT_EXPORT_HEADERS, projectExportRows(shown))),
        disabledReason: loading ? "Still loading" : shown.length === 0 ? "No rows to export" : undefined,
      }}
      // The frame draws the plus (C01-13), so the label is the plain word.
      newAction={{ label: "New", onClick: () => router.push("/projects/new") }}
      messages={messages}
    >
      {filterOpen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-ct-border px-4 py-3">
          <label className="flex items-center gap-1.5 text-[12.5px] text-ct-navy">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
            >
              <option value="">All</option>
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <span className="text-[12.5px] text-ct-muted">Showing {shown.length} of {rows.length}</span>
          {status !== "" && (
            <button type="button" onClick={() => setStatus("")} className="text-[12.5px] text-ct-navy underline">
              Clear all
            </button>
          )}
        </div>
      )}

      {loadError ? (
        <div className="px-4 py-3">
          <DataLoadError messages={[`Could not load projects: ${loadError}`]} onRetry={() => void load()} />
        </div>
      ) : loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted" aria-busy="true">Loading your projects…</p>
      ) : (
        <ListScreen
          functionId={FUNCTION_ID}
          columns={COLUMNS}
          rows={shown as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          onRowClick={(row) => router.push(`/dashboard/project?projectId=${row.id}`)}
          emptyStateLabel={
            rows.length === 0
              ? "No projects yet."
              : "No projects match this filter."
          }
          renderCell={{
            name: (row) => (
              // Kept as a real link so middle-click still opens a tab; the row
              // click above is the fast path.
              <Link
                href={`/dashboard/project?projectId=${(row as unknown as ProjectRow).id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-ct-navy hover:underline"
              >
                {(row as unknown as ProjectRow).name}
              </Link>
            ),
            percentByValue: (row) => {
              const project = row as unknown as ProjectRow;
              const width = percentBarWidth(project.percentByValue);
              if (width === null) {
                // A project with no BOQ gets words, not an empty bar -- an empty
                // bar reads as 0% done rather than as "no scope defined".
                return <span className="text-ct-muted">No BOQ yet</span>;
              }
              return (
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-20 shrink-0 rounded-full bg-ct-border2"
                    role="img"
                    aria-label={`${formatNumber(width)}% complete by BOQ value`}
                  >
                    <span
                      className="block h-full rounded-full bg-[color:var(--color-veri-status-done)]"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-[12.5px]">{formatNumber(width)}%</span>
                </span>
              );
            },
            contractValue: (row) => {
              const value = (row as unknown as ProjectRow).contractValue;
              return (
                <span className={MONEY_CELL_CLASS}>
                  {value === null ? <span className="text-ct-muted">No scope yet</span> : money(value)}
                </span>
              );
            },
            projectValue: (row) => {
              const value = (row as unknown as ProjectRow).projectValue;
              return (
                <span className={MONEY_CELL_CLASS}>
                  {value === null ? <span className="text-ct-muted">Not set</span> : money(value)}
                </span>
              );
            },
            __status: (row) => {
              const { glyph, word, className } = projectStatusPresentation(row as unknown as ProjectRow);
              return (
                <span className={className}>
                  <span aria-hidden="true">{glyph}</span> {word}
                </span>
              );
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
