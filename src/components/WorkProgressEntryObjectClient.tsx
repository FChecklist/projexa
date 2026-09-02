"use client";

// R67 lane D22 (item D-77, rec R-289): the object page a work-progress entry
// never had.
//
// WHAT WAS WRONG. The Work Progress list showed a row and offered nothing to
// click. There was no way to see the remarks in full, no way to see the photo
// the crew attached from site, and no way to correct a quantity typed wrong --
// the only mutation that had ever existed on an entry was DELETE, on a route
// PROJEXA could not even reach. So a site engineer who typed 500 instead of 50
// had exactly one remedy: destroy the record and re-record it, losing who
// entered it and when.
//
// WHAT THIS IS. Display first -- the entry as it stands, with its BOQ line
// named as "<code> — <description>" and never as an id (R-230's rule, and the
// same boqLineLabel() the list and the picker use). Edit turns the measured
// facts into fields with ONE Save/Cancel pair in the footer; Delete is kept
// isolated in the footer with an inline confirm, because it is the one action
// here that destroys evidence.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { boqLineHref, boqLineLabel } from "@/lib/boq-line-options";

type EntryBoqLine = {
  boqLineId: string;
  code: string | null;
  description: string;
  unit: string;
  qtyTotal: number;
  qtyDone: number;
  boqId: string;
};

type Entry = {
  id: string;
  projectId: string;
  activityId: string;
  boqLineItemId: string | null;
  boqLine: EntryBoqLine | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  createdAt: string;
  activityName: string | null;
  activityUnit: string | null;
  projectName: string | null;
  recordedByName: string | null;
};

type Photo = { id: string; fileName: string; contentType: string; createdAt: string; url: string | null };

type Draft = { entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string };

function progressTone(pct: number): StatusTone {
  if (pct >= 100) return "done";
  if (pct >= 50) return "running";
  return "waiting";
}

/** Pure: the basis, in words a site engineer uses rather than the stored token. */
export function entryBasisLabel(basis: string): string {
  return basis === "SNAPSHOT" ? "Snapshot (cumulative % to date)" : "Delta (this period's quantity)";
}

