"use client";

// R67 MERGE (lane D0 x lane F2). Lane D0 (item D-46) replaced this tab's
// wordless spinner with a skeleton in the real shape plus a waiting caption
// that names the module at 2 s, counts from 3 s and offers a way out at 8 s.
// Lane F2 (item F-31, audit R-275) put a machine-readable
// data-state="loading|ready|empty|error" and aria-busy on the region, which is
// what the pass-2 latency script waits on to decide a screen is usable -- its
// `usable` column was empty for all thirteen measured pages without it. Under
// decision D-11 D0's markup is canonical, so it is kept exactly and F2's
// attribute is added around it by ListStateRegion.

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
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";
import { ListStateRegion } from "@/components/ListScreenFrame";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { displayScheduleDate, EMPTY_DATE_CELL, toGanttDateFields } from "@/lib/gantt-task-dates";
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
  const [error, setError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);

  async function loadGantt() {
    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    try {
      const res = await fetch(`/api/schedule/gantt?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError({ status: res.status, message: typeof data?.error === "string" ? data.error : null });
        return;
      }
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      setDependencies(Array.isArray(data?.dependencies) ? data.dependencies : []);
      setMilestones(Array.isArray(data?.milestones) ? data.milestones : []);
    } catch (err) {
      setError({ status: null, message: err instanceof Error ? err.message : null });
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

  // R67 D-46: the timeline's own shape -- three summary tiles and five row
  // bars -- rather than a spinner in the middle of an empty pane.
  if (loading) {
    return (
      <ListStateRegion state="loading" className="space-y-4">
        <PaneWaitingCaption startedAt={startedAt} entity="the schedule" onRetry={() => void loadGantt()} />
        <div className="flex flex-wrap items-center gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="min-w-[140px] flex-1">
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </ListStateRegion>
    );
  }
  if (error) {
    return (
      <ListStateRegion state="error">
        <PaneErrorCard entity="the schedule" error={error} onRetry={() => void loadGantt()} />
      </ListStateRegion>
    );
  }

  const criticalCount = tasks.filter((t) => t.isCritical).length;

  // F_018: these dates used to be fabricated -- a null startDate became
  // `new Date()` (today), and the `duration: 1` that came with it made SVAR
  // overwrite the real dueDate with start+1 day (tomorrow). See
  // src/lib/gantt-task-dates.ts for the mechanism and the oracle test.
  // Nothing here may invent a value the API did not send.
  const ganttTasks = [
    ...tasks.map((t) => ({
      id: t.id,
      text: t.title,
      ...toGanttDateFields(t.startDate, t.dueDate),
      progress: t.completionPercentage,
      type: "task" as const,
    })),
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

  // F_018 again, from the other side: the Start/Due CELLS read the original
  // API values, not SVAR's normalised copy of them. Whatever a chart library
  // does internally to position a bar, the text a user reads is the real
  // recorded date -- and an unset one is an em-dash, never a guess.
  const scheduleDateCell = (field: "startDate" | "dueDate") => (props: any) => {
    const task = tasks.find((t) => t.id === String(props.row?.id));
    if (!task) return null;
    const value = task[field];
    return value
      ? <span className="text-xs">{displayScheduleDate(value)}</span>
      : <span className="text-xs text-px-muted" title="Not scheduled">{EMPTY_DATE_CELL}</span>;
  };

  const columns = [
    { id: "text", header: columnLabel(labelColumns, "task", "Task"), flexGrow: 2 },
    { id: "start", header: columnLabel(labelColumns, "start", "Start"), width: 100, cell: scheduleDateCell("startDate") },
    { id: "end", header: columnLabel(labelColumns, "due", "Due"), width: 100, cell: scheduleDateCell("dueDate") },
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
    <ListStateRegion state={tasks.length > 0 ? "ready" : "empty"} className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "taskCount", "Tasks")}</p><p className="text-2xl font-heading text-px-ink">{tasks.length}</p></CardContent></Card>
        {/* R67 D-46: a tile that is permanently red says nothing. Zero tasks
            on the critical path is GOOD NEWS and reads in the ordinary ink
            tone; only a real count above zero takes the error token, and it
            takes a glyph and the word "critical" with it -- never colour
            alone, which is lost to greyscale, to colour-blindness and to a
            screenshot pasted into a report. */}
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4">
          <p className="text-xs text-px-muted">{columnLabel(labelColumns, "criticalCount", "On Critical Path")}</p>
          {criticalCount > 0 ? (
            <p className="flex items-center gap-1.5 text-2xl font-heading text-px-error">
              <AlertTriangle className="size-5" aria-hidden />
              {criticalCount}
              <span className="text-xs font-normal">critical</span>
            </p>
          ) : (
            <p className="text-2xl font-heading text-px-ink">{criticalCount}</p>
          )}
        </CardContent></Card>
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
          ) : (
            <Willow>
              <Gantt tasks={ganttTasks} links={ganttLinks} columns={columns} readonly />
            </Willow>
          )}
        </CardContent>
      </Card>

      {/* F_017. The fault: GET /api/schedule/gantt correctly returns all N
          pms_issues rows (confirmed: this project's Tasks stat tile above
          reads tasks.length, same array), but SVAR's own grid pane above
          silently mounts fewer <div role="row"> elements than tasks.length --
          verified directly, outside this app, by feeding @svar-ui/react-gantt
          2.7.1 the exact task shapes this component produces (both the
          unscheduled/identical-date shape from the fault's own 3 rows, and a
          control set of 3-5 tasks with distinct real start/due dates): in
          every case .wx-data mounted only 2 <div class="wx-row"> regardless
          of task count, while the chart pane's own .wx-bar elements on the
          right DID render one bar per task, including the one missing from
          the grid. So the task exists in SVAR's data store (the bar proves
          it) but the grid pane's row virtualisation does not reliably mount
          one DOM row per task -- a defect in this specific third-party
          package version, not in the array this component hands it (there is
          no filter or slice between `tasks` and `ganttTasks` above), and not
          fixable from this codebase.

          The fix: the task list also renders as an ordinary table this
          component fully owns, whose row count is tasks.map(...).length by
          construction -- so "every task the API returned is present in the
          DOM" no longer depends on a dependency's internal virtualisation. */}
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
                  <TableCell className={t.startDate ? undefined : "text-px-muted"}>
                    {t.startDate ? displayScheduleDate(t.startDate) : EMPTY_DATE_CELL}
                  </TableCell>
                  <TableCell className={t.dueDate ? undefined : "text-px-muted"}>
                    {t.dueDate ? displayScheduleDate(t.dueDate) : EMPTY_DATE_CELL}
                  </TableCell>
                  <TableCell>{t.completionPercentage}%</TableCell>
                  <TableCell>
                    {t.floatDays === null ? (
                      <span className="text-px-muted">{EMPTY_DATE_CELL}</span>
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
        </CardContent>
      </Card>
    </ListStateRegion>
  );
}
