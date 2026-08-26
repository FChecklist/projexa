import { NextResponse } from "next/server";
import { createClient } from "./server";
import { getClaimsWithRetry } from "./get-claims-with-retry";

export type AuthUser = { id: string; email: string | null };

export type AuthContext = {
  user: AuthUser | null;
  organizationId: string | null;
  role: string | null;
  response: NextResponse | null;
};

// PROJEXA-native tenant role, backed by `memberships.role` (see
// drizzle/0001_projexa_tenant_schema.sql's check constraint, extended by
// drizzle/0012_membership_roles_pm_site_engineer.sql). This is PROJEXA's
// own axis -- separate from VERIDIAN's user_role enum -- because PROJEXA
// users authenticate against PROJEXA's own Supabase project and PROJEXA's
// server routes call VERIDIAN with a single shared per-org API key (see
// veridian-client.ts), not a per-user VERIDIAN identity. `client_viewer` is
// a real PROJEXA-native role (not routed through VERIDIAN's own
// client_viewer concept) for exactly that reason: there is no per-user
// VERIDIAN call for a role check on the VERIDIAN side to attach to, so the
// gate has to live here to have any effect at the API boundary.
//
// R48_API_WRITES_WITHOUT_ROLE_CHECK_01: the role vocabulary itself now lives
// in src/lib/authz/roles.ts, which has no imports at all, so that
// src/middleware.ts (Edge runtime) can enforce the central write policy
// without pulling in this file's `next/headers`-backed Supabase server
// client. Re-exported here unchanged so every existing
// `from "@/lib/supabase/auth-guard"` import keeps working.
// Deliberately re-declared as local `export const` bindings rather than
// `export { X } from "../authz/roles"`. Several route tests mock this module
// with bun's mock.module(), and a re-export chain through a mocked module
// makes bun fail to resolve ANY of this file's exports ("Export named
// 'requireRole' not found"). A local binding assigned from the import is the
// same single source of truth without that failure mode.
import {
  ALL_ORG_ROLES as ORG_ROLES_SOURCE,
  ROLE_GROUPS as ROLE_GROUPS_SOURCE,
  type OrgRole as OrgRoleSource,
} from "../authz/roles";

export type OrgRole = OrgRoleSource;
export const ALL_ORG_ROLES = ORG_ROLES_SOURCE;
export const ROLE_GROUPS = ROLE_GROUPS_SOURCE;

// Server-side role gate. Must be called after requireAuth() has already
// confirmed ctx.response is null (i.e. the caller is authenticated and has
// a resolved membership role) -- mirrors compliance-tracker's own
// requireRole()/requireRoleOrScope() pattern (auth-guard.ts:443-456 there),
// adapted to PROJEXA's thinner 'memberships.role' axis instead of VERIDIAN's
// rank-based user_role enum, since PROJEXA's 6 roles have no linear
// seniority order that a single rank number could represent (client_viewer
// isn't "below" site_engineer, they're different axes of restriction).
export function requireRole(ctx: AuthContext, allowed: readonly string[]): NextResponse | null {
  if (!ctx.role || !allowed.includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden: your role does not permit this action" }, { status: 403 });
  }
  return null;
}

