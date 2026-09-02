"use client";

// R67 D-67 -- /work-progress/[id], the object page a logged progress entry
// never had.
//
// R-257: "Add /work-progress/[id] (read-only entry with the site photo,
// Edit | Delete | Back) and make Daily Entry rows clickable." Until now a
// Daily Entry row was the end of the road: the grid showed a truncated
// remark and a percentage, the photo a site engineer had attached was
// reachable from nowhere in the UI at all, and clicking a row did nothing.
//
// HOW IT READS THE ENTRY, and why that is not a shortcut: there is no
// per-entry endpoint in either repo -- compliance-tracker exposes
// GET /work-progress?projectId= and nothing addressed by entry id (verified
// against src/app/api/v1/construction/progress/ and
// src/app/api/v1/projexa/work-progress/). So the page reads the project's
// entries, which is the only real source there is, and selects the one asked
// for. Inventing a client-side "not found" from a failed read would be the
// exact fault D-71 exists to prevent, so a failure says it failed.
//
// WHY THERE IS NO Edit AND NO Delete: for the same reason -- neither repo
// has a PATCH or a DELETE for a progress entry. The archetype's rule is that
// an action is disabled with its reason or absent, never present and dead, so
// the two controls the item names are absent until the endpoints exist. Back
// is always there.

import { useCallback, useEffect, useState } from "react";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";
import { useCreatedMessage } from "@/components/CreatedReceipt";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
};

type Activity = { id: string; name: string; unit: string | null };
type Photo = { id: string; fileName: string; contentType: string; createdAt: string; url: string | null };

export default function WorkProgressEntryObjectClient({
  entryId,
  projectId,
  projectName,
}: {
  entryId: string;
  projectId: string;
  projectName: string;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [activityName, setActivityName] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const created = useCreatedMessage("Progress entry");

  const load = useCallback(async () => {
    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    setNotFound(false);
    try {
      const [entriesData, activitiesData] = await Promise.all([
        fetchJson<{ entries?: Entry[] }>(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`),
        fetchJson<{ activities?: Activity[] }>(
          `/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`
        ),
      ]);
      const found = (entriesData.entries ?? []).find((e) => e.id === entryId) ?? null;
      setEntry(found);
      // "Not there" is only sayable after a read that SUCCEEDED.
      setNotFound(found === null);
      if (found) {
        const activity = (activitiesData.activities ?? []).find((a) => a.id === found.activityId);
        setActivityName(activity?.name ?? null);
      }
    } catch (err) {
      setError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error ? err.message : null,
      });
    } finally {
      setLoading(false);
    }
  }, [entryId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The photos are PROJEXA's own (Supabase storage, work_progress_photos), so
  // they are a second, independent read -- and a failure there must not blank
  // the entry the user came to see.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const data = await fetchJson<{ photos?: Photo[] }>(
          `/api/work-progress/photos?veridianEntryId=${encodeURIComponent(entryId)}`
        );
        if (live) setPhotos(Array.isArray(data.photos) ? data.photos : []);
      } catch (err) {
        if (live) setPhotosError(err instanceof Error ? err.message : "the request did not complete");
      }
    })();
    return () => {
      live = false;
    };
  }, [entryId]);

  const moduleHref = `/work-progress?projectId=${encodeURIComponent(projectId)}`;
  const title = entry ? `Progress on ${formatDate(entry.entryDate)}` : "Progress entry";

  return (
    <ObjectScreen
      module="Work Progress"
      moduleHref={moduleHref}
      objectLabel="Progress entry"
      title={title}
      facets={entry ? [{ label: "Project", value: projectName }, { label: "Basis", value: entry.entryBasis }] : []}
      footerMessage={created}
    >
      {loading && !entry && (
        <PaneWaitingCaption startedAt={startedAt} entity="this progress entry" projectName={projectName} onRetry={load} />
      )}

      {error && <PaneErrorCard entity="this progress entry" error={error} onRetry={load} />}

      {notFound && !error && (
        <p className="text-sm text-px-muted">
          This progress entry is not on {projectName}. It may have been logged against another project.
        </p>
      )}

      {entry && (
        <div className="space-y-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-[12px] text-px-muted">Date</dt>
              <dd className="text-sm text-ct-navy">{formatDate(entry.entryDate)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-px-muted">Activity</dt>
              {/* The activity's NAME, or an honest en-dash -- never the raw id,
                  which is the rule task-errors.ts states for failures and
                  which applies just as much to a healthy row. */}
              <dd className="text-sm text-ct-navy">{activityName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-px-muted">Basis</dt>
              <dd className="text-sm text-ct-navy">{entry.entryBasis}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-px-muted">Quantity done</dt>
              <dd className="text-sm tabular-nums text-ct-navy">{entry.quantityDone}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-px-muted">% complete</dt>
              <dd className="text-sm tabular-nums text-ct-navy">{entry.percentComplete}%</dd>
            </div>
          </dl>

          <div>
            <h2 className="text-[12px] text-px-muted">Remarks</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ct-navy">{entry.remarks?.trim() || "—"}</p>
          </div>

          <div>
            <h2 className="text-[12px] text-px-muted">Site photos</h2>
            {photosError ? (
              <p role="alert" className="mt-1 text-sm text-px-error">
                Could not load the photos for this entry: {photosError}.
              </p>
            ) : photos.length === 0 ? (
              <p className="mt-1 text-sm text-px-muted">No photo was attached to this entry.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-3">
                {photos.map((p) => (
                  <li key={p.id} className="w-48">
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a
                      // short-lived Supabase signed URL is not a configurable
                      // next/image remote pattern; the host rotates per project.
                      <img src={p.url} alt={p.fileName} className="w-full rounded-md border border-px-border" />
                    ) : (
                      <p className="text-sm text-px-muted">{p.fileName} (link expired)</p>
                    )}
                    <p className="mt-1 truncate text-[11px] text-px-muted">{p.fileName}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </ObjectScreen>
  );
}
