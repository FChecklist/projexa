import { LandingPage } from "@/components/marketing/LandingPage";

// The root route used to unconditionally redirect() to /dashboard regardless
// of auth state, so a logged-out visitor bounced straight to /login (via
// middleware's protected-route check) without ever seeing what PROJEXA is.
// This is PROJEXA's first marketing page: logged-out visitors see it,
// logged-in visitors are sent straight to /dashboard (mirroring the same
// pattern middleware.ts already uses for /login and /signup) rather than
// being forced through marketing copy on every visit.
//
// R67 J-01 (audit R-246): that logged-in redirect now lives in middleware.ts
// instead of here. It was the ONLY reason this page read request state
// (createClient() -> cookies(), then getClaims()), and one cookie read is
// enough to make the whole route server-rendered on every single request --
// which is exactly what the audit measured: "/" warm TTFB 1375 ms / FCP
// 1672 ms against /how-it-works 232 ms and /login 120 ms, i.e. the warm
// paint was SLOWER than the cold one because nothing was ever cached.
// middleware.ts already computes the same `userId` from the same claims on
// every request that reaches this route, so moving the redirect there costs
// nothing extra at runtime and leaves this page with zero request-time
// reads.
//
// `force-static` is deliberate and not just belt-and-braces alongside
// `revalidate`: the shared root layout still calls next-intl's getLocale()/
// getMessages(), which read the NEXT_LOCALE cookie (src/i18n/request.ts).
// Under `force-static` Next returns an empty cookie store instead of
// bailing out to dynamic rendering, so the locale resolves to
// DEFAULT_LOCALE. That is the honest consequence of caching one HTML
// document for everyone: a cached page cannot vary by cookie. The public
// marketing pages are therefore served in the default locale; every
// authenticated route is untouched and still follows the cookie.
export const dynamic = "force-static";
export const revalidate = 3600;

export default function RootPage() {
  return <LandingPage />;
}
