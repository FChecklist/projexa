import type { Breadcrumb } from "./types";

export const MAX_BREADCRUMBS = 30;

/** In-memory ring of the last 30 things a person did. Lives only in this tab's RAM; it is copied into an event only when something goes wrong. */
export function createBreadcrumbs(now: () => number = Date.now, max = MAX_BREADCRUMBS) {
  let ring: Breadcrumb[] = [];
  return {
    add(type: Breadcrumb["type"], label: string, route: string) {
      ring.push({ t: new Date(now()).toISOString(), type, label: String(label).slice(0, 120), route: String(route).slice(0, 200) });
      if (ring.length > max) ring = ring.slice(ring.length - max);
    },
    snapshot(): Breadcrumb[] {
      return ring.map((b) => ({ ...b }));
    },
    size: () => ring.length,
  };
}
export type Breadcrumbs = ReturnType<typeof createBreadcrumbs>;
