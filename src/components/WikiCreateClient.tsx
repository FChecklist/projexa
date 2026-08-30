"use client";

// Real-screen conversion (2026-08-30): replaces WikiClient.tsx's old "New
// Page" Dialog popup with a real create screen. This action genuinely
// works via PROJEXA's shared API key -- createWikiPage() already degrades
// updatedById to null rather than rejecting (see WikiObjectClient.tsx's
// header comment for the full identity-bridge finding).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function WikiCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSubmitting(true);
    try {
      const page = await fetchJson<{ id: string }>("/api/wiki", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: title.trim(), content: content || undefined }),
      });
      toast.success("Page created");
      router.push(`/wiki/${page.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create page"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Wiki / New Page"
      title="New Wiki Page"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push(`/wiki?projectId=${projectId}`)}
      onBack={() => router.push(`/wiki?projectId=${projectId}`)}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Saving…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Content (optional)</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} className="font-mono text-sm" /></div>
      </div>
    </ObjectScreen>
  );
}
