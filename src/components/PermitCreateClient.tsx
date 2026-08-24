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
            <Input id="name" name="name" required />
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
            <Input id="file" name="file" type="file" accept="application/pdf" required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/permits")}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Create"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
