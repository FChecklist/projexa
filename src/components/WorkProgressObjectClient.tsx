"use client";

// R67 D-28 (R-069/R-071/R-078). Work Progress was CREATE-ONLY: three inert
// rows whose BOQ-line cell printed a raw cuid, no way to open an entry, no way
// to correct a mis-keyed quantity, no way to delete one, and no sight of the
// photo you had just uploaded. This is the object page that closes that --
// built on PermitObjectClient's pattern (display by default, Edit switches to
// edit mode, Save carries the missing-field count, Cancel discards, Back
// returns to the list with the project intact) on the D-09 fork of
// ObjectScreen, so Delete can be rendered-but-disabled with a reason when it
// is not offered instead of vanishing.
//
// The names on this page come from the SERVER (activityName, boqItemCode,
// boqLineDescription, unit -- the LEFT JOIN R67 D-28 added to
// listProgressEntries/getProgressEntry). This screen never re-resolves an id
// against whatever BOQ it happened to fetch, which is exactly how the list came
// to print ids: an entry recorded against another revision had no name to find.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDayMonthYearNumeric } from "@/lib/format-date";
import {
  describeProgressDeleteImpact, progressDeleteConfirmSentence,
  type BoqLineItem as ReportBoqLine, type ProgressEntry as ReportEntry,
} from "@/lib/work-progress-report";

export type ProgressEntryDetail = {
  id: string;
  projectId: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  activityName: string | null;
  boqItemCode: string | null;
  boqLineDescription: string | null;
  boqLineQuantity: string | null;
  boqLineRate: string | null;
  boqLineAmount: string | null;
  unit: string | null;
};

type Activity = { id: string; name: string; unit: string | null };
type Photo = { id: string; fileName: string; url: string | null; createdAt: string };

export const NO_PHOTO_LABEL = "No site photo attached";

const ENTRY_BASIS_OPTIONS = [
  { value: "DELTA", label: "Delta -- this entry adds to progress already logged" },
  { value: "SNAPSHOT", label: "Snapshot -- this entry replaces the running total" },
];

const REQUIRED_FIELDS = ["activityId", "entryDate", "quantityDone", "percentComplete", "entryBasis"] as const;

/** "R60SK-A - R60 skiphop sub", or an en-dash when the entry names no BOQ line. Exported so the list and this page render the cell identically. */
export function boqLineLabel(itemCode: string | null | undefined, description: string | null | undefined): string {
  if (!itemCode && !description) return "–";
  if (!itemCode) return description!;
  if (!description) return itemCode;
  return `${itemCode} - ${description}`;
}

