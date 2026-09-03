"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// R67 F-05 (R-075). The Work Progress screen has three tabs over ONE project's
// data, and each tab used to load that data from scratch: Daily Entry fetched
// entries and activities, then /api/scope (1.5-4.4 s -- the whole BOQ list),
// then /api/scope/{id}; switching to Analytics ran the identical chain again.
// 15 requests and 7.4 s to network idle on a screen whose backend answers
// /work-progress in 400-831 ms.
//
// Two changes make that one call. Server-side, entries now arrive with their
// activity name and BOQ line already joined on (compliance-tracker's
// listProgressEntries), so the two /api/scope hops that existed only to look
// up labels are gone. Client-side, this provider holds the result for the
// project, so a tab switch reads what is already in memory instead of
// refetching.
//
// THE TTL IS DELIBERATELY SHORT. Progress entries are the thing users are
// actively creating on this screen, so 60 seconds is long enough to make tab
// switching free and short enough that a colleague's entry shows up on the
// next visit. A write goes through reload(), which bypasses the cache
// entirely -- your own entry is never stale.
export type WorkProgressEntry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  // Joined server-side (R67 F-05). null means the referenced row is genuinely
  // gone -- the UI decides how to say "unknown", the API never invents a label.
  activityName: string | null;
  boqItemCode: string | null;
  boqLineDescription: string | null;
  unit: string | null;
};

export type WorkProgressActivity = { id: string; name: string; categoryId?: string | null };

type WorkProgressData = {
  entries: WorkProgressEntry[];
  activities: WorkProgressActivity[];
  entriesLoading: boolean;
  activitiesLoading: boolean;
  entriesError: string | null;
  reload: () => Promise<void>;
};

const TTL_MS = 60_000;

// Each half of the row carries its OWN timestamp, and is written only by its
// own SUCCESSFUL load.
//
// R67 F-05 (review fix). This used to be a single { at, entries, activities }
// record that either load would create, filling the other half with `?? []`.
// That made a failed entries load indistinguishable from an empty project:
// /work-progress 504s, the activities call succeeds a moment later and writes
// a row whose `entries` is the empty default, and for the next 60 seconds
// every mount short-circuits on that row and paints an empty list -- no rows,
// no error card, and no request to fail. It is exactly the fault
// src/lib/fetch-json.ts exists to kill (a failed request rendered as an empty
// list), reintroduced one layer up in the cache, and it is worst on the tab
// switch this provider was added to make free.
//
// Splitting the halves also fixes the milder ordering bug underneath it: when
// activities resolved FIRST, the entries write recorded `activities: []` over
// a list it had just loaded.
type CachePart<T> = { at: number; value: T };
type CacheRow = { entries?: CachePart<WorkProgressEntry[]>; activities?: CachePart<WorkProgressActivity[]> };
const cache = new Map<string, CacheRow>();

/** The cached value if it is still inside the TTL, else null. An empty array
 * is a real answer ("this project has none") and is returned as one. */
function freshPart<T>(part: CachePart<T> | undefined): T | null {
  return part && Date.now() - part.at < TTL_MS ? part.value : null;
}

function cachedEntries(projectId: string): WorkProgressEntry[] | null {
  return freshPart(cache.get(projectId)?.entries);
}

function cachedActivities(projectId: string): WorkProgressActivity[] | null {
  return freshPart(cache.get(projectId)?.activities);
}

/** Test seam: `bun test` runs every file in one process, so this module-level
 * cache would otherwise leak between test files. */
export function __resetWorkProgressCacheForTests(): void {
  cache.clear();
}

const WorkProgressDataContext = createContext<WorkProgressData | null>(null);

export function useWorkProgressData(): WorkProgressData {
  const value = useContext(WorkProgressDataContext);
  if (!value) throw new Error("useWorkProgressData must be used inside <WorkProgressDataProvider>");
  return value;
}

export function WorkProgressDataProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  // Read at mount so a warm tab switch paints on the FIRST render rather than
  // after an effect. The two halves are independent: entries can be warm while
  // activities are not, and vice versa.
  const entriesAtMount = cachedEntries(projectId);
  const activitiesAtMount = cachedActivities(projectId);

  const [entries, setEntries] = useState<WorkProgressEntry[]>(entriesAtMount ?? []);
  const [activities, setActivities] = useState<WorkProgressActivity[]>(activitiesAtMount ?? []);
  const [entriesLoading, setEntriesLoading] = useState(entriesAtMount === null);
  const [activitiesLoading, setActivitiesLoading] = useState(activitiesAtMount === null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  // Two independent loads, deliberately NOT awaited together. The list needs
  // only the entries; activities exist for the form's Activity select. Under
  // the old Promise.all the list waited on both, so a slow activities lookup
  // held back rows that were already in hand.
  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const data = await fetchJson(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`);
      const loaded: WorkProgressEntry[] = data.entries ?? [];
      setEntries(loaded);
      // Only a real answer is remembered -- the catch below writes nothing.
      cache.set(projectId, { ...cache.get(projectId), entries: { at: Date.now(), value: loaded } });
      return loaded;
    } catch (err) {
      // The backend's own words, never a blank list dressed up as "no entries".
      setEntriesError(errorMessage(err, "Couldn't load work progress"));
      return null;
    } finally {
      setEntriesLoading(false);
    }
  }, [projectId]);

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const data = await fetchJson(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`);
      const loaded: WorkProgressActivity[] = data.activities ?? [];
      setActivities(loaded);
      // Writes ONLY its own half: it must never mint an `entries` value on
      // behalf of a load that failed.
      cache.set(projectId, { ...cache.get(projectId), activities: { at: Date.now(), value: loaded } });
    } catch {
      // Activities are a label/option source, not the screen's subject: a
      // failure here must not blank the list or raise an error card.
    } finally {
      setActivitiesLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // A tab switch inside the TTL costs nothing at all -- but each half is
    // decided on its own, so a warm entries list does not suppress a missing
    // activities load (or, more importantly, the retry of a failed one).
    const warmEntries = cachedEntries(projectId);
    if (warmEntries) {
      setEntries(warmEntries);
      setEntriesError(null);
      setEntriesLoading(false);
    } else {
      void loadEntries();
    }

    const warmActivities = cachedActivities(projectId);
    if (warmActivities) {
      setActivities(warmActivities);
      setActivitiesLoading(false);
    } else {
      void loadActivities();
    }
  }, [projectId, loadEntries, loadActivities]);

  // reload() is what a successful write calls -- it must never read the cache.
  const reload = useCallback(async () => {
    cache.delete(projectId);
    await Promise.all([loadEntries(), loadActivities()]);
  }, [projectId, loadEntries, loadActivities]);

  const value = useMemo<WorkProgressData>(
    () => ({ entries, activities, entriesLoading, activitiesLoading, entriesError, reload }),
    [entries, activities, entriesLoading, activitiesLoading, entriesError, reload]
  );

  return <WorkProgressDataContext.Provider value={value}>{children}</WorkProgressDataContext.Provider>;
}

export default WorkProgressDataProvider;
