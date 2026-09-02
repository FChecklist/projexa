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
import Link from "next/link";
import { PROJECT_LIST_UNAVAILABLE_REASON, projectListFailureBanner } from "@/lib/project-selection";
import { setScreenMessage } from "@/lib/screen-message";
import {
  STORAGE_UNAVAILABLE_BANNER,
  STORAGE_UNAVAILABLE_REASON,
  fileSizeError,
  fileTypeError,
} from "@/lib/file-limits";
import { CREATE_STATUS_OPTIONS, DEFAULT_DRAWING_STATUS, type DrawingStatus } from "@/lib/drawing-status";

export type DrawingKind = "dwg" | "3d_walkthrough";

/**
 * R67 D-78 CORRECTION. This was 50, and the hint under the file input said
 * "Max 50 MB" -- but createDrawingRecord() shares prepareDocumentStorage() with
 * every other upload in VERIDIAN, whose MAX_SIZE_BYTES is 25 MB and whose own
 * comment says that number matches the bucket's file_size_limit. So a 40 MB
 * drawing passed every client-side check this screen makes and was then refused
 * server-side with "File exceeds 25 MB limit" -- the exact fail-after-click R67
 * D-09 set out to remove from this form, still live because the client's number
 * and the server's number were written in different files on different days.
 */
export const MAX_DRAWING_MB = 25;

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
  drawingNo: string;
  rev: string;
  usingLink: boolean;
  externalUrl: string;
  hasFile: boolean;
}): string[] {
  return [
    ...(input.name.trim() ? [] : ["Name"]),
    // R67 D-12: a register that cannot answer "is this the one I build from?"
    // is not a register, and it cannot answer it for a drawing that has no
    // number and no revision -- the supersede rule is keyed on exactly those.
    ...(input.drawingNo.trim() ? [] : ["Drawing No."]),
    ...(input.rev.trim() ? [] : ["Rev"]),
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
  /**
   * R67 D-78: the LABELS of the fields needing attention, in field order. When
   * they are known the button names them -- "Save (File (DWG))" -- because
   * "1 field needs attention" tells a user there is a problem and not where.
   * The count remains the fallback for a caller that cannot name them.
   */
  attentionFields?: string[];
  /**
   * R67 D-78: the server cannot accept a file at all. First, because it is the
   * only one of these no retry and no correction on this form can clear.
   */
  storageUnavailable?: boolean;
}): string | undefined {
  if (input.storageUnavailable) return STORAGE_UNAVAILABLE_REASON;
  // R67 D-70: was "Project not loaded". Every create route in the app now
  // states this same reason for this same condition, from one constant, so the
  // user meets one sentence rather than twenty-three near-misses.
  if (!input.projectLoaded) return PROJECT_LIST_UNAVAILABLE_REASON;
  if (input.submitting) return "Adding…";
  if (input.attention > 0) {
    if (input.attentionFields && input.attentionFields.length > 0) return input.attentionFields.join(", ");
    return `${input.attention} field${input.attention === 1 ? "" : "s"} need${input.attention === 1 ? "s" : ""} attention`;
  }
  if (input.missing.length > 0) return input.missing.join(", ");
  return undefined;
}

// R67 D-08 introduced describeProjectLoadFailure() here -- replace a bare HTTP
// status phrase with a sentence that names the failed call, pass every real
// backend message through untouched. R67 D-70 gives that SAME failure the same
// words on all 23 create routes, so the rule moved to
// src/lib/project-selection.ts (describeProjectListFailure / the banner built
// from it) and this copy is gone rather than left as a second definition: two
// copies is how two screens start disagreeing about what a 500 sounds like.

export default function DrawingCreateClient({
  projectId,
  projectName,
  projectError,
  storageConfigured = true,
}: {
  /** From ?projectId= first, the resolved project second, null when neither is available. */
  projectId?: string | null;
  projectName?: string;
  /** resolveSelectedProject's own backend message, or null. Never replaces this screen. */
  projectError?: string | null;
  /**
   * R67 D-78: resolved server-side from VERIDIAN's own storage probe. Defaults
   * to true so the guard can only ever be an ADDITIONAL block, never a new way
   * for this screen to refuse work it could have done.
   */
  storageConfigured?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DrawingKind>("dwg");
  const [name, setName] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [rev, setRev] = useState("");
  const [status, setStatus] = useState<DrawingStatus>(DEFAULT_DRAWING_STATUS);
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
  const missing = missingDrawingFields({ name, drawingNo, rev, usingLink, externalUrl, hasFile: !usingLink && file !== null });
  // R67 D-78: the field's OWN label, so the button can name it -- "Save (File
  // (DWG))" rather than "Save (1 field needs attention)".
  const fileFieldLabel = `File${kind === "dwg" ? " (DWG)" : ""}`;
  const attentionFields = [...(fileError ? [fileFieldLabel] : []), ...(urlError ? ["Walkthrough URL"] : [])];
  const attention = attentionFields.length;
  const saveDisabledReason = drawingSaveReason({
    storageUnavailable: !storageConfigured,
    projectLoaded: !!resolvedId,
    submitting,
    missing,
    attention,
    attentionFields,
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
    // Runs once per mount; Retry is the explicit re-run.
    void loadProjects();
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
    formData.set("drawingNo", drawingNo.trim());
    formData.set("rev", rev.trim());
    formData.set("status", status);
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
        {/* R67 D-78: stated BEFORE the file field, because it is the one thing
            on this screen that makes filling the form in pointless. */}
        {!storageConfigured && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--color-veri-status-late)] bg-[color:var(--color-veri-status-late)]/5 p-3 text-[13px]"
          >
            {STORAGE_UNAVAILABLE_BANNER}
          </p>
        )}
        {/* The failure is reported here, inside the screen, with the
            backend's own words and a way out -- never as a replacement for
            the screen. */}
        {/* R67 D-70: the same banner, Retry and Back-to-module every other
            create route now shows for this same failure. Retry here re-fetches
            /api/projects in the browser (this screen holds its own project
            state), which is a truer retry than a page refresh. */}
        {loadError && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-[color:var(--color-veri-status-late)] bg-[color:var(--color-veri-status-late)]/5 p-3 text-[13px]"
          >
            <p>{projectListFailureBanner(loadError)}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void loadProjects()}
                disabled={retrying}
                aria-busy={retrying}
                className="font-medium underline disabled:opacity-50"
              >
                {/* The LABEL never changes. A control whose name is different
                    while it is working is a different control to a screen
                    reader, and to anyone looking for the word they were told
                    to click. Its busy state is aria-busy and the disabled
                    attribute, not a rename. */}
                Retry
              </button>
              <Link href="/drawings" className="font-medium underline">
                Back to Drawings
              </Link>
            </div>
          </div>
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
        {/* R67 D-12: the register's own identity. The supersede rule is keyed
            on Drawing No., so a drawing without one can never take over from
            the revision it replaces. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="drawingNo">Drawing No.</Label>
            <Input id="drawingNo" value={drawingNo} onChange={(e) => setDrawingNo(e.target.value)} placeholder="e.g. AR-101" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev">Rev</Label>
            <Input id="rev" value={rev} onChange={(e) => setRev(e.target.value)} placeholder="e.g. A" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as DrawingStatus)}
            className="w-full rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
          >
            {CREATE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-[12.5px] text-ct-muted">
            Choosing Current supersedes the drawing with the same Drawing No. that people are building from today.
          </p>
        </div>
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
            <Label htmlFor="file">{fileFieldLabel}</Label>
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
