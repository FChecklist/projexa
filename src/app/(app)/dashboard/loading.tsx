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
    <div className="flex-1 space-y-6 p-6" data-testid="dashboard-loading">
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
