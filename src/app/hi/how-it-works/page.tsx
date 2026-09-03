import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HowItWorksContent } from "@/components/marketing/how-it-works/HowItWorksContent";
import { MarketingLocaleProvider } from "@/components/marketing/MarketingLocaleProvider";

// R67 J-01 fix pass (audit R-246): the Hindi /how-it-works page. Same page as
// src/app/how-it-works/page.tsx, prerendered in Hindi; middleware.ts rewrites
// a Hindi visitor's request for /how-it-works here. See src/app/hi/page.tsx
// for why a second document rather than a cookie read.
export const dynamic = "force-static";
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: "hi", namespace: "Marketing.howItWorks.hero" });
  return {
    title: `${t("heading")} | PROJEXA`,
    description: t("subhead"),
  };
}

export default function HindiHowItWorksPage() {
  return (
    <MarketingLocaleProvider locale="hi">
      <HowItWorksContent locale="hi" />
    </MarketingLocaleProvider>
  );
}
