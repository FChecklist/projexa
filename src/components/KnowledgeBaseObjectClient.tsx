"use client";

// Real-screen conversion (2026-08-30): Knowledge Base pages never had a
// real, URL-addressable detail view -- selecting a page in the old
// two-pane client only set local React state, and editing was inline in
// that same component. Real Object Page on the kit's ObjectScreen. Real
// Delete = real Archive (updateKbPage({isArchived:true}) -- archived pages
// already existed as a real, designed end-state (listKbPages always
// excluded them), just never reachable from a Delete button. Edit now
// genuinely works for PROJEXA's API-key caller -- see updateKbPage()'s own
// comment in knowledge-base-service.ts for the FK-safety fix this required.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type KbPage = { id: string; slug: string; title: string; content: string | null; version: number; isArchived: boolean; isPublished: boolean };

export default function KnowledgeBaseObjectClient({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [page, setPage] = useState<KbPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<KbPage>(`/api/knowledge-base/${pageId}`);
      setPage(data);
      setLoadError(null);
    } catch (err) {
      setPage(null);
      setLoadError(errorMessage(err, "Couldn't load this page"));
    }
  }
  useEffect(() => { load(); }, [pageId]);

  function startEdit() {
    if (!page) return;
    setDraftTitle(page.title);
    setDraftContent(page.content ?? "");
    setMode("edit");
  }

  async function saveEdit() {
    if (!draftTitle.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-base/${pageId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim(), content: draftContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save page");
      toast.success("Page saved");
      setMode("display");
      setPage(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save page");
    } finally {
      setSaving(false);
    }
  }

  async function archivePage() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/knowledge-base/${pageId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to archive page");
      toast.success("Page archived");
      router.push("/knowledge-base");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't archive page");
    } finally {
      setArchiving(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!page) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const tone: StatusTone = page.isArchived ? "late" : page.isPublished ? "done" : "neutral";
  const label = page.isArchived ? "archived" : page.isPublished ? "published" : "internal";

  return (
    <ObjectScreen
      breadcrumb="Knowledge Base / Page"
      title={mode === "edit" ? "Edit Page" : page.title}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone, label }}
      facets={[{ label: "Slug", value: page.slug }, { label: "Version", value: `v${page.version}` }]}
      onEdit={!page.isArchived && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={!page.isArchived && mode === "display" ? archivePage : undefined}
      deleteDisabledReason={archiving ? "Archiving…" : undefined}
      onBack={() => router.push("/knowledge-base")}
      saveDisabled={saving || !draftTitle.trim()}
      saveDisabledReason={saving ? "Saving…" : !draftTitle.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {mode === "edit" ? (
          <>
            <div className="space-y-1.5"><Label>Title</Label><Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <Textarea value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={16} className="font-mono text-sm" />
            </div>
          </>
        ) : (
          <div className="whitespace-pre-wrap text-sm text-px-ink">
            {page.content || <span className="text-px-muted">This page is empty. Click Edit to add content.</span>}
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
