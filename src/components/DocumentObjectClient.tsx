"use client";

// Real-screen conversion (2026-08-30): the Documents list never had a
// detail view -- a file could be uploaded but never viewed/downloaded
// again, and its category/expiry could never be corrected after upload.
// Real Object Page on the kit's ObjectScreen.
//
// R67 D-15 (audit R-036/R-040/R-045). Four things were wrong with it.
//
// 1. The NAME could not be edited. The typo was made at upload time by the same
//    person now looking at the page, and a document called "scan_0012.pdf" is
//    unfindable. Now an Input in edit mode, sent in the PATCH.
// 2. The FILE could not be replaced. The only lifecycle action was Dispose,
//    which is retention-gated -- so it is refused for exactly the fresh upload
//    somebody wants to fix. Now "Replace file" posts a new VERSION (the columns
//    have existed since Wave 61; nothing on PROJEXA's surface exposed them).
// 3. The document could not be SEEN without leaving the page: a link, and
//    beside it a screen-reader-only sentence about the link expiring that no
//    sighted user could read. Now an inline preview (iframe for a PDF, img for
//    an image), the expiry stated in plain visible text, and a signed URL that
//    is re-fetched when it has expired rather than failing silently.
// 4. Dispose's disabled reason was records-management jargon. "No retention
//    policy set" tells a site engineer nothing about what to do next.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";
import { takeScreenMessage } from "@/lib/screen-message";
import { DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, describeFileSize, documentSizeError, relatesToWord } from "@/lib/document-intake";

type DocVersion = { id: string; name: string; versionNumber: number; createdAt: string; fileType: string | null };

type Doc = {
  id: string; name: string; category: string | null; fileType: string | null; fileSize: number | null;
  expiryDate: string | null; versionNumber: number; createdAt: string;
  isDisposed: boolean; legalHold: boolean; disposalDate: string | null;
  linkedEntityType: string | null; linkedEntityId: string | null;
  isExternalLink: boolean; signedUrl: string | null; expiresInSeconds: number;
  versions?: DocVersion[];
};

/**
 * R67 D-15. The reasons Dispose is refused, in a person's language and with the
 * next step in them. The old set was records-management vocabulary: a site
 * engineer reading "No retention policy set" learns neither what a retention
 * policy is nor who can set one.
 */
export function disposeDisabledReason(
  doc: Pick<Doc, "isDisposed" | "legalHold" | "disposalDate">,
  disposing: boolean,
  today: string
): string | undefined {
  if (doc.isDisposed) return "Already disposed";
  if (doc.legalHold) return "On legal hold - cannot be disposed";
  if (!doc.disposalDate) return "Cannot delete - no retention policy is set for this document. Ask an admin to set one.";
  if (doc.disposalDate > today) return `Kept until ${formatDate(doc.disposalDate)} under the retention policy`;
  return disposing ? "Disposing…" : undefined;
}

/**
 * R67 D-15. The Save button's own name, in the convention /labour/new set. A
 * document with no name is unfindable, so it is the one field edit mode cannot
 * do without -- and the button says so instead of failing after the click.
 */
export function documentEditSaveReason(name: string, saving: boolean): string | undefined {
  if (saving) return "Saving…";
  if (!name.trim()) return "Name is required";
  return undefined;
}

/** The PATCH body, so what is sent is testable without driving a controlled input. */
export function documentPatchBody(input: { name: string; category: string; expiryDate: string }) {
  return { name: input.name.trim(), category: input.category, expiryDate: input.expiryDate || null };
}