export default function WorkProgressEntryObjectClient({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<Entry>(`/api/work-progress/${entryId}`);
      setEntry(data);
      setLoadError(null);
      // The site photo, from PROJEXA's own store (the offline queue uploads
      // here once an entry syncs). Never fatal: an entry with no photo is the
      // ordinary case and must still open.
      const photoData = await fetchJson<{ photos?: Photo[] }>(
        `/api/work-progress/photos?veridianEntryId=${encodeURIComponent(entryId)}`
      ).catch(() => ({ photos: [] }));
      setPhotos(photoData.photos ?? []);
    } catch (err) {
      setEntry(null);
      setLoadError(errorMessage(err, "Couldn't load this progress entry"));
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => { load(); }, [load]);

  function startEdit() {
    if (!entry) return;
    setDraft({
      entryDate: entry.entryDate,
      quantityDone: entry.quantityDone,
      percentComplete: entry.percentComplete,
      entryBasis: entry.entryBasis,
      remarks: entry.remarks ?? "",
    });
    setConfirmingDelete(false);
    setMode("edit");
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/work-progress/${entryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate: draft.entryDate,
          quantityDone: Number(draft.quantityDone),
          percentComplete: Number(draft.percentComplete),
          entryBasis: draft.entryBasis,
          remarks: draft.remarks,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save this entry");
      setMode("display");
      setDraft(null);
      setMessages([{ level: "success", text: "Entry saved" }]);
      await load();
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't save this entry") }]);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/work-progress/${entryId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't delete this entry");
      router.push(`/work-progress?projectId=${entry.projectId}`);
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't delete this entry") }]);
      setDeleting(false);
    }
  }

  if (loading) {
    // DE-29's loading skeleton shape: the page's own frame, not a spinner in
    // the middle of nothing -- what is coming is already visible.
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!entry) return null;

  const percent = Number(entry.percentComplete);
  const unit = entry.boqLine?.unit ?? entry.activityUnit ?? "";
  const missing = !draft
    ? []
    : [
        ...(draft.entryDate ? [] : ["Date"]),
        ...(Number.isFinite(Number(draft.percentComplete)) && Number(draft.percentComplete) >= 0 && Number(draft.percentComplete) <= 100 ? [] : ["% complete 0-100"]),
      ];

  const headerActions = mode === "display" ? (
    <Button size="sm" onClick={startEdit}>Edit</Button>
  ) : undefined;

  return (
    <ObjectScreen
      breadcrumb="Work Progress / Entry"
      title={`${entry.activityName ?? "Activity"} — ${formatDate(entry.entryDate)}`}
      subtitle={entry.projectName ?? undefined}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: progressTone(percent), label: `${percent}%` }}
      facets={[
        { label: "Date", value: formatDate(entry.entryDate) },
        { label: "Quantity", value: unit ? `${entry.quantityDone} ${unit}` : entry.quantityDone },
        { label: "Basis", value: entryBasisLabel(entry.entryBasis) },
        { label: "Recorded by", value: entry.recordedByName ?? "—" },
        { label: "Recorded at", value: formatDateTime(entry.createdAt) },
      ]}
      headerActions={headerActions}
      onSave={mode === "edit" ? save : undefined}
      onCancel={mode === "edit" ? () => { setDraft(null); setMode("display"); } : undefined}
      // Back returns to the list this entry was clicked from, with the project
      // still selected -- never to a bare /work-progress that has to resolve a
      // project all over again.
      onBack={() => router.push(`/work-progress?projectId=${entry.projectId}`)}
      saveDisabled={saving || missing.length > 0}
      saveDisabledReason={saving ? "Saving…" : missing.length ? missing.join(", ") : undefined}
      messages={messages}
    >
      <div className="space-y-4 px-4 py-3">
        <section className="space-y-1.5">
          <h3 className="text-[13px] font-medium text-ct-navy">BOQ line</h3>
          {/* Code and description, never an id -- and a link to the line on its
              own BOQ page, which is where "how much of this is left" lives. */}
          {entry.boqLine ? (
            <Link
              href={boqLineHref(entry.boqLine.boqId, entry.boqLine.boqLineId)}
              className="text-[13px] text-px-steel underline underline-offset-2"
            >
              {boqLineLabel(entry.boqLine)}
            </Link>
          ) : (
            <p className="text-[13px] text-ct-muted">
              — this entry was recorded against the activity only, with no BOQ line.
            </p>
          )}
        </section>

        {mode === "edit" && draft ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={draft.entryDate} onChange={(e) => setDraft((d) => (d ? { ...d, entryDate: e.target.value } : d))} />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity done{unit ? ` (${unit})` : ""}</Label>
                <Input type="number" step="any" value={draft.quantityDone} onChange={(e) => setDraft((d) => (d ? { ...d, quantityDone: e.target.value } : d))} />
              </div>
              <div className="space-y-1.5">
                <Label>% complete</Label>
                <Input type="number" min="0" max="100" value={draft.percentComplete} onChange={(e) => setDraft((d) => (d ? { ...d, percentComplete: e.target.value } : d))} />
              </div>
            </div>
            <div className="space-y-1.5 sm:w-2/3">
              <Label>Basis</Label>
              <Select value={draft.entryBasis} onValueChange={(v) => setDraft((d) => (d ? { ...d, entryBasis: v } : d))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DELTA">{entryBasisLabel("DELTA")}</SelectItem>
                  <SelectItem value="SNAPSHOT">{entryBasisLabel("SNAPSHOT")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Remarks</Label>
              <Textarea rows={3} value={draft.remarks} onChange={(e) => setDraft((d) => (d ? { ...d, remarks: e.target.value } : d))} />
            </div>
            <p className="text-[12px] text-ct-muted">
              The activity and the BOQ line cannot be changed here — an entry recorded against the wrong line is deleted and re-recorded, so every roll-up that read it moves with it.
            </p>
          </div>
        ) : (
          <>
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-medium text-ct-navy">Remarks</h3>
              <p className="whitespace-pre-wrap text-[13px] text-ct-navy">
                {entry.remarks?.trim() ? entry.remarks : <span className="text-ct-muted">None recorded.</span>}
              </p>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-[13px] font-medium text-ct-navy">Site photo</h3>
              {photos.length === 0 ? (
                <p className="text-[13px] text-ct-muted">No photo attached to this entry.</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {photos.map((photo) => (
                    <li key={photo.id} className="space-y-1">
                      {photo.url ? (
                        // A plain <img>, deliberately: the src is a short-lived
                        // Supabase signed URL whose host AND token change on
                        // every read, so it cannot be declared as a next/image
                        // remote pattern.
                        <img src={photo.url} alt={photo.fileName} className="h-40 w-auto rounded-md border border-ct-border object-cover" />
                      ) : (
                        <span className="text-[12.5px] text-ct-muted">{photo.fileName} (link unavailable)</span>
                      )}
                      <p className="text-[11.5px] text-ct-muted">{formatDateTime(photo.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Delete is isolated -- the footer's own separated slot in
                ObjectScreen -- and asks before it fires, because a deleted
                entry takes its quantities out of every report that read them. */}
            <section className="border-t border-ct-border pt-3">
              {!confirmingDelete ? (
                <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(true)}>Delete this entry</Button>
              ) : (
                <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ct-navy">
                  <span>Deleting removes this quantity from every report that reads it; cannot be undone</span>
                  <Button size="sm" variant="outline" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Delete"}</Button>
                  <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                </span>
              )}
            </section>
          </>
        )}
      </div>
    </ObjectScreen>
  );
}
