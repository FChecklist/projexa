"use client";

// R42 seq21: full-page lift of PermitsClient.tsx's existing create dialog
// (Wave 143, unchanged POST /api/permits contract) -- ObjectScreen's own
// create mode isn't used here (see permits/new/page.tsx header comment for
// why); this is real, already-shipped functionality, just moved out of a
// modal onto its own route so "+ New" in PermitsListClient has somewhere to
// navigate to.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function PermitCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // R52 fix for F_010. The recorded fault is "the only in-app entry point to
  // this route is a dead no-op". It is not a Radix fault and not a routing
  // fault: `name` and `file` are both `required`, and Create was only
  // disabled while saving, so clicking it with no PDF chosen failed NATIVE
  // HTML constraint validation and did nothing visible. No React, no Radix,
  // no hydration involved.
  //
  // The DEFINITION OF DONE for every screen forbids exactly this: "NO
  // FAIL-AFTER-CLICK (primary action disabled while required fields are
  // empty, with the count beside it)". So the button is now disabled until
  // both required fields are satisfied, and the count of what is still
  // missing is rendered next to it -- the user is told what is wrong BEFORE
  // clicking rather than getting silence after.
  const [name, setName] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const missing = (name.trim() ? 0 : 1) + (hasFile ? 0 : 1);

  async function handleCreate(formData: FormData) {
    formData.set("projectId", projectId);
    setSaving(true);
    try {
      const res = await fetch("/api/permits", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create permit");
      }
      const created = await res.json();
      toast.success("Permit created");
      router.push(`/permits/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create permit");
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle>New Permit</CardTitle></CardHeader>
      <CardContent>
        <form action={handleCreate} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Permit name</Label>
            <Input id="name" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="permitAuthority">Issuing authority</Label>
              <Input id="permitAuthority" name="permitAuthority" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="permitNumber">Permit number</Label>
              <Input id="permitNumber" name="permitNumber" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="issueDate">Issue date</Label>
              <Input id="issueDate" name="issueDate" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate">End date</Label>
              <Input id="endDate" name="endDate" type="date" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="file">Permit PDF</Label>
            <Input id="file" name="file" type="file" accept="application/pdf" required
              onChange={(e) => setHasFile(Boolean(e.target.files && e.target.files.length > 0))} />
          </div>
          <div className="flex items-center justify-end gap-2">
            {missing > 0 && (
              <span className="mr-auto text-xs text-px-muted">
                {missing} required field{missing > 1 ? "s" : ""} still needed
                {name.trim() ? "" : " — permit name"}
                {hasFile ? "" : (name.trim() ? " — permit PDF" : ", permit PDF")}
              </span>
            )}
            <Button type="button" variant="outline" onClick={() => router.push("/permits")}>Cancel</Button>
            <Button type="submit" disabled={saving || missing > 0}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Create"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
