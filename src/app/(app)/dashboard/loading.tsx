// R67 F-18 (decision D-04). /dashboard is the landing screen and the one the
// module pages fall back to when neither the URL nor the projexa_project
// cookie names a project, so it is the screen most often waited on. It paints
// its own shape immediately -- greeting line, the four KPI tiles, the projects
// table -- instead of leaving the previous route on screen while two VERIDIAN
// calls resolve.
//
// No tile LABELS are drawn here on purpose: they come from the
// dashboard.dashboard registry row (or DashboardHomeView's own fallbacks), and
// guessing them would put words on screen that the real render then replaces.
// A tile-shaped placeholder is honest; a wrong label is not.
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-8 pb-4" data-state="loading" aria-busy="true">
      <div className="space-y-6 p-6">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="shadow-card">
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" data-testid="module-list-skeleton-row" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
