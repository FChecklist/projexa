"use client";

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
//
// R67 F-18: the documents now normally arrive as props, fetched by
// documents/page.tsx on the server inside its Suspense boundary. The category
// filter still refetches on the client -- useModuleList keys on the whole URL,
// so changing the category is exactly the case that SHOULD go to the network,
// and it aborts the previous request when it does.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { DOCUMENTS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { useModuleList, type ModuleListInitial } from "@/lib/use-module-list";

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

// R67 F-18: the fallback labels moved to src/lib/module-list-columns.ts so
// this screen's loading skeleton draws the same column heads this table does.

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
  registryColumns,
  initial = null,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initial?: ModuleListInitial<Doc>;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DOCUMENTS_LIST_COLUMNS;

  const params = new URLSearchParams({ linkedEntityType: "project", linkedEntityId: projectId });
  if (category !== "all") params.set("category", category);

  // The server prefetched the UNFILTERED list, which is what "all" renders --
  // so the first paint is free and only a real category change costs a fetch.
  const { rows: docs, error, loading } = useModuleList<Doc>({
    initial: category === "all" ? initial : null,
    url: `/api/documents?${params.toString()}`,
    pick: (d) => d.documents as Doc[] | undefined,
    context: "documents",
  });

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

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : error ? (
            // Never an empty table over a failed read.
            <p role="alert" className="py-10 text-center text-sm text-px-error">{error}</p>
          ) : docs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No documents found for this project.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
