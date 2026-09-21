import { createClient } from "@/lib/supabase/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

// PROJEXA-E2E-001 cold-load investigation (2026-09-21): /settings used to
// render an instant-but-empty shell (SettingsClient has no props at all)
// and fire TWO client-side fetches after hydration --
// GET /api/organization and GET /api/org-members -- with the WHOLE page
// behind one `loading` spinner until both resolved. Same class of gap R67
// F-18 already closed on documents/labour/budgets/reports/MoMs: the frame
// painted at TTFB, but nothing useful was on screen until a full
// browser-round-trip-after-hydration finished, with zero server-side
// prefetch.
//
// This file is the ONE implementation both the API route (GET
// /api/organization, GET /api/org-members -- unchanged, still the real
// client-side refresh/mutation path) and the settings page's server
// component (new, streamed via <Suspense>) call, so there is exactly one
// place that knows how to read this org's info/roster -- the same
// "lift into a shared function, have both callers use it" precedent
// risk-register-service.ts's own header comment documents for its own
// extraction.
//
// Deliberately NOT given a cross-request cache (no unstable_cache/
// revalidateTag): unlike budget-lookups.ts's reference data (fiscal years,
// once-configured-per-org), organization role/membership changes via this
// SAME page's own role-editing controls and needs to read back correctly on
// the very next render -- the fix here is moving the read from
// "after hydration" to "during SSR", not caching it across requests.

export type SettingsOrgInfo = {
  organization: { id: string; name: string; slug: string; created_at: string; country: string | null };
  role: string;
  email: string;
};

export type SettingsMember = {
  user_id: string;
  role: string;
  profiles: { email: string; display_name: string | null } | null;
};

export async function getSettingsOrgInfo(ctx: Pick<AuthContext, "organizationId" | "role" | "user">): Promise<SettingsOrgInfo | { error: string }> {
  const supabase = await createClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at, country")
    .eq("id", ctx.organizationId!)
    .single();

  if (error || !org) return { error: error?.message ?? "Organization not found" };
  return { organization: org, role: ctx.role!, email: ctx.user!.email! };
}

export async function getSettingsMembers(organizationId: string): Promise<{ members: SettingsMember[] } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(email, display_name)")
    .eq("organization_id", organizationId);

  if (error) return { error: error.message };
  // A4S14_settings_01 (unchanged from the route's own fix): the roster is
  // every member including the caller -- no self-filter.
  return { members: (data ?? []) as unknown as SettingsMember[] };
}
