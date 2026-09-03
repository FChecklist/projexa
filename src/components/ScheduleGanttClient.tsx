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
//
// ─── R67 D-44 (audit R-126) ─────────────────────────────────────────────────
// The Gantt Card sat ABOVE the "All tasks" table, so the first thing on the
// module's main tab was a third-party chart whose grid pane demonstrably drops
// rows (F_017 below), and the authoritative list was pushed under it. The table
// is now first. It also gained the three columns a programme manager actually
// reads across -- Duration, % Complete and Slip -- and every row is a real
// keyboard-reachable link to that activity's Object Page, which is what "the
// list opens objects" means; a row that only responds to a mouse is not a list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { FieldMessage, ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { displayScheduleDate, EMPTY_DATE_CELL, toGanttDateFields } from "@/lib/gantt-task-dates";
import { formatDateNumeric, formatDayMonthYear } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import {
  EMPTY_SCHEDULE_CELL,
  NO_BASELINE_NOTE,
  barGeometry,
  durationDays,
  formatDurationDays,
  formatScheduleProgress,
  formatSlip,
  formatSlippageTile,
  isMilestoneWindow,
  plannedPercentComplete,
  scheduleWindow,
  slipDays,
  summariseScheduleProgress,
  summariseTaskSlippage,
  taskSlippage,
  type BaselineWindow,
  type TaskSlippage,
} from "@/lib/schedule-progress";
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
  // R67 D-56: which BOQ line owns this activity's progress, if any. Set by
  // getGanttData()'s attachBoqLinks(). An activity that HAS one takes its
  // completion from the Work Progress report, so the Timeline shows it
  // read-only and says so; an unlinked one is editable in place.
  boqLineItemId?: string | null;
};
type GanttDependency = { predecessorId: string; successorId: string; lagDays: number };
type Milestone = { id: string; name: string; targetDate: string | null };

// R67 D-45. pms_schedule_baselines + pms_baseline_issue_snapshots have been
// written since Wave 140 and BOTH GET routes have shipped with zero UI callers,
// so no screen has ever compared a planned date to an actual one. This
// component consumes them; it does not rebuild them.
type Baseline = { id: string; name: string; createdAt: string; capturedById: string | null };
type BaselineVariance = {
  issueId: string;
  baselineStartDate: string | null;
  baselineDueDate: string | null;
};

/** Capturing a baseline is a programme decision, and the route already enforces it (ROLE_GROUPS.PM_OR_ABOVE). */
const PM_OR_ABOVE: readonly string[] = ["owner", "admin", "pm"];
export const NEEDS_PM_ROLE = "Needs PM role";
export const BASELINE_NAME_REQUIRED = "Name is required";

/**
 * The baseline form's primary label, in this product's own
 * "Label (reason it cannot be used)" form. Exported so the rule can be
 * exercised directly: this environment does not deliver input/change events to
 * React, so a component test cannot empty the field to reach the second case.
 */
export function baselineSaveLabel(name: string, capturing: boolean): string {
  if (capturing) return "Capturing…";
  return name.trim() ? "Save" : `Save (${BASELINE_NAME_REQUIRED})`;
}

