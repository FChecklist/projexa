"use client";

// Priority 17 Wave 1: org-wide Knowledge Base, over the previously-unexposed
// VERIDIAN knowledge-base-service.ts (distinct from the per-project Wiki --
// this is org-wide reference material, not project working notes). Honest
// limitation: create/edit require a real VERIDIAN user session
// (knowledge_base_pages.updated_by_id is FK'd to compliance.users), same
// pre-existing identity-bridge gap as Wiki/Timesheets.
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, FileText, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

type KbPage = { id: string; slug: string; title: string; content: string | null; version: number };

export default function KnowledgeBaseClient() {
  const [pages, setPages] = useState<KbPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<KbPage | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge-base");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load knowledge base");
      const loaded: KbPage[] = data.pages ?? [];
      setPages(loaded);
      setSelected((prev) => prev ?? loaded[0] ?? null);
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
      setPages(data.pages ?? []);
    } catch {
      toast.error("Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function createPage() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create page");
      toast.success("Page created");
      setNewTitle(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create page");
    } finally {
      setCreating(false);
    }
  }

  function startEdit() {
    setDraftContent(selected?.content ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-base/${encodeURIComponent(selected.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save page");
      toast.success("Page saved");
      setEditing(false);
      setSelected(data);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save page");
    } finally {
      setSaving(false);
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
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <Card className="shadow-card h-fit">
        <CardContent className="space-y-2 p-3">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" className="w-full"><Plus className="size-4" /> New Page</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Knowledge Base Page</DialogTitle></DialogHeader>
              <div className="space-y-1.5"><Label>Title</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
              <DialogFooter><Button onClick={createPage} disabled={creating || !newTitle.trim()}>{creating ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-px-muted" />
            <Input value={query} onChange={(e) => runSearch(e.target.value)} placeholder="Search…" className="pl-7" />
          </div>
          <div className="space-y-1">
            {searching ? (
              <Loader2 className="mx-auto size-4 animate-spin text-px-muted" />
            ) : pages.length === 0 ? (
              <p className="p-2 text-xs text-px-muted">No pages yet.</p>
            ) : (
              pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => { setSelected(page); setEditing(false); }}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${selected?.id === page.id ? "bg-px-orange/10 text-px-ink font-medium" : "text-px-muted hover:bg-px-cloud/60"}`}
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{page.title}</span>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card min-h-[24rem]">
        <CardContent className="p-6">
          {!selected ? (
            <p className="text-sm text-px-muted">Select or create a page.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-lg text-px-ink">{selected.title}</h3>
                {!editing && <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button>}
              </div>
              {editing ? (
                <div className="space-y-3">
                  <Textarea value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={16} className="font-mono text-sm" />
                  <div className="flex gap-2">
                    <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                    <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-sm text-px-ink">
                  {selected.content || <span className="text-px-muted">This page is empty. Click Edit to add content.</span>}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
