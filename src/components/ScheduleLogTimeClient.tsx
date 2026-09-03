"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleTimesheetClient.tsx's
// old "Log Time" Dialog popup with a real create screen. A separate screen
// from the Task Object Page's own inline "Log Time" action (ScheduleTaskObjectClient.tsx)
// because this one's real job is picking WHICH task to log against, when
// the user hasn't navigated to a specific task first.
//
// ─── R67 D-51 (audit R-145 / R-149) ─────────────────────────────────────────
// Two defects:
//
//   * "Activity Type (optional)" was a free-text box whose placeholder read
//     "e.g. Development, Site Visit" -- a software team's vocabulary on a site
//     product, optional, and free text, so designerTimesheetReport's byCategory
//     breakdown grouped on two or three spellings per person and produced no
//     usable subtotal. It is now a REQUIRED "Category *" select over the
//     project's own construction categories (unioned with the customer's BOQ
//     vocabulary so a project with no categories yet is not a dead end), plus
//     "Other (specify)" which reveals a text field. The chosen value is still
//     persisted into the existing activityType column -- see
//     src/lib/time-categories.ts for why, and for what changes when the backend
//     gains a real category column.
//   * The form never said which project it was logging against, while the top
//     rail could be showing something else entirely. It now prints the resolved
//     project above Task, offers a "Change project" link that focuses the rail's
//     own switcher, and writes the resolved project INTO the rail so the two
//     cannot disagree while the form is being filled in.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { writeRailProject } from "@/lib/rail-project";
import { focusRailProjectSwitcher } from "@/lib/rail-focus";
import {
  OTHER_CATEGORY_LABEL,
  OTHER_CATEGORY_VALUE,
  mergeCategoryNames,
  resolveCategoryValue,
} from "@/lib/time-categories";

type Task = { id: string; number: number; title: string };
type Category = { id: string; name: string };

/** The rail-disagreement line D-51 quotes. The project's own name may contain a hyphen, so the separator is the em-dash this product's other R67 sentences use. */
export function projectLine(projectName: string): string {
  return `Project: ${projectName} — change in the top bar`;
}

export const RAIL_NOT_ON_SCREEN = "The project switcher is not on screen — scroll to the top bar";

export default function ScheduleLogTimeClient({
  projectId,
  projectName,
}: {
  projectId: string;
  /** Resolved server-side by the page, so the form can say what it is logging against. */
  projectName: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>(mergeCategoryNames([]));
  const [issueId, setIssueId] = useState("");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("");
  const [otherCategory, setOtherCategory] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [railNote, setRailNote] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => setTasks(data.tasks ?? []))
      .catch(() => { /* task dropdown is a convenience */ });
  }, [projectId]);

  useEffect(() => {
    // The project's own categories, from the call that already returns them
    // alongside its activities. A failure degrades to the seeded list rather
    // than to an empty required select.
    fetchJson<{ categories?: Category[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => setCategories(mergeCategoryNames((data.categories ?? []).map((c) => c.name))))
      .catch(() => setCategories(mergeCategoryNames([])));
  }, [projectId]);

  useEffect(() => {
    // Tint the rail to the project this form is actually logging against.
    writeRailProject(projectId);
  }, [projectId]);

  const resolvedCategory = resolveCategoryValue(category, otherCategory);

  const missing = [
    ...(issueId ? [] : ["Task"]),
    ...(hours ? [] : ["Hours"]),
    ...(spentOn ? [] : ["Date"]),
    ...(resolvedCategory ? [] : ["Category"]),
  ];

  async function logTime() {
    if (missing.length) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await fetchJson("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          hours,
          spentOn,
          // Persisted into activityType until the backend gains a real category
          // column; see src/lib/time-categories.ts.
          activityType: resolvedCategory,
          comments: comments || undefined,
        }),
      });
      toast.success("Time logged");
      router.push(`/schedule?projectId=${projectId}&tab=timesheet`);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't log time"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Schedule / Log Time"
      title="Log Time"
      mode="create"
      hasDraft={false}
      onSave={logTime}
      onCancel={() => router.push(`/schedule?projectId=${projectId}&tab=timesheet`)}
      onBack={() => router.push(`/schedule?projectId=${projectId}&tab=timesheet`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Logging…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {/* D-51: the form names its project, and offers the one control that
            changes it, instead of leaving the user to compare the rail with the
            rows they are about to write. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-px-border bg-px-cloud/40 px-3 py-2 text-[13px]">
          <span className="text-ct-navy" data-testid="log-time-project">
            {projectLine(projectName)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRailNote(focusRailProjectSwitcher() ? null : RAIL_NOT_ON_SCREEN)}
          >
            Change project
          </Button>
          {railNote && <span className="text-px-muted">{railNote}</span>}
        </div>

        <div className="space-y-1.5">
          <Label>Task</Label>
          <Select value={issueId} onValueChange={setIssueId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select a task" /></SelectTrigger>
            <SelectContent>{tasks.map((t) => <SelectItem key={t.id} value={t.id}>#{t.number} {t.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Hours (e.g. 7.5)</Label><Input type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} /></div>
        </div>

        <FormField label="Category" required>
          {(f) => (
            <Select value={category} onValueChange={(next) => { setCategory(next); if (next !== OTHER_CATEGORY_VALUE) setOtherCategory(""); }}>
              <SelectTrigger {...f} className="w-full"><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>
                {categories.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
                <SelectItem value={OTHER_CATEGORY_VALUE}>{OTHER_CATEGORY_LABEL}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        {category === OTHER_CATEGORY_VALUE && (
          <FormField label="Category name" required hint="What this time was spent on, in your own words">
            {(f) => <Input {...f} value={otherCategory} onChange={(e) => setOtherCategory(e.target.value)} />}
          </FormField>
        )}

        <div className="space-y-1.5"><Label>Comments (optional)</Label><Input value={comments} onChange={(e) => setComments(e.target.value)} /></div>

        {saveError && <p role="alert" className="text-[13px] text-px-error">{saveError}</p>}
      </div>
    </ObjectScreen>
  );
}
