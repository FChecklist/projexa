"use client";

// Real-screen conversion (2026-08-30): "New Entry" routes to a real create
// screen (SiteDiaryCreateClient.tsx, which now also asks for visitors/
// material received/remarks); rows route to a real Object Page
// (SiteDiaryObjectClient.tsx, which gained a real detail view this
// conversion -- getSiteDiary() didn't exist before -- and surfaces all of
// the previously-hidden fields, including `instructions`, which the old
// Dialog collected but the list table never displayed).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Diary = {
  id: string;
  diaryDate: string;
  weather: string | null;
  workDone: string | null;
  labourCount: number | null;
  issues: string | null;
};

export default function SiteDiaryClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ diaries?: Diary[] }>(`/api/site-diary?projectId=${encodeURIComponent(projectId)}`);
      setDiaries(data.diaries ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load site diary"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Entry" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/site-diary/new?projectId=${projectId}`)}><Plus className="size-4" /> New Entry</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : diaries.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No diary entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Weather</TableHead><TableHead>Work Done</TableHead>
                  <TableHead>Labour</TableHead><TableHead>Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where every field now lives. */}
                {diaries.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/site-diary/${d.id}`)}>
                    <TableCell className="text-px-muted">{formatDate(d.diaryDate)}</TableCell>
                    <TableCell>{d.weather ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{d.workDone ?? "—"}</TableCell>
                    <TableCell>{d.labourCount ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-px-muted">{d.issues ?? "—"}</TableCell>
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
