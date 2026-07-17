"use client";

// Priority 17 Wave 1: per-project Wiki, over the previously-unexposed
// VERIDIAN pms-wiki-service.ts. Plain text/markdown content, no CRDT
// collaborative editor (matches the backend's own explicit v1 scope).
// Honest limitation: create/edit require a real VERIDIAN user session
// (pms_wiki_pages.updated_by_id is FK'd to compliance.users) -- same
// pre-existing identity-bridge gap as the Timesheet "Log time" action.
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

type WikiPage = { id: string; slug: string; title: string; content: string | null; version: number };

export default function WikiClient({ projectId }: { projectId: string }) {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WikiPage | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load wiki pages");
      const loaded: WikiPage[] = data.pages ?? [];
      setPages(loaded);
      if (!selected && loaded.length) setSelected(loaded[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wiki pages");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function createPage() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/wiki", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: newTitle.trim() }),
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
      const res = await fetch(`/api/wiki/${encodeURIComponent(selected.id)}`, {
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
        <CardContent className="p-4 text-sm text-px-error">Could not load wiki: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Same honest-disclosure treatment as MaterialsClient.tsx/BudgetsClient.tsx's
          own VERIDIAN-dependency notices: state the real reason up front instead of
          only surfacing it in the error toast after a failed click (that toast is
          still wired below via createPage()/saveEdit() and shows VERIDIAN's real
          message verbatim, unchanged). */}
      <p className="text-sm text-px-muted">
        Creating and editing pages on this project&apos;s wiki requires a per-user VERIDIAN session. PROJEXA&apos;s
        connection to VERIDIAN currently authenticates with a shared organization API key, not individual logins,
        so New Page and Save will be rejected until that per-user identity bridge exists. Viewing existing pages is
        unaffected.
      </p>
      <div className="grid grid-cols-[240px_1fr] gap-4">
        <Card className="shadow-card h-fit">
          <CardContent className="space-y-1 p-3">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm" className="mb-2 w-full"><Plus className="size-4" /> New Page</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Wiki Page</DialogTitle></DialogHeader>
                <div className="space-y-1.5"><Label>Title</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
                <DialogFooter><Button onClick={createPage} disabled={creating || !newTitle.trim()}>{creating ? "Creating…" : "Create"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            {pages.length === 0 ? (
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
    </div>
  );
}