export default function ScheduleGanttClient({
  projectId,
  registryColumns,
  titleFilter = "",
  onMessage,
  today,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  /** R67 D-44: the header's Filter bar, applied to the authoritative table. */
  titleFilter?: string;
  /**
   * R67 D-45: the persistent footer message area lives on the ScreenFrame that
   * wraps the tabs, so a failure here is handed up rather than shown in a toast
   * that has gone by the time the user looks up. Passing null clears it.
   */
  onMessage?: (message: FieldMessage | null) => void;
  /** Injectable for tests only; production always uses the real current date. */
  today?: string;
}) {
  const router = useRouter();
  const labelColumns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [variances, setVariances] = useState<BaselineVariance[]>([]);
  const [snapshotCounts, setSnapshotCounts] = useState<Record<string, number | "error">>({});
  const [baselinesOpen, setBaselinesOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  // R67 D-56: the inline "% complete" editor. One row at a time, one field, and
  // only on activities no BOQ line owns.
  const [editingPercentId, setEditingPercentId] = useState<string | null>(null);
  const [percentDraft, setPercentDraft] = useState("");
  const [savingPercentId, setSavingPercentId] = useState<string | null>(null);
  // "unknown" is NOT the same as "not a PM": if the role lookup itself failed we
  // must not pre-refuse the action on a guess. The route enforces
  // ROLE_GROUPS.PM_OR_ABOVE either way, and its refusal now reaches the footer
  // verbatim -- so the worst case is one wasted click with a truthful reason,
  // rather than a PM being told they lack a role they have.
  const [roleState, setRoleState] = useState<{ kind: "loading" } | { kind: "known"; role: string | null } | { kind: "unknown" }>({
    kind: "loading",
  });

  // Resolved once on mount, not read during render: `new Date()` in a render
  // body is the same hydration hazard src/lib/format-date.ts documents.
  const [resolvedToday, setResolvedToday] = useState<string | null>(today ?? null);
  useEffect(() => {
    if (!today) setResolvedToday(new Date().toISOString().slice(0, 10));
  }, [today]);

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

  // The footer callback is held in a ref, and NOTHING depends on its identity.
  // A parent that passes an inline arrow (the natural way to write
  // `onMessage={(m) => push(m, "baseline")}`) hands a NEW function on every
  // render; if the loaders below depended on it, every message would change the
  // callback, which would re-run the loader effect, which would fetch again and
  // set another message -- an unbounded fetch loop. Measured, not theorised:
  // the first version of this component did exactly that.
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });
  const emitMessage = useCallback((message: FieldMessage | null) => {
    onMessageRef.current?.(message);
  }, []);

  /** The most recent baseline's snapshots, which is what slip is measured against. */
  const loadBaselineDetail = useCallback(async (baselineId: string) => {
    try {
      const detail = await fetchJson<{ variances?: BaselineVariance[] }>(
        `/api/schedule/baselines/${encodeURIComponent(baselineId)}`
      );
      const rows = detail.variances ?? [];
      setVariances(rows);
      setSnapshotCounts((counts) => ({ ...counts, [baselineId]: rows.length }));
    } catch (err) {
      setVariances([]);
      setSnapshotCounts((counts) => ({ ...counts, [baselineId]: "error" }));
      emitMessage({ level: "warning", text: errorMessage(err, "Couldn't load the baseline this schedule is measured against") });
    }
  }, [emitMessage]);

  const loadBaselines = useCallback(async () => {
    try {
      const data = await fetchJson<{ baselines?: Baseline[] }>(
        `/api/schedule/baselines?projectId=${encodeURIComponent(projectId)}`
      );
      // listBaselines() has no ORDER BY of its own, so "most recent" is decided
      // here rather than assumed from the array order.
      const rows = [...(data.baselines ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setBaselines(rows);
      if (rows[0]) await loadBaselineDetail(rows[0].id);
      else setVariances([]);
    } catch (err) {
      setBaselines([]);
      setVariances([]);
      emitMessage({ level: "warning", text: errorMessage(err, "Couldn't load this project's baselines") });
    }
  }, [projectId, loadBaselineDetail, emitMessage]);

  useEffect(() => {
    // D-45: "fetch GET /api/schedule/baselines?projectId in parallel with the
    // gantt call". Two independent awaits would have made the slowest screen in
    // the module slower still.
    void Promise.all([loadGantt(), loadBaselines()]);
    // loadGantt is stable-by-construction (it closes over projectId only); the
    // baseline loader is the memoised one, and its own chain bottoms out at
    // emitMessage, which has no dependencies at all -- so this effect runs once
    // per project, not once per render.
  }, [projectId, loadBaselines]);

  useEffect(() => {
    // The role decides whether the action is offered at all -- refusing AFTER
    // the click is the defect D-45 names.
    fetchJson<{ role?: string }>("/api/organization")
      .then((d) => setRoleState({ kind: "known", role: d.role ?? null }))
      .catch(() => setRoleState({ kind: "unknown" }));
  }, []);

  const captureDisabledReason =
    roleState.kind === "loading"
      ? "Loading…"
      : roleState.kind === "known" && !(roleState.role && PM_OR_ABOVE.includes(roleState.role))
        ? NEEDS_PM_ROLE
        : undefined;

  function openBaselineForm() {
    // "Baseline 02-09-2026" -- today in the organisation's own date format.
    setBaselineName(`Baseline ${formatDateNumeric(resolvedToday ?? new Date().toISOString().slice(0, 10))}`);
    setFormOpen(true);
  }

  async function captureBaseline() {
    const name = baselineName.trim();
    if (!name) return;
    setCapturing(true);
    emitMessage(null);
    try {
      await fetchJson("/api/schedule/baselines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name }),
      });
      toast.success(`Baseline "${name}" captured`);
      setFormOpen(false);
      setBaselinesOpen(true);
      await loadBaselines();
    } catch (err) {
      // The backend's OWN sentence, verbatim, in the persistent message area --
      // the old handler threw away the response entirely and showed
      // "Couldn't capture baseline — try again", which tells a PM nothing about
      // a 403, an empty project or a service that never answered.
      emitMessage({ level: "error", text: errorMessage(err, "The baseline was not captured") });
    } finally {
      setCapturing(false);
    }
  }

  /** Snapshot counts for the baselines the disclosure lists, fetched only when it is opened. */
  async function ensureSnapshotCounts(rows: Baseline[]) {
    for (const baseline of rows) {
      if (snapshotCounts[baseline.id] !== undefined) continue;
      await loadBaselineCount(baseline.id);
    }
  }

  async function loadBaselineCount(baselineId: string) {
    try {
      const detail = await fetchJson<{ variances?: BaselineVariance[] }>(
        `/api/schedule/baselines/${encodeURIComponent(baselineId)}`
      );
      setSnapshotCounts((counts) => ({ ...counts, [baselineId]: (detail.variances ?? []).length }));
    } catch {
      setSnapshotCounts((counts) => ({ ...counts, [baselineId]: "error" }));
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

  // R67 D-45: issueId -> the planned window this activity was baselined with.
  const baselineByIssueId: ReadonlyMap<string, BaselineWindow> = new Map(
    variances.map((v) => [v.issueId, { plannedStartDate: v.baselineStartDate, plannedDueDate: v.baselineDueDate }])
  );
  const currentBaseline = baselines[0] ?? null;
  const progress = summariseScheduleProgress(tasks, baselineByIssueId, resolvedToday ?? "");
  // NOT named `window`: shadowing the global inside a client component is how a
  // later edit reaches for `window.location` and silently gets an object shape.
  const chartWindow = scheduleWindow(tasks, baselineByIssueId);
  const slipTitle = currentBaseline
    ? `Measured against "${currentBaseline.name}", captured ${formatDayMonthYear(currentBaseline.createdAt)}`
    : NO_BASELINE_NOTE;

  // ─── R67 D-56 (audit R-185): planned vs actual, from the activity's OWN
  // window ──────────────────────────────────────────────────────────────────
  //
  // D-45's Slip answers "has the finish DATE moved since we baselined?" and
  // needs a baseline to answer anything at all. D-56 asks the question a site
  // meeting actually asks -- "is the WORK far enough along for where we are in
  // this activity's window?" -- and needs no baseline, which matters because
  // most projects have never captured one. The two columns sit side by side
  // deliberately: an activity can be dead on its original finish date and
  // still be a fortnight of work behind.
  const slippageByTask = new Map<string, TaskSlippage>(
    tasks.map((t) => {
      const planned = plannedPercentComplete(t.startDate, t.dueDate, resolvedToday ?? "");
      return [t.id, taskSlippage(planned, t.completionPercentage, durationDays(t.startDate, t.dueDate))];
    })
  );
  const slippageSummary = summariseTaskSlippage([...slippageByTask.values()]);

  /**
   * D-56: the inline "% complete" editor, offered only where nothing else owns
   * the number. It PATCHes the ONE field through the existing task route and
   * updates the row optimistically; a failure puts the backend's own sentence
   * in the persistent footer and restores what was there.
   */
  async function savePercent(task: GanttTask) {
    const raw = percentDraft.trim();
    setEditingPercentId(null);
    const next = Number(raw);
    if (raw === "" || !Number.isFinite(next)) return;
    if (next < 0 || next > 100) {
      emitMessage({ level: "warning", text: "% complete must be between 0 and 100." });
      return;
    }
    const rounded = Math.round(next);
    if (rounded === task.completionPercentage) return;

    const previous = task.completionPercentage;
    setSavingPercentId(task.id);
    setTasks((rows) => rows.map((r) => (r.id === task.id ? { ...r, completionPercentage: rounded } : r)));
    try {
      await fetchJson(`/api/schedule/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionPercentage: rounded }),
      });
      emitMessage(null);
    } catch (err) {
      setTasks((rows) => rows.map((r) => (r.id === task.id ? { ...r, completionPercentage: previous } : r)));
      emitMessage({ level: "warning", text: errorMessage(err, `% complete was not saved for "${task.title}"`) });
    } finally {
      setSavingPercentId(null);
    }
  }

  // The header's Filter bar narrows the authoritative table only -- the chart
  // keeps every bar, because hiding dependency lines whose other end is
  // filtered out would draw a programme that does not exist.
  const needle = titleFilter.trim().toLowerCase();
  const visibleTasks = needle ? tasks.filter((t) => t.title.toLowerCase().includes(needle)) : tasks;

  // The row's return address, so ← Back on the Object Page lands on the list as
  // the user left it (D-44). Built from props, NEVER from window.location:
  // reading the browser's URL during render would make the server's HTML and
  // the client's first render disagree, which is a real hydration mismatch --
  // the same class of defect src/lib/format-date.ts exists to prevent.
  const backTo = `/schedule?projectId=${encodeURIComponent(projectId)}&tab=timeline${
    titleFilter ? `&q=${encodeURIComponent(titleFilter)}` : ""
  }`;
  const taskHref = (id: string) => `/schedule/tasks/${id}?backTo=${encodeURIComponent(backTo)}`;

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
      // R67 D-56: "milestones as diamonds". A zero-length activity IS a
      // milestone, so it is drawn as one rather than as a bar of no width that
      // the eye cannot find. The chart and the table agree because both ask
      // isMilestoneWindow().
      type: isMilestoneWindow(t.startDate, t.dueDate) ? ("milestone" as const) : ("task" as const),
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-4">
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "taskCount", "Tasks")}</p><p className="text-2xl font-heading text-px-ink">{tasks.length}</p></CardContent></Card>
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "criticalCount", "On Critical Path")}</p><p className="text-2xl font-heading text-px-error">{criticalCount}</p></CardContent></Card>
        <Card className="flex-1 min-w-[140px]"><CardContent className="p-4"><p className="text-xs text-px-muted">{columnLabel(labelColumns, "milestoneCount", "Milestones")}</p><p className="text-2xl font-heading text-px-ink">{milestones.length}</p></CardContent></Card>
        {/* R67 D-45's fourth tile. The one number a PM opens this module for --
            and, until now, the one number the product could not answer. */}
        <Card className="flex-1 min-w-[260px]" data-testid="schedule-progress-tile">
          <CardContent className="p-4">
            <p className="text-xs text-px-muted">Schedule progress</p>
            <p className="text-base font-heading text-px-ink">{formatScheduleProgress(progress)}</p>
            <p className="mt-1 text-xs text-px-muted">
              {currentBaseline
                ? `${currentBaseline.name} — captured ${formatDayMonthYear(currentBaseline.createdAt)}`
                : NO_BASELINE_NOTE}
            </p>
          </CardContent>
        </Card>
        {/* R67 D-56's project header tile. Unlike the baseline tile beside it,
            this one answers even when no baseline has ever been captured --
            it reads each activity's own window. */}
        <Card className="flex-1 min-w-[260px]" data-testid="schedule-slippage-tile">
          <CardContent className="p-4">
            <p className="text-xs text-px-muted">Slippage</p>
            <p
              className={
                slippageSummary.behindCount > 0
                  ? "text-base font-heading text-[color:var(--color-veri-status-late)]"
                  : "text-base font-heading text-px-ink"
              }
            >
              {formatSlippageTile(slippageSummary)}
            </p>
            <p className="mt-1 text-xs text-px-muted">
              Planned % is where this activity should be today; Actual % is what has been reported.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* R67 D-45: window.prompt() is gone. It cannot be styled, cannot be
          validated, cannot say why it is unavailable, and is suppressed
          outright by some browsers -- so the one control that starts slip
          tracking could silently do nothing. */}
      <Card className="shadow-card">
        <CardContent className="space-y-3 p-4">
          {!formOpen ? (
            <Button
              onClick={openBaselineForm}
              disabled={!!captureDisabledReason}
              title={captureDisabledReason}
              variant="outline"
              data-testid="capture-baseline"
            >
              {captureDisabledReason ? `Capture Baseline (${captureDisabledReason})` : "Capture Baseline"}
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="baseline-name">Name</Label>
                <Input
                  id="baseline-name"
                  className="w-64"
                  value={baselineName}
                  onChange={(e) => setBaselineName(e.target.value)}
                />
              </div>
              <Button
                onClick={captureBaseline}
                disabled={capturing || !baselineName.trim()}
                title={capturing ? "Capturing…" : !baselineName.trim() ? BASELINE_NAME_REQUIRED : undefined}
                data-testid="baseline-save"
              >
                {baselineSaveLabel(baselineName, capturing)}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          )}

          {/* The disclosure. Snapshot counts are fetched only when it is opened
              -- one GET per baseline, and only for the ones actually shown. */}
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[13px] text-ct-navy hover:underline"
              aria-expanded={baselinesOpen}
              data-testid="baselines-disclosure"
              onClick={() => {
                const next = !baselinesOpen;
                setBaselinesOpen(next);
                if (next) void ensureSnapshotCounts(baselines);
              }}
            >
              {baselinesOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              Baselines ({baselines.length})
            </button>
            {baselinesOpen && (
              <ul className="mt-2 space-y-1 text-[13px]">
                {baselines.length === 0 ? (
                  <li className="text-px-muted">{NO_BASELINE_NOTE}</li>
                ) : (
                  baselines.map((b) => {
                    const count = snapshotCounts[b.id];
                    return (
                      <li key={b.id} className="flex flex-wrap gap-x-3 text-ct-navy">
                        <span className="font-medium">{b.name}</span>
                        <span className="text-px-muted">{formatDayMonthYear(b.createdAt)}</span>
                        <span className="text-px-muted">
                          {count === undefined
                            ? "Loading activities…"
                            : count === "error"
                              ? "Activity count unavailable"
                              : `${count} activities`}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>
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
            All tasks ({visibleTasks.length}
            {needle && visibleTasks.length !== tasks.length ? ` of ${tasks.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{columnLabel(labelColumns, "task", "Task")}</TableHead>
                <TableHead>{columnLabel(labelColumns, "start", "Start")}</TableHead>
                <TableHead>{columnLabel(labelColumns, "due", "Due")}</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                {/* D-56 calls this pair Planned % / Actual %. "% Complete" is
                    the Actual half and keeps the name D-44 shipped it under,
                    so an existing link, export or screenshot still matches. */}
                <TableHead className="text-right">Planned %</TableHead>
                <TableHead className="text-right">% Complete</TableHead>
                <TableHead className="text-right">Slippage</TableHead>
                <TableHead>Planned finish</TableHead>
                <TableHead>Slip</TableHead>
                <TableHead>{columnLabel(labelColumns, "critical", "Critical Path")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTasks.length === 0 ? (
                <TableRow>
                  {/* 10, matching the TableHead count above exactly: Task,
                      Start, Due, Duration, Planned %, % Complete, Slippage,
                      Planned finish, Slip, Critical Path. A colSpan larger
                      than the header count stretches the table by a phantom
                      column. */}
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-px-muted">
                    {tasks.length === 0
                      ? "No scheduled activities yet."
                      : `No activity matches "${titleFilter}".`}
                  </TableCell>
                </TableRow>
              ) : (
                visibleTasks.map((t) => {
                  const planned = baselineByIssueId.get(t.id) ?? null;
                  const slip = formatSlip(slipDays(t.dueDate, planned?.plannedDueDate));
                  // R67 D-56
                  const plannedPercent = plannedPercentComplete(t.startDate, t.dueDate, resolvedToday ?? "");
                  const slippage = slippageByTask.get(t.id) ?? taskSlippage(null, null, null);
                  const milestone = isMilestoneWindow(t.startDate, t.dueDate);
                  const boqOwned = !!t.boqLineItemId;
                  const editingPercent = editingPercentId === t.id;
                  const plannedBar = barGeometry(
                    planned?.plannedStartDate, planned?.plannedDueDate, chartWindow.start, chartWindow.end
                  );
                  const actualBar = barGeometry(t.startDate, t.dueDate, chartWindow.start, chartWindow.end);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {/* A real link, so it is reachable by keyboard and by
                            middle-click/open-in-new-tab -- not an onClick on
                            the row, which is neither. */}
                        {/* D-56: a milestone is an activity with a
                            zero-length window (Finish = Start). It is drawn
                            with a diamond AND titled, never by shape alone. */}
                        {milestone && (
                          <span className="mr-1 text-px-muted" title="Milestone — finish is the same day as start">◆</span>
                        )}
                        <Link
                          href={taskHref(t.id)}
                          className="rounded underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ct-navy"
                        >
                          {t.title}
                        </Link>
                      </TableCell>
                      <TableCell className={t.startDate ? undefined : "text-px-muted"}>
                        {t.startDate ? displayScheduleDate(t.startDate) : EMPTY_DATE_CELL}
                      </TableCell>
                      <TableCell className={t.dueDate ? undefined : "text-px-muted"}>
                        {t.dueDate ? displayScheduleDate(t.dueDate) : EMPTY_DATE_CELL}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDurationDays(durationDays(t.startDate, t.dueDate))}
                      </TableCell>
                      {/* 0 % is a real answer and prints as "0 %"; only an
                          absent figure prints the en-dash. */}
                      <TableCell className="text-right tabular-nums text-px-muted">
                        {plannedPercent === null ? EMPTY_SCHEDULE_CELL : `${plannedPercent} %`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editingPercent ? (
                          <Input
                            autoFocus
                            type="number"
                            min={0}
                            max={100}
                            aria-label={`% complete for ${t.title}`}
                            className="ml-auto h-8 w-20 text-right"
                            value={percentDraft}
                            onChange={(e) => setPercentDraft(e.target.value)}
                            onBlur={() => void savePercent(t)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void savePercent(t);
                              // Escape abandons the edit; it must not save.
                              if (e.key === "Escape") setEditingPercentId(null);
                            }}
                          />
                        ) : boqOwned ? (
                          // D-56: an activity linked to a BOQ line takes its
                          // progress from the Work Progress report. Letting the
                          // Timeline overwrite it would give one number two
                          // authors and no way to tell which you are reading.
                          <span title="This activity's progress comes from its BOQ line">
                            {t.completionPercentage} %{" "}
                            <span className="text-[11px] text-px-muted">from Work Progress</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rounded px-1 underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ct-navy"
                            title="Click to edit % complete"
                            disabled={savingPercentId === t.id}
                            onClick={() => {
                              setEditingPercentId(t.id);
                              setPercentDraft(String(t.completionPercentage));
                            }}
                          >
                            {savingPercentId === t.id ? "Saving…" : `${t.completionPercentage} %`}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            slippage.tone === "behind"
                              ? "text-xs font-medium text-[color:var(--color-veri-status-late)]"
                              : "text-xs text-px-muted"
                          }
                          title="Planned % minus Actual %, priced in this activity's own days"
                        >
                          {slippage.glyph ? `${slippage.glyph} ` : ""}
                          {slippage.text}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={planned?.plannedDueDate ? undefined : "text-px-muted"} title={slipTitle}>
                          {planned?.plannedDueDate ? displayScheduleDate(planned.plannedDueDate) : EMPTY_SCHEDULE_CELL}
                        </span>
                        {/* D-45: "Draw the planned bar as a second grey bar per
                            Gantt row where SVAR supports it, otherwise as an
                            inline mini-bar in the table row." SVAR's baseline
                            overlay is a PRO-only feature (see this file's header
                            comment), so the comparison is drawn here, where this
                            component owns every pixel. */}
                        {(plannedBar || actualBar) && (
                          <span
                            className="mt-1 block w-28 space-y-0.5"
                            aria-hidden
                            title="Grey: planned. Blue: actual."
                          >
                            <span className="block h-1 rounded bg-px-cloud">
                              {plannedBar && (
                                <span
                                  className="block h-1 rounded bg-ct-border2"
                                  style={{ marginLeft: `${plannedBar.offsetPercent}%`, width: `${plannedBar.widthPercent}%` }}
                                />
                              )}
                            </span>
                            <span className="block h-1 rounded bg-px-cloud">
                              {actualBar && (
                                <span
                                  className="block h-1 rounded bg-[color:var(--color-veri-status-context)]"
                                  style={{ marginLeft: `${actualBar.offsetPercent}%`, width: `${actualBar.widthPercent}%` }}
                                />
                              )}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            slip.tone === "late"
                              ? "text-xs font-medium text-[color:var(--color-veri-status-late)]"
                              : slip.tone === "early"
                                ? "text-xs text-[color:var(--color-veri-status-done)]"
                                : "text-xs text-px-muted"
                          }
                          title={slipTitle}
                        >
                          {slip.glyph ? `${slip.glyph} ` : ""}
                          {slip.text}
                        </span>
                      </TableCell>
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
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-card overflow-hidden">
        <CardHeader><CardTitle className="font-heading text-base">Timeline</CardTitle></CardHeader>
        <CardContent className="p-0" style={{ height: 480 }}>
          {tasks.length === 0 ? (
            <p className="py-16 text-center text-sm text-px-muted">No scheduled tasks yet.</p>
          ) : (
            <Willow>
              {/* A bar is a control now: clicking one opens the same Object
                  Page the table row does, so the chart is not a dead picture. */}
              <Gantt
                tasks={ganttTasks}
                links={ganttLinks}
                columns={columns}
                readonly
                onTaskClick={(event: { id?: string | number }) => {
                  const id = String(event?.id ?? "");
                  if (!id || id.startsWith("milestone_")) return;
                  router.push(taskHref(id));
                }}
              />
            </Willow>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
