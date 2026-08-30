"use client";

// Real-screen conversion (2026-08-30): replaces KnowledgeBaseClient.tsx's
// old "New Page" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function KnowledgeBaseCreateClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createPage() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const page = await fetchJson<{ id: string }>("/api/knowledge-base", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      toast.success("Page created");
      router.push(`/knowledge-base/${page.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create page"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Knowledge Base / New Page"
      title="New Knowledge Base Page"
      mode="create"
      hasDraft={false}
      onSave={createPage}
      onCancel={() => router.push("/knowledge-base")}
      onBack={() => router.push("/knowledge-base")}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
