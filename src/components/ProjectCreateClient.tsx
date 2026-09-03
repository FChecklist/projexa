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
// The product list is resolved SERVER-SIDE by the route (decision D-04,
// Option A: the page fetches, the VERIDIAN key never reaches the browser), so
// this component does no read of its own -- it receives the list plus, when
// that read failed, the backend's own words. An empty picker is never
// presented as "no products": a failed read and a genuinely empty list say
// different things (src/lib/read-outcome.ts's standing rule).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invalidateShell } from "@/lib/shell-store";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { missingProjectFields, projectSaveDisabledReason } from "@/lib/project-form";
import { mayAssertEmpty } from "@/lib/read-outcome";

export type ProductOption = { id: string; name: string };

/**
 * R67 D-01 (lane D1, folded into this canonical component under D-11's rule).
 * Which FIELD a server refusal is about, so the sentence lands next to the
 * control the user has to change rather than only at the top of the screen.
 * Returns undefined when the message names no field -- the message is then
 * shown once, in the screen's own message strip, exactly as before.
 */
export function fieldForProjectError(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("product")) return "productId";
  if (m.includes("target date")) return "targetDate";
  if (m.includes("start date")) return "startDate";
  if (m.includes("name")) return "name";
  return undefined;
}

export default function ProjectCreateClient({
  products,
  productsError,
}: {
  products: ProductOption[];
  /** The backend's own message when the product read failed; null when it succeeded. */
  productsError: string | null;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const missing = missingProjectFields({ productId, name });
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
          productId,
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
    } catch (err) {
      // Never a generic "couldn't create": the server's own refusal is the
      // only thing the user can act on. Values are kept, nothing is reset.
      const message = errorMessage(err, "Couldn't create the project");
      setSaveError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
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
          {/* R67 D-01: htmlFor/id pairs, so clicking the label reaches the control and a screen reader announces the two together. */}
          <Label htmlFor="productId">Product</Label>
          {productsError ? (
            <p role="alert" className="rounded-md border border-px-error-border bg-px-error-light p-2 text-sm text-px-error">
              Couldn&apos;t load products: {productsError}
            </p>
          ) : mayAssertEmpty(productsError) && products.length === 0 ? (
            <p role="status" className="rounded-md border border-px-border bg-px-cloud p-2 text-sm text-px-muted">
              No products are set up for this organisation yet. An administrator must add a product before a
              project can be created.
            </p>
          ) : (
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="productId"><SelectValue placeholder="Select a product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {fieldError("productId") && <p className="text-[12.5px] text-px-error">{fieldError("productId")}</p>}
        </div>
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
