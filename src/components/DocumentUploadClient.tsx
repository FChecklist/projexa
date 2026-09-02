"use client";

// Real-screen conversion (2026-08-30) -- replaces DocumentsClient.tsx's old
// "Upload Document" Dialog popup with a real create screen, same fields.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

export default function DocumentUploadClient({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("A file is required");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    if (name.trim()) formData.set("name", name.trim());
    formData.set("category", category);
    formData.set("linkedEntityType", "project");
    formData.set("linkedEntityId", projectId);
    setUploading(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to upload document");
      toast.success("Document uploaded");
      router.push(`/documents/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload document");
    } finally {
      setUploading(false);
    }
  }

  return (
    <ObjectScreen
      // R67 D-13: "Upload Document" was the only screen in this product that
      // named a create screen after the mechanism rather than after the thing
      // being created. Every other one is "New <Object>".
      breadcrumb="Documents / New Document"
      title="New Document"
      facets={projectName ? [{ label: "Project", value: projectName }] : undefined}
      mode="create"
      hasDraft={false}
      onSave={handleUpload}
      onCancel={() => router.push(`/documents?projectId=${projectId}`)}
      onBack={() => router.push(`/documents?projectId=${projectId}`)}
      saveDisabled={uploading || !fileName}
      saveDisabledReason={uploading ? "Uploading…" : !fileName ? "A file is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name (optional)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>File (PDF, email, etc.)</Label>
          <Input ref={fileInputRef} type="file" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        </div>
      </div>
    </ObjectScreen>
  );
}
