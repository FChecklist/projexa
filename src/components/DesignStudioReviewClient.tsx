"use client";

// R67 WS-H (items H-02/H-03/H-04). The manager's Review tab: submitted days
// grouped by designer, Approve (bulk per day) and Reject (reason required,
// at least 5 characters).
//
// THREE THINGS THIS SCREEN DELIBERATELY DOES NOT DO:
//  1. It never places Delete next to Approve (item H-02). There is no delete
//     here at all -- deleting someone else's hours is not a review decision.
//  2. It never invents its own refusal. Self-approval and
//     already-decided-entry are refused by VERIDIAN's own service
//     (pms-time-service.reviewTimeEntry), and its sentence -- "The submitter
//     cannot review their own time entry", "Only a submitted time entry can
//     be reviewed" -- is what lands in the footer message area verbatim.
//  3. It never hides the button a role cannot use. A non-PM sees Approve and
//     Reject DISABLED WITH THE REASON, because a hidden control teaches
//     nothing; the real gate is server-side (requireRole on the resolved
//     acting user, VERIDIAN side).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScreenFrame, StatusBadge } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import DesignStudioTabs from "@/components/DesignStudioTabs";
import { fetchJson } from "@/lib/fetch-json";
import { ROLE_GROUPS } from "@/lib/authz/roles";
import { formatDayLabel, formatHours, groupSubmittedByDesignerDay, rowStatus, totalHours, type DesignerDayGroup } from "@/lib/design-studio-timesheet";
import type { TimesheetEntry } from "@/components/DesignStudioTimesheetClient";

/** The minimum a reject reason has to say to be worth sending back (item H-02). */
export const MIN_REJECT_REASON = 5;

type DayGroup = DesignerDayGroup<TimesheetEntry>;

export default function DesignStudioReviewClient({
  projectId,
  projectName,
  role,
}: {
  projectId: string;
  projectName: string;
  role: string | null;
}) {
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [footerMessage, setFooterMessage] = useState<{ level: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const canReview = !!role && (ROLE_GROUPS.PM_OR_ABOVE as readonly string[]).includes(role);
  const roleReason = canReview ? undefined : "Only a project manager or above can approve or return hours";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    try {
      const data = await fetchJson<{ entries?: TimesheetEntry[] }>(`/api/timesheets?projectId=${encodeURIComponent(projectId)}`);
      setEntries(data.entries ?? []);
    } catch (err) {
      setLoadErrors([err instanceof Error ? err.message : "Could not load the review queue"]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupSubmittedByDesignerDay(entries), [entries]);

  /**
   * ONE decision over the whole day, in ONE request.
   *
   * FIX PASS: this used to loop one POST per entry, which is exactly the
   * half-succeeding pattern /api/timesheets/submit-day exists to avoid on the
   * designer's side ("a loop of N POSTs can half-succeed, and there is no
   * honest thing to show" -- that route's own header). On the manager's side
   * it is worse: a four-row day whose third call fails leaves two rows
   * approved and two not, the footer shows only the first error, and the
   * reload re-renders a partly decided day in a queue they believe they have
   * cleared. VERIDIAN's reviewDayForReview() moves the whole day or none of
   * it, and refuses self-review for the whole call rather than per row.
   */
  async function decideDay(group: DayGroup, decision: "approved" | "rejected", rejectionReason?: string) {
    const before = new Map(group.entries.map((e) => [e.id, e.approvalStatus]));
    const ids = new Set(before.keys());
    setEntries((prev) => prev.map((e) => (ids.has(e.id) ? { ...e, approvalStatus: decision } : e)));
    setBusy(true);
    try {
      const result = await fetchJson<{ decided: number; hours: number; reviewTaskError: string | null }>(
        "/api/timesheets/review-day",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            designerId: group.designerId,
            projectId,
            spentOn: group.spentOn,
            decision,
            ...(rejectionReason ? { rejectionReason } : {}),
          }),
        }
      );
      const day = `${group.designerName}'s ${formatDayLabel(group.spentOn)}`;
      const done = decision === "approved"
        ? `${day} approved (${result.decided} ${result.decided === 1 ? "entry" : "entries"}, ${formatHours(result.hours)} h)`
        : `${day} returned with your reason (${result.decided} ${result.decided === 1 ? "entry" : "entries"})`;
      setFooterMessage(
        result.reviewTaskError
          ? { level: "error", text: `${done}, but the Task Master rows were not updated: ${result.reviewTaskError}` }
          : { level: "success", text: done }
      );
    } catch (err) {
      // Roll every row back to exactly what it was, and put the BACKEND's
      // sentence in the footer -- not one this component made up.
      setEntries((prev) => prev.map((e) => (before.has(e.id) ? { ...e, approvalStatus: before.get(e.id)! } : e)));
      setFooterMessage({ level: "error", text: err instanceof Error ? err.message : "The decision was not recorded" });
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function approveDay(group: DayGroup) {
    await decideDay(group, "approved");
  }

  async function rejectDay(group: DayGroup) {
    if (reason.trim().length < MIN_REJECT_REASON) return;
    await decideDay(group, "rejected", reason.trim());
    setRejecting(null);
    setReason("");
  }

  return (
    <ScreenFrame
      breadcrumb={`Design Studio / ${projectName} / Review`}
      filterAction={{ label: "Filter", disabledReason: "Submitted days only" }}
      messages={footerMessage ? [{ level: footerMessage.level, text: footerMessage.text }] : []}
    >
      <DesignStudioTabs projectId={projectId} />

      <div className="space-y-4 p-4">
        <DataLoadError messages={loadErrors} onRetry={() => void load()} />

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-px-muted">No submitted days waiting for you on {projectName}.</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="rounded-md border border-px-border">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-px-border px-4 py-2.5">
                <div className="text-[13px]">
                  <span className="font-medium text-px-ink">{group.designerName}</span>
                  <span className="text-px-muted"> · {formatDayLabel(group.spentOn)} · {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}, {formatHours(totalHours(group.entries))} h</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={busy || !canReview} title={roleReason} onClick={() => void approveDay(group)}>Approve</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !canReview}
                    title={roleReason}
                    onClick={() => { setRejecting(rejecting === group.key ? null : group.key); setReason(""); }}
                  >
                    Reject
                  </Button>
                </div>
              </header>

              {rejecting === group.key && (
                <div className="flex flex-wrap items-end gap-2 border-b border-px-border px-4 py-2.5">
                  <div className="min-w-[18rem] flex-1 space-y-1.5">
                    <label htmlFor={`reason-${group.key}`} className="text-[12.5px] text-px-muted">Reason (required, at least {MIN_REJECT_REASON} characters)</label>
                    <Input id={`reason-${group.key}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What does the designer need to change?" />
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || reason.trim().length < MIN_REJECT_REASON}
                    title={reason.trim().length < MIN_REJECT_REASON ? `Type at least ${MIN_REJECT_REASON} characters` : undefined}
                    onClick={() => void rejectDay(group)}
                  >
                    Send back
                  </Button>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.entries.map((entry) => {
                    const chip = rowStatus(entry.approvalStatus);
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>{formatDayLabel(entry.spentOn)}</TableCell>
                        <TableCell>{projectName}</TableCell>
                        <TableCell>{entry.activityType ?? "-"}</TableCell>
                        <TableCell>{entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : "Untitled task"}</TableCell>
                        <TableCell>{formatHours(entry.hours)}</TableCell>
                        <TableCell><StatusBadge tone={chip.tone} label={chip.label} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          ))
        )}
      </div>
    </ScreenFrame>
  );
}
