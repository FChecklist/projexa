"use client";

// R67 E-29 (R-255): "Beneath it a grouped horizontal bar 'Revenue / Budget /
// Earned value per project' ... each bar a door to its project, hiding a
// series with a stated reason when its source is unset."
//
// The chart itself is HierarchyProjectBars, already built for the company
// dashboard (E-23) against the same three series and the same one shared axis.
// Building a second one here would be two charts of one thing that could drift
// apart; this is the same component, on the home screen's data.
//
// This wrapper exists for exactly one reason: DashboardHomeView is a Server
// Component, and HierarchyProjectBars needs the org's currency, which arrives
// through the useOrgMoney() hook. A hook cannot run on the server, and an
// OrgMoney carries bound FUNCTIONS, which cannot cross the server/client
// boundary as props. So the server passes plain project rows, and the currency
// is resolved here.

import { HierarchyProjectBars } from "@/components/HierarchyProjectBars";
import { useOrgMoney } from "@/lib/use-org-money";
import type { ProjectBarSource } from "@/lib/project-bar-rows";

export function DashboardPortfolioBars({ projects }: { projects: ProjectBarSource[] }) {
  const orgMoney = useOrgMoney();
  return (
    <HierarchyProjectBars
      projects={projects}
      orgMoney={orgMoney}
      loading={false}
      // The home screen's own error card above already carries a failed load;
      // repeating it inside the chart would say the same thing twice.
      error={null}
      onRetry={() => {}}
      dateRangeApplied={false}
    />
  );
}
