// R48_PAGE_AUTH_GATE_COVERS_HALF_THE_NAV_01 -- page-route authentication,
// inverted from allow-list to deny-by-default.
//
// WHAT WAS WRONG: middleware.ts gated pages against PROTECTED_PREFIXES, a
// hand-written array of 24 strings matched by startsWith. At the time this
// was measured, 53 page routes lived under src/app/(app)/ and 26 of them
// matched nothing (roughly half the navigable product sat outside the
// gate) -- these counts drift as pages are added, so re-run
// `find src/app/\(app\) -name page.tsx | wc -l` (or page-access.test.ts,
// which recomputes filesystem parity on every run and is the live source
// of truth) rather than trusting this comment's numbers going forward.
// [R66 code-quality fix, 2026-09-01: re-measured at 157 page.tsx files as
// of this note -- confirms the drift this comment now warns about.]
// Two entries prove it was genuine
// drift rather than a counting artefact: the array carried "/ai-copilot" while
// both the route and the nav item ship "/copilot" (so the one module the list
// explicitly meant to protect was open), and "/manpower" matched no page route
// at all.
//
// WHY INVERSION RATHER THAN 26 MORE STRINGS: an allow-list of protected paths
// fails open -- forgetting an entry silently ships an ungated page. A deny-list
// of PUBLIC paths fails closed: forgetting an entry ships a page that redirects
// to /login, which is visible in one click instead of invisible forever.
// page-access.test.ts additionally regenerates both sets from the real
// src/app/**/page.tsx files, so the two lists below cannot drift from the
// filesystem without failing the build.
//
// THE CLAUSE THAT MUST NOT BE DROPPED: /api/* is excluded here. Without that,
// every API route's 401 JSON response becomes a 307 redirect to an HTML login
// page, breaking all 216 of them. API authentication is separate and sound
// (209 route.ts files call requireAuth(), 4 more use requireCompanyScope(),
// 3 are public by design) and is not this function's business.
//
// SCOPE, stated so an earlier reverted framing is not reintroduced: this is a
// GATE, not a data boundary. getServerOrganizationId() returns null rather than
// throwing for an unauthenticated visitor, so an ungated page rendered empty
// chrome rather than another tenant's data. This closes the gate; it is not a
// leak fix.

// Exact public page paths (everything NOT under src/app/(app)/).
const PUBLIC_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/", // marketing landing
  "/hi", // the same landing page, prerendered in Hindi (R67 J-01)
  "/how-it-works",
  "/hi/how-it-works",
  "/login",
  "/signup",
]);

// Public page families whose remaining segments are opaque tokens.
//   /auth/*    the Supabase OAuth/magic-link callback -- must be reachable
//              while unauthenticated, that is the entire point of it
//   /invite/*  token-scoped invite redemption, by definition pre-membership
//   /share/*   unauthenticated public share links (see VERIDIAN_ORIGIN's
//              comment in veridian-client.ts -- these carry no auth of any
//              kind, Bearer or session, on purpose)
//   /shared/*  the same thing under the path VERIDIAN's own share-link
//              composer already emits (R67 D-21's /shared/mom/[token] --
//              note "/shared/" does NOT match the "/share/" prefix above, so
//              it needs its own entry or the page fails closed and redirects
//              the recipient of a WhatsApp link to a login screen)
const PUBLIC_PAGE_PREFIXES: readonly string[] = ["/auth/", "/invite/", "/share/", "/shared/"];

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

// Anything whose final segment carries an extension is a file, not a page:
// /sw.js, /manifest.webmanifest, /robots.txt, /icon-192.png. Treating these as
// pages would redirect service-worker registration and PWA manifest fetches to
// an HTML login page. Deliberately a shape rule rather than a second
// hand-maintained list, since public/ gains files without anyone editing this.
export function isAssetPath(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return lastSegment.includes(".");
}

export function isPublicPagePath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) return true;
  return PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The single predicate middleware.ts asks. True means "an unauthenticated
 * visitor must be redirected to /login".
 */
export function requiresAuthenticatedPage(pathname: string): boolean {
  if (isApiPath(pathname)) return false;
  if (isAssetPath(pathname)) return false;
  if (isPublicPagePath(pathname)) return false;
  return true;
}

// Exported for page-access.test.ts, which asserts these against the filesystem.
export const PUBLIC_PAGE_PATHS_FOR_TEST = PUBLIC_PAGE_PATHS;
export const PUBLIC_PAGE_PREFIXES_FOR_TEST = PUBLIC_PAGE_PREFIXES;
