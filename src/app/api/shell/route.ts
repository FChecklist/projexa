import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { callVeridianResult } from "@/lib/veridian-client";
import { serverTimingHeader } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 F-21 (audit recommendation R-236) -- ONE bootstrap for the shell.
//
// WHAT IT REPLACES. M24Shell re-fetched /api/organization (two or three times
// per navigation), /api/projects (1.4-2.7 s), /api/notifications, /api/tasks,
// /api/pill-usage and /api/capability-tree ON EVERY NAVIGATION -- setting
// network-idle at 3.8-4.6 s even on a create form that needs none of them.
// Six of those are the same six answers for the whole session: the user's
// organisation does not change between /permits and /scope.
//
// So they run ONCE here, concurrently, server-side, and the client holds the
// result in a session store (src/lib/shell-store.ts) that revalidates in the
// background on its own schedule rather than on every route change. Tasks
// stay OUT of this payload deliberately: they change as the user works, they
// are paginated, and F-26 gives them their own single-row polling.
//
// EVERY LOOKUP IS INDEPENDENT. allSettled, not all: a failing pill ranking
// must not blank the organisation name, and the audit's own finding is that
// this shell reported nothing at all when part of it failed. Each failure is
// named in `errors` with the backend's own words, so the shell can say which
// half of itself is missing instead of rendering an em-dash and hoping.
export const dynamic = "force-dynamic";

export type ShellBootstrapPayload = {
  organization: { id: string; name: string; slug: string; country: string | null } | null;
  role: string | null;
  email: string | null;
  projects: { id: string; name: string }[];
  notifications: unknown[];
  unreadCount: number;
  pillUsage: { pillKey: string; functionId?: string }[];
  history: unknown[];
  isNewUser: boolean;
  capabilityTree: unknown[];
  currencies: unknown[];
  // R67 F-25 (R-241): the subcontractor list. It is a session-scoped lookup --
  // the same answer on /labour, on /labour/new and on /labour/attendance/new --
  // and LabourClient used to re-fetch it on every landing purely to turn a
  // vendorId into a company name in one column.
  vendors: { id: string; vendorName: string }[];
  fetchedAt: number;
  /** Per-key failures, in the backend's own words. Absent keys succeeded. */
  errors: Record<string, string>;
};

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const startedAt = Date.now();
  const supabase = await createClient();
  const organizationId = ctx.organizationId!;

  const [orgRow, notifs, unread, projects, pillUsage, capabilityTree, currencies, vendors] = await Promise.allSettled([
    supabase.from("organizations").select("id, name, slug, created_at, country").eq("id", organizationId).single(),
    ctx.user
      ? supabase
          .from("notifications")
          .select("id, title, message, type, is_read, metadata, created_at")
          .eq("user_id", ctx.user.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    ctx.user
      ? supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("is_read", false)
      : Promise.resolve({ count: 0, error: null }),
    callVeridianResult<{ projects?: { id: string; name: string }[] }>("/dashboard", { organizationId }),
    callVeridianResult<{ pills?: { pillKey: string; functionId?: string }[]; history?: unknown[]; isNewUser?: boolean }>(
      "/pill-usage?limit=6",
      { organizationId }
    ),
    callVeridianResult<{ nodes?: unknown[] }>("/capability-tree", { organizationId }),
    callVeridianResult<{ currencies?: unknown[] }>("/currencies", { organizationId }),
    callVeridianResult<{ vendors?: { id: string; vendorName: string }[] }>("/vendors", { organizationId }),
  ]);

  const errors: Record<string, string> = {};

  const orgValue = orgRow.status === "fulfilled" ? orgRow.value : null;
  if (!orgValue || orgValue.error || !orgValue.data) {
    errors.organization = orgValue?.error?.message ?? "Organization not found";
  }

  const notifValue = notifs.status === "fulfilled" ? (notifs.value as { data?: unknown[]; error?: { message: string } | null }) : null;
  if (!notifValue || notifValue.error) errors.notifications = notifValue?.error?.message ?? "Couldn't load notifications";

  const unreadValue = unread.status === "fulfilled" ? (unread.value as { count?: number | null; error?: { message: string } | null }) : null;

  const projectsValue = projects.status === "fulfilled" ? projects.value : null;
  if (!projectsValue?.ok) errors.projects = projectsValue?.message ?? "Couldn't load projects";

  const pillValue = pillUsage.status === "fulfilled" ? pillUsage.value : null;
  if (!pillValue?.ok) errors.pillUsage = pillValue?.message ?? "Couldn't load your ranked modules";

  const treeValue = capabilityTree.status === "fulfilled" ? capabilityTree.value : null;
  if (!treeValue?.ok) errors.capabilityTree = treeValue?.message ?? "Couldn't load the capability tree";

  const currencyValue = currencies.status === "fulfilled" ? currencies.value : null;
  if (!currencyValue?.ok) errors.currencies = currencyValue?.message ?? "Couldn't load currencies";

  const vendorValue = vendors.status === "fulfilled" ? vendors.value : null;
  if (!vendorValue?.ok) errors.vendors = vendorValue?.message ?? "Couldn't load subcontractors";

  const payload: ShellBootstrapPayload = {
    organization: orgValue?.data
      ? {
          id: orgValue.data.id as string,
          name: orgValue.data.name as string,
          slug: orgValue.data.slug as string,
          country: (orgValue.data.country as string | null) ?? null,
        }
      : null,
    role: ctx.role ?? null,
    email: ctx.user?.email ?? null,
    projects: projectsValue?.ok ? (projectsValue.data.projects ?? []) : [],
    notifications: (notifValue?.data ?? []) as unknown[],
    unreadCount: unreadValue?.count ?? 0,
    pillUsage: pillValue?.ok ? (pillValue.data.pills ?? []) : [],
    history: pillValue?.ok ? (pillValue.data.history ?? []) : [],
    isNewUser: pillValue?.ok ? Boolean(pillValue.data.isNewUser) : false,
    capabilityTree: treeValue?.ok ? (treeValue.data.nodes ?? []) : [],
    currencies: currencyValue?.ok ? (currencyValue.data.currencies ?? []) : [],
    vendors: vendorValue?.ok ? (vendorValue.data.vendors ?? []) : [],
    fetchedAt: Date.now(),
    errors,
  };

  // The slowest upstream is what this route actually cost -- they ran
  // concurrently, so summing them would misreport it.
  const upstreamMs = Math.max(
    projectsValue?.durationMs ?? 0,
    pillValue?.durationMs ?? 0,
    treeValue?.durationMs ?? 0,
    currencyValue?.durationMs ?? 0,
    vendorValue?.durationMs ?? 0
  );

  return NextResponse.json(payload, {
    headers: { "Server-Timing": serverTimingHeader(upstreamMs, Date.now() - startedAt) },
  });
});
