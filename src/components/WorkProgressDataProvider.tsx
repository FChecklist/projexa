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

type CacheRow = { at: number; entries: WorkProgressEntry[]; activities: WorkProgressActivity[] };
const cache = new Map<string, CacheRow>();

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
  const fresh = cache.get(projectId);
  const isFresh = !!fresh && Date.now() - fresh.at < TTL_MS;

  const [entries, setEntries] = useState<WorkProgressEntry[]>(isFresh ? fresh!.entries : []);
  const [activities, setActivities] = useState<WorkProgressActivity[]>(isFresh ? fresh!.activities : []);
  const [entriesLoading, setEntriesLoading] = useState(!isFresh);
  const [activitiesLoading, setActivitiesLoading] = useState(!isFresh);
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
      const row = cache.get(projectId);
      cache.set(projectId, { at: Date.now(), entries: loaded, activities: row?.activities ?? [] });
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
      const row = cache.get(projectId);
      cache.set(projectId, { at: row?.at ?? Date.now(), entries: row?.entries ?? [], activities: loaded });
    } catch {
      // Activities are a label/option source, not the screen's subject: a
      // failure here must not blank the list or raise an error card.
    } finally {
      setActivitiesLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const row = cache.get(projectId);
    if (row && Date.now() - row.at < TTL_MS) {
      // A tab switch inside the TTL costs nothing at all.
      setEntries(row.entries);
      setActivities(row.activities);
      setEntriesLoading(false);
      setActivitiesLoading(false);
      return;
    }
    void loadEntries();
    void loadActivities();
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
