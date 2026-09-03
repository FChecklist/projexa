// R67 E-19 (R-180) + F-18 (decision D-04).
//
// F-18's rule is the one both items agree on -- /dashboard is the landing
// screen and the most-waited-on route, so it paints its own SHAPE immediately
// rather than leaving the previous route on screen. What that shape is comes
// from E-19/E-01's page order (one number, chart, rows, then the tiles as
// secondary), which is what this screen actually renders.
//
// No tile LABELS are drawn on purpose: they come from the dashboard registry
// row, and guessing them would put words on screen that the real render then
// replaces. A tile-shaped placeholder is honest; a wrong label is not.
//
// R67 E-19 (R-180): "Loading renders skeleton rows, never a spinner."
//
// /dashboard is an async server component that makes three VERIDIAN calls
// before it can render anything, so between navigation and first paint there is
// a real wait. Next streams this file in that gap. A spinner in that gap says
// only "wait"; row-shaped skeletons say WHAT is coming and roughly how much of
// it, so the page does not visibly jump when the data lands and a reader can
// already aim at where their project will be.
//
// The skeleton row is the SAME component the list renders, so the two shapes
// cannot drift apart -- a skeleton that stops matching the thing it stands in
// for is worse than none, because it moves everything on arrival.
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectRowSkeleton } from "@/components/dashboard/ProjectRow";

export default function DashboardLoading() {
  return (
    <div
      className="flex-1 space-y-6 p-6"
      data-testid="dashboard-loading"
      // R67 F-18: announced as busy, so a screen reader is told the page is
      // still arriving rather than being read an empty frame.
      data-state="loading"
      aria-busy="true"
    >
      {/* The one number, then the chart, then the rows, then the tiles -- the
          order the real screen renders them in. */}
      <Card className="shadow-card">
        <CardContent className="space-y-2 p-5">
          <span className="block h-3 w-56 rounded bg-px-cloud" />
          <span className="block h-9 w-96 max-w-full rounded bg-px-cloud" />
          <span className="block h-3 w-72 max-w-full rounded bg-px-cloud" />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <span className="block h-4 w-40 rounded bg-px-cloud" />
        </CardHeader>
        <CardContent>
          <ProjectRowSkeleton />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-l-4 shadow-card">
            <CardContent className="flex items-center gap-4 p-4">
              <span className="size-11 shrink-0 rounded-lg bg-px-cloud" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-24 rounded bg-px-cloud" />
                <span className="block h-6 w-32 rounded bg-px-cloud" />
                <span className="block h-3 w-40 max-w-full rounded bg-px-cloud" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
