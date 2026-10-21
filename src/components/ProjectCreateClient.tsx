"use client";

// R67 D-01 -- "+ Create Project" stops being a dialog.
//
// Correction C-01: "The one popup in PROJEXA is the home's Create Project.
// The 'no dialogs' rule stands as a recommendation, so Create Project must
// move to a real /projects/new route with breadcrumb and Back." This file is
// the form contents of the retired CreateProjectDialog, rehoused in the same
// ObjectScreen create archetype /labour/new already uses -- breadcrumb
// "Dashboard / New Project", a Back control, and a Save that is disabled WITH
// THE REASON, naming the fields still missing (src/lib/project-form.ts).
//
// PROJEXA has no "product" concept for the user: the form asks for a project
// name only. VERIDIAN's schema still requires a productId, so POST
// /api/projects fills it in server-side (see that route).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invalidateShell } from "@/lib/shell-store";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { missingProjectFields, projectSaveDisabledReason, resolveProjectName } from "@/lib/project-form";
import { ApiError } from "@/lib/fetch-json";
import { ensureOrganization, NO_ORGANIZATION_PATTERN, withOrgRetry } from "@/lib/org/ensure-org-client";
import { browserEnsureDeps } from "@/lib/org/browser-ensure";
import { reportClientError } from "@/lib/local-first/client-error-report";
import { GuidedError } from "@/components/GuidedError";
import { contextFromError, fieldFromBody } from "@/lib/error-guide/context";
import { useDraft } from "@/lib/error-guide/use-draft";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import { faultError, projectFormFaults } from "@/lib/error-guide/g1-faults";

/**
 * R67 D-01 (lane D1, folded into this canonical component under D-11's rule).
 * Which FIELD a server refusal is about, so the sentence lands next to the
 * control the user has to change rather than only at the top of the screen.
 * Returns undefined when the message names no field -- the message is then
 * shown once, in the screen's own message strip, exactly as before.
 */
export function fieldForProjectError(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("target date")) return "targetDate";
  if (m.includes("start date")) return "startDate";
  if (m.includes("name")) return "name";
  return undefined;
}

/** A problem the form can see without asking the server: the dates run backwards. Returns the field and the sentence, or null. */
export function projectDateProblem(startDate: string, targetDate: string): { field: "targetDate"; message: string } | null {
  if (startDate && targetDate && targetDate < startDate) {
    return { field: "targetDate", message: "The target date must be on or after the start date. Pick a later target date, or an earlier start date." };
  }
  return null;
}

const EMPTY_PROJECT = { name: "", description: "", startDate: "", targetDate: "" };

