import { MarketingHeader } from "./MarketingHeader";
import { Hero } from "./Hero";
import { ProblemSection } from "./ProblemSection";
import { SolutionSection } from "./SolutionSection";
import { CopilotSpotlight } from "./CopilotSpotlight";
import { ROISection } from "./ROISection";
import { FinalCTA } from "./FinalCTA";
import { MarketingFooter } from "./MarketingFooter";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <Hero />
      <ProblemSection />
      <SolutionSection />
      <CopilotSpotlight />
      <ROISection />
      <FinalCTA />
      <MarketingFooter />
    </div>
  );
}
