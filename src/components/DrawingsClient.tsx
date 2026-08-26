"use client";

// Wave 143 (Drawings & 3D module): DWG file uploads + 3D walkthrough
// files/links, per project -- same Card/Table/Dialog primitives as
// PermitsClient.tsx, same VERIDIAN documents-table-with-category backend
// (category='drawing'|'drawing_3d').
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, LayoutPanelLeft, ExternalLink, Plus, Box } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Drawing = {
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
const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Kind", field: "kind", type: "text", importance: "High" },
  { label: "Discipline", field: "discipline", type: "text", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

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
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<"dwg" | "3d_walkthrough">("dwg");
  const [linkMode, setLinkMode] = useState(false);

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

  async function handleCreate(formData: FormData) {
    formData.set("projectId", projectId);
    formData.set("kind", kind);
    setSaving(true);
    try {
      const res = await fetch("/api/drawings", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to add drawing");
      }
      toast.success("Drawing added");
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add drawing");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">DWG drawings and 3D walkthroughs for this project.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/floor-plans?projectId=${projectId}`}><Box className="size-4" /> Floor Plans / 3D Walkthrough</Link>
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="size-4" /> Add Drawing</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Drawing / 3D Walkthrough</DialogTitle></DialogHeader>
              <form action={handleCreate} className="space-y-3">
                <div className="space-y-1">
                  <Label>Kind</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as "dwg" | "3d_walkthrough")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dwg">DWG Drawing</SelectItem>
                      <SelectItem value="3d_walkthrough">3D Walkthrough</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="discipline">Discipline (optional)</Label>
                  <Input id="discipline" name="discipline" placeholder="Architectural, Structural, MEP..." />
                </div>
                {kind === "3d_walkthrough" && (
                  <div className="flex items-center gap-2 text-sm">
                    <button type="button" className="underline" onClick={() => setLinkMode((v) => !v)}>
                      {linkMode ? "Upload a file instead" : "Use an external link instead"}
                    </button>
                  </div>
                )}
                {kind === "3d_walkthrough" && linkMode ? (
                  <div className="space-y-1">
                    <Label htmlFor="externalUrl">Walkthrough URL</Label>
                    <Input id="externalUrl" name="externalUrl" type="url" placeholder="https://..." required />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="file">File{kind === "dwg" ? " (DWG)" : ""}</Label>
                    <Input id="file" name="file" type="file" required />
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Add"}</Button>
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
          ) : drawings.length === 0 ? (
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
                  <TableRow key={d.id}>
                    {columns.map((c) => renderDrawingCell(c, d))}
                    <TableCell className="text-right">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
