import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClaimsWithRetry } from "./lib/supabase/get-claims-with-retry";

// CONFIRMED ROOT CAUSE of the random mid-session logouts + silent write
// failures (investigated 2026-07-13, see auth-guard.ts for the full
// writeup): this used to call `supabase.auth.getUser()`, which makes a live
// network round-trip to Supabase Auth's `/user` endpoint on *every single
// request* this middleware runs for (its matcher covers pages and /api/*
// alike), with the `error` half of the result silently discarded. Every
// Route Handler then made its *own* independent getUser() call on top of
// that via requireAuth() -- so one page load with ~6 concurrent API calls
// meant ~12 independent live calls to Supabase Auth, any one of which
// failing (a real, reproduced ConnectTimeoutError talking to Supabase's
// edge, not a hypothetical) got silently treated as "user is logged out",
// bouncing that one request to /login or 401ing that one write -- with
// nothing visibly wrong to the person testing it, and no relationship to
// which route happened to be involved.
//
// Fix: use getClaims(), which verifies the session's JWT locally (WebCrypto
// signature check against a cached JWKS) instead of a network call, only
// touching the network when the token is genuinely near-expiry (to refresh)
// or the JWKS cache is cold. This is also where the (still real, still
// needed) refresh-token network call happens when one actually is due --
// keeping that here and *not* repeating it in every Route Handler is what
// stops the redundant-refresh fan-out.
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data, error } = await getClaimsWithRetry(supabase);
  if (error) {
    // Non-fatal by design (a transient JWKS-fetch or refresh failure here
    // must not be indistinguishable from "not logged in" without a trace),
    // but no longer silent -- this is exactly the failure mode that used to
    // produce unexplained logouts.
    console.error("[middleware] getClaims() failed:", error.message);
  }
  const userId = (data?.claims?.sub as string | undefined) ?? null;

  const PROTECTED_PREFIXES = [
    "/dashboard", "/schedule", "/scope", "/work-progress", "/site-diary", "/documents",
    "/rfis", "/submittals", "/punch-list", "/change-orders", "/mood-boards", "/ffe", "/floor-plans",
    "/manpower", "/labour", "/materials", "/vendors", "/budgets", "/expenses", "/kpis",
    "/reports", "/ai-copilot", "/settings",
  ];
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (!userId && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (userId && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    // Deferred-provisioning gap (Priority 17 platform provisioning): an
    // authenticated user with NO organization yet -- signup required email
    // confirmation, so org/VERIDIAN provisioning was deferred to their next
    // login (see login/page.tsx's `projexa_pending_org_name` handling) --
    // must be allowed to actually reach /login so that completion logic can
    // run. Unconditionally bouncing every authenticated visitor to
    // /dashboard (the prior behavior) made that entire code path
    // unreachable: middleware redirected them away before the page's own
    // script ever executed. Only /login gets this exception; /signup has no
    // equivalent "resume" logic and re-running supabase.auth.signUp() for an
    // already-authenticated session isn't a real use case.
    if (request.nextUrl.pathname === "/login") {
      const { data: membership } = await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!membership) {
        return supabaseResponse;
      }
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-mark.svg).*)"],
};
