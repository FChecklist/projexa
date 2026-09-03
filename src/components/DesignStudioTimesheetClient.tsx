"use client";

// R67 WS-H (items H-01/H-02/H-03/H-04, decision D-07). The Design Studio
// "My timesheet" tab: a DAY GRID, one row per task, in Sumeet's exact
// columns Date | Project | Category | Task | Hours, with the status chip at
// row level and one primary action for the whole day.
//
// D-07 SUPERSEDES the recommendations' "week grid with day columns": the
// week view here is a FILTER over the same rows, rendered by the same table,
// not a second grid with its own layout, its own totals and its own bugs.
//
// WHY THE ROWS ARE SAVED ON BLUR AND NOT ON A "SAVE" BUTTON: the add row is
// one line of a grid the designer is filling in at the end of a day, and the
// audit's own count budget (D-08) allows at most one typed value and three
// clicks per task. The row commits when Hours loses focus, optimistically,
// and rolls back with the backend's own sentence if the write fails --
// never a generic "something went wrong", and never a silent revert.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { StatusBadge, ScreenFrame } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import DesignStudioTabs from "@/components/DesignStudioTabs";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import {
  DESIGN_STUDIO_CATEGORIES,
  dayTotalLabel,
  emptyDayMessage,
  formatDayLabel,
  formatHours,
  rowStatus,
  submitDayLabel,
  todayIso,
  totalHours,
  validateHours,
} from "@/lib/design-studio-timesheet";

export type TimesheetEntry = {
  id: string;
  ref?: string;
  issueId: string;
  hours: string;
  spentOn: string;
  activityType: string | null;
  comments: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  issue?: { id: string; number: number; title: string } | null;
  loggedBy?: { id: string; name: string } | null;
};

type Task = { id: string; number: number; title: string };
type ProjectOption = { id: string; name: string };
type DesignerStatusRow = {
  userId: string;
  userName: string;
  draft: { hours: number; entries: number };
  submitted: { hours: number; entries: number };
  approved: { hours: number; entries: number };
  rejected: { hours: number; entries: number };
};

