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
  const { data, error } = await getClaimsWithRetry(supabase);

  if (error || !data?.claims) {
    if (error) {
      console.error("[requireAuth] getClaims() failed -- treating as unauthenticated:", error.message);
    }
    return { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user: AuthUser = { id: data.claims.sub as string, email: (data.claims.email as string | undefined) ?? null };

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

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
