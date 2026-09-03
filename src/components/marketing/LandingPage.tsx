import { MarketingHeader } from "./MarketingHeader";
import { Hero } from "./Hero";
import { ProblemSection } from "./ProblemSection";
import { SolutionSection } from "./SolutionSection";
import { ModuleCatalogSection } from "./ModuleCatalogSection";
import { CopilotSpotlight } from "./CopilotSpotlight";
import { ValueSection } from "./ValueSection";
import { ROISection } from "./ROISection";
import { SelfCoordinationSection } from "./SelfCoordinationSection";
import { FinalCTA } from "./FinalCTA";
import { MarketingFooter } from "./MarketingFooter";
import type { MarketingLocaleProps } from "./marketing-locale";

// R67 J-01 fix pass (audit R-246): rendered by BOTH src/app/page.tsx (locale
// "en") and src/app/hi/page.tsx (locale "hi"), which are two separately
// prerendered documents of the same page. The locale is threaded explicitly
// rather than resolved from the request -- see ./marketing-locale for why
// ambient resolution cannot work under static rendering.
//
// `lang` on the wrapper, not just on <html>: the root layout renders one
// <html lang> for every prerendered route and it cannot vary per route (a
// layout renders before the page it wraps, so nothing the page does can
// reach it). A subtree `lang` is the standards-correct way to say "this
// content is in Hindi" and is what assistive tech and search engines read
// for the section they are in.
export function LandingPage({ locale }: MarketingLocaleProps) {
  return (
    <div lang={locale} className="min-h-screen bg-background">
      <MarketingHeader />
      <Hero locale={locale} />
      <ProblemSection locale={locale} />
      <SolutionSection locale={locale} />
      <ModuleCatalogSection locale={locale} />
      <CopilotSpotlight locale={locale} />
      <ValueSection locale={locale} />
      <ROISection locale={locale} />
      <SelfCoordinationSection locale={locale} />
      <FinalCTA locale={locale} sourcePage="home" />
      <MarketingFooter locale={locale} />
    </div>
  );
}
