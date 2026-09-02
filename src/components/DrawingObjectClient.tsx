"use client";

// Real-screen conversion (2026-08-30): Drawings & 3D never had a detail view
// either -- rows only had a bare "Open" link. A drawing IS a `documents` row
// (category='drawing'|'drawing_3d', discipline in its metadata jsonb) --
// same underlying table/routes as the Documents module, reused here rather
// than duplicated (matches this codebase's own "documents table, not a
// parallel one" convention, see the v1 drawings route's own header comment).
//
// No Edit: updateDocumentMetadata() doesn't accept a metadata/discipline
// patch (only category/expiryDate/linkedEntity) -- an honest scope cut
// rather than a half-working edit form. Real Delete = real Dispose, same as
// Documents.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { useDeleteConfirmation } from "@/components/DeleteConfirmation";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Drawing = {
  id: string; name: string; category: string | null; fileType: string | null;
  createdAt: string; isDisposed: boolean; legalHold: boolean; disposalDate: string | null;
  metadata: { discipline?: string } | null; isExternalLink: boolean; signedUrl: string | null; expiresInSeconds: number;
};

export default function DrawingObjectClient({ drawingId, projectId }: { drawingId: string; projectId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Drawing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disposing, setDisposing] = useState(false);

  async function load() {
    try {
      // Same route the Documents module uses (documents/[id]) -- a drawing
      // is just a document with category='drawing'|'drawing_3d'.
      const data = await fetchJson<Drawing>(`/api/documents/${drawingId}`);
      setD(data);
      setLoadError(null);
    } catch (err) {
      setD(null);
      setLoadError(errorMessage(err, "Couldn't load this drawing"));
    }
  }

  useEffect(() => { load(); }, [drawingId]);

  async function handleDispose() {
    setDisposing(true);
    try {
      const res = await fetch(`/api/documents/${drawingId}/dispose`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove drawing");
      toast.success("Drawing removed");
      router.push(`/drawings?projectId=${projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove drawing");
    } finally {
      setDisposing(false);
    }
  }

  // R67 D-67. Declared before the early returns below, because a hook must
  // be. The blast radius is spelled out: removing a drawing disposes the
  // uploaded file with it, and the sentence has to say so before the click,
  // not after.
  const removal = useDeleteConfirmation({
    objectLabel: "Drawing",
    identifier: d?.name ?? null,
    extra: "and its uploaded file",
    verb: "Remove",
    run: handleDispose,
  });

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!d) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const kind = d.category === "drawing_3d" ? "3D Walkthrough" : "DWG";
  const disposeDisabledReason = d.isDisposed
    ? "Already removed"
    : d.legalHold
    ? "Under legal hold"
    : !d.disposalDate
    ? "No retention policy set"
    : d.disposalDate > new Date().toISOString().slice(0, 10)
    ? `Not eligible until ${d.disposalDate}`
    : disposing ? "Removing…" : undefined;

  return (
    <ObjectScreen
      breadcrumb="Drawings & 3D / Drawing"
      title={d.name}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: d.isDisposed ? "late" : "neutral", label: d.isDisposed ? "removed" : kind }}
      facets={[
        { label: "Discipline", value: d.metadata?.discipline ?? "—" },
        { label: "Added", value: d.createdAt.slice(0, 10) },
      ]}
      // R67 D-67: the kit renders the Delete button itself and calls
      // onDelete() straight from onClick, so this used to dispose the
      // drawing AND its file on ONE click, with no confirmation anywhere.
      // It now arms the confirm card rendered below.
      onDelete={!d.isDisposed ? removal.request : undefined}
      deleteDisabledReason={disposeDisabledReason}
      onBack={() => router.push(`/drawings?projectId=${projectId}`)}
      messages={[]}
    >
      {removal.card}
      <div className="px-4 py-3">
        {d.signedUrl && !d.isDisposed ? (
          <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] underline underline-offset-2">
            Open {kind === "3D Walkthrough" ? "walkthrough" : "drawing"}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : d.isDisposed ? (
          <p className="text-sm text-ct-muted">This drawing has been removed — the file is no longer retrievable.</p>
        ) : (
          <p className="text-sm text-ct-muted">No file link available.</p>
        )}
      </div>
    </ObjectScreen>
  );
}
