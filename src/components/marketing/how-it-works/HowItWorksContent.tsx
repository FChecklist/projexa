import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "../marketing-locale";
import { MarketingHeader } from "../MarketingHeader";
import { HowItWorksHero } from "./HowItWorksHero";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { ChangeOrderTrace } from "./ChangeOrderTrace";
import { FactsRow } from "./FactsRow";
import { FinalCTA } from "../FinalCTA";
import { MarketingFooter } from "../MarketingFooter";

// R67 J-01 fix pass (audit R-246): the body of the /how-it-works page, lifted
// out of src/app/how-it-works/page.tsx so the English document and the Hindi
// one (src/app/hi/how-it-works/page.tsx) are the same page rendered twice
// rather than two copies of the same JSX that can drift.
//
// Shares MarketingHeader/MarketingFooter with the landing page so the two
// pages read as one integrated site rather than a separate microsite.
export async function HowItWorksContent({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.howItWorks" });

  return (
    <div lang={locale} className="min-h-screen bg-background">
      <MarketingHeader />
      <HowItWorksHero locale={locale} />
      <ArchitectureDiagram locale={locale} />
      <ChangeOrderTrace locale={locale} />
      <FactsRow locale={locale} />
      <FinalCTA locale={locale} sourcePage="how-it-works" />
      <div className="bg-px-ink pb-16 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-px-cloud2 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToHome")}
        </Link>
      </div>
      <MarketingFooter locale={locale} />
    </div>
  );
}
