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
//
// R67 D-09 (audit R-027). The disabled reason counted ONLY the name while the
// submit guard also demanded a file or a URL, so a user who filled in Name saw
// an enabled Save that then failed with a toast -- the fail-after-click this
// product's own rules forbid. The counter now counts every mandatory field, in
// the same "Save (Name, File)" form /labour/new uses, and the file field
// filters what can be chosen by Kind instead of accepting anything and failing
// server-side.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DataLoadError from "@/components/DataLoadError";
import { setScreenMessage } from "@/lib/screen-message";
import { fileSizeError, fileTypeError } from "@/lib/file-limits";

export type DrawingKind = "dwg" | "3d_walkthrough";

/** The bucket's own cap is 25 MB for documents; drawings are the large ones. */
export const MAX_DRAWING_MB = 50;

/**
 * What each Kind's file field takes. A DWG drawing is a CAD file or the PDF
 * plot of one; a 3D walkthrough is a model or a recorded fly-through. The
 * accept attribute is built from this same list, so the filter the OS picker
 * applies and the message shown when it is bypassed can never drift apart.
 */
export const ACCEPTED_EXTENSIONS: Record<DrawingKind, readonly string[]> = {
  dwg: [".dwg", ".dxf", ".pdf"],
  "3d_walkthrough": [".glb", ".gltf", ".fbx", ".mp4"],
};

export function acceptFor(kind: DrawingKind): string {
  return ACCEPTED_EXTENSIONS[kind].join(",");
}

/**
 * R67 D-09. Every mandatory field, in field order, in the label the field
 * itself carries -- so "Save (Name, File)" names things the user can point at.
 * Which second field is mandatory depends on the Source the form is on: a
 * walkthrough given as a link has no file, and a file has no URL.
 */
export function missingDrawingFields(input: {
  name: string;
  usingLink: boolean;
  externalUrl: string;
  hasFile: boolean;
}): string[] {
  return [
    ...(input.name.trim() ? [] : ["Name"]),
    ...(input.usingLink
      ? input.externalUrl.trim()
        ? []
        : ["Walkthrough URL"]
      : input.hasFile
        ? []
        : ["File"]),
  ];
}

/** "Enter a link starting with http:// or https://" -- checked on blur. */
export function walkthroughUrlError(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined; // absence is the counter's job, not an error
  return /^https?:\/\/\S+$/i.test(trimmed) ? undefined : "Enter a link starting with http:// or https://";
}

/**
 * The one reason the primary action states, in precedence order. A field that
 * is filled but WRONG outranks the counter (it is a more specific thing to
 * say), and a project that never loaded outranks everything (there is nothing
 * to write to, whatever the form says).
 */
export function drawingSaveReason(input: {
  projectLoaded: boolean;
  submitting: boolean;
  missing: string[];
  attention: number;
}): string | undefined {
  if (!input.projectLoaded) return "Project not loaded";
  if (input.submitting) return "Adding…";
  if (input.attention > 0) {
    return `${input.attention} field${input.attention === 1 ? "" : "s"} need${input.attention === 1 ? "s" : ""} attention`;
  }
  if (input.missing.length > 0) return input.missing.join(", ");
  return undefined;
}

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
  const [kind, setKind] = useState<DrawingKind>("dwg");
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
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
  const extensions = ACCEPTED_EXTENSIONS[kind];
  // Checked the moment a file is chosen: choosing IS the interaction, so
  // waiting for a blur that may never come would hide the problem until Save.
  const fileError = file ? fileTypeError(file.name, extensions) ?? fileSizeError(file.size, MAX_DRAWING_MB) : undefined;
  const urlError = urlTouched && usingLink ? walkthroughUrlError(externalUrl) : undefined;
  const missing = missingDrawingFields({ name, usingLink, externalUrl, hasFile: !usingLink && file !== null });
  const attention = (fileError ? 1 : 0) + (urlError ? 1 : 0);
  const saveDisabledReason = drawingSaveReason({
    projectLoaded: !!resolvedId,
    submitting,
    missing,
    attention,
  });

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

  // Switching Kind changes what the file field accepts, so a file chosen
  // under the old Kind must not silently survive into the new one.
  function changeKind(next: DrawingKind) {
    setKind(next);
    if (next === "dwg") setLinkMode(false);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function createDrawing() {
    if (saveDisabledReason || !resolvedId) return;
    const formData = new FormData();
    formData.set("projectId", resolvedId);
    formData.set("kind", kind);
    formData.set("name", name.trim());
    if (discipline.trim()) formData.set("discipline", discipline.trim());
    if (usingLink) {
      formData.set("externalUrl", externalUrl.trim());
    } else {
      formData.set("file", file!);
    }
    setSubmitting(true);
    setMessages([]);
    try {
      const res = await fetch("/api/drawings", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's own validation ("DWG drawings require a file upload")
        // is the second line of defence, and it belongs in the frame's
        // persistent message band -- not in a toast that is gone before the
        // user has finished reading it.
        setMessages([{ level: "error", text: data.error ?? `Couldn't add this drawing (HTTP ${res.status})` }]);
        setSubmitting(false);
        return;
      }
      // The receipt has to outlive this screen, which the push below is
      // about to replace -- see screen-message.ts.
      setScreenMessage("drawings.object", { level: "success", text: `Drawing ${name.trim()} added` });
      router.push(`/drawings/${data.id}?projectId=${resolvedId}`);
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't add this drawing" }]);
      setSubmitting(false);
    }
  }

  const backToList = () => router.push(resolvedId ? `/drawings?projectId=${resolvedId}` : "/drawings");

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
      // Named inside the button, matching /labour/new's "Save (Name, Daily
      // Rate)" -- the convention correction C-11 records as this product's
      // good one. It stays short by construction: these are field labels, not
      // a sentence (the sentence form is the permit form's counter, which has
      // four fields to name).
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
          <Select value={kind} onValueChange={(v) => changeKind(v as DrawingKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dwg">DWG Drawing</SelectItem>
              <SelectItem value="3d_walkthrough">3D Walkthrough</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="discipline">Discipline (optional)</Label><Input id="discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="Architectural, Structural, MEP..." /></div>
        {/* R67 D-09: was an underlined text button reading "Use an external
            link instead" -- a toggle whose current state you had to infer
            from the label of the thing it would do next. Two labelled
            options, one of them visibly chosen. */}
        {kind === "3d_walkthrough" && (
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Source</legend>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="radio"
                  name="drawing-source"
                  value="file"
                  checked={!linkMode}
                  onChange={() => {
                    setLinkMode(false);
                    setUrlTouched(false);
                  }}
                />
                Upload a file
              </label>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="radio"
                  name="drawing-source"
                  value="link"
                  checked={linkMode}
                  onChange={() => {
                    setLinkMode(true);
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                External link
              </label>
            </div>
          </fieldset>
        )}
        {usingLink ? (
          <div className="space-y-1.5">
            <Label htmlFor="externalUrl">Walkthrough URL</Label>
            <Input
              id="externalUrl"
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              onBlur={() => setUrlTouched(true)}
              placeholder="https://..."
            />
            {urlError && (
              <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{urlError}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="file">File{kind === "dwg" ? " (DWG)" : ""}</Label>
            <Input
              id="file"
              ref={fileInputRef}
              type="file"
              accept={acceptFor(kind)}
              onChange={(e) => setFile(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null)}
            />
            <p className="text-[12.5px] text-ct-muted">Max {MAX_DRAWING_MB} MB</p>
            {fileError && (
              <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{fileError}</p>
            )}
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
