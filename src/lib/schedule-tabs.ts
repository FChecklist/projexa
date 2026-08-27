// F_016 fix (2026-08-27): extracted out of ScheduleTabsClient.tsx, which is
// a "use client" module. schedule/page.tsx is a Server Component and calls
// isScheduleTab(tab) directly (not just rendering it as a Component or
// passing it as a prop) while resolving initialTab. A function exported
// from a "use client" module becomes an opaque client reference when
// imported into a Server Component, so invoking it directly server-side
// throws "Attempted to call isScheduleTab() from the server but
// isScheduleTab is on the client" -- confirmed 500ing every GET /schedule
// in production (digest 1240219489, first seen 2026-08-27T09:09:55Z,
// immediately after R57/PR#185 -- which introduced ScheduleTabsClient.tsx
// and moved isScheduleTab into it -- went live at 2026-08-27T08:50:10Z).
// This module has no "use client" directive, so both the server page and
// the client tabs component can import and call these directly.
export const SCHEDULE_TABS = ["timeline", "board", "sprints", "timesheet"] as const;
export type ScheduleTab = (typeof SCHEDULE_TABS)[number];

export function isScheduleTab(value: string | undefined): value is ScheduleTab {
  return !!value && (SCHEDULE_TABS as readonly string[]).includes(value);
}
