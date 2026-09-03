import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClaimsWithRetry } from "./lib/supabase/get-claims-with-retry";
import { checkApiWriteAccess, MUTATING_METHODS } from "./lib/authz/api-write-policy";
import { requiresAuthenticatedPage } from "./lib/authz/page-access";

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

  // R45 seq4 follow-up (platform.r43_queue seq4): getClaimsWithRetry()'s
  // `{ data, error }` return shape only covers Supabase's OWN reported auth
  // failures -- it does NOT cover a THROWN exception, which is exactly what
  // real production telemetry showed happening here (Vercel runtime logs,
  // 2026-08-24: repeated `[error/edge-middleware] Invalid UTF-8 sequence`
  // bursts across every route -- page routes AND every /api/* route alike --
  // all in the same few-second window, consistent with the Edge runtime's
  // cookie-header parser throwing on a malformed cookie byte sequence while
  // decoding the JWT during getClaims()). Before this fix, that throw was
  // uncaught: it escaped this whole middleware function, which Next.js's
  // Edge runtime turns into a hard 500 for the ENTIRE request -- not a
  // graceful "treat as logged out," a real request failure on every single
  // route this middleware's matcher covers (i.e. almost everything,
  // including every page navigation and every one of the ~10 API calls the
  // app shell fires in parallel on load). A user mid-session hitting this on
  // even one of those parallel calls would see partial/broken data for that
  // request while the rest of the shell looks fine -- a plausible source of
  // "some interaction on this page just doesn't work" reports that never
  // show up as a clean, single reproducible error.
  //
  // R46 F_015 follow-up: the try/catch used to start AFTER
  // createServerClient(...) -- only wrapping getClaimsWithRetry(). That left
  // client CONSTRUCTION itself as an uncaught throw vector (Supabase's own
  // client throws synchronously -- "Your project's URL and Key are required
  // to create a Supabase client!" -- when NEXT_PUBLIC_SUPABASE_URL/ANON_KEY
  // are empty), invisible in practice only because every route this
  // matcher covers already sat behind Vercel's own SSO/deployment
  // protection wall on non-production deployments, so nothing unauthenticated
  // ever reached this line to prove it. Moving src/app/sw.js/route.ts's
  // service worker off static hosting onto this same middleware-covered
  // request pipeline surfaced it immediately: Vercel's protection layer lets
  // *.js-looking asset paths like /sw.js through unauthenticated (by design,
  // so SW registration/PWA installs aren't blocked by a login wall), so it
  // was the first path able to actually execute this line against a preview
  // deployment missing those two env vars, confirmed via
  // get_runtime_logs: "GET /sw.js 500 [error/edge-middleware] ... Your
  // project's URL and Key are required...". Same non-fatal-by-design intent
  // as the rest of this block -- widened to cover client construction, not
  // just the claims check, so ANY failure here (reported, thrown during the
  // claims check, or thrown constructing the client at all) degrades to
  // "logged out for this one request" instead of taking the whole request
  // down.
  let supabase: ReturnType<typeof createServerClient> | null = null;
  let userId: string | null = null;
  try {
    supabase = createServerClient(
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
    userId = (data?.claims?.sub as string | undefined) ?? null;
  } catch (err) {
    console.error("[middleware] auth check threw:", err instanceof Error ? err.message : err);
  }

  const pathname = request.nextUrl.pathname;

  // R48_API_WRITES_WITHOUT_ROLE_CHECK_01: the single server-side choke point
  // for role-gated writes. 146 of 159 mutating /api routes had no role check at
  // all, so any authenticated member of the tenant -- including the read-only
  // client_viewer -- could run payroll, create employees, raise purchase orders
  // or rewrite the BOQ. See src/lib/authz/api-write-policy.ts for the tier
  // table and api-write-policy.test.ts for the drift guard that keeps it
  // honest against the filesystem.
  //
  // WHY HERE RATHER THAN 146 requireRole() CALLS: this middleware already runs
  // ahead of every /api route (its matcher covers them), and a per-file guard
  // is precisely the hand-maintained mechanism that drifted on the page side
  // below. One table + one enforcement point + one test that regenerates the
  // route set from disk.
  //
  // COST IS BOUNDED TO WRITES: the membership lookup below only runs for
  // POST/PUT/PATCH/DELETE on /api/*, never for a GET or a page navigation, so
  // the read path this middleware handles is unchanged.
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method) && userId && supabase) {
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      // Same honest failure shape requireAuth() already uses for this case: a
      // transient membership-lookup failure is NOT a "no organization" and is
      // NOT a role refusal. Fail closed on the write, but say why.
      console.error("[middleware] memberships lookup failed on a write -- refusing rather than guessing:", membershipError.message);
      return NextResponse.json({ error: "Could not verify organization membership, please retry" }, { status: 503 });
    }

    const role = (membership as { role?: string } | null)?.role ?? null;
    const decision = checkApiWriteAccess(request.method, pathname, role);
    if (!decision.allowed) {
      // Byte-identical to requireRole()'s own body so the 13 routes that
      // already gate themselves and the 146 gated here are indistinguishable
      // to a client.
      return NextResponse.json({ error: "Forbidden: your role does not permit this action" }, { status: 403 });
    }
  }

  // R48_PAGE_AUTH_GATE_COVERS_HALF_THE_NAV_01: this used to be
  // PROTECTED_PREFIXES, a hand-written array of 24 strings matched by
  // startsWith, which had drifted so far that 23 of the 46 nav destinations
  // were ungated -- including "/copilot", which the list thought it was
  // protecting under the stale name "/ai-copilot", and "/manpower", an entry
  // matching no page route at all. Inverted to deny-by-default in
  // src/lib/authz/page-access.ts (which keeps the mandatory !/api/ clause --
  // without it every API 401 JSON turns into a 307 redirect to an HTML login
  // page) and pinned to the filesystem by page-access.test.ts.
  const isProtected = requiresAuthenticatedPage(pathname);

  if (!userId && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return withLocaleCookie(NextResponse.redirect(url), request, locale);
  }

  // R67 J-01 (audit R-246): the "already logged in -> go to the app, not the
  // marketing page" redirect moved here out of src/app/page.tsx. It is the
  // same rule, evaluated against the same `userId` this middleware already
  // computed above -- but doing it here instead of inside the page render is
  // what lets "/" be statically prerendered and cached (a page that reads
  // cookies is server-rendered on every request, which is the whole finding
  // R-246 reports). Deliberately NOT given /login's deferred-provisioning
  // exception below: the marketing page has no resume logic to reach, and
  // the previous in-page redirect had no such exception either, so this is
  // byte-for-byte the behaviour that shipped before.
  if (userId && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
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
      // supabase is guaranteed non-null here: userId only ever gets set
      // (above) after createServerClient succeeded in the same try block.
      const { data: membership } = await supabase!
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
