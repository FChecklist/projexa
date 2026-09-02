"use client";

// Real-screen conversion (2026-08-30) -- replaces DocumentsClient.tsx's old
// "Upload Document" Dialog popup with a real create screen.
//
// R67 D-13/D-14 (audit R-039/R-044). What was wrong with the screen that
// replaced the dialog: it was titled after the mechanism ("Upload Document"),
// it opened with Category = "other" and linkedEntityType hard-coded to the
// literal string "project", and its only affordance was a bare file input. A
// site engineer who dropped DEWA_permit_2026.pdf and pressed Save filed a
// permit called "DEWA_permit_2026.pdf", categorised "other", related to
// nothing -- and every failure on the way was a four-second toast.
//
// It is now a create screen that reads the file it has been handed: a real drop
// zone, the name defaulted from the file, the category defaulted from what this
// user filed last (else from the file itself), the three email header fields
// filled from an .eml where they are parseable, and a "Relates to" combobox
// over this project's permits, RFIs and meetings. Every message -- the size
// refusal, the backend's own words -- lands in the screen's own message band.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/fetch-json";
import { setScreenMessage } from "@/lib/screen-message";
import { STORAGE_UNAVAILABLE_BANNER, STORAGE_UNAVAILABLE_REASON } from "@/lib/file-limits";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_MB,
  defaultCategory,
  describeFileSize,
  documentSizeError,
  documentTypeError,
  fileStem,
  parseEmailHeaders,
  readLastCategory,
  writeLastCategory,
  type EmailHeaders,
} from "@/lib/document-intake";

export const DROP_ZONE_LABEL = `Drop a PDF, image or email here, or Choose File - up to ${DOCUMENT_MAX_MB} MB`;

type RelatesToOption = { type: "project" | "permit" | "rfi" | "mom"; id: string; label: string };

/** The value the combobox holds -- "permit:abc123" -- split back apart on save. */
export function encodeRelatesTo(option: { type: string; id: string }): string {
  return `${option.type}:${option.id}`;
}

export function decodeRelatesTo(value: string): { type: string; id: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return id ? { type, id } : null;
}

/**
 * The button's own name says what is still missing, in the convention
 * /labour/new set ("Save (Name, Daily Rate)"). A file is the one thing this
 * screen cannot do without -- everything else has a defensible default.
 */
export function documentSaveReason(
  hasFile: boolean,
  fileError: string | undefined,
  saving: boolean,
  storageUnavailable = false
): string | undefined {
  // R67 D-78: first, because it is the only one of these the user cannot clear.
  if (storageUnavailable) return STORAGE_UNAVAILABLE_REASON;
  if (saving) return "Saving…";
  if (!hasFile) return "A file is required";
  // R67 D-78: names the field, not a count -- "File" is the only field this can
  // ever be about, and "1 field needs attention" made the reader look for it.
  if (fileError) return "File";
  return undefined;
}

