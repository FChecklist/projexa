import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { HowItWorksHero } from "@/components/marketing/how-it-works/HowItWorksHero";
import { ArchitectureDiagram } from "@/components/marketing/how-it-works/ArchitectureDiagram";
import { ChangeOrderTrace } from "@/components/marketing/how-it-works/ChangeOrderTrace";
import { FactsRow } from "@/components/marketing/how-it-works/FactsRow";
import { FinalCTA } from "@/components/marketing/FinalCTA";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "How PROJEXA Works — One Core, Every Module Connected | PROJEXA",
  description:
    "See exactly how PROJEXA's modules coordinate on a real example -- one change order moving through five modules, with nobody re-typing anything, on top of VERIDIAN AI OS.",
};

// R67 J-01 (audit R-246): this page reads nothing from the request itself,
// but the shared root layout does (next-intl's getLocale()/getMessages() ->
// the NEXT_LOCALE cookie), which was enough to make the whole route
// server-rendered on every request. `force-static` makes that cookie read
// return an empty store rather than bail to dynamic rendering, so the route
// is prerendered once and revalidated hourly. See src/app/page.tsx's own
// comment for the locale consequence -- a cached document cannot vary by
// cookie, so the public pages are served in the default locale.
export const dynamic = "force-static";
export const revalidate = 3600;

// New public marketing route -- unauthenticated, not gated by
// middleware.ts's PROTECTED_PREFIXES (it doesn't list /how-it-works), and
// deliberately not redirect-gated by auth state the way the root "/" route
// is: it's a real, always-visible page, not a state-dependent landing.
// Shares MarketingHeader/MarketingFooter with "/" so the two pages read as
// one integrated site rather than a separate microsite.
export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <HowItWorksHero />
      <ArchitectureDiagram />
      <ChangeOrderTrace />
      <FactsRow />
      <FinalCTA sourcePage="how-it-works" />
      <div className="bg-px-ink pb-16 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-px-cloud2 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projexa-ai.com
        </Link>
      </div>
      <MarketingFooter />
    </div>
  );
}