// CONFIRMED ROOT CAUSE (2026-07-13 investigation, see commit message for the
// full writeup): this used to call `supabase.auth.getUser()`, which makes a
// live network round-trip to Supabase Auth's `/user` endpoint on *every*
// single call, with no caching. middleware.ts *already* makes that same
// live call on every request that reaches this handler (its matcher covers
// /api/* too), so every Route Handler was making a second, fully redundant
// round-trip to Supabase Auth for a request that had already been verified
// moments earlier. Reproduced live against this project's real Supabase
// instance: a `getUser()` call that hit a slow/failed connection
// (ConnectTimeoutError against Supabase's edge) took 10-20s and then
// resolved with no user, which this function silently treated as "not
// logged in" -- a transient network hiccup, not an actual logout, ends up
// bouncing the user to /login (via middleware) or 401ing a write (via this
// function) with zero indication anything went wrong. Doubling the number
// of independent live calls per page load (~6 concurrent API requests, each
// with its own getUser() here, on top of middleware's own) doubled exposure
// to that failure mode for no security benefit, since both calls check the
// exact same cookie-derived session against the exact same Auth server.
//
// Fix: verify the session locally via getClaims(), which validates the
// JWT's signature against a cached JWKS (WebCrypto, no network call) and
// only ever talks to the network when the token is actually near-expiry
// (to refresh first) or the JWKS cache is cold -- see auth-js's GoTrueClient
// for the exact fallback rules. This eliminates the redundant round-trip
// instead of just relocating it.
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient();

  // R46 (production incident, 2026-08-25: 39 uncaught 500s across 13 routes
  // for one user in a 13s window, "SyntaxError: Expected ',' or '}' after
  // property value in JSON" from getClaims()): middleware.ts already wraps
  // this identical call in try/catch (its own R45 seq4 follow-up comment
  // above documents why -- a malformed cookie/JWT can make the Edge
  // runtime's claims decoder THROW, not just return an `error`, and an
  // uncaught throw here escapes as a hard 500 instead of degrading to
  // "unauthenticated" the way every other failure mode in this function
  // already does). That fix was never carried over to this Route Handler
  // path, which every /api/* route calls independently of middleware --
  // so the exact same malformed-cookie condition that middleware already
  // handles gracefully (redirect to /login) instead took down 13 separate
  // API routes with uncaught 500s for the one affected request. Mirrors
  // middleware.ts's try/catch exactly, same non-fatal-by-design intent.
  let data: Awaited<ReturnType<typeof getClaimsWithRetry>>["data"] = null;
  let error: Awaited<ReturnType<typeof getClaimsWithRetry>>["error"] = null;
  try {
    ({ data, error } = await getClaimsWithRetry(supabase));
  } catch (err) {
    console.error("[requireAuth] getClaims() threw -- treating as unauthenticated:", err instanceof Error ? err.message : err);
  }

  if (error || !data?.claims) {
    if (error) {
      console.error("[requireAuth] getClaims() failed -- treating as unauthenticated:", error.message);
    }
    return { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user: AuthUser = { id: data.claims.sub as string, email: (data.claims.email as string | undefined) ?? null };

  const fetchMembership = () =>
    supabase
      .from("memberships")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

  // CONFIRMED ROOT CAUSE (Priority 16 Part 2, "Create Job Opening"
  // reproducibly failing with 400 "No organization" on a user who
  // demonstrably has a real membership row): this used to destructure only
  // `data` from the query below and silently discard `error` -- so a
  // transient Supabase query failure (the same class of network hiccup
  // documented above for getClaims(), and separately reproduced this same
  // test session against /api/attendance) was indistinguishable from a
  // genuine "this user has no organization" case, and got misreported with
  // the same misleading, non-retryable-sounding 400. One retry, mirroring
  // getClaimsWithRetry() above -- if it still errors after that, this is
  // surfaced honestly as a transient failure instead of a false "no org".
  let { data: membership, error: membershipError } = await fetchMembership();
  if (membershipError) {
    console.warn("[requireAuth] memberships query failed once, retrying:", membershipError.message);
    ({ data: membership, error: membershipError } = await fetchMembership());
  }

  if (membershipError) {
    console.error("[requireAuth] memberships query failed twice -- not a genuine 'no organization' case, surfacing as a transient failure instead:", membershipError.message);
    return { user, organizationId: null, role: null, response: NextResponse.json({ error: "Could not verify organization membership, please retry" }, { status: 503 }) };
  }

  if (!membership) {
    return { user, organizationId: null, role: null, response: NextResponse.json({ error: "No organization" }, { status: 400 }) };
  }

  return { user, organizationId: membership.organization_id, role: membership.role, response: null };
}

// Server Component convenience wrapper around requireAuth(). Server
// Components (e.g. the (app)/*/page.tsx pages that call
// resolveSelectedProject() in src/lib/project-selection.ts) can't return a
// NextResponse the way a Route Handler can -- page-level route protection is
// already handled by middleware.ts, so these just need the current
// organizationId for scoping their VERIDIAN calls (see Priority 17 platform
// provisioning: callVeridian* now resolves a per-org key from this id
// instead of always falling back to the shared demo VERIDIAN_API_KEY).
// Returns null if unauthenticated or the user has no organization yet --
// callers already handle a null/missing project the same way they handle a
// VERIDIAN error (see resolveSelectedProject's errorMessage/empty-state
// handling), so this deliberately doesn't throw.
export async function getServerOrganizationId(): Promise<string | null> {
  const ctx = await requireAuth();
  return ctx.organizationId;
}
