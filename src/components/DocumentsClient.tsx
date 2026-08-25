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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, FileText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";

type Doc = {
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

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Category", field: "category", type: "text", importance: "High" },
  { label: "Type", field: "fileType", type: "text", importance: "High" },
  { label: "Size", field: "fileSize", type: "number", importance: "High" },
  { label: "Expiry", field: "expiryDate", type: "date", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

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
      return <span className="text-px-muted">{d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : "—"}</span>;
    case "createdAt":
      return <span className="text-px-muted">{new Date(d.createdAt).toLocaleDateString()}</span>;
    default:
      return String((d as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function DocumentsClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  async function handleUpload(formData: FormData) {
    formData.set("linkedEntityType", "project");
    formData.set("linkedEntityId", projectId);
    setSaving(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to upload document");
      }
      toast.success("Document uploaded");
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ linkedEntityType: "project", linkedEntityId: projectId });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/documents?${params.toString()}`);
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {
      toast.error("Couldn't load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId, category]);

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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="size-4" /> Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
              <form action={handleUpload} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="doc-name">Name (optional)</Label>
                  <Input id="doc-name" name="name" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="doc-category">Category</Label>
                  <Select name="category" defaultValue="other">
                    <SelectTrigger id="doc-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter((c) => c !== "all").map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="doc-file">File (PDF, email, etc.)</Label>
                  <Input id="doc-file" name="file" type="file" required />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Upload"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
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
                  <TableRow key={d.id}>
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