export default function WorkProgressObjectClient({ entryId, justLogged }: { entryId: string; justLogged?: boolean }) {
  const router = useRouter();
  const [entry, setEntry] = useState<ProgressEntryDetail | null>(null);
  const [siblings, setSiblings] = useState<ProgressEntryDetail[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    let detail: ProgressEntryDetail;
    try {
      detail = await fetchJson<ProgressEntryDetail>(`/api/work-progress/${entryId}`);
    } catch (err) {
      setEntry(null);
      // The backend's own words, not a generic replacement -- the reason an
      // entry will not load is information the site engineer needs.
      setLoadError(errorMessage(err, "Couldn't load this progress entry"));
      return;
    }
    setLoadError(null);
    setEntry(detail);
    setValues(detail as unknown as Record<string, unknown>);

    // Everything else is context, never a reason to blank the entry: an
    // activity list that fails degrades Edit's picker, a sibling list that
    // fails degrades the delete confirmation to its quantity-only wording,
    // and a photo list that fails is stated as such rather than as "none".
    const [activityRes, siblingRes, photoRes] = await Promise.allSettled([
      fetchJson<{ activities?: Activity[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(detail.projectId)}`),
      fetchJson<{ entries?: ProgressEntryDetail[] }>(`/api/work-progress?projectId=${encodeURIComponent(detail.projectId)}`),
      fetchJson<{ photos?: Photo[] }>(`/api/work-progress/photos?veridianEntryId=${encodeURIComponent(entryId)}`),
    ]);
    setActivities(activityRes.status === "fulfilled" ? (activityRes.value.activities ?? []) : []);
    setSiblings(siblingRes.status === "fulfilled" ? (siblingRes.value.entries ?? []) : []);
    setPhotos(photoRes.status === "fulfilled" ? (photoRes.value.photos ?? []) : []);
  }, [entryId]);

  useEffect(() => { void load(); }, [load]);

  // R67 D-28: the form used to leave the user on an emptied form with a toast
  // that had already gone. The confirmation now waits for them here, on the
  // entry itself, in the persistent band.
  useEffect(() => {
    if (justLogged) setMessages([{ level: "info", text: `Progress entry ${entryId} logged` }]);
  }, [justLogged, entryId]);

  const selectedActivityUnit = useMemo(() => {
    const id = (values.activityId as string) ?? entry?.activityId;
    return activities.find((a) => a.id === id)?.unit ?? entry?.unit ?? null;
  }, [values.activityId, entry, activities]);

  const columns: ScreenColumn[] = useMemo(() => [
    {
      label: "Activity", field: "activityId", control: "SELECT", type: "text", required: true, fieldStatus: "REQUIRED",
      options: activities.map((a) => ({ value: a.id, label: a.unit ? `${a.name} (${a.unit})` : a.name })),
    },
    { label: "Date", field: "entryDate", control: "DATE", type: "date", required: true, fieldStatus: "REQUIRED" },
    {
      label: selectedActivityUnit ? `Quantity done (${selectedActivityUnit})` : "Quantity done",
      field: "quantityDone", control: "NUMBER", type: "number", required: true, fieldStatus: "REQUIRED",
    },
    { label: "% complete", field: "percentComplete", control: "NUMBER", type: "number", required: true, fieldStatus: "REQUIRED" },
    { label: "Entry basis", field: "entryBasis", control: "RADIO", type: "text", required: true, fieldStatus: "REQUIRED", options: ENTRY_BASIS_OPTIONS },
  ], [activities, selectedActivityUnit]);

  const remarksColumns: ScreenColumn[] = [
    { label: "Remarks", field: "remarks", control: "TEXT", type: "text", required: false, fieldStatus: "OPTIONAL" },
  ];

  const missingCount = mode === "edit"
    ? REQUIRED_FIELDS.filter((f) => values[f] === undefined || values[f] === null || values[f] === "").length
    : 0;

  async function handleSave() {
    if (!entry) return;
    setSaving(true);
    setMessages([]);
    try {
      const saved = await fetchJson<ProgressEntryDetail>(`/api/work-progress/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: values.activityId,
          entryDate: values.entryDate,
          quantityDone: Number(values.quantityDone),
          percentComplete: Number(values.percentComplete),
          entryBasis: values.entryBasis,
          remarks: (values.remarks as string) ?? null,
        }),
      });
      setEntry(saved);
      setValues(saved as unknown as Record<string, unknown>);
      setMode("display");
      setMessages([{ level: "info", text: `Progress entry ${saved.id} saved` }]);
      // The list behind this page now holds a stale row for this entry.
      router.refresh();
    } catch (err) {
      // The backend's message verbatim -- e.g. the parent-BOQ-line refusal or
      // the 0-100 range -- in the persistent band, never a toast.
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't save this progress entry") }]);
    } finally {
      setSaving(false);
    }
  }

  const deleteImpact = useMemo(() => {
    if (!entry) return null;
    const line: ReportBoqLine | null = entry.boqLineItemId
      ? {
          id: entry.boqLineItemId,
          activityId: entry.activityId,
          itemCode: entry.boqItemCode,
          description: entry.boqLineDescription ?? "",
          unit: entry.unit ?? "",
          quantity: entry.boqLineQuantity ?? 0,
          rate: entry.boqLineRate ?? 0,
          amount: entry.boqLineAmount ?? 0,
        }
      : null;
    return describeProgressDeleteImpact({
      entry: entry as unknown as ReportEntry,
      entries: siblings as unknown as ReportEntry[],
      line,
      unit: entry.unit,
    });
  }, [entry, siblings]);

  async function handleDelete() {
    if (!entry) return;
    setDeleting(true);
    try {
      await fetchJson(`/api/work-progress/${entryId}`, { method: "DELETE" });
      setConfirmingDelete(false);
      router.push(`/work-progress?projectId=${entry.projectId}&deleted=${encodeURIComponent(`Deleted the entry logged on ${formatDayMonthYearNumeric(entry.entryDate)}`)}`);
    } catch (err) {
      setConfirmingDelete(false);
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't delete this progress entry") }]);
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <div className="rounded-md border border-px-error-border bg-px-error-light p-4">
          <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px]">Retry</button>
      </div>
    );
  }

  // A skeleton of THIS layout -- breadcrumb, title, facet row, body -- not a
  // spinner: the page that arrives should be the shape the page that was
  // loading promised.
  if (!entry) {
    return (
      <div className="space-y-3 p-6" aria-busy="true" aria-label="Loading this progress entry">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-6 w-72" />
        <div className="flex gap-6"><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-28" /></div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const lineLabel = boqLineLabel(entry.boqItemCode, entry.boqLineDescription);

  return (
    <ObjectScreen
      breadcrumb="Work Progress / Entry"
      title={`${entry.activityName ?? "Progress entry"} · ${formatDayMonthYearNumeric(entry.entryDate)}`}
      subtitle={lineLabel === "–" ? undefined : lineLabel}
      mode={mode}
      hasDraft={false}
      facets={[
        { label: "Date", value: formatDayMonthYearNumeric(entry.entryDate) },
        { label: "Activity", value: entry.activityName ?? "–" },
        { label: "BOQ line", value: lineLabel },
        { label: "Qty done", value: entry.unit ? `${entry.quantityDone} ${entry.unit}` : entry.quantityDone },
        { label: "% complete", value: `${entry.percentComplete}%` },
        { label: "Basis", value: entry.entryBasis },
      ]}
      onEdit={mode === "display" ? () => { setValues(entry as unknown as Record<string, unknown>); setMessages([]); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setValues(entry as unknown as Record<string, unknown>); setMessages([]); setMode("display"); } : undefined}
      onDelete={() => setConfirmingDelete(true)}
      deleteDisabledReason={mode === "edit" ? "Finish editing first" : deleting ? "Deleting…" : undefined}
      onBack={() => router.push(`/work-progress?projectId=${entry.projectId}`)}
      saveDisabled={saving || missingCount > 0}
      saveDisabledReason={saving ? "Saving…" : missingCount > 0 ? `${missingCount} required field${missingCount === 1 ? "" : "s"}` : undefined}
      messages={messages}
    >
      {mode === "edit" ? (
        <>
          {/* The BOQ line is shown, not edited, here: re-pointing an entry at a
              different line is a change of WHAT was measured, and the backend
              enforces real rules about it (the line must belong to this
              project's BOQ and must not be a parent line). Correcting the
              numbers is what this screen is for. */}
          <p className="px-4 pt-3 text-[12.5px] text-px-muted">
            BOQ line: {lineLabel}. To record against a different line, log a new entry and delete this one.
          </p>
          <FormSection title="Progress entry" columns={columns} values={values} mode="edit" onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} />
          <FormSection title="More details" columns={remarksColumns} values={values} mode="edit" onFieldChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} defaultOptionalCollapsed />
        </>
      ) : (
        <div className="space-y-4 px-4 py-3">
          <section>
            <h3 className="text-[13px] font-semibold text-px-ink">Remarks</h3>
            <p className="mt-1 text-[13px] text-px-muted">{entry.remarks || "No remarks on this entry"}</p>
          </section>
          {/* R-078: the photo a site engineer uploads with an entry was never
              shown back anywhere. It is the evidence the entry exists. */}
          <section>
            <h3 className="text-[13px] font-semibold text-px-ink">Site photos</h3>
            {photos.length === 0 ? (
              <p className="mt-1 text-[13px] text-px-muted">{NO_PHOTO_LABEL}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-3">
                {photos.map((photo) => (
                  <li key={photo.id} className="w-40">
                    {photo.url ? (
                      <a href={photo.url} target="_blank" rel="noopener noreferrer">
                        {/* A plain <img>, not next/image: this is a Supabase
                            signed URL -- short-lived, per-request, on a host
                            that would have to be whitelisted in remotePatterns,
                            and next/image would cache it past its expiry. */}
                        <img src={photo.url} alt={photo.fileName} className="h-28 w-40 rounded-md border border-px-border object-cover" />
                      </a>
                    ) : (
                      <div className="grid h-28 w-40 place-items-center rounded-md border border-px-border text-[12px] text-px-muted">
                        Preview unavailable
                      </div>
                    )}
                    <p className="mt-1 text-[11.5px] text-px-muted">{formatDayMonthYearNumeric(entry.entryDate)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* R-069: deleting a progress entry moves the project's completion
          figure. The confirmation states, before the click, exactly what it
          removes and what the running total becomes -- computed by
          work-progress-report.ts's own arithmetic, the same one the report and
          the PDF use. */}
      <AlertDialog open={confirmingDelete} onOpenChange={(open) => !open && setConfirmingDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this progress entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteImpact ? progressDeleteConfirmSentence(deleteImpact, entry.activityName ?? "this activity") : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ObjectScreen>
  );
}
