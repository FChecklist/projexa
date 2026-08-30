"use client";

// Priority 17 Wave 1: org-wide Knowledge Base, over VERIDIAN's
// knowledge-base-service.ts (distinct from the per-project Wiki -- this is
// org-wide reference material, not project working notes).
//
// Real-screen conversion (2026-08-30): this used to be a two-pane
// sidebar-plus-inline-editor with a "New Page" Dialog popup, page selection
// held only in local React state (never a real URL) and edit/save baked
// directly into this component. Now a real List Report: rows route to a
// real `/knowledge-base/[id]` Object Page (KnowledgeBaseObjectClient.tsx),
// "New Page" routes to a real `/knowledge-base/new` create screen. The
// stale "creating AND editing require a real VERIDIAN user session" notice
// is corrected below -- see updateKbPage()'s own comment in
// knowledge-base-service.ts: create already worked via a real isRealUser
// gate; only edit was ever actually blocked, and that gap is now closed too
// (this conversion widened updateKbPage to accept PROJEXA's API-key actor
// the same way submitSalesInvoice/submitSalesCreditNote were widened for
// module #13/Invoices).
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, FileText, Search } from "lucide-react";
import { errorMessage } from "@/lib/fetch-json";

type KbPage = { id: string; slug: string; title: string; content: string | null; version: number };

export default function KnowledgeBaseClient() {
  const router = useRouter();
  const [pages, setPages] = useState<KbPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge-base");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load knowledge base");
      setPages(data.pages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) { load(); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge-base/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setPages(data.pages ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Search failed"));
    } finally {
      setSearching(false);
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load knowledge base: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-px-muted" />
          <Input value={query} onChange={(e) => runSearch(e.target.value)} placeholder="Search…" className="pl-7" />
        </div>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New Page"
            Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/knowledge-base/new")}><Plus className="size-4" /> New Page</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {searching ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : pages.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No pages yet.</p>
          ) : (
            <div className="divide-y divide-px-border">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => router.push(`/knowledge-base/${page.id}`)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-px-cloud/40"
                >
                  <FileText className="size-4 shrink-0 text-px-muted" />
                  <span className="flex-1 font-medium text-px-ink">{page.title}</span>
                  <span className="text-xs text-px-muted">v{page.version}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