export default function DocumentUploadClient({
  projectId,
  projectName,
  storageConfigured = true,
}: {
  projectId: string;
  projectName?: string;
  /** R67 D-78: from VERIDIAN's own storage probe, resolved server-side. Defaults to true. */
  storageConfigured?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [email, setEmail] = useState<EmailHeaders>({ from: "", receivedOn: "", subject: "" });
  const [relatesTo, setRelatesTo] = useState(`project:${projectId}`);
  const [options, setOptions] = useState<RelatesToOption[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  const sizeError = documentSizeError(file?.size ?? null);
  // R67 D-78: the drop zone accepts anything dropped on it -- the accept
  // attribute filters the PICKER and nothing else -- so a .zip landed here,
  // uploaded, and came back as VERIDIAN's flat "Failed to upload document".
  // Type before size: a .zip is not "too big", it is the wrong thing.
  const typeError = documentTypeError(file?.name ?? null);
  const fileError = typeError ?? sizeError;

  // "Relates to" is a real list of this project's own records. Each read is
  // allowed to fail on its own: a permits list that does not answer costs one
  // group of options, never the ability to file the document against the
  // project (the default, which needs no read at all).
  useEffect(() => {
    let cancelled = false;
    const scope = encodeURIComponent(projectId);
    (async () => {
      const [permits, rfis, moms] = await Promise.allSettled([
        fetchJson<{ permits?: { id: string; name: string; permitNumber: string | null }[] }>(`/api/permits?projectId=${scope}&all=true`),
        fetchJson<{ rfis?: { id: string; number: number; subject: string }[] }>(`/api/rfis?projectId=${scope}`),
        fetchJson<{ meetings?: { id: string; title: string }[] }>(`/api/moms?projectId=${scope}`),
      ]);
      if (cancelled) return;
      const next: RelatesToOption[] = [];
      if (permits.status === "fulfilled") {
        for (const p of permits.value.permits ?? []) {
          next.push({ type: "permit", id: p.id, label: p.permitNumber ? `${p.name} (${p.permitNumber})` : p.name });
        }
      }
      if (rfis.status === "fulfilled") {
        for (const r of rfis.value.rfis ?? []) next.push({ type: "rfi", id: r.id, label: `RFI ${r.number} — ${r.subject}` });
      }
      if (moms.status === "fulfilled") {
        for (const m of moms.value.meetings ?? []) next.push({ type: "mom", id: m.id, label: m.title });
      }
      setOptions(next);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const acceptFile = useCallback(async (chosen: File | null) => {
    setFile(chosen);
    if (!chosen) return;
    // The name defaults to the file's stem -- the hint under the field says so,
    // because a default nobody was told about is indistinguishable from a value
    // the user typed and forgot.
    setName(fileStem(chosen.name));
    const nextCategory = defaultCategory(chosen.name, readLastCategory());
    setCategory(nextCategory);
    setMessages([]);

    if (nextCategory === "email") {
      // Best effort, and only for a file small enough that reading it costs
      // nothing. An unparseable email leaves the three fields empty for the
      // user to fill; it never guesses.
      try {
        const text = await chosen.slice(0, 64 * 1024).text();
        setEmail(parseEmailHeaders(text));
      } catch {
        setEmail({ from: "", receivedOn: "", subject: "" });
      }
    } else {
      setEmail({ from: "", receivedOn: "", subject: "" });
    }
  }, []);

  async function handleSave() {
    if (!file) return;
    if (fileError) {
      setMessages([{ level: "error", text: fileError }]);
      return;
    }
    const relation = decodeRelatesTo(relatesTo);
    const formData = new FormData();
    formData.set("file", file);
    if (name.trim()) formData.set("name", name.trim());
    formData.set("category", category);
    // R67 D-14: what the document is RELATED to...
    formData.set("linkedEntityType", relation?.type ?? "project");
    formData.set("linkedEntityId", relation?.id ?? projectId);
    // ...and the project it BELONGS to, which is how the project's Documents
    // list still finds a document filed against one of its permits.
    formData.set("projectId", projectId);
    if (category === "email") {
      if (email.from.trim()) formData.set("emailFrom", email.from.trim());
      if (email.receivedOn.trim()) formData.set("emailReceivedOn", email.receivedOn.trim());
      if (email.subject.trim()) formData.set("emailSubject", email.subject.trim());
    }

    setSaving(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to upload document");
      writeLastCategory(category);
      // The receipt is handed to the screen that replaces this one, not shown
      // in a toast that vanishes during the navigation.
      setScreenMessage("documents.object", { level: "success", text: `Document ${name.trim() || file.name} added` });
      router.push(`/documents/${data.id}`);
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't upload document" }]);
    } finally {
      setSaving(false);
    }
  }

  const saveReason = documentSaveReason(!!file, fileError, saving, !storageConfigured);

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
      onSave={handleSave}
      onCancel={() => router.push(`/documents?projectId=${projectId}`)}
      onBack={() => router.push(`/documents?projectId=${projectId}`)}
      saveDisabled={!!saveReason}
      saveDisabledReason={saveReason}
      messages={messages}
    >
      <div className="space-y-4 px-4 py-3">
        {!storageConfigured && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--color-veri-status-late)] bg-[color:var(--color-veri-status-late)]/5 p-3 text-[13px]"
          >
            {STORAGE_UNAVAILABLE_BANNER}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="document-file">File</Label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void acceptFile(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-md border border-dashed px-4 py-6 text-center text-[13px] ${
              dragging ? "border-ct-teal bg-ct-cloud" : "border-ct-border2 text-ct-muted"
            }`}
          >
            {DROP_ZONE_LABEL}
          </div>
          <input
            id="document-file"
            ref={fileInputRef}
            type="file"
            accept={DOCUMENT_ACCEPT}
            className="sr-only"
            onChange={(e) => void acceptFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="text-[12.5px] text-ct-muted">
              {file.name} — {describeFileSize(file.size)}
            </p>
          )}
          {/* The refusal is at the field, before the upload, in the same units
              as the limit -- never a toast after a failed round trip. */}
          {fileError && <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{fileError}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="document-name">Name</Label>
            <Input id="document-name" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-[12.5px] text-ct-muted">Defaults to the file name</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="document-category">Category</Label>
            <select
              id="document-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
            >
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="document-relates-to">Relates to</Label>
          <select
            id="document-relates-to"
            value={relatesTo}
            onChange={(e) => setRelatesTo(e.target.value)}
            className="w-full rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
          >
            <option value={`project:${projectId}`}>{projectName ? `Project — ${projectName}` : "This project"}</option>
            {options.map((o) => (
              <option key={encodeRelatesTo(o)} value={encodeRelatesTo(o)}>
                {o.type === "permit" ? "Permit" : o.type === "rfi" ? "RFI" : "Minutes of Meeting"} — {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* R67 D-14: an email is filed by who sent it, when it arrived and what
            it was about -- not by a file name. Pre-filled from the .eml's own
            headers where they parse, and editable either way. */}
        {category === "email" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="document-email-from">From</Label>
              <Input id="document-email-from" value={email.from} onChange={(e) => setEmail({ ...email, from: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="document-email-received">Received on</Label>
              <Input id="document-email-received" type="date" value={email.receivedOn} onChange={(e) => setEmail({ ...email, receivedOn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="document-email-subject">Subject</Label>
              <Input id="document-email-subject" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
            </div>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
