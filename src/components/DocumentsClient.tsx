"use client";

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

const CATEGORIES = ["all", "permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsClient({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
                  <TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Type</TableHead>
                  <TableHead>Size</TableHead><TableHead>Expiry</TableHead><TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="flex items-center gap-2 font-medium"><FileText className="size-4 text-px-muted" />{d.name}</TableCell>
                    <TableCell><Badge variant="outline">{d.category.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-px-muted">{d.fileType ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{formatSize(d.fileSize)}</TableCell>
                    <TableCell className="text-px-muted">{d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-px-muted">{new Date(d.createdAt).toLocaleDateString()}</TableCell>
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
