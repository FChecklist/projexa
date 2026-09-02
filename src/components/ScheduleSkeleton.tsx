import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// R67 F-09 (R-122). The <Suspense> fallback for /schedule's tab area.
//
// It is deliberately the SHAPE of the real screen, not a spinner: the four tab
// labels, the three stat tiles and the All-tasks table with its real headers.
// A spinner tells the reader nothing and the layout jumps when the timeline
// lands; this way the page is recognisable in the first flush and nothing
// moves afterwards.
//
// A server component (no "use client"): it never needs state, and keeping it
// server-side means it costs nothing in the client bundle.
const TASK_HEADERS = ["Task", "Start", "Due", "Progress", "Critical Path"];
const TAB_LABELS = ["Timeline", "Board", "Sprints", "Timesheet"];
const TILE_LABELS = ["Tasks", "On Critical Path", "Milestones"];

export function ScheduleSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-48" />
      <div className="inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-[3px]">
        {TAB_LABELS.map((label) => (
          <span key={label} className="rounded-md px-2 py-1 text-sm font-medium text-px-muted">{label}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {TILE_LABELS.map((label) => (
          <Card key={label} className="min-w-[140px] flex-1">
            <CardContent className="p-4">
              <p className="text-xs text-px-muted">{label}</p>
              <Skeleton className="mt-2 h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="shadow-card">
        <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {TASK_HEADERS.map((header) => <TableHead key={header}>{header}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }, (_, rowIndex) => (
                <TableRow key={rowIndex} data-testid="schedule-loading-row">
                  {TASK_HEADERS.map((header) => (
                    <TableCell key={header}><Skeleton className="h-4 w-full max-w-[10rem]" /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p role="status" className="border-t border-px-border px-4 py-2 text-[12.5px] text-px-muted">
            Loading the schedule…
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default ScheduleSkeleton;
