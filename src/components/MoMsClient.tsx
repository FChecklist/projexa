"use client";

// Wave 143 (Minutes of Meeting module): live meeting-notes creation, AI
// summary generation, and PDF export -- wired to VERI Meeting Intelligence
// (veri-meeting-service.ts) via /api/moms, not PROJEXA's basic scheduling
// CRUD (/api/meetings).
//
// R46 P8 seq129: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list. R67 D-16 narrows what the registry may do
// here: the six columns and their ORDER are now fixed by the item (Meeting |
// Date & time | Attendees | Open actions | Status | Action), because two of
// them are new aggregates and "Action" is not a data field at all. A
// screen_definitions row can still RELABEL any of the three original fields
// (title / scheduledAt / status), which is the capability the registry model
// was proven with; it can no longer drop or reorder them.
//
// Real-screen conversion (2026-08-30): "New Meeting" routes to a real
// create screen (MoMCreateClient.tsx); rows route to a real Object Page
// (MoMObjectClient.tsx). Every action this list used to expose inline
// (Minutes/PDF/WhatsApp) lives on that Object Page.
//
// ─── R67 D-16 / D-20: WHAT CHANGED AND WHY ──────────────────────────────
//
// BEFORE: two branches. `loading ? <spinner/> : meetings.length === 0 ?
// "No meetings recorded yet." : <table/>`, with the failure path being
// `toast.error(...)` inside the catch -- which left `meetings` at [] and so
// rendered THE EMPTY SENTENCE OVER A 504. A toast that has already faded is
// not a state; the screen was left asserting, permanently, that this project
// has never held a meeting. That is the single defect this programme exists
// to remove, and it was here in its purest form.
//
// AFTER: `momsListState()` in src/lib/moms-list.ts decides the branch, and
// the empty sentence is only reachable from a 200. There are six branches,
// not two -- no project, loading, failed, forbidden, empty, filtered-empty,
// ready -- and each has its own words and its own way out.
//
// The header is Filter | Export | + New Meeting in that fixed order, the
// filter lives in the URL so Back restores it, dates render in the org's own
// form, status is a glyph AND a word, and every row
// carries a real "Open" link as well as the row click, which by itself did
// not navigate at all in the audit pass.
//
// R67 D-74 SUPERSEDES D-16 ON THE DATE CELL, deliberately and narrowly. D-16
// specified formatDateTimeOrg's "28 Aug 2026, 10:00" for this column; D-74 is
// the item that consolidates the product onto ONE form and its acceptance
// names this screen: "a grep of the rendered DOM on MoMs, Scope, Work
// Progress, Labour attendance, Materials receipts, Timesheet and Schedule
// finds the same date string form dd-mm-yyyy". Two forms on seven screens is
// the finding; keeping a nicer one here would leave the finding standing.
// formatDateTimeOrg and its tests are untouched for any caller that wants it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Download, Filter as FilterIcon, NotebookText, Plus, RefreshCw } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { StatusChip } from "@/components/StatusChip";
import { formatDateTime } from "@/lib/format";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import {
  MOMS_DEFAULT_RANGE_DAYS,
  MOMS_TEXT,
  countCell,
  displayAttendeesCount,
  displayOpenActions,
  filterMeetings,
  isNarrowedAgainst,
  meetingStatusChip,
  meetingsToCsv,
  momsCsvFilename,
  momsListState,
  momsSearchParams,
  type MeetingListRow,
  type MomsFilter,
} from "@/lib/moms-list";

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DocumentsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

type ColumnKey = "title" | "project" | "scheduledAt" | "attendeesCount" | "openActionItems" | "status" | "action";

const COLUMN_LABELS: Record<ColumnKey, string> = {
  title: "Meeting",
  project: "Project",
  scheduledAt: "Date & time",
  attendeesCount: "Attendees",
  openActionItems: "Open actions",
  status: "Status",
  action: "Action",
};

