"use client";

// Real-screen conversion (2026-08-30) -- replaces DrawingsClient.tsx's old
// "Add Drawing" Dialog popup with a real create screen, same fields
// (kind, discipline, file-or-external-link for 3D walkthroughs).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DrawingCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"dwg" | "3d_walkthrough">("dwg");
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const usingLink = kind === "3d_walkthrough" && linkMode;

  async function createDrawing() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (usingLink ? !externalUrl.trim() : !fileInputRef.current?.files?.[0]) {
      toast.error(usingLink ? "A walkthrough URL is required" : "A file is required");
      return;
    }
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("kind", kind);
    formData.set("name", name.trim());
    if (discipline.trim()) formData.set("discipline", discipline.trim());
    if (usingLink) {
      formData.set("externalUrl", externalUrl.trim());
    } else {
      formData.set("file", fileInputRef.current!.files![0]);
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/drawings", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add drawing");
      toast.success("Drawing added");
      router.push(`/drawings/${data.id}?projectId=${projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add drawing");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Drawings & 3D / New Drawing"
      title="Add Drawing / 3D Walkthrough"
      mode="create"
      hasDraft={false}
      onSave={createDrawing}
      onCancel={() => router.push(`/drawings?projectId=${projectId}`)}
      onBack={() => router.push(`/drawings?projectId=${projectId}`)}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Adding…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "dwg" | "3d_walkthrough")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dwg">DWG Drawing</SelectItem>
              <SelectItem value="3d_walkthrough">3D Walkthrough</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Discipline (optional)</Label><Input value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="Architectural, Structural, MEP..." /></div>
        {kind === "3d_walkthrough" && (
          <button type="button" className="text-sm underline" onClick={() => setLinkMode((v) => !v)}>
            {linkMode ? "Upload a file instead" : "Use an external link instead"}
          </button>
        )}
        {usingLink ? (
          <div className="space-y-1.5"><Label>Walkthrough URL</Label><Input type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://..." /></div>
        ) : (
          <div className="space-y-1.5">
            <Label>File{kind === "dwg" ? " (DWG)" : ""}</Label>
            <Input ref={fileInputRef} type="file" />
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
