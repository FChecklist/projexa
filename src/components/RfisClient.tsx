"use client";

// Real-screen conversion (2026-08-30): "New RFI" routes to a real create
// screen (RfiCreateClient.tsx, which now also asks for due date); rows
// route to a real Object Page (RfiObjectClient.tsx, which gained a real
// detail view this conversion -- getRfi() didn't exist before) instead of
// the inline Answer/Close buttons and the "Answer" Dialog popup.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Rfi = {
  id: string; number: number; subject: string; question: string; status: string; ballInCourt: string;
  answer: string | null; dueDate: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive", answered: "secondary", closed: "outline",
};

export default function RfisClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ rfis?: Rfi[] }>(`/api/rfis?projectId=${encodeURIComponent(projectId)}`);
      setRfis(data.rfis ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load RFIs"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            RFI" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/rfis/new?projectId=${projectId}`)}><Plus className="size-4" /> New RFI</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : rfis.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No RFIs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Subject</TableHead><TableHead>Ball in Court</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where Answer/Close now live. */}
                {rfis.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/rfis/${r.id}`)}>
                    <TableCell className="font-mono text-xs">RFI-{r.number}</TableCell>
                    <TableCell className="font-medium">{r.subject}</TableCell>
                    <TableCell className="capitalize text-px-muted">{r.ballInCourt}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
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
