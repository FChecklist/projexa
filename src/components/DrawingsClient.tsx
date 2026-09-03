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

// Wave 143 (Drawings & 3D module): DWG file uploads + 3D walkthrough
// files/links, per project -- same Card/Table/Dialog primitives as
// PermitsClient.tsx, same VERIDIAN documents-table-with-category backend
// (category='drawing'|'drawing_3d').
//
// R67 D-65 / D-59 / D-71: the failure path used to be a toast.error() inside
// the catch, which left `drawings` at [] and so rendered "No drawings or 3D
// walkthroughs yet." over a 504 -- and once the toast faded, that sentence
// was the only thing left on screen. The outcome is now held and PaneState
// decides what may be said; the empty sentence needs a 200. D-71 replaces
// this screen's copy of the load-state bookkeeping with the one shared list
// hook, so permits and drawings cannot drift apart again.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayoutPanelLeft, ExternalLink, Plus, Box } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { PaneState } from "@/components/PaneState";
import { formatDate } from "@/lib/format-date";
import { useListRead } from "@/lib/use-list-read";
import { DRAWINGS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";
import { recordCountLabel } from "@/lib/pane-state";

// Exported so drawings/page.tsx can type the rows it fetches server-side.
export type Drawing = {
  id: string;
  name: string;
  kind: "dwg" | "3d_walkthrough";
  discipline: string | null;
  isExternalLink: boolean;
  documentUrl: string | null;
  createdAt: string;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// intentionally the same fields as ScreenColumn (R46 P8 seq127, same
// pattern as PermitsListClient.tsx / R43 seq2).
export type RegistryColumn = ScreenColumn;

// R46 P8 seq127: the table used to render these 4 headers as hardcoded
// inline JSX (Name | Kind | Discipline | Added), plus a non-data "Open"
// action column. This COLUMNS const is now ONLY the fallback for when the
// compliance.screen_definitions row for drawings.list doesn't exist yet
// (404) or the call errors -- the "Open" action column is intentionally
// NOT part of it and is always rendered separately below.

function renderDrawingCell(column: ScreenColumn, d: Drawing) {
  switch (column.field) {
    case "name":
      return (
        <TableCell key={column.field} className="flex items-center gap-2 font-medium">
          <LayoutPanelLeft className="size-4 text-px-muted" />{d.name}
        </TableCell>
      );
    case "kind":
      return (
        <TableCell key={column.field}>
          <Badge variant="outline">{d.kind === "3d_walkthrough" ? "3D Walkthrough" : "DWG"}</Badge>
        </TableCell>
      );
    case "discipline":
      return <TableCell key={column.field} className="text-px-muted">{d.discipline ?? "—"}</TableCell>;
    case "createdAt":
      return <TableCell key={column.field} className="text-px-muted">{formatDate(d.createdAt)}</TableCell>;
    default:
      return (
        <TableCell key={column.field} className="text-px-muted">
          {String((d as unknown as Record<string, unknown>)[column.field] ?? "—")}
        </TableCell>
      );
  }
}

export default function DrawingsClient({
  projectId,
  projectName,
  registryColumns,
  initial = null,
}: {
  projectId: string;
  projectName?: string | null;
  registryColumns?: RegistryColumn[] | null;
  /**
   * R67 F-18: what drawings/page.tsx already fetched on the server for this
   * project. Present, the hook starts ANSWERED and makes no round trip on
   * first paint; a server-side failure starts it in the error state, never on
   * a spinner and never on an empty table. Only the first url is seeded, so a
   * project switch or a filter change still reads normally.
   */
  initial?: ModuleListInitial<Drawing>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DRAWINGS_LIST_COLUMNS;
  // Rows already held survive a failed refresh -- see PaneState.
  const {
    rows: drawings,
    status,
    startedAt,
    loadedAt,
    error,
    reload,
  } = useListRead<Drawing>({
    url: `/api/drawings?projectId=${encodeURIComponent(projectId)}`,
    select: (body) => (body as { drawings?: Drawing[] } | null)?.drawings,
    initial,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">DWG drawings and 3D walkthroughs for this project.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/floor-plans?projectId=${projectId}`}><Box className="size-4" /> Floor Plans / 3D Walkthrough</Link>
          </Button>
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Drawing" Dialog popup with a real create route. */}
          <Button size="sm" onClick={() => router.push(`/drawings/new?projectId=${projectId}`)}><Plus className="size-4" /> Add Drawing</Button>
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-2">
          <p className="px-2 py-1 text-[12px] text-px-muted">{recordCountLabel(status, drawings.length)}</p>
          <PaneState
            status={status}
            entity="drawings"
            projectName={projectName}
            startedAt={startedAt}
            error={error}
            rowCount={drawings.length}
            lastLoadedAt={loadedAt}
            skeletonColumns={[...columns.map((c) => c.label), "Open"]}
            emptyMessage="No drawings yet for this project."
            emptyAction={
              <Button size="sm" onClick={() => router.push(`/drawings/new?projectId=${projectId}`)}>
                <Plus className="size-4" aria-hidden /> New
              </Button>
            }
            onRetry={reload}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.field}>{c.label}</TableHead>)}
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drawings.map((d) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of only a bare "Open" link (no
                  // detail view existed before this).
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/drawings/${d.id}?projectId=${projectId}`)}>
                    {columns.map((c) => renderDrawingCell(c, d))}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {d.documentUrl ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={d.documentUrl} target="_blank" rel="noopener noreferrer">Open <ExternalLink className="size-3.5" /></a>
                        </Button>
                      ) : "—"}
                    </TableCell>
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
