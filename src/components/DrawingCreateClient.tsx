"use client";

// Real-screen conversion (2026-08-30) -- replaced DrawingsClient.tsx's old
// "Add Drawing" Dialog popup with a real create screen, same fields
// (kind, discipline, file-or-external-link for 3D walkthroughs).
//
// R67 D-08 (audit R-032). The screen is now unconditional. drawings/new/
// page.tsx used to return a bare error Card INSTEAD of this component
// whenever the project list failed to resolve, so a backend hiccup replaced
// the entire right pane with the words "Internal Server Error" -- no title,
// no Back, no Retry. This component now always renders its own frame
// (breadcrumb, Back, title "New Drawing") and reports the failure INSIDE it,
// with a Retry that re-fetches the project list rather than a dead end.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DataLoadError from "@/components/DataLoadError";
import { setScreenMessage } from "@/lib/screen-message";

/**
 * R67 D-08. The standing rule in this codebase is to show the backend's OWN
 * words (see DataLoadError's header), and this keeps them -- with one
 * exception, which is the whole point of the item: a bare "Internal Server
 * Error" is not the backend's words about anything. It is the HTTP status
 * phrase, it names no subject, and it is precisely the card that used to
 * replace this entire screen. A message that says nothing is replaced by one
 * that says which call failed and who answered; every other message, including
 * every real VERIDIAN message, passes through untouched.
 */
export function describeProjectLoadFailure(raw: string): string {
  return /^(internal server error|internal error|error|500)\.?$/i.test(raw.trim())
    ? "The project list did not load — VERIDIAN answered with an internal error."
    : raw;
}

export default function DrawingCreateClient({
  projectId,
  projectName,
  projectError,
}: {
  /** From ?projectId= first, the resolved project second, null when neither is available. */
  projectId?: string | null;
  projectName?: string;
  /** resolveSelectedProject's own backend message, or null. Never replaces this screen. */
  projectError?: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"dwg" | "3d_walkthrough">("dwg");
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  // The project this screen will write to. Seeded from the server, and
  // recoverable in the browser: Retry re-fetches /api/projects, so a
  // transient failure at render time does not strand the screen.
  const [resolvedId, setResolvedId] = useState<string | null>(projectId ?? null);
  const [resolvedName, setResolvedName] = useState<string | undefined>(projectName);
  const [loadError, setLoadError] = useState<string | null>(projectError ?? null);
  const [retrying, setRetrying] = useState(false);

  const usingLink = kind === "3d_walkthrough" && linkMode;

  // The name is resolved in the BACKGROUND -- it is a label, never a
  // precondition for writing. The create call needs the id alone, and
  // VERIDIAN scopes that id to the caller's org on the write itself.
  async function loadProjects(): Promise<void> {
    setRetrying(true);
    try {
      const res = await fetch("/api/projects");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(body.error ?? `Couldn't load your project list (HTTP ${res.status})`);
        return;
      }
      const projects: { id: string; name: string }[] = body.projects ?? [];
      const match = (resolvedId && projects.find((p) => p.id === resolvedId)) || projects[0] || null;
      if (match) {
        setResolvedId(match.id);
        setResolvedName(match.name);
        setLoadError(null);
      } else {
        setLoadError("No projects came back for this organisation.");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load your project list");
    } finally {
      setRetrying(false);
    }
  }

  // Fill in a missing name (or a missing id) without being asked, so the
  // screen names its destination as soon as it can rather than only after a
  // manual Retry.
  useEffect(() => {
    if (resolvedId && resolvedName) return;
    void loadProjects();
    // Runs once per mount; Retry is the explicit re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDrawing() {
    if (!resolvedId) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (usingLink ? !externalUrl.trim() : !fileInputRef.current?.files?.[0]) {
      toast.error(usingLink ? "A walkthrough URL is required" : "A file is required");
      return;
    }
    const formData = new FormData();
    formData.set("projectId", resolvedId);
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
      // The receipt has to outlive this screen, which the push below is
      // about to replace -- see screen-message.ts.
      setScreenMessage("drawings.object", { level: "success", text: `Drawing ${name.trim()} added` });
      router.push(`/drawings/${data.id}?projectId=${resolvedId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add drawing");
    } finally {
      setSubmitting(false);
    }
  }

  const backToList = () => router.push(resolvedId ? `/drawings?projectId=${resolvedId}` : "/drawings");

  // "Project not loaded" is the one reason that outranks every field: with no
  // project id there is nothing to write to, whatever the form says.
  const saveDisabledReason = !resolvedId
    ? "Project not loaded"
    : submitting
      ? "Adding…"
      : !name.trim()
        ? "Name is required"
        : undefined;

  return (
    <ObjectScreen
      breadcrumb="Drawings & 3D / New Drawing"
      title="New Drawing"
      subtitle={resolvedName ? `For project: ${resolvedName}` : undefined}
      mode="create"
      hasDraft={false}
      onSave={createDrawing}
      onCancel={backToList}
      onBack={backToList}
      saveDisabled={!!saveDisabledReason}
      saveDisabledReason={saveDisabledReason}
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        {/* The failure is reported here, inside the screen, with the
            backend's own words and a way out -- never as a replacement for
            the screen. */}
        {loadError && (
          <DataLoadError messages={[describeProjectLoadFailure(loadError)]} onRetry={() => void loadProjects()} />
        )}
        {!loadError && !resolvedId && (
          <p role="status" className="text-[12.5px] text-ct-muted">
            {retrying ? "Loading your project list…" : "No project is selected yet. Choose one in the top rail."}
          </p>
        )}
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
        <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="discipline">Discipline (optional)</Label><Input id="discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="Architectural, Structural, MEP..." /></div>
        {kind === "3d_walkthrough" && (
          <button type="button" className="text-sm underline" onClick={() => setLinkMode((v) => !v)}>
            {linkMode ? "Upload a file instead" : "Use an external link instead"}
          </button>
        )}
        {usingLink ? (
          <div className="space-y-1.5"><Label htmlFor="externalUrl">Walkthrough URL</Label><Input id="externalUrl" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://..." /></div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="file">File{kind === "dwg" ? " (DWG)" : ""}</Label>
            <Input id="file" ref={fileInputRef} type="file" />
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
