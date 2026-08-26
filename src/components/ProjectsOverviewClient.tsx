"use client";

import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import type { ProgressBar } from "@/lib/dashboard-overview";

// R46 P8 seq124 (M28 registry-model proof, function_id "dashboard.overview"
// -- see dashboard/overview/page.tsx's resolver comment for why this isn't
// "dashboard.dashboard", which seq125/PR #142 already claimed for the
// separate /dashboard/project screen): this screen has no real table columns
// to speak of (a title + one horizontal progress bar per project, not a
// table) -- so unlike the LIST conversions and boq.custom's CUSTOM
// conversion before it, what's registry-driven here is the two static UI
// text strings on the page (the heading and the empty-state message), keyed
// by `field` the same way boq.custom's columnLabel() reads its real column
// headers off a screen_definitions row. DEFAULT_LABELS mirrors the seeded
// row 1:1, so there is no visible difference between "resolved from the DB"
// and this fallback (M28: keep the hardcoded version behind a flag until
// verified). Nothing about data fetching, bar computation, or layout
// changed from before this seq -- see src/lib/dashboard-overview.ts.
export type RegistryColumn = ScreenColumn;

const DEFAULT_LABELS: ScreenColumn[] = [
  { field: "title", label: "Projects Overview", type: "text" },
  { field: "emptyState", label: "No active projects yet.", type: "text" },
];

function label(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

export default function ProjectsOverviewClient({
  bars,
  errorMessage,
  labels,
}: {
  bars: ProgressBar[];
  errorMessage: string | null;
  labels?: RegistryColumn[] | null;
}) {
  const columns = labels && labels.length > 0 ? labels : DEFAULT_LABELS;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title={label(columns, "title", "Projects Overview")} />
      {errorMessage && <p className="text-sm text-px-error">Could not load live data: {errorMessage}</p>}
      <Card className="shadow-card">
        <CardContent className="space-y-5 pt-6">
          {bars.length === 0 ? (
            <p className="py-8 text-center text-sm text-px-muted">{label(columns, "emptyState", "No active projects yet.")}</p>
          ) : (
            bars.map((p) => (
              <div key={p.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-px-muted">{p.progressPercent}%</span>
                </div>
                <Progress value={p.progressPercent} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
