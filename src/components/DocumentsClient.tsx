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
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FileText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import PaneState from "@/components/PaneState";
import { recordCountLabel } from "@/lib/pane-state";
import { useListRead } from "@/lib/use-list-read";
import { DOCUMENTS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";

// Exported so documents/page.tsx can type the rows it fetches server-side.
export type Doc = {
  id: string;
  name: string;
  category: string;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;


const CATEGORIES = ["all", "permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 6 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderDocumentCell(field: string, d: Doc) {
  switch (field) {
    case "name":
      return (
        <span className="flex items-center gap-2 font-medium">
          <FileText className="size-4 text-px-muted" />{d.name}
        </span>
      );
    case "category":
      return <Badge variant="outline">{d.category.replace(/_/g, " ")}</Badge>;
    case "fileType":
      return <span className="text-px-muted">{d.fileType ?? "—"}</span>;
    case "fileSize":
      return <span className="text-px-muted">{formatSize(d.fileSize)}</span>;
    case "expiryDate":
      return <span className="text-px-muted">{d.expiryDate ? formatDate(d.expiryDate) : "—"}</span>;
    case "createdAt":
      return <span className="text-px-muted">{formatDate(d.createdAt)}</span>;
    default:
      return String((d as unknown as Record<string, unknown>)[field] ?? "—");
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
  const [category, setCategory] = useState("all");
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DOCUMENTS_LIST_COLUMNS;

  const url = useMemo(() => {
    const params = new URLSearchParams({ linkedEntityType: "project", linkedEntityId: projectId });
    if (category !== "all") params.set("category", category);
    return `/api/documents?${params.toString()}`;
  }, [projectId, category]);

  const read = useListRead<Doc>({
    url,
    select: (body) => (body as { documents?: Doc[] })?.documents,
    // The page prefetches the DEFAULT ("all categories") read only; changing
    // the category is exactly the case that should go to the network.
    initial,
  });
  const docs = read.rows;

  // A filtered read that comes back empty is NOT "this project has no
  // documents" -- it is "no permits, in this project". Saying the first over
  // the second is how a user concludes the upload never landed.
  const emptyMessage =
    category === "all"
      ? `No documents yet for ${projectName ?? "this project"}.`
      : `No ${category.replace(/_/g, " ")} documents in ${projectName ?? "this project"}. Clear the category filter to see the rest.`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">
          Documents linked directly to this project (permits, drawings, site photos, etc.). Records attached to a
          specific RFI, work progress entry, or other item are visible from that record.
        </p>
        <div className="flex items-center gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c === "all" ? "All categories" : c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Upload Document" Dialog popup with a real create route. */}
          <Button size="sm" onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}><Plus className="size-4" /> Upload</Button>
        </div>
      </div>

      <p className="px-1 text-[12px] text-px-muted">{recordCountLabel(read.status, docs.length)}</p>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <PaneState
            status={read.status}
            entity="documents"
            projectName={projectName}
            startedAt={read.startedAt}
            error={read.error}
            rowCount={docs.length}
            skeletonColumns={columns.map((col) => col.label)}
            emptyMessage={emptyMessage}
            emptyAction={
              <Button size="sm" onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}>
                <Plus className="size-4" /> Upload
              </Button>
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
                {docs.map((d) => (
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
          </PaneState>
        </CardContent>
      </Card>
    </div>
  );
}
