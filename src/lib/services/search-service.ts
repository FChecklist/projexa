import { callVeridian } from "@/lib/veridian-client";
import { resolveSelectedProject, type SelectableProject } from "@/lib/project-selection";
import { createClient } from "@/lib/supabase/server";

// PROJEXA's global command-palette search (src/components/search-command.tsx)
// covers PROJEXA's own real entities. Unlike compliance-tracker's
// search-service.ts (which runs a single ILIKE query against its own
// Postgres tables), most of PROJEXA's construction entities live entirely in
// VERIDIAN -- see src/lib/veridian-client.ts -- so there is no SQL to run
// against them. Instead this fetches each project-scoped entity list via the
// same real callVeridian() proxy every other page already uses, then filters
// in application code. `todos` is the one real local Postgres table PROJEXA
// has of its own, so that one genuinely does run a query.

export type SearchResultItem = {
  type: "project" | "rfi" | "submittal" | "punch_list" | "change_order" | "todo";
  id: string;
  title: string;
  status?: string | null;
  projectId?: string;
};

export type SearchResults = {
  projects: SearchResultItem[];
  rfis: SearchResultItem[];
  submittals: SearchResultItem[];
  punchList: SearchResultItem[];
  changeOrders: SearchResultItem[];
  todos: SearchResultItem[];
};

export const EMPTY_SEARCH_RESULTS: SearchResults = {
  projects: [], rfis: [], submittals: [], punchList: [], changeOrders: [], todos: [],
};

// Case-insensitive substring match against any of the given fields. Some
// fields (e.g. Submittal.specSection, PunchItem.location) are legitimately
// nullable -- those are just skipped rather than throwing.
export function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(needle));
}

export function filterAndCap<T>(items: T[], getFields: (item: T) => (string | null | undefined)[], query: string, limit: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (matchesQuery(getFields(item), query)) out.push(item);
  }
  return out;
}

export function searchProjects(projects: SelectableProject[], query: string, limit: number): SearchResultItem[] {
  return filterAndCap(projects, (p) => [p.name], query, limit).map((p) => ({
    type: "project" as const, id: p.id, title: p.name,
  }));
}

type Rfi = { id: string; subject: string; question: string; status: string };
type Submittal = { id: string; title: string; status: string };
type PunchItem = { id: string; description: string; status: string };
type ChangeOrder = { id: string; title: string; status: string };

// Fetches the 4 project-scoped entity lists for one project in parallel and
// filters each. A failure on any single entity (VERIDIAN transiently down,
// an org with no RFIs module enabled, etc.) degrades that one group to empty
// rather than failing the whole search -- same "don't let one bad group take
// down the rest" principle as the rest of this codebase's error handling.
export async function searchProjectEntities(
  organizationId: string,
  projectId: string,
  query: string,
  limit: number
): Promise<Pick<SearchResults, "rfis" | "submittals" | "punchList" | "changeOrders">> {
  const [rfis, submittals, punchList, changeOrders] = await Promise.all([
    callVeridian<{ rfis: Rfi[] }>(`/rfis?projectId=${encodeURIComponent(projectId)}`, { organizationId })
      .then((d) => d.rfis ?? [])
      .catch(() => [] as Rfi[]),
    callVeridian<{ submittals: Submittal[] }>(`/submittals?projectId=${encodeURIComponent(projectId)}`, { organizationId })
      .then((d) => d.submittals ?? [])
      .catch(() => [] as Submittal[]),
    callVeridian<{ items: PunchItem[] }>(`/punch-list?projectId=${encodeURIComponent(projectId)}`, { organizationId })
      .then((d) => d.items ?? [])
      .catch(() => [] as PunchItem[]),
    callVeridian<{ changeOrders: ChangeOrder[] }>(`/change-orders?projectId=${encodeURIComponent(projectId)}`, { organizationId })
      .then((d) => d.changeOrders ?? [])
      .catch(() => [] as ChangeOrder[]),
  ]);

  return {
    rfis: filterAndCap(rfis, (r) => [r.subject, r.question], query, limit)
      .map((r) => ({ type: "rfi" as const, id: r.id, title: r.subject, status: r.status, projectId })),
    submittals: filterAndCap(submittals, (s) => [s.title], query, limit)
      .map((s) => ({ type: "submittal" as const, id: s.id, title: s.title, status: s.status, projectId })),
    punchList: filterAndCap(punchList, (i) => [i.description], query, limit)
      .map((i) => ({ type: "punch_list" as const, id: i.id, title: i.description, status: i.status, projectId })),
    changeOrders: filterAndCap(changeOrders, (c) => [c.title], query, limit)
      .map((c) => ({ type: "change_order" as const, id: c.id, title: c.title, status: c.status, projectId })),
  };
}

// The one real ILIKE query in this file -- todos is a genuine local Postgres
// table (see src/lib/db/schema.ts), queried the same way GET /api/todos
// already does (Supabase JS client, RLS-scoped to the caller's own rows).
export async function searchTodos(userId: string, query: string, limit: number): Promise<SearchResultItem[]> {
  const term = query.trim();
  if (!term) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todos")
    .select("id, text, done")
    .eq("user_id", userId)
    .ilike("text", `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
    .limit(limit);
  if (error || !data) return [];
  return data.map((t) => ({ type: "todo" as const, id: t.id, title: t.text, status: t.done ? "done" : "pending" }));
}

export async function searchAll(
  organizationId: string,
  userId: string,
  requestedProjectId: string | null,
  query: string,
  limit: number
): Promise<SearchResults> {
  const term = query.trim();
  if (!term) return EMPTY_SEARCH_RESULTS;

  const selection = await resolveSelectedProject(requestedProjectId ?? undefined, organizationId);
  const projectId = selection.project?.id ?? null;

  const [projects, todos, projectEntities] = await Promise.all([
    Promise.resolve(searchProjects(selection.projects, term, limit)),
    searchTodos(userId, term, limit),
    projectId
      ? searchProjectEntities(organizationId, projectId, term, limit)
      : Promise.resolve({ rfis: [], submittals: [], punchList: [], changeOrders: [] } as Pick<SearchResults, "rfis" | "submittals" | "punchList" | "changeOrders">),
  ]);

  return { projects, todos, ...projectEntities };
}
