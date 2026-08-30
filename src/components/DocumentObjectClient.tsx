"use client";

// Real-screen conversion (2026-08-30): the Documents list never had a
// detail view -- a file could be uploaded but never viewed/downloaded
// again, and its category/expiry could never be corrected after upload.
// Real Object Page on the kit's ObjectScreen.
//
// Real Delete = real Dispose (disposeDocument()) -- a genuine, retention-
// policy-gated lifecycle action, not an invented mapping. Most documents
// have no retention policy set (setRetentionPolicy() is a separate, not-yet
// -wired action), so Delete is honestly disabled with the real reason in
// that common case rather than a fake-enabled button.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Doc = {
  id: string; name: string; category: string | null; fileType: string | null; fileSize: number | null;
  expiryDate: string | null; versionNumber: number; createdAt: string;
  isDisposed: boolean; legalHold: boolean; disposalDate: string | null;
  isExternalLink: boolean; signedUrl: string | null; expiresInSeconds: number;
};

const CATEGORIES = ["permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentObjectClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [category, setCategory] = useState("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [disposing, setDisposing] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<Doc>(`/api/documents/${documentId}`);
      setDoc(data);
      setCategory(data.category ?? "other");
      setExpiryDate(data.expiryDate ?? "");
      setLoadError(null);
    } catch (err) {
      setDoc(null);
      setLoadError(errorMessage(err, "Couldn't load this document"));
    }
  }

  useEffect(() => { load(); }, [documentId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, expiryDate: expiryDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save document");
      toast.success("Document saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save document");
    } finally {
      setSaving(false);
    }
  }

  async function handleDispose() {
    setDisposing(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/dispose`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to dispose document");
      toast.success("Document disposed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't dispose document");
    } finally {
      setDisposing(false);
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
  if (!doc) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const disposeDisabledReason = doc.isDisposed
    ? "Already disposed"
    : doc.legalHold
    ? "Under legal hold"
    : !doc.disposalDate
    ? "No retention policy set"
    : doc.disposalDate > new Date().toISOString().slice(0, 10)
    ? `Not eligible until ${doc.disposalDate}`
    : disposing ? "Disposing…" : undefined;

  return (
    <ObjectScreen
      breadcrumb="Documents / Document"
      title={doc.name}
      subtitle={`Version ${doc.versionNumber}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: doc.isDisposed ? "late" : doc.legalHold ? "needs-you" : "neutral", label: doc.isDisposed ? "disposed" : doc.legalHold ? "legal hold" : (doc.category ?? "other").replace(/_/g, " ") }}
      facets={[
        { label: "Type", value: doc.fileType ?? "—" },
        { label: "Size", value: formatSize(doc.fileSize) },
        { label: "Added", value: doc.createdAt.slice(0, 10) },
      ]}
      onEdit={!doc.isDisposed && mode === "display" ? () => { setCategory(doc.category ?? "other"); setExpiryDate(doc.expiryDate ?? ""); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={!doc.isDisposed ? handleDispose : undefined}
      deleteDisabledReason={disposeDisabledReason}
      onBack={() => router.push("/documents")}
      saveDisabled={saving}
      saveDisabledReason={saving ? "Saving…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {doc.signedUrl && !doc.isDisposed && (
          <a
            href={doc.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] underline underline-offset-2"
          >
            View / Download this document
            <span className="sr-only">(opens in a new tab{doc.isExternalLink ? "" : `, link expires in ${doc.expiresInSeconds}s`})</span>
          </a>
        )}
        {doc.isDisposed && <p className="text-sm text-ct-muted">This document has been disposed — the file is no longer retrievable.</p>}

        {mode === "edit" ? (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Expiry Date</Label><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-[13px] max-w-md">
            <div><dt className="text-ct-muted">Category</dt><dd className="text-ct-navy">{(doc.category ?? "other").replace(/_/g, " ")}</dd></div>
            <div><dt className="text-ct-muted">Expiry Date</dt><dd className="text-ct-navy">{doc.expiryDate ?? "—"}</dd></div>
          </dl>
        )}
      </div>
    </ObjectScreen>
  );
}