const NUMERIC_COLUMNS: ReadonlySet<ColumnKey> = new Set<ColumnKey>(["attendeesCount", "openActionItems"]);

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

export default function MoMsClient({
  projectId,
  projectName,
  mode,
  fellBack,
  projects,
  initialFilter,
  defaultFilter,
  registryColumns,
}: {
  /** null in "all projects" mode -- an explicit state, not a missing value. */
  projectId: string | null;
  projectName: string | null;
  mode: "project" | "all";
  /** True when the server picked the project because the URL named none. */
  fellBack: boolean;
  projects: { id: string; name: string }[];
  /** Read from the URL server-side, so the client never computes "today". */
  initialFilter: MomsFilter;
  defaultFilter: MomsFilter;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MeetingListRow[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [backendMessage, setBackendMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<MomsFilter>(initialFilter);
  const [filterOpen, setFilterOpen] = useState(false);

  // Back/forward re-renders this route on the server with the new search
  // params, which arrive here as a new `initialFilter`. Re-syncing on that
  // is what makes the browser's own Back button restore the filter rather
  // than change the URL under a stale panel.
  const lastInitial = useRef(initialFilter);
  useEffect(() => {
    if (
      lastInitial.current.status !== initialFilter.status ||
      lastInitial.current.from !== initialFilter.from ||
      lastInitial.current.to !== initialFilter.to ||
      lastInitial.current.attendee !== initialFilter.attendee
    ) {
      lastInitial.current = initialFilter;
      setFilter(initialFilter);
    }
  }, [initialFilter]);

  const projectLabel = mode === "all" ? "all projects" : projectName ?? "this project";
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const load = useCallback(async () => {
    setStatus("loading");
    setHttpStatus(null);
    setBackendMessage(null);
    try {
      // D-20: "all" mode queries the org scope -- /api/moms without a
      // projectId, which compliance-tracker's list already supports
      // (listVeriMeetings' contextEntityId argument is optional). It does NOT
      // pick a project and pretend the user chose it.
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const data = await fetchJson<{ meetings?: MeetingListRow[] }>(`/api/moms${query}`);
      setRows(Array.isArray(data.meetings) ? data.meetings : []);
      setStatus("ready");
    } catch (err) {
      // The rows are NOT cleared: whatever was last loaded stays on screen
      // under the error rather than the screen going blank and then claiming
      // emptiness. `status` is what decides the branch, never rows.length.
      setHttpStatus(err instanceof ApiError ? err.status : null);
      setBackendMessage(err instanceof Error && err.message ? err.message : null);
      setStatus("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The URL is the filter (same rule D-02 applied to the WPR): replace(), not
  // push(), so tweaking a date does not fill the history stack with an entry
  // per keystroke, and scroll is preserved so a switch does not jump the list.
  const applyFilter = useCallback(
    (next: Partial<MomsFilter>) => {
      const merged = { ...filter, ...next };
      setFilter(merged);
      router.replace(`/moms?${momsSearchParams(merged, projectId).toString()}`, { scroll: false });
    },
    [filter, projectId, router]
  );

  const visibleRows = useMemo(() => filterMeetings(rows, filter), [rows, filter]);
  const state = momsListState({
    hasProjectScope: mode === "all" || Boolean(projectId),
    status,
    httpStatus,
    errorMessage: backendMessage,
    projectLabel,
    rows,
    visibleRows,
  });

  const columns: ColumnKey[] = useMemo(() => {
    const base: ColumnKey[] = ["title", "scheduledAt", "attendeesCount", "openActionItems", "status", "action"];
    return mode === "all" ? (["title", "project", ...base.slice(1)] as ColumnKey[]) : base;
  }, [mode]);

  // The registry may relabel the three original data columns; it can no
  // longer drop or reorder the six (see this file's header).
  const labelFor = useCallback(
    (key: ColumnKey) => registryColumns?.find((c) => c.field === key)?.label ?? COLUMN_LABELS[key],
    [registryColumns]
  );

  function exportCsv() {
    const csv = meetingsToCsv(visibleRows, {
      projectNameFor: mode === "all" ? (row) => projectNameById.get(row.contextEntityId ?? "") ?? null : undefined,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = momsCsvFilename(mode === "all" ? "All projects" : projectName ?? "project", filter);
    a.click();
    URL.revokeObjectURL(url);
  }

  const newMeetingHref = projectId ? `/moms/new?projectId=${encodeURIComponent(projectId)}` : "/moms/new";
  const narrowed = isNarrowedAgainst(filter, defaultFilter);

  return (
    <div className="space-y-4">
      {/* ── The header trio, in the fixed order Filter | Export | + New ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-px-muted">
          {mode === "all"
            ? "Minutes of Meeting across every project — pick a project in the top bar to narrow this list."
            : "Minutes of Meeting for this project — live notes, AI summary, PDF export."}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen}>
            <FilterIcon className="size-4" aria-hidden /> Filter
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={visibleRows.length === 0}
                title={visibleRows.length === 0 ? "No rows to export" : undefined}
              >
                <Download className="size-4" aria-hidden /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportCsv}>Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => router.push(newMeetingHref)}>
            <Plus className="size-4" aria-hidden /> New Meeting
          </Button>
        </div>
      </div>

      {filterOpen && (
        <Card className="shadow-card">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="moms-status">Status</Label>
              <Select value={filter.status || "any"} onValueChange={(v) => applyFilter({ status: v === "any" ? "" : v })}>
                <SelectTrigger id="moms-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value || "any"} value={o.value || "any"}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="moms-from">From</Label>
              <Input id="moms-from" type="date" value={filter.from} onChange={(e) => applyFilter({ from: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="moms-to">To</Label>
              <Input id="moms-to" type="date" value={filter.to} onChange={(e) => applyFilter({ to: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="moms-attendee">Attendee</Label>
              <Input
                id="moms-attendee"
                placeholder="e.g. Priya"
                value={filter.attendee}
                onChange={(e) => applyFilter({ attendee: e.target.value })}
              />
            </div>
            <p className="text-[12px] text-px-muted sm:col-span-4">
              The last {MOMS_DEFAULT_RANGE_DAYS} days by default. Every filter is kept in the address bar, so Back and a shared link both
              restore this exact view.
            </p>
          </CardContent>
        </Card>
      )}

      {fellBack && projectName && (
        <p role="status" className="text-[12px] text-px-muted">
          Showing <span style={{ color: "var(--color-veri-status-context)" }}>{projectName}</span> (auto-selected) — no
          project was named in the address bar.
        </p>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {state.kind === "no-project" && (
            <p className="py-10 text-center text-sm text-px-muted">{MOMS_TEXT.noProject}</p>
          )}

          {state.kind === "forbidden" && (
            <p role="alert" className="py-10 text-center text-sm" style={{ color: "var(--color-veri-status-late)" }}>
              {state.message}
            </p>
          )}

          {state.kind === "error" && (
            <div role="alert" className="m-4 rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm">
              <p className="flex items-start gap-2 font-medium text-px-error">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {state.message}
              </p>
              {/* The closed-vocabulary sentence above is what the user reads;
                  the backend's own words stay on screen underneath it so the
                  real reason is never lost (C19 ERROR_TRUTHFUL). */}
              {backendMessage && <p className="mt-1 pl-6 text-px-error/90">{backendMessage}</p>}
              <div className="mt-3 pl-6">
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  {MOMS_TEXT.retry}
                </Button>
              </div>
            </div>
          )}

          {(state.kind === "loading" || state.kind === "ready") && (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((key) => (
                    <TableHead key={key} className={NUMERIC_COLUMNS.has(key) ? "text-right" : undefined}>
                      {labelFor(key)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.kind === "loading"
                  ? // Three skeleton rows in the real column shape -- not a
                    // centred wordless spinner, which tells the user nothing
                    // about what is coming and moves the whole table when it
                    // resolves.
                    [0, 1, 2].map((i) => (
                      <TableRow key={`skeleton-${i}`}>
                        {columns.map((key) => (
                          <TableCell key={key}>
                            <Skeleton className={NUMERIC_COLUMNS.has(key) ? "ml-auto h-4 w-8" : "h-4 w-full max-w-40"} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : state.rows.map((row) => {
                      const chip = meetingStatusChip(row.status);
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-px-cloud/40"
                          onClick={() => router.push(`/moms/${row.id}`)}
                        >
                          {columns.map((key) => {
                            switch (key) {
                              case "title":
                                return (
                                  <TableCell key={key}>
                                    <span className="flex items-center gap-2 font-medium">
                                      <NotebookText className="size-4 text-px-muted" aria-hidden />
                                      {row.title}
                                    </span>
                                  </TableCell>
                                );
                              case "project":
                                return (
                                  <TableCell key={key} className="text-px-muted">
                                    {projectNameById.get(row.contextEntityId ?? "") ?? "—"}
                                  </TableCell>
                                );
                              case "scheduledAt":
                                return (
                                  <TableCell key={key} className="text-px-muted">
                                    {formatDateTime(row.scheduledAt)}
                                  </TableCell>
                                );
                              case "attendeesCount":
                                return (
                                  <TableCell key={key} className="text-right tabular-nums">
                                    {countCell(displayAttendeesCount(row))}
                                  </TableCell>
                                );
                              case "openActionItems":
                                return (
                                  <TableCell key={key} className="text-right tabular-nums">
                                    {countCell(displayOpenActions(row))}
                                  </TableCell>
                                );
                              case "status":
                                return (
                                  <TableCell key={key}>
                                    <StatusChip label={chip.label} filled={chip.filled} tone={chip.tone} />
                                  </TableCell>
                                );
                              case "action":
                                return (
                                  <TableCell key={key} onClick={(e) => e.stopPropagation()}>
                                    <span className="flex items-center gap-3 text-[12px]">
                                      <Link href={`/moms/${row.id}`} className="underline underline-offset-2">
                                        Open
                                      </Link>
                                      <a
                                        href={`/api/moms/${row.id}/pdf`}
                                        className="underline underline-offset-2 text-px-muted"
                                      >
                                        Export PDF
                                      </a>
                                    </span>
                                  </TableCell>
                                );
                            }
                          })}
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          )}

          {state.kind === "empty" && (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-px-muted">{state.message}</p>
              <Button size="sm" onClick={() => router.push(newMeetingHref)}>
                <Plus className="size-4" aria-hidden /> New Meeting
              </Button>
            </div>
          )}

          {state.kind === "filtered-empty" && (
            <div className="space-y-3 py-10 text-center">
              {/* NOT the empty sentence: this project HAS meetings, they are
                  simply outside the current filter (the default range is the
                  last 90 days). Saying "no meetings recorded yet" here would
                  be the same lie as saying it over a 500. */}
              <p className="text-sm text-px-muted">{state.message}</p>
              <p className="text-[12px] text-px-muted">
                {rows.length} meeting{rows.length === 1 ? "" : "s"} exist outside {filter.from} to {filter.to}.
              </p>
              <Button size="sm" variant="outline" onClick={() => applyFilter(defaultFilter)} disabled={!narrowed}>
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The persistent footer message band: an error stays counted here
          after the user has scrolled past the card, so a failed screen can
          never look like a working one. */}
      {state.kind === "error" && (
        <div
          role="status"
          className="rounded-lg border border-px-error-border bg-px-error-light px-3 py-2 text-[12px] text-px-error"
        >
          <span className="font-medium">{state.footer}</span> — {state.message}
        </div>
      )}
    </div>
  );
}