export default function ProjectCreateClient() {
  const router = useRouter();
  // GUIDED ERRORS: what is typed is kept in a draft (sessionStorage, 2 h), so leaving through a "Fix it now" link, a sign-in that ran out or a
  // reload loses nothing; it is thrown away on a successful save.
  const draft = useDraft("project-new", EMPTY_PROJECT);
  const { name, description, startDate, targetDate } = draft.value;
  const setName = (v: string) => draft.set({ name: v });
  const setDescription = (v: string) => draft.set({ description: v });
  const setStartDate = (v: string) => draft.set({ startDate: v });
  const setTargetDate = (v: string) => draft.set({ targetDate: v });
  const [submitting, setSubmitting] = useState(false);
  // The failure as it was caught (kept whole, so the guide can read its status, code and call), or a problem the form found itself.
  const [failure, setFailure] = useState<{ err: unknown; field?: string; message: string } | null>(null);
  const saveError = failure?.message ?? null;

  const missing = missingProjectFields({ name });
  // R67 D-01: the refusal is shown in the guided panel AND beside the field it is about, when it names one.
  const errorField = failure ? (failure.field ?? fieldForProjectError(failure.message)) : undefined;
  const fieldError = (field: string) => (errorField === field ? saveError : undefined);
  const guideCtx = useMemo(
    () => (failure ? contextFromError(failure.err, { entityType: "project", field: errorField, serverMessage: failure.message }) : null),
    [failure, errorField]
  );

  // Scroll to and focus the first bad field, so the person never has to look for it.
  useEffect(() => {
    if (!errorField) return;
    const el = findFocusTarget(errorField);
    if (el) highlightElement(el);
  }, [failure, errorField]);

  async function createProject() {
    if (missing.length > 0 || submitting) return;
    // Everything the form can see is wrong is told BEFORE anything is sent (a name over 200 letters, a year that cannot be right, dates the wrong
    // way round), with the input outlined. src/lib/error-guide/g1-faults.ts.
    const [problem] = projectFormFaults({ name, description, startDate, targetDate });
    if (problem) {
      setFailure({ err: faultError(problem), field: problem.field, message: problem.message });
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      // POST /api/projects proxies VERIDIAN's own /projects create, which
      // returns the created row itself (status 201) -- so the new project's
      // id is available here and the user lands on the real object, never
      // back on an empty form.
      // Nothing is required: an empty name becomes "New project <date>" (renamable later).
      const projectName = resolveProjectName(name);
      const post = () =>
        fetchJson<{ id?: string }>("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: projectName,
            description: description.trim() || undefined,
            startDate: startDate || undefined,
            targetDate: targetDate || undefined,
          }),
        });
      const created = await withOrgRetry(
        post,
        () => ensureOrganization(browserEnsureDeps()),
        (e) => e instanceof ApiError && e.status === 400 && NO_ORGANIZATION_PATTERN.test(e.message),
        (detail) => reportClientError("org-provision", new Error(detail), "ProjectCreateClient"),
      );
      toast.success(`Created project ${projectName}`);
      draft.clear();
      // R67 F-21 (carried over from the deleted CreateProjectDialog, which
      // decision D-01 replaced with this route): the shell's project list is
      // held in a session store, so mark that ONE key stale and the new
      // project appears in the top rail's switcher at once, without re-reading
      // the whole bootstrap.
      invalidateShell("projects");
      router.push(created?.id ? `/dashboard/project?projectId=${encodeURIComponent(created.id)}` : "/dashboard");
      router.refresh();
      // Stay locked after a success: if the navigation is slow (or the embedded shell does not move), a second click must not create a duplicate project.
      return;
    } catch (err) {
      // Never a generic "couldn't create": the server's own refusal is the
      // only thing the user can act on. Values are kept, nothing is reset.
      const message = errorMessage(err, "Couldn't create the project");
      const bodyField = err instanceof ApiError ? fieldFromBody(err.body) : undefined;
      setFailure({ err, field: bodyField, message: err instanceof Error && err.message ? err.message : message });
    }
    setSubmitting(false);
  }

  return (
    <ObjectScreen
      breadcrumb="Dashboard / New Project"
      title="New Project"
      mode="create"
      hasDraft={false}
      onSave={createProject}
      onCancel={() => router.push("/dashboard")}
      onBack={() => router.push("/dashboard")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={projectSaveDisabledReason(missing, submitting)}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {guideCtx && <GuidedError ctx={guideCtx} onRetry={failure && !failure.field ? createProject : undefined} draftKey="project-new" />}
        {draft.restored && !guideCtx && (
          <p className="text-[12.5px] text-px-muted" data-testid="draft-restored">
            We kept what you typed earlier.{" "}
            <button type="button" className="underline underline-offset-2" onClick={draft.startFresh}>
              Start fresh
            </button>
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">Project Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional. e.g. Lakeview Residence — Phase 2" aria-invalid={fieldError("name") ? true : undefined} />
          {fieldError("name") && <p role="alert" className="text-[12.5px] text-px-error">{fieldError("name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start Date (optional)</Label>
            <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={fieldError("startDate") ? true : undefined} />
            {fieldError("startDate") && <p role="alert" className="text-[12.5px] text-px-error">{fieldError("startDate")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targetDate">Target Date (optional)</Label>
            <Input id="targetDate" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} aria-invalid={fieldError("targetDate") ? true : undefined} />
            {fieldError("targetDate") && <p role="alert" className="text-[12.5px] text-px-error">{fieldError("targetDate")}</p>}
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
