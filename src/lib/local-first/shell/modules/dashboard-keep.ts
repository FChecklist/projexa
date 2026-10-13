// UAT 2026-10-13, checklist 4.3b (R-50, R-51, R-62): the offline dashboard said "Money, budgets and progress by value are worked out by the server"
// and showed NO figures, because the laptop's copy of the server's project figures (the snapshot, snapshot-cache.ts) was only ever written when the
// person opened the dashboard INSIDE the offline shell while online. A person who works on the normal pages (the usual case) never did, so there was
// nothing to show offline. This keeps the server's answer from the normal pages instead:
//   * keepProjectDashboard   the normal project dashboard page already fetched /api/dashboard/project/<id>: it keeps THAT answer (no extra request);
//   * topUpProjectDashboard  for a person who has not opened that page: at most one fetch per project per half hour from the background refresh.
// Nothing is computed here: the figures are the server's, shown offline as "As of <dd-mm-yyyy hh:mm>, from this laptop" (the dashboard's own label).

import { deviceMetaStore, openDeviceMeta } from "../../device-meta";
import { createIdentityStore, getDurableIdentity } from "../../identity";
import { isLocalFirstEnabled } from "../../local-reader";
import { readShellData } from "../context";
import { refreshSnapshot, snapshotCacheFor, type SnapshotCache } from "../snapshot-cache";
import { projectDashboardFor, projectDashboardSnapshotName, projectDashboardUrl } from "./dashboard-adapter";

export const DASHBOARD_TOPUP_FRESH_MS = 30 * 60 * 1000;

/** The person this browser is kept for, and the snapshot cache of their own database. Null: no laptop copy for anyone. */
async function cacheForThisPerson(deps: { localFirstOn?: () => boolean; idb?: IDBFactory } = {}): Promise<SnapshotCache | null> {
  if (!(deps.localFirstOn ?? isLocalFirstEnabled)()) return null;
  try {
    const store = createIdentityStore({ storage: typeof localStorage === "undefined" ? null : localStorage, openMeta: () => openDeviceMeta(deps.idb) });
    const identity = await getDurableIdentity(store);
    if (!identity) return null;
    // the SAME derivation of the role the shell uses (context.ts buildShellData), so the shell reads back what is written here
    const data = await readShellData({ identity, deviceMeta: deviceMetaStore(deps.idb), idb: deps.idb });
    return snapshotCacheFor({ userId: data.userId, role: data.role, idb: deps.idb });
  } catch {
    return null;
  }
}

/** Keeps the dashboard answer the normal page just received. True when it was kept. Never throws. */
export async function keepProjectDashboard(projectId: string, body: unknown, deps: { localFirstOn?: () => boolean; idb?: IDBFactory } = {}): Promise<boolean> {
  try {
    if (!projectDashboardFor(projectId)(body)) return false;
    const cache = await cacheForThisPerson(deps);
    if (!cache) return false;
    return (await cache.write(projectDashboardSnapshotName(projectId), body)) !== null;
  } catch {
    return false;
  }
}

/** Fetches the dashboard answer when none is kept or the kept one is older than half an hour. True when a fresh answer was kept. Never throws. */
export async function topUpProjectDashboard(
  projectId: string,
  deps: { localFirstOn?: () => boolean; idb?: IDBFactory; now?: () => number; fetchImpl?: typeof fetch; freshMs?: number } = {}
): Promise<boolean> {
  try {
    const cache = await cacheForThisPerson(deps);
    if (!cache) return false;
    const name = projectDashboardSnapshotName(projectId);
    const validate = projectDashboardFor(projectId);
    const kept = await cache.read(name, validate);
    const now = deps.now ? deps.now() : Date.now();
    if (kept && now - kept.fetchedAt < (deps.freshMs ?? DASHBOARD_TOPUP_FRESH_MS)) return false;
    const outcome = await refreshSnapshot(cache, name, projectDashboardUrl(projectId), validate, { fetchImpl: deps.fetchImpl });
    return outcome.state === "fresh";
  } catch {
    return false;
  }
}
