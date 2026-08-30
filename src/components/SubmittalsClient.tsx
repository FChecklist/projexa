"use client";

// Real-screen conversion (2026-08-30): "New Submittal" routes to a real
// create screen (SubmittalCreateClient.tsx, which now also asks for
// type/due date); rows route to a real Object Page (SubmittalObjectClient.tsx,
// which gained a real detail view this conversion -- getSubmittal() didn't
// exist before) instead of the inline Review button and its Dialog.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Submittal = {
  id: string; number: number; title: string; specSection: string | null; type: string; status: string; reviewComments: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", approved: "secondary", approved_as_noted: "secondary", revise_resubmit: "destructive", rejected: "destructive",
};

export default function SubmittalsClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Submittal[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ submittals?: Submittal[] }>(`/api/submittals?projectId=${encodeURIComponent(projectId)}`);
      setItems(data.submittals ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load submittals"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Submittal" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/submittals/new?projectId=${projectId}`)}><Plus className="size-4" /> New Submittal</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No submittals yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Spec Section</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where Review now lives. */}
                {items.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/submittals/${s.id}`)}>
                    <TableCell className="font-mono text-xs">SUB-{s.number}</TableCell>
                    <TableCell className="font-medium">{s.title}</TableCell>
                    <TableCell className="text-px-muted">{s.specSection ?? "—"}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[s.status]}>{s.status.replace(/_/g, " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
