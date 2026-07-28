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

// PLATFORM-01 Wave 2 (Workstream 5, i18n): locale resolution, added
// alongside the auth logic above rather than replacing any of it. Cookie/
// header-based only -- deliberately NOT a URL-prefix routing scheme
// ([locale]/dashboard etc.), since that would rewrite every path this
// middleware's PROTECTED_PREFIXES check matches against and would be a much
// bigger structural change than this wave should attempt. Kept in sync
// manually with src/i18n/request.ts's copy of the same two constants (see
// that file's comment for why it isn't a shared import).
const SUPPORTED_LOCALES = ["en", "hi"] as const;
const DEFAULT_LOCALE = "en";
const LOCALE_COOKIE = "NEXT_LOCALE";

function resolveLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)) {
    return cookieLocale;
  }
  // Accept-Language, e.g. "hi-IN,hi;q=0.9,en;q=0.8" -- take the first tag's
  // primary subtag only, no q-value weighting; a full negotiation algorithm
  // is more than a first-visit default needs.
  const acceptLanguage = request.headers.get("accept-language");
  const preferred = acceptLanguage?.split(",")[0]?.split("-")[0]?.trim().toLowerCase();
  if (preferred && (SUPPORTED_LOCALES as readonly string[]).includes(preferred)) {
    return preferred;
  }
  return DEFAULT_LOCALE;
}

// Only writes the cookie when the incoming request didn't already have one
// -- i.e. real first-visit detection, not a rewrite-every-request cookie
// refresh. Applied to whichever response this middleware ends up returning
// (redirect or pass-through) so locale detection works no matter which
// branch below fires.
function withLocaleCookie(response: NextResponse, request: NextRequest, locale: string): NextResponse {
  if (!request.cookies.get(LOCALE_COOKIE)) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const locale = resolveLocale(request);

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
    "/manpower", "/labour", "/materials", "/site-materials", "/vendors", "/budgets", "/expenses", "/kpis",
    "/reports", "/ai-copilot", "/settings",
  ];
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (!userId && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return withLocaleCookie(NextResponse.redirect(url), request, locale);
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
        return withLocaleCookie(supabaseResponse, request, locale);
      }
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return withLocaleCookie(NextResponse.redirect(url), request, locale);
  }

  return withLocaleCookie(supabaseResponse, request, locale);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-mark.svg).*)"],
};
