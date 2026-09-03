import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingPage } from "@/components/marketing/LandingPage";
import { MarketingLocaleProvider } from "@/components/marketing/MarketingLocaleProvider";

// R67 J-01 fix pass (audit R-246): the Hindi landing page.
//
// WHY A SECOND ROUTE RATHER THAN A COOKIE. Making "/" statically prerendered
// is what R-246 asks for, and one cached HTML document cannot vary by cookie
// -- under `force-static` Next hands the page an EMPTY cookie store, so
// next-intl resolves the default locale no matter what NEXT_LOCALE says. The
// first cut of J-01 accepted that and served English to everyone, which
// silently retired a COMPLETE shipped Hindi translation (messages/hi.json
// carries the whole Marketing tree) on the only two pages an unauthenticated
// prospect ever sees. Static rendering does permit the alternative: one
// prerendered document per locale. middleware.ts REWRITES (not redirects) a
// Hindi visitor's request for "/" here, so the canonical URL stays "/" for
// everyone, the rewrite target is what a CDN keys its cache on, and neither
// document reads anything at request time.
//
// Nothing here is a translation of copy -- every string on this page comes
// from messages/hi.json, including the metadata below.
export const dynamic = "force-static";
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: "hi", namespace: "Marketing.hero" });
  return {
    title: `${t("headingLine1")} ${t("headingLine2")} | PROJEXA`,
    description: t("subhead"),
  };
}

export default function HindiRootPage() {
  return (
    <MarketingLocaleProvider locale="hi">
      <LandingPage locale="hi" />
    </MarketingLocaleProvider>
  );
}
