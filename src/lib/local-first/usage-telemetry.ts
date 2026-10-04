// LOCAL-FIRST usage telemetry (Audit 37 point 9): numbers that show the work happens on the user's laptop. Once per session, then at most
// every 10 minutes while the tab is visible, one data-free line of kind "usage" goes through the existing client-error channel
// (client-error-report.ts -> /api/local-first/client-error). The message is a small JSON object of counts and sizes only: no URLs, no content.

export const USAGE_INTERVAL_MS = 10 * 60_000;
export const SYNC_PATH = "/functions/v1/projexa-sync";

export type ResourceEntry = { name: string; transferSize?: number; decodedBodySize?: number };

export type UsageSnapshot = {
  deviceMemoryGb: number | null;
  jsHeapMb: number | null;
  storageUsedMb: number | null;
  storageQuotaMb: number | null;
  syncRuns: number;
  networkRequests: number;
  networkKb: number;
  localServed: number;
  localServedKb: number;
};

const mb = (n: number) => Math.round((n / 1_048_576) * 10) / 10;
const kb = (n: number) => Math.round(n / 1024);

/** Pure: resource timing entries since the last report -> counts. transferSize 0 with a body = served from the laptop's cache/worker. */
export function summariseResources(entries: readonly ResourceEntry[]) {
  let syncRuns = 0, networkRequests = 0, networkBytes = 0, localServed = 0, localBytes = 0;
  for (const e of entries) {
    if (e.name.includes(SYNC_PATH)) syncRuns += 1;
    const transfer = e.transferSize ?? 0;
    if (transfer > 0) { networkRequests += 1; networkBytes += transfer; }
    else if ((e.decodedBodySize ?? 0) > 0) { localServed += 1; localBytes += e.decodedBodySize ?? 0; }
  }
  return { syncRuns, networkRequests, networkKb: kb(networkBytes), localServed, localServedKb: kb(localBytes) };
}

export function buildUsageSnapshot(input: {
  deviceMemory?: number;
  usedJSHeapSize?: number;
  storage?: { usage?: number; quota?: number } | null;
  entries: readonly ResourceEntry[];
}): UsageSnapshot {
  return {
    deviceMemoryGb: typeof input.deviceMemory === "number" ? input.deviceMemory : null,
    jsHeapMb: typeof input.usedJSHeapSize === "number" ? mb(input.usedJSHeapSize) : null,
    storageUsedMb: typeof input.storage?.usage === "number" ? mb(input.storage.usage) : null,
    storageQuotaMb: typeof input.storage?.quota === "number" ? mb(input.storage.quota) : null,
    ...summariseResources(input.entries),
  };
}

/** Whether a report is due: first one of the session, then not before 10 minutes, and only while the tab is visible. */
export function usageReportDue(lastAt: number | null, now: number, visible: boolean): boolean {
  return visible && (lastAt === null || now - lastAt >= USAGE_INTERVAL_MS);
}

type Deps = {
  report: (kind: string, message: string, where?: string) => void;
  now?: () => number;
  isVisible?: () => boolean;
  collect?: () => Promise<UsageSnapshot>;
};

async function collectFromBrowser(): Promise<UsageSnapshot> {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const entries = performance.getEntriesByType("resource") as unknown as ResourceEntry[];
  performance.clearResourceTimings?.();
  let storage: { usage?: number; quota?: number } | null = null;
  try { storage = (await navigator.storage?.estimate?.()) ?? null; } catch { storage = null; }
  return buildUsageSnapshot({ deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, usedJSHeapSize: perf.memory?.usedJSHeapSize, storage, entries });
}

/** Starts the schedule; returns stop(). Never throws. The first report waits for the tab to be visible. */
export function startUsageTelemetry(deps: Deps): () => void {
  const now = deps.now ?? Date.now;
  const visible = deps.isVisible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const collect = deps.collect ?? collectFromBrowser;
  let last: number | null = null;
  let busy = false;
  const tick = async () => {
    if (busy || !usageReportDue(last, now(), visible())) return;
    busy = true;
    try {
      last = now();
      deps.report("usage", JSON.stringify(await collect()), "usage-telemetry");
    } catch { /* telemetry must never break the app */ } finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  const onVisible = () => void tick();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
