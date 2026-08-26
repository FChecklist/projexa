"use client";

// Wave 140 (PROJEXA gap analysis): Gantt/critical-path view. Uses SVAR
// React Gantt (@svar-ui/react-gantt, MIT license -- verified against the
// package's own LICENSE file, not just its package.json field) for the
// free/OSS timeline+dependency rendering. Critical-path/baseline/workload
// visualization are SVAR's own PRO-only features, so those are surfaced
// here as a grid column + a separate stats panel instead of relying on
// SVAR's built-in (paid) highlighting.
//
// R46 P8 seq130 (M28 registry-model proof, TIMELINE archetype -- function_id
// "schedule.timeline"): the real SVAR Gantt/dependency/critical-path/
// baseline-capture behaviour is genuinely bespoke -- no generic renderer in
// the kit reproduces it (the kit's own TimelineScreen is a plain bars+
// markers component with no dependency lines, no critical-path grid, no
// baseline capture; swapping it in would be a lossy rewrite, not a registry
// wiring) -- so this stays a fully hand-rolled component, same call as R46
// P8 seq121's boq.custom (CUSTOM archetype) for /scope. What IS
// registry-driven: the Gantt grid's column LABELS (Task/Start/Due/Critical
// Path) and the three summary-card labels (Tasks/On Critical Path/
// Milestones), resolved server-side in schedule/page.tsx and passed down as
// `registryColumns`. DEFAULT_COLUMNS is the fallback when the row is
// missing or the resolve call errors -- identical text, so there is no
// visible difference between "resolved from the DB" and this default.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import "@svar-ui/react-gantt/all.css";

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ScopeClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const DEFAULT_COLUMNS: RegistryColumn[] = [
  { field: "task", label: "Task", type: "text", importance: "High" },
  { field: "start", label: "Start", type: "date", importance: "High" },
  { field: "due", label: "Due", type: "date", importance: "High" },
  { field: "critical", label: "Critical Path", type: "text", importance: "High" },
  { field: "taskCount", label: "Tasks", type: "number", importance: "Medium" },
  { field: "criticalCount", label: "On Critical Path", type: "number", importance: "Medium" },
  { field: "milestoneCount", label: "Milestones", type: "number", importance: "Medium" },
];

