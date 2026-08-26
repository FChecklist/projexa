"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, LayoutPanelLeft, Box } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import LoadError from "@/components/LoadError";

type FloorPlan = { id: string; name: string; floorLevel: string | null; status: string };

export default function FloorPlansClient({ projectId }: { projectId: string }) {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // R52 Gate 2 / A4S14_02. The recorded diagnosis said the page "silently falls
  // through to the generic empty state" when its data call fails, and that is
  // right -- but the mechanism is here, not in routing: res.ok was never read,
  // so a 504's { error: "VERIDIAN request timed out after 20000ms: ..." } body
  // parsed fine, data.floorPlans came back undefined, and `?? []` turned a dead
  // backend into "No floor plans yet." The try/catch could not help -- catch
  // never fires on an HTTP status.
  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ floorPlans?: FloorPlan[] }>(`/api/floor-plans?projectId=${encodeURIComponent(projectId)}`);
      setPlans(data.floorPlans ?? []);
    } catch (err) {
      // Drop stale rows rather than showing a previous project's plans beside
      // an error about this one.
      setPlans([]);
      const msg = errorMessage(err, "Couldn't load floor plans");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createPlan() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/floor-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, floorLevel: floorLevel || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Floor plan created");
      setName(""); setFloorLevel(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create floor plan");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Floor Plan</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Floor Plan</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living + Dining Layout" /></div>
              <div className="space-y-1.5"><Label>Floor Level (optional)</Label><Input value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)} placeholder="e.g. Ground Floor" /></div>
            </div>
            <DialogFooter><Button onClick={createPlan} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Error BEFORE empty: "no floor plans" is a fact about the user's data
          and may only be stated when the read actually succeeded. */}
      {loadError ? (
        <LoadError message={loadError} onRetry={load} />
      ) : plans.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-px-muted">No floor plans yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="shadow-card">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="font-heading text-base">{p.name}</CardTitle>
                  {p.floorLevel && <p className="text-xs text-px-muted mt-0.5">{p.floorLevel}</p>}
                </div>
                <Badge variant={p.status === "final" ? "default" : "outline"}>{p.status}</Badge>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Link href={`/floor-plans/${p.id}`} className="flex-1">
                  <Button variant="outline" className="w-full"><LayoutPanelLeft className="size-4" /> 2D Editor</Button>
                </Link>
                <Link href={`/floor-plans/${p.id}/walkthrough`} className="flex-1">
                  <Button variant="outline" className="w-full"><Box className="size-4" /> 3D Walkthrough</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