/** "Link valid for 5 minutes" -- visible, not screen-reader-only. */
export function linkValidityText(expiresInSeconds: number): string {
  const minutes = Math.round(expiresInSeconds / 60);
  return `Link valid for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * What can honestly be shown inline. A PDF and an image can; anything else --
 * a .docx, an .eml, an unknown type, a disposed document whose bytes are gone --
 * gets the link alone rather than an empty grey box that looks like a failure.
 */
export function previewKind(doc: Pick<Doc, "fileType" | "isDisposed" | "signedUrl">): "pdf" | "image" | null {
  if (doc.isDisposed || !doc.signedUrl) return null;
  const type = (doc.fileType ?? "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  return null;
}

export default function DocumentObjectClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [replacement, setReplacement] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [previewFailed, setPreviewFailed] = useState(false);
  /**
   * A signed storage URL is valid for five minutes. A page left open longer than
   * that returns 403 for the preview, which the browser reports to us only as a
   * load error -- so the first failure means "re-sign it", and only a second
   * failure means the file really cannot be shown.
   */
  const [previewRetried, setPreviewRetried] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<Doc>(`/api/documents/${documentId}`);
      setDoc(data);
      // The form fields are seeded by Edit, NOT here. This function is also the
      // "re-sign the expired preview link" path, and seeding here meant a
      // background re-fetch silently overwrote whatever the user had just typed
      // into the Name field -- a rename lost to a link refresh, with no sign
      // that anything had happened.
      setPreviewFailed(false);
      setLoadError(null);
    } catch (err) {
      setDoc(null);
      setLoadError(errorMessage(err, "Couldn't load this document"));
    }
  }, [documentId]);

  useEffect(() => { void load(); }, [load]);

  /** First failure: the link has probably expired -- re-sign it. Second: give up and show the link alone. */
  function handlePreviewError() {
    if (previewRetried) {
      setPreviewFailed(true);
      return;
    }
    setPreviewRetried(true);
    void load();
  }

  // The receipt handed over by the create screen ("Document <name> added").
  useEffect(() => {
    const handed = takeScreenMessage("documents.object");
    if (handed) setMessages([handed]);
  }, []);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // The file first: if it fails, the metadata is left untouched and the
      // reason is on screen, rather than a half-applied edit.
      if (replacement) {
        const sizeError = documentSizeError(replacement.size);
        if (sizeError) throw new Error(sizeError);
        const body = new FormData();
        body.set("file", replacement);
        const versionRes = await fetch(`/api/documents/${documentId}/versions`, { method: "POST", body });
        const versionData = await versionRes.json().catch(() => ({}));
        if (!versionRes.ok) throw new Error(versionData.error ?? "Failed to replace this document's file");
        // The new version is a NEW row -- the page must follow it, or it would
        // keep showing the superseded one.
        setReplacement(null);
        setMessages([{ level: "success", text: `File replaced — version ${versionData.versionNumber ?? ""}`.trim() }]);
        setMode("display");
        router.replace(`/documents/${versionData.id}`);
        return;
      }

      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentPatchBody({ name, category, expiryDate })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save document");
      setMessages([{ level: "success", text: "Saved" }]);
      setMode("display");
      await load();
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't save document" }]);
    } finally {
      setSaving(false);
    }
  }

  async function handleDispose() {
    setDisposing(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/dispose`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to dispose document");
      setMessages([{ level: "success", text: `${doc?.name ?? "Document"} disposed` }]);
      await load();
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't dispose document" }]);
    } finally {
      setDisposing(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (!doc) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const disposeReason = disposeDisabledReason(doc, disposing, today);
  const preview = previewFailed ? null : previewKind(doc);
  const earlierVersions = (doc.versions ?? []).filter((v) => v.id !== doc.id);
  const saveReason = documentEditSaveReason(name, saving);

  return (
    <ObjectScreen
      breadcrumb="Documents / Document"
      title={doc.name}
      subtitle={`Version ${doc.versionNumber}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: doc.isDisposed ? "late" : doc.legalHold ? "needs-you" : "neutral", label: doc.isDisposed ? "disposed" : doc.legalHold ? "legal hold" : (doc.category ?? "uncategorised").replace(/_/g, " ") }}
      facets={[
        { label: "Type", value: doc.fileType ?? "—" },
        { label: "Size", value: doc.fileSize === null || doc.fileSize === undefined ? "—" : describeFileSize(doc.fileSize) },
        { label: "Relates to", value: doc.linkedEntityType ? relatesToWord(doc.linkedEntityType) : "—" },
        { label: "Added", value: formatDate(doc.createdAt) },
        // R67 D-15: earlier versions are listed here and nowhere else -- they
        // are not isLatestVersion, so they never appear as list rows either.
        ...(earlierVersions.length > 0
          ? [{
              label: "Versions",
              value: earlierVersions.map((v) => `v${v.versionNumber} (${formatDate(v.createdAt)})`).join(", "),
            }]
          : []),
      ]}
      onEdit={!doc.isDisposed && mode === "display" ? () => {
        setName(doc.name);
        setCategory(doc.category ?? "other");
        setExpiryDate(doc.expiryDate ? doc.expiryDate.slice(0, 10) : "");
        setReplacement(null);
        setMode("edit");
      } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setReplacement(null); setMode("display"); } : undefined}
      onDelete={!doc.isDisposed ? handleDispose : undefined}
      deleteDisabledReason={disposeReason}
      onBack={() => router.push("/documents")}
      saveDisabled={!!saveReason}
      saveDisabledReason={saveReason}
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        {/* The document itself, on the page. A link alone made every reader
            leave the screen to find out what they were looking at. */}
        {preview === "pdf" && (
          <iframe
            src={doc.signedUrl ?? undefined}
            title={doc.name}
            className="h-[480px] w-full rounded-md border border-ct-border"
            onError={handlePreviewError}
          />
        )}
        {preview === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed,
          // short-lived storage URL cannot go through next/image's optimiser.
          <img
            src={doc.signedUrl ?? undefined}
            alt={doc.name}
            className="h-[480px] w-full rounded-md border border-ct-border object-contain"
            onError={handlePreviewError}
          />
        )}

        {doc.signedUrl && !doc.isDisposed && (
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              View / Download this document
            </a>
            {/* Was sr-only. A sighted user had no way to know the link expires,
                so a tab left open for ten minutes just failed. */}
            {!doc.isExternalLink && (
              <span className="text-[12.5px] text-ct-muted">{linkValidityText(doc.expiresInSeconds)}</span>
            )}
            {!doc.isExternalLink && (
              <button
                type="button"
                onClick={() => void load()}
                className="text-[12.5px] text-ct-muted underline underline-offset-2 hover:text-ct-navy"
              >
                Refresh link
              </button>
            )}
          </p>
        )}
        {doc.isDisposed && <p className="text-sm text-ct-muted">This document has been disposed — the file is no longer retrievable.</p>}

        {mode === "edit" ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="document-name">Name</Label>
                <Input id="document-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-category">Category</Label>
                <select
                  id="document-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border border-ct-border2 px-2 py-1.5 text-[13px]"
                >
                  {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-expiry">Expiry date</Label>
                <Input id="document-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-replacement">Replace file</Label>
                <Input
                  id="document-replacement"
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  onChange={(e) => setReplacement(e.target.files?.[0] ?? null)}
                />
                <p className="text-[12.5px] text-ct-muted">
                  {replacement
                    ? `${replacement.name} — ${describeFileSize(replacement.size)} will become version ${doc.versionNumber + 1}`
                    : "Keeps this document and its history; the new file becomes the latest version."}
                </p>
                {replacement && documentSizeError(replacement.size) && (
                  <p className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{documentSizeError(replacement.size)}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-[13px] max-w-md">
            <div><dt className="text-ct-muted">Category</dt><dd className="text-ct-navy">{doc.category ? doc.category.replace(/_/g, " ") : "—"}</dd></div>
            <div><dt className="text-ct-muted">Expiry date</dt><dd className="text-ct-navy">{doc.expiryDate ? formatDate(doc.expiryDate) : "—"}</dd></div>
          </dl>
        )}
      </div>
    </ObjectScreen>
  );
}