function columnLabel(columns: RegistryColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

// R52 Gate 2 / F_018. The dash is the whole point: an unset date is a REAL
// FACT about the schedule ("nobody has committed a start yet") and a quantity
// surveyor reads it as one. Rendering anything else there -- today, the due
// date, a guess -- replaces a fact with a fabrication.
const NO_DATE = "—";
function displayDate(value: string | null): string {
  return value ? formatDate(value) : NO_DATE;
}

// Where a bar may honestly be drawn. A task with only a due date is a point on
// its due date, NOT a bar starting today; a task with only a start date runs
// from that start. A task with NEITHER has no position on a timeline at all and
// is listed separately rather than invented onto one.
function barRange(t: GanttTask): { start: Date; end: Date } | null {
  const startIso = t.startDate ?? t.dueDate;
  const endIso = t.dueDate ?? t.startDate;
  if (!startIso || !endIso) return null;
  return { start: new Date(startIso), end: new Date(endIso) };
}

const Gantt = dynamic(() => import("@svar-ui/react-gantt").then((m) => m.Gantt), { ssr: false });
const Willow = dynamic(() => import("@svar-ui/react-gantt").then((m) => m.Willow), { ssr: false });

type GanttTask = {
  id: string; title: string; startDate: string | null; dueDate: string | null;
  completionPercentage: number; milestoneId: string | null; parentIssueId: string | null;
  isCritical: boolean; floatDays: number | null;
};
type GanttDependency = { predecessorId: string; successorId: string; lagDays: number };
type Milestone = { id: string; name: string; targetDate: string | null };

export default function ScheduleGanttClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const labelColumns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  async function loadGantt() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/gantt?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load schedule");
      setTasks(data.tasks ?? []);
      setDependencies(data.dependencies ?? []);
      setMilestones(data.milestones ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGantt();
  }, [projectId]);

  async function captureBaseline() {
    const name = window.prompt("Name this baseline (e.g. \"Original Plan\"):", "Baseline " + new Date().toLocaleDateString());
    if (!name) return;
    setCapturing(true);
    try {
      const res = await fetch("/api/schedule/baselines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Baseline "${name}" captured`);
    } catch {
      toast.error("Couldn't capture baseline — try again");
    } finally {
      setCapturing(false);
    }
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load schedule: {error}</CardContent>
      </Card>
    );
  }

  const criticalCount = tasks.filter((t) => t.isCritical).length;

  // R52 Gate 2 / F_018 -- THE DEFECT, and it was exactly two lines:
  //
  //     start: t.startDate ? new Date(t.startDate) : new Date(),
  //     end:   t.dueDate   ? new Date(t.dueDate)   : new Date(),
  //     duration: t.startDate && t.dueDate ? undefined : 1,
  //
  // `new Date()` with no argument is NOW. Every task whose startDate was null
  // got TODAY, and because `duration: 1` was then passed alongside, SVAR
  // resolved the bar to today..tomorrow -- which is precisely what the fault
  // recorded seeing (Start 25-08-2026, Due 26-08-2026) for three tasks whose
  // real rows are start_date NULL and due_date 2026-10-15, verified again this
  // session by direct SQL against compliance.pms_issues for project
  // g555imnoq4wihavpwc7t64um. A viewer was being shown "due tomorrow" for work
  // genuinely due in seven weeks.
  //
  // Now: bars are placed from real dates only (barRange), and tasks that carry
  // no date at all are not placed on the timeline at all -- they are listed
  // under it by name, so nothing is silently dropped either.
  const scheduled = tasks.filter((t) => barRange(t) !== null);
  const unscheduled = tasks.filter((t) => barRange(t) === null);

  const ganttTasks = [
    ...scheduled.map((t) => {
      const range = barRange(t)!;
      const sameDay = range.start.getTime() === range.end.getTime();
      return {
        id: t.id,
        text: t.title,
        start: range.start,
        end: range.end,
        // A single-day marker needs a length to be drawable; a real range must
        // NOT be overridden by one, which is the other half of the old bug.
        duration: sameDay ? 1 : undefined,
        progress: t.completionPercentage,
        type: "task" as const,
      };
    }),
    ...milestones
      .filter((m) => m.targetDate)
      .map((m) => ({
        id: `milestone_${m.id}`,
        text: m.name,
        start: new Date(m.targetDate!),
        end: new Date(m.targetDate!),
        duration: 0,
        type: "milestone" as const,
      })),
  ];
  const ganttLinks = dependencies.map((d, i) => ({
    id: i + 1,
    source: d.predecessorId,
    target: d.successorId,
    type: "e2s" as const,
    lag: d.lagDays,
  }));

  // The grid's Start/Due cells read the ORIGINAL row, not the bar geometry.
  // Without this, a task placed on its due date (because its start is unset)
  // would report that due date as its START -- swapping one fabrication for
  // another. `props.row?.id` is a milestone id for milestone rows, which find()
  // simply misses, so those keep SVAR's own rendering.
  const columns = [
    { id: "text", header: columnLabel(labelColumns, "task", "Task"), flexGrow: 2 },
    {
      id: "start", header: columnLabel(labelColumns, "start", "Start"), width: 100,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (props: any) => {
        const task = tasks.find((t) => t.id === String(props.row?.id));
        if (!task) return null;
        return <span className={task.startDate ? undefined : "text-px-muted"}>{displayDate(task.startDate)}</span>;
      },
    },
    {
      id: "end", header: columnLabel(labelColumns, "due", "Due"), width: 100,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (props: any) => {
        const task = tasks.find((t) => t.id === String(props.row?.id));
        if (!task) return null;
        return <span className={task.dueDate ? undefined : "text-px-muted"}>{displayDate(task.dueDate)}</span>;
      },
    },
    {
      id: "critical", header: columnLabel(labelColumns, "critical", "Critical Path"), width: 110,
      // SVAR's ICellProps["row"] (IRow) doesn't publicly expose an `id`
      // field in its shipped types despite carrying one at runtime (it's
      // the task row) -- any is the pragmatic escape hatch here.
      cell: (props: any) => {
        const task = tasks.find((t) => t.id === String(props.row?.id));
        if (!task || task.floatDays === null) return null;
        return task.isCritical
          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-px-error"><AlertTriangle className="size-3" /> Critical</span>
          : <span className="text-xs text-px-muted">{task.floatDays}d slack</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "taskCount", "Tasks")}</p><p className="text-2xl font-heading text-px-ink">{tasks.length}</p></CardContent></Card>
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "criticalCount", "On Critical Path")}</p><p className="text-2xl font-heading text-px-error">{criticalCount}</p></CardContent></Card>
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "milestoneCount", "Milestones")}</p><p className="text-2xl font-heading text-px-ink">{milestones.length}</p></CardContent></Card>
        <Button onClick={captureBaseline} disabled={capturing} variant="outline">
          {capturing ? "Capturing…" : "Capture Baseline"}
        </Button>
      </div>

      <Card className="shadow-card overflow-hidden">
        <CardHeader><CardTitle className="font-heading text-base">Timeline</CardTitle></CardHeader>
        <CardContent className="p-0" style={{ height: 480 }}>
          {tasks.length === 0 ? (
            <p className="py-16 text-center text-sm text-px-muted">No scheduled tasks yet.</p>
          ) : ganttTasks.length === 0 ? (
            <p className="py-16 text-center text-sm text-px-muted">
              None of these {tasks.length} tasks has a start or due date yet, so none can be placed on a timeline. They are listed below.
            </p>
          ) : (
            <Willow>
              <Gantt tasks={ganttTasks} links={ganttLinks} columns={columns} readonly />
            </Willow>
          )}
        </CardContent>
      </Card>

      {/* R52 Gate 2 / F_017. The fault: "GET /api/schedule/gantt returns all 3
          pms_issues rows ... the rendered Timeline table only shows the first 2
          -- 'Site safety induction for new crew' never appears in the DOM
          despite the Tasks stat tile correctly reading 3."

          The recorded diagnosis was "likely a key/filter bug dropping one row".
          Read against this file that does not hold: there is no filter and no
          key logic anywhere between `tasks` and the rendered rows -- the old
          code mapped tasks 1:1 -- and I re-checked the three rows by direct SQL
          (compliance.pms_issues, project g555imnoq4wihavpwc7t64um): they are
          IDENTICAL in every field the renderer reads (start_date NULL, due_date
          2026-10-15, completion 0, no parent, no milestone). Nothing
          data-dependent can drop exactly one of three identical rows.

          What CAN is the row virtualisation inside SVAR's own canvas grid --
          which is third-party, was being fed a degenerate one-day date range by
          the F_018 bug above, and which this codebase cannot assert against.
          So rather than guess at SVAR's internals, the task rows now also exist
          as ordinary DOM in a table this component fully owns. Its row count is
          `tasks.length` by construction, so "the timeline renders 100% of what
          its API returns" stops depending on a dependency's viewport maths. It
          is also the only surface that can honour F_018's own stated oracle --
          an unset start must render as an empty-state dash, which a Gantt bar
          cannot express at all. */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="font-heading text-base">
            All tasks ({tasks.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{columnLabel(labelColumns, "task", "Task")}</TableHead>
                <TableHead>{columnLabel(labelColumns, "start", "Start")}</TableHead>
                <TableHead>{columnLabel(labelColumns, "due", "Due")}</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>{columnLabel(labelColumns, "critical", "Critical Path")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell className={t.startDate ? undefined : "text-px-muted"}>{displayDate(t.startDate)}</TableCell>
                  <TableCell className={t.dueDate ? undefined : "text-px-muted"}>{displayDate(t.dueDate)}</TableCell>
                  <TableCell>{t.completionPercentage}%</TableCell>
                  <TableCell>
                    {t.floatDays === null ? (
                      <span className="text-px-muted">{NO_DATE}</span>
                    ) : t.isCritical ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-px-error"><AlertTriangle className="size-3" /> Critical</span>
                    ) : (
                      <span className="text-xs text-px-muted">{t.floatDays}d slack</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {unscheduled.length > 0 && (
            <p className="border-t px-4 py-3 text-xs text-px-muted">
              {unscheduled.length} of these {tasks.length} task{tasks.length === 1 ? "" : "s"} {unscheduled.length === 1 ? "has" : "have"} no start or due date and so {unscheduled.length === 1 ? "does" : "do"} not appear on the timeline above. {unscheduled.length === 1 ? "It is" : "They are"} listed here, not hidden.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
