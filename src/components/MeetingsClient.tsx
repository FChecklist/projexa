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
//
// Cold-load fix (owner-flagged "single biggest risk to a live demo", 10-20s
// on /meetings among 8 named routes). THE DEFECT: meetings/page.tsx used to
// await resolveSelectedProject() directly with no <Suspense> boundary and no
// cache, so the WHOLE PAGE (including the title) blocked on an uncached
// upstream call -- and only THEN did this component fire a second, separate
// client fetch after hydration. Two sequential VERIDIAN hops before a usable
// screen, exactly the anti-pattern R67 F-18/F-30 already fixed on
// /labour, /reports, /documents and /budgets, just never applied here.
// Measured cold vs warm on this exact route: 48.5s cold, 3.1s warm (the
// largest cold/warm ratio of the owner's 8 routes) -- almost entirely
// first-hit-only cost, which is exactly what this fix collapses into one
// server-side round trip. See module-list-source.ts's fetchMeetingsList and
// meetings/page.tsx for the other half.
import { useRouter } from "next/navigation";
import { formatDateTimeMedium } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import DataLoadError from "@/components/DataLoadError";
import { useListRead } from "@/lib/use-list-read";
import type { ModuleListInitial } from "@/lib/module-list-state";

export type Meeting = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
};

// R67 G-05: this local copy pinned the locale but not the time zone, so the
// SSR pass stamped a meeting in UTC and the browser in the visitor's zone --
// a different clock time, and near midnight a different DATE. One shared,
// fully pinned helper now.
const formatDateTime = formatDateTimeMedium;

export default function MeetingsClient({
  projectId,
  initial = null,
}: {
  projectId: string;
  /**
   * What meetings/page.tsx already fetched on the server for this project
   * (via fetchMeetingsList). Present, the hook starts ANSWERED and makes no
   * round trip on first paint. Only the first url is seeded -- a project
   * switch still reads normally.
   */
  initial?: ModuleListInitial<Meeting>;
}) {
  const router = useRouter();

  const read = useListRead<Meeting>({
    url: `/api/meetings?projectId=${encodeURIComponent(projectId)}`,
    select: (body) => (body as { meetings?: Meeting[] })?.meetings,
    initial,
  });
  const meetings = read.rows;
  const loading = read.status === "loading" || read.status === "idle";

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
            <div className="grid h-32 place-items-center" aria-busy="true"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : read.status === "error" ? (
            <DataLoadError messages={[read.error?.message ?? "Couldn't load meetings"]} onRetry={read.reload} />
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
