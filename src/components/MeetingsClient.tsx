"use client";

// Wave 141 (PROJEXA gap analysis): Meetings/MOM (Minutes of Meeting) module.
// Manual CRUD only -- the AI voice-to-MOM capture flow (GAP-MOM-VOICE-TICKETS)
// is a separate, still-pending item blocked on a speech-to-text provider
// choice, intentionally out of scope here.
//
// Real-screen conversion (2026-08-30): "New Meeting" routes to a real
// create screen (MeetingCreateClient.tsx); rows route to a real Object Page
// (MeetingObjectClient.tsx, which gained a real Edit this conversion --
// updateMeeting() didn't exist before) instead of the old "View" Dialog
// popup.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type Meeting = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function MeetingsClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ meetings?: Meeting[] }>(`/api/meetings?projectId=${encodeURIComponent(projectId)}`);
      setMeetings(data.meetings ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load meetings");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Meeting" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/meetings/new?projectId=${projectId}`)}><Plus className="size-4" /> New Meeting</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No meetings scheduled yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead><TableHead>When</TableHead><TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the real
                    Object Page, where Edit now lives. */}
                {meetings.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/meetings/${m.id}`)}>
                    <TableCell className="font-medium">{m.title}</TableCell>
                    <TableCell className="text-px-muted">{formatDateTime(m.scheduledAt)}</TableCell>
                    <TableCell className="text-px-muted">{m.durationMinutes ? `${m.durationMinutes} min` : "—"}</TableCell>
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
