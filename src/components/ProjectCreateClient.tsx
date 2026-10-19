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
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invalidateShell } from "@/lib/shell-store";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { missingProjectFields, projectSaveDisabledReason } from "@/lib/project-form";

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

export default function ProjectCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const missing = missingProjectFields({ name });
  // R67 D-01: the refusal is shown BOTH in the screen strip and beside the
  // field it is about, when it names one.
  const errorField = saveError ? fieldForProjectError(saveError) : undefined;
  const fieldError = (field: string) => (errorField === field ? saveError : undefined);

  async function createProject() {
    if (missing.length > 0 || submitting) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      // POST /api/projects proxies VERIDIAN's own /projects create, which
      // returns the created row itself (status 201) -- so the new project's
      // id is available here and the user lands on the real object, never
      // back on an empty form.
      const created = await fetchJson<{ id?: string }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          startDate: startDate || undefined,
          targetDate: targetDate || undefined,
        }),
      });
      toast.success(`Created project ${name.trim()}`);
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
      setSaveError(message);
      toast.error(message);
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
      messages={saveError ? [{ level: "error" as const, text: saveError }] : []}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakeview Residence — Phase 2" />
          {fieldError("name") && <p className="text-[12.5px] text-px-error">{fieldError("name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start Date (optional)</Label>
            <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {fieldError("startDate") && <p className="text-[12.5px] text-px-error">{fieldError("startDate")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targetDate">Target Date (optional)</Label>
            <Input id="targetDate" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            {fieldError("targetDate") && <p className="text-[12.5px] text-px-error">{fieldError("targetDate")}</p>}
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