/** The 7 days ending on (and including) `spentOn` -- the week view's filter. */
function weekRange(spentOn: string): { from: string; to: string } {
  const end = new Date(`${spentOn}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to: spentOn };
}

export default function DesignStudioTimesheetClient({
  projectId,
  projectName,
  projects,
}: {
  projectId: string;
  projectName: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const today = todayIso();

  const [spentOn, setSpentOn] = useState(today);
  const [view, setView] = useState<"day" | "week">("day");
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [designerStatus, setDesignerStatus] = useState<DesignerStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [footerMessage, setFooterMessage] = useState<{ level: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The inline "Add entry" row.
  const [draftProjectId, setDraftProjectId] = useState(projectId);
  const [draftCategory, setDraftCategory] = useState<string>(DESIGN_STUDIO_CATEGORIES[0]);
  const [draftTaskId, setDraftTaskId] = useState("");
  const [draftHours, setDraftHours] = useState("");
  const [draftComments, setDraftComments] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    const errors: string[] = [];

    // Day view asks the server for the day; week view asks for the project
    // and filters the SAME rows locally -- D-07's "the week view is a filter
    // over the same rows, not a second grid", literally.
    const listQuery = new URLSearchParams({ projectId, mine: "true" });
    if (view === "day") listQuery.set("spentOn", spentOn);

    const [entriesResult, tasksResult, statusResult] = await Promise.allSettled([
      fetchJson<{ entries?: TimesheetEntry[] }>(`/api/timesheets?${listQuery.toString()}`),
      fetchJson<{ tasks?: Task[] }>(`/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ byDesigner?: DesignerStatusRow[] }>(`/api/reports/designer-approval-status?projectId=${encodeURIComponent(projectId)}`),
    ]);

    if (entriesResult.status === "fulfilled") setEntries(entriesResult.value.entries ?? []);
    else errors.push(entriesResult.reason instanceof Error ? entriesResult.reason.message : "Could not load your timesheet");

    if (tasksResult.status === "fulfilled") setTasks(tasksResult.value.tasks ?? []);
    else errors.push(tasksResult.reason instanceof Error ? tasksResult.reason.message : "Could not load this project's tasks");

    if (statusResult.status === "fulfilled") setDesignerStatus(statusResult.value.byDesigner ?? []);
    else errors.push(statusResult.reason instanceof Error ? statusResult.reason.message : "Could not load the designer-wise status");

    setLoadErrors(errors);
    setLoading(false);
  }, [projectId, spentOn, view]);

  useEffect(() => { void load(); }, [load]);

  const visibleEntries = useMemo(() => {
    if (view === "day") return entries.filter((e) => e.spentOn === spentOn);
    const { from, to } = weekRange(spentOn);
    return entries.filter((e) => e.spentOn >= from && e.spentOn <= to);
  }, [entries, view, spentOn]);

  const dayEntries = useMemo(() => entries.filter((e) => e.spentOn === spentOn), [entries, spentOn]);
  const dayHours = totalHours(dayEntries);
  const draftRows = dayEntries.filter((e) => e.approvalStatus === "draft");
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  async function addRow() {
    const otherHours = totalHours(dayEntries);
    const problem = validateHours(draftHours, otherHours);
    setHoursError(problem);
    if (problem || !draftTaskId) {
      if (!draftTaskId) setFooterMessage({ level: "error", text: "Pick a task before saving the row." });
      return;
    }

    // Optimistic append: the row appears immediately with a temporary id and
    // is replaced by the saved row, or removed with the real reason.
    const optimisticId = `pending-${Date.now()}`;
    const task = tasks.find((t) => t.id === draftTaskId) ?? null;
    setEntries((prev) => [
      { id: optimisticId, issueId: draftTaskId, hours: draftHours, spentOn, activityType: draftCategory, comments: draftComments || null, approvalStatus: "draft", rejectionReason: null, issue: task },
      ...prev,
    ]);
    setBusy(true);
    try {
      const saved = await fetchJson<TimesheetEntry>("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: draftTaskId, hours: draftHours, spentOn, activityType: draftCategory, comments: draftComments || undefined }),
      });
      setEntries((prev) => prev.map((e) => (e.id === optimisticId ? { ...saved, issue: task } : e)));
      setDraftHours("");
      setDraftComments("");
      setFooterMessage({ level: "success", text: `${formatHours(saved.hours)} h saved on ${formatDayLabel(saved.spentOn)}` });
    } catch (err) {
      setEntries((prev) => prev.filter((e) => e.id !== optimisticId));
      setFooterMessage({ level: "error", text: err instanceof ApiError || err instanceof Error ? err.message : "The row was not saved" });
    } finally {
      setBusy(false);
    }
  }

  async function submitEntry(entry: TimesheetEntry) {
    const before = entry.approvalStatus;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, approvalStatus: "submitted" } : e)));
    setBusy(true);
    try {
      await fetchJson(`/api/timesheets/${encodeURIComponent(entry.id)}/submit`, { method: "POST" });
      setFooterMessage({ level: "success", text: `${entry.ref ?? "Entry"} submitted for review` });
      void load();
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, approvalStatus: before } : e)));
      setFooterMessage({ level: "error", text: err instanceof Error ? err.message : "The entry was not submitted" });
    } finally {
      setBusy(false);
    }
  }

  async function submitDay() {
    setBusy(true);
    try {
      const result = await fetchJson<{ submitted: number; hours: number; reviewTaskError: string | null }>("/api/timesheets/submit-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, spentOn }),
      });
      setFooterMessage(
        result.reviewTaskError
          ? { level: "error", text: `${result.submitted} rows (${formatHours(result.hours)} h) submitted, but the reviewer's task was not created: ${result.reviewTaskError}` }
          : { level: "success", text: `${result.submitted} rows (${formatHours(result.hours)} h) submitted for review` }
      );
      void load();
    } catch (err) {
      setFooterMessage({ level: "error", text: err instanceof Error ? err.message : "The day was not submitted" });
    } finally {
      setBusy(false);
    }
  }

  const submitDisabledReason = draftRows.length === 0
    ? "Add at least one entry for this day first"
    : busy
      ? "Working..."
      : undefined;

  return (
    <ScreenFrame
      breadcrumb={`Design Studio / ${projectName} / Timesheet`}
      filterAction={{
        label: view === "day" ? "Filter: day" : "Filter: week",
        onClick: () => setView((v) => (v === "day" ? "week" : "day")),
      }}
      exportAction={{
        label: "Export",
        onClick: () => router.push(`/reports?report=designer-timesheet&projectId=${encodeURIComponent(projectId)}`),
      }}
      newAction={{
        label: "New",
        onClick: () => router.push(`/design-studio/timesheets/new?projectId=${encodeURIComponent(projectId)}`),
      }}
      footerActions={
        <>
          <Button onClick={submitDay} disabled={!!submitDisabledReason} title={submitDisabledReason}>
            {submitDayLabel(draftRows.length, totalHours(draftRows), spentOn, today)}
          </Button>
          <span className="ml-auto text-[13px] font-medium text-px-ink">{dayTotalLabel(dayHours, spentOn, today)}</span>
        </>
      }
      messages={footerMessage ? [{ level: footerMessage.level, text: footerMessage.text }] : []}
    >
      <DesignStudioTabs projectId={projectId} />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="design-studio-day">Day</Label>
            <Input id="design-studio-day" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="design-studio-view">View</Label>
            <Select value={view} onValueChange={(v) => setView(v as "day" | "week")}>
              <SelectTrigger id="design-studio-view" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">This day</SelectItem>
                <SelectItem value="week">This week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DataLoadError messages={loadErrors} onRetry={() => void load()} />

        {/* Designer-wise status strip (item H-02) -- hours per designer in
            each approval state, from designerApprovalStatusReport. It sits
            ABOVE the list because it is the answer to "is the team's day
            in?", which is the question a PM opens this screen with. */}
        {designerStatus.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Designer-wise status">
            {designerStatus.map((row) => (
              <div key={row.userId} className="rounded-md border border-px-border px-3 py-2 text-[12.5px]">
                <div className="font-medium text-px-ink">{row.userName}</div>
                <div className="text-px-muted">
                  Draft {formatHours(row.draft.hours)} h · Submitted {formatHours(row.submitted.hours)} h · Approved {formatHours(row.approved.hours)} h · Rejected {formatHours(row.rejected.hours)} h
                </div>
              </div>
            ))}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [0, 1, 2].map((i) => (
                <TableRow key={`skeleton-${i}`}>
                  {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                    <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              visibleEntries.map((entry) => {
                const chip = rowStatus(entry.approvalStatus);
                return (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDayLabel(entry.spentOn)}</TableCell>
                    <TableCell>{projectNameById.get(projectId) ?? projectName}</TableCell>
                    <TableCell>{entry.activityType ?? "-"}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => router.push(`/design-studio/timesheets/${encodeURIComponent(entry.id)}`)}
                      >
                        {entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId}
                      </button>
                    </TableCell>
                    <TableCell>{formatHours(entry.hours)}</TableCell>
                    <TableCell><StatusBadge tone={chip.tone} label={chip.label} /></TableCell>
                    <TableCell className="text-right">
                      {entry.approvalStatus === "draft" && !entry.id.startsWith("pending-") && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void submitEntry(entry)}>Submit</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}

            {!loading && visibleEntries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-px-muted">
                  {emptyDayMessage(spentOn)}
                </TableCell>
              </TableRow>
            )}

            {/* The inline Add entry row -- the same five columns, so the
                thing being filled in looks like the thing being listed. */}
            <TableRow>
              <TableCell>{formatDayLabel(spentOn)}</TableCell>
              <TableCell>
                <Select value={draftProjectId} onValueChange={setDraftProjectId}>
                  <SelectTrigger aria-label="Project" className="w-full"><SelectValue placeholder="Project" /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select value={draftCategory} onValueChange={setDraftCategory}>
                  <SelectTrigger aria-label="Category" className="w-full"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{DESIGN_STUDIO_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select value={draftTaskId} onValueChange={setDraftTaskId}>
                  <SelectTrigger aria-label="Task" className="w-full"><SelectValue placeholder="Select a task" /></SelectTrigger>
                  <SelectContent>{tasks.map((t) => <SelectItem key={t.id} value={t.id}>#{t.number} {t.title}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  aria-label="Hours"
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={draftHours}
                  onChange={(e) => setDraftHours(e.target.value)}
                  onBlur={() => { if (draftHours.trim() !== "") void addRow(); }}
                  className="w-24"
                />
                {hoursError && <p className="mt-1 text-[12px] text-px-error">{hoursError}</p>}
              </TableCell>
              <TableCell>
                <Input aria-label="Comments" value={draftComments} onChange={(e) => setDraftComments(e.target.value)} placeholder="Comments" />
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void addRow()}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                  Add entry
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ScreenFrame>
  );
}
