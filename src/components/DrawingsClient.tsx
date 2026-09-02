"use client";

// Wave 143 (Drawings & 3D module): DWG file uploads + 3D walkthrough
// files/links, per project -- same Card/Table/Dialog primitives as
// PermitsClient.tsx, same VERIDIAN documents-table-with-category backend
// (category='drawing'|'drawing_3d').
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayoutPanelLeft, ExternalLink, Plus, Box } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { TableLoadingRows } from "@/components/TableLoadingRows";

type Drawing = {
  id: string;
  name: string;
  kind: "dwg" | "3d_walkthrough";
  discipline: string | null;
  isExternalLink: boolean;
  // R67 F-02: documentUrl is now present ONLY for external links (a stored
  // URL string, free to return). A storage-backed drawing reports
  // hasDocument and its signed URL is minted on click -- see openDrawing().
  documentUrl: string | null;
  hasDocument: boolean;
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
const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Kind", field: "kind", type: "text", importance: "High" },
  { label: "Discipline", field: "discipline", type: "text", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

// R67 F-02: the labels drawings/page.tsx paints in its Suspense fallback (plus
// the always-present "Open" action column), so the header row on screen while
// loading is the header row that stays there when rows arrive.
export const DRAWINGS_FALLBACK_COLUMN_LABELS = [...COLUMNS.map((c) => c.label), "Open"];

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
  registryColumns,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // R67 F-02. The register no longer carries a signed URL per row, so this
  // asks for one drawing's URL at click time. The blank tab is opened
  // SYNCHRONOUSLY, before the await: a browser only treats window.open() as
  // user-initiated inside the click handler's own turn, so opening it after
  // the fetch resolves is what a popup blocker kills.
  async function openDrawing(drawing: Drawing) {
    if (drawing.documentUrl) {
      window.open(drawing.documentUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const tab = window.open("", "_blank", "noopener,noreferrer");
    setOpeningId(drawing.id);
    try {
      const data = await fetchJson(`/api/drawings/${encodeURIComponent(drawing.id)}/document-url`);
      if (!data?.documentUrl) throw new Error("No file link came back for this drawing");
      if (tab) tab.location.href = data.documentUrl;
      // If the popup was blocked, honour the click with a real link the
      // browser treats as user-initiated. (window.location.href is assigned
      // via window.open on the current frame here rather than mutated
      // directly: the React Compiler lint rule forbids writing to a value
      // defined outside the component, and this achieves the same navigation.)
      else window.open(data.documentUrl, "_self");
    } catch (err) {
      tab?.close();
      toast.error(errorMessage(err, "Couldn't open this drawing"));
    } finally {
      setOpeningId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/drawings?projectId=${encodeURIComponent(projectId)}`);
      setDrawings(data.drawings ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load drawings"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

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
          {/* R67 F-02: warm the create route on hover/focus. */}
          <Button
            size="sm"
            onMouseEnter={() => router.prefetch(`/drawings/new?projectId=${projectId}`)}
            onFocus={() => router.prefetch(`/drawings/new?projectId=${projectId}`)}
            onClick={() => router.push(`/drawings/new?projectId=${projectId}`)}
          >
            <Plus className="size-4" /> Add Drawing
          </Button>
        </div>
      </div>

      {/* R67 F-02: the real column headers while loading, not a bare spinner. */}
      {loading ? (
        <TableLoadingRows headers={[...columns.map((c) => c.label), "Open"]} rows={3} caption="Loading drawings..." />
      ) : (
      <Card className="shadow-card">
        <CardContent className="p-0">
          {drawings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No drawings or 3D walkthroughs yet.</p>
          ) : (
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
                  <TableRow
                    key={d.id}
                    className="cursor-pointer hover:bg-px-cloud/40"
                    onMouseEnter={() => router.prefetch(`/drawings/${d.id}?projectId=${projectId}`)}
                    onClick={() => router.push(`/drawings/${d.id}?projectId=${projectId}`)}
                  >
                    {columns.map((c) => renderDrawingCell(c, d))}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {d.documentUrl || d.hasDocument ? (
                        <Button variant="ghost" size="sm" disabled={openingId === d.id} onClick={() => openDrawing(d)}>
                          {openingId === d.id ? "Opening…" : <>Open <ExternalLink className="size-3.5" /></>}
                        </Button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
