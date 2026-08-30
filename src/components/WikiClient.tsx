"use client";

// Priority 17 Wave 1: per-project Wiki, over the previously-unexposed
// VERIDIAN pms-wiki-service.ts. Plain text/markdown content, no CRDT
// collaborative editor (matches the backend's own explicit v1 scope).
//
// Real-screen conversion (2026-08-30): the old inline "selected page" panel
// (client-side state, no real URL) and the "New Page" Dialog are both gone.
// Rows route to a real Object Page (WikiObjectClient.tsx); "New Page" routes
// to a real create screen (WikiCreateClient.tsx). Also corrects a stale
// disclosure: only Edit is genuinely identity-bridge-blocked, not Create --
// see WikiObjectClient.tsx's header comment for the full finding.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type WikiPage = { id: string; slug: string; title: string; content: string | null; version: number };

export default function WikiClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ pages?: WikiPage[] }>(`/api/wiki?projectId=${encodeURIComponent(projectId)}`);
      setPages(data.pages ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Failed to load wiki pages");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load wiki: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Real screen navigation (2026-08-30) -- New Page routes to a real
          create screen, which genuinely works via the shared API key
          (createWikiPage() degrades updatedById to null rather than
          rejecting). Only Edit is identity-bridge-blocked, disclosed on the
          Object Page itself, not here. */}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => router.push(`/wiki/new?projectId=${projectId}`)}><Plus className="size-4" /> New Page</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {pages.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No pages yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Version</TableHead></TableRow></TableHeader>
              <TableBody>
                {pages.map((page) => (
                  <TableRow key={page.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/wiki/${page.id}`)}>
                    <TableCell className="font-medium">{page.title}</TableCell>
                    <TableCell className="text-px-muted">v{page.version}</TableCell>
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
