import { callVeridian, VERIDIAN_PAGE_BUDGET_MS } from "@/lib/veridian-client";

// R67 F-09 (R-122), D-04. The two schedule create screens fetched their
// reference lists AFTER hydration: /schedule/tasks/new fetched the task types,
// /schedule/log-time fetched the project's tasks. Both therefore rendered a
// select with nothing in it, showing "Loading…" or an empty dropdown, and only
// filled in a round trip later -- on a five-field form where that select is
// the one field that cannot be typed.
//
// Resolved in the server component instead and handed down as props, so the
// first rendered frame carries the real options. The VERIDIAN key stays
// server-side, which is why the browser could not do this itself.
//
// Both resolvers NEVER THROW. A reference list is a convenience: create still
// works with the server-side default type, and Log Time still shows its other
// fields. A failed lookup must not turn a working create screen into an error
// page -- it returns an empty list, and the form says honestly that there are
// no options rather than pretending to load forever.
export type IssueType = { id: string; name: string; isDefault?: boolean | null };
export type ScheduleTask = { id: string; number: number; title: string };

export async function resolveIssueTypes(organizationId: string | null): Promise<IssueType[]> {
  try {
    const data = await callVeridian<{ types?: IssueType[] }>("/schedule/types", {
      organizationId: organizationId ?? undefined,
      timeoutMs: VERIDIAN_PAGE_BUDGET_MS,
    });
    return data.types ?? [];
  } catch (err) {
    console.error("[schedule-reference] task types lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function resolveScheduleTasks(projectId: string, organizationId: string | null): Promise<ScheduleTask[]> {
  try {
    const data = await callVeridian<{ tasks?: ScheduleTask[] }>(`/schedule?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: organizationId ?? undefined,
      timeoutMs: VERIDIAN_PAGE_BUDGET_MS,
    });
    return data.tasks ?? [];
  } catch (err) {
    console.error("[schedule-reference] task list lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
