"use client";

// R67 WS-H (item H-01, decision D-11). The timesheet entry's object page.
//
// DISPLAY-FIRST, per D-11: it opens READ-ONLY with its facets and one
// explicit Edit. There is no keystroke autosave here -- an entry a manager
// is reviewing must not change under them because somebody's cursor was in
// a field. Edit -> change -> Save is the whole lifecycle, and Save goes
// through the same PATCH the grid's own edit would.
//
// Delete states its blast radius rather than asking "Are you sure?" -- the
// sentence names the entry, the hours, the task, the day, the state it is in
// and the consequence, and it changes with the state because the consequence
// does (see deleteConfirmation in src/lib/design-studio-timesheet.ts).
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchJson } from "@/lib/fetch-json";
import {
  DESIGN_STUDIO_CATEGORIES,
  deleteConfirmation,
  formatDayLabel,
  formatHours,
  headerStatus,
  validateHours,
} from "@/lib/design-studio-timesheet";

type Entry = {
  id: string;
  ref: string;
  issueId: string;
  hours: string;
  spentOn: string;
  activityType: string | null;
  comments: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  projectId: string | null;
  issue?: { id: string; number: number; title: string } | null;
  loggedBy?: { id: string; name: string } | null;
  reviewedBy?: { id: string; name: string } | null;
};

export default function DesignStudioTimesheetObjectClient({
  entryId,
  projectId,
  projectName,
}: {
  entryId: string;
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The create route hands its receipt over in the URL, so the sentence
  // "Timesheet entry TS-000123 saved" is shown by the screen the user
  // actually landed on rather than by a toast that outlived its own screen.
  const savedReceipt = searchParams.get("saved");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [message, setMessage] = useState<{ level: "error" | "success" | "info"; text: string } | null>(
    savedReceipt ? { level: "success", text: savedReceipt } : null
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const [hours, setHours] = useState("");
  const [category, setCategory] = useState("");
  const [comments, setComments] = useState("");
  const [spentOn, setSpentOn] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<Entry>(`/api/timesheets/${encodeURIComponent(entryId)}`);
      setEntry(data);
      setHours(String(data.hours));
      setCategory(data.activityType ?? "");
      setComments(data.comments ?? "");
      setSpentOn(data.spentOn);
    } catch (err) {
      setMessage({ level: "error", text: err instanceof Error ? err.message : "Could not load this entry" });
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => { void load(); }, [load]);

  const backHref = `/design-studio?projectId=${encodeURIComponent(projectId)}`;

  async function save() {
    const problem = validateHours(hours);
    if (problem) { setMessage({ level: "error", text: problem }); return; }
    setBusy(true);
    try {
      await fetchJson(`/api/timesheets/${encodeURIComponent(entryId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours, spentOn, activityType: category || null, comments: comments || null }),
      });
      setMode("display");
      setMessage({ level: "success", text: `${entry?.ref ?? "Entry"} saved` });
      void load();
    } catch (err) {
      setMessage({ level: "error", text: err instanceof Error ? err.message : "The entry was not saved" });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const result = await fetchJson<{ reviewTaskError: string | null }>(`/api/timesheets/${encodeURIComponent(entryId)}/submit`, { method: "POST" });
      setMessage(
        result.reviewTaskError
          ? { level: "error", text: `Submitted, but the reviewer's task was not created: ${result.reviewTaskError}` }
          : { level: "success", text: `${entry?.ref ?? "Entry"} submitted for review` }
      );
      void load();
    } catch (err) {
      setMessage({ level: "error", text: err instanceof Error ? err.message : "The entry was not submitted" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetchJson(`/api/timesheets/${encodeURIComponent(entryId)}`, { method: "DELETE" });
      router.push(backHref);
    } catch (err) {
      setMessage({ level: "error", text: err instanceof Error ? err.message : "The entry was not deleted" });
      setBusy(false);
    } finally {
      setConfirmDelete(false);
    }
  }

  if (loading || !entry) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const status = headerStatus(entry.approvalStatus);
  const task = entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId;

  return (
    <>
      <ObjectScreen
        breadcrumb={`Design Studio / ${projectName} / Timesheet`}
        title={`Timesheet entry ${entry.ref}`}
        headerStatus={status}
        facets={[
          { label: "Date", value: formatDayLabel(entry.spentOn) },
          { label: "Project", value: projectName },
          { label: "Category", value: entry.activityType ?? "-" },
          { label: "Task", value: task },
          { label: "Hours", value: formatHours(entry.hours) },
          { label: "Logged by", value: entry.loggedBy?.name ?? "-" },
          { label: "Reviewed by", value: entry.reviewedBy?.name ?? "-" },
        ]}
        mode={mode}
        hasDraft={false}
        onEdit={entry.approvalStatus === "draft" ? () => setMode("edit") : undefined}
        onSave={save}
        onCancel={() => { setMode("display"); void load(); }}
        onDelete={() => setConfirmDelete(true)}
        onBack={() => router.push(backHref)}
        saveDisabled={busy || !!validateHours(hours)}
        saveDisabledReason={busy ? "Saving..." : validateHours(hours) ?? undefined}
        messages={message ? [{ level: message.level, text: message.text }] : []}
      >
        <div className="space-y-4 px-4 py-3">
          {entry.approvalStatus === "rejected" && entry.rejectionReason && (
            <p className="rounded-md border border-px-error-border bg-px-error-light p-3 text-sm text-px-error">
              Sent back: {entry.rejectionReason}
            </p>
          )}

          {mode === "display" ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-[12.5px] text-px-muted">Comments</dt><dd className="text-sm text-px-ink">{entry.comments ?? "-"}</dd></div>
            </dl>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="entry-date">Date</Label>
                <Input id="entry-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-hours">Hours</Label>
                <Input id="entry-hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="entry-category"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{DESIGN_STUDIO_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-comments">Comments</Label>
                <Input id="entry-comments" value={comments} onChange={(e) => setComments(e.target.value)} />
              </div>
            </div>
          )}

          {mode === "display" && entry.approvalStatus === "draft" && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-md border border-px-border px-3 py-1.5 text-[13px] text-px-ink disabled:opacity-50"
            >
              Submit
            </button>
          )}
        </div>
      </ObjectScreen>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this timesheet entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmation({ ref: entry.ref, hours: entry.hours, spentOn: entry.spentOn, approvalStatus: entry.approvalStatus, issue: entry.issue ?? null })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} disabled={busy}>Delete entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
