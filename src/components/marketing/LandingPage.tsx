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

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <Hero />
      <ProblemSection />
      <SolutionSection />
      <ModuleCatalogSection />
      <CopilotSpotlight />
      <ValueSection />
      <ROISection />
      <SelfCoordinationSection />
      <FinalCTA sourcePage="home" />
      <MarketingFooter />
    </div>
  );
}
