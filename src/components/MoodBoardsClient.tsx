"use client";

// Real-screen conversion (2026-08-30): "New Mood Board" routes to a real
// create screen (MoodBoardCreateClient.tsx); cards route to a real Object
// Page (MoodBoardObjectClient.tsx, which gained real Edit/item-remove this
// conversion -- getMoodBoard()/updateMoodBoard() and a PROJEXA proxy for
// removeMoodBoardItem() didn't exist before) instead of the old "Add Item"
// Dialog popup and inline status buttons.
//
// Cold-load fix (owner-flagged "single biggest risk to a live demo", 10-20s
// on /mood-boards among 8 named routes) -- same defect and same fix as
// MeetingsClient.tsx: page.tsx used to block entirely on an uncached,
// un-streamed resolveSelectedProject() and this component then fired a
// second client fetch after hydration. Measured cold vs warm on this route:
// 40.8s cold, 11.2s warm. See module-list-source.ts's fetchMoodBoardsList
// and mood-boards/page.tsx for the other half.
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Image as ImageIcon } from "lucide-react";
import DataLoadError from "@/components/DataLoadError";
import { useListRead } from "@/lib/use-list-read";
import type { ModuleListInitial } from "@/lib/module-list-state";

type MoodBoardItem = { id: string; label: string | null; notes: string | null };
export type MoodBoard = { id: string; title: string; roomOrArea: string | null; status: string; items: MoodBoardItem[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", shared: "secondary", approved: "default",
};

export default function MoodBoardsClient({
  projectId,
  initial = null,
}: {
  projectId: string;
  /**
   * What mood-boards/page.tsx already fetched on the server for this project
   * (via fetchMoodBoardsList). Present, the hook starts ANSWERED and makes
   * no round trip on first paint.
   */
  initial?: ModuleListInitial<MoodBoard>;
}) {
  const router = useRouter();

  const read = useListRead<MoodBoard>({
    url: `/api/mood-boards?projectId=${encodeURIComponent(projectId)}`,
    select: (body) => (body as { boards?: MoodBoard[] })?.boards,
    initial,
  });
  const boards = read.rows;
  const loading = read.status === "loading" || read.status === "idle";

  if (loading) return <div className="grid h-64 place-items-center" aria-busy="true"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

  if (read.status === "error") {
    return <DataLoadError messages={[read.error?.message ?? "Couldn't load mood boards"]} onRetry={read.reload} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Mood Board" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/mood-boards/new?projectId=${projectId}`)}><Plus className="size-4" /> New Mood Board</Button>
      </div>

      {boards.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-px-muted">No mood boards yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Real screen navigation (2026-08-30) -- cards open the real
              Object Page, where Edit/Add Item/Remove Item/status now live. */}
          {boards.map((b) => (
            <Card key={b.id} className="shadow-card cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/mood-boards/${b.id}`)}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="font-heading text-base">{b.title}</CardTitle>
                  {b.roomOrArea && <p className="text-xs text-px-muted mt-0.5">{b.roomOrArea}</p>}
                </div>
                <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
              </CardHeader>
              <CardContent>
                {b.items.length === 0 ? (
                  <p className="text-xs text-px-muted">No items yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {b.items.slice(0, 6).map((i) => (
                      <div key={i.id} className="rounded-lg border border-px-border bg-px-concrete/40 p-2">
                        <ImageIcon className="size-4 text-px-muted mb-1" />
                        <p className="text-xs font-medium text-px-ink truncate">{i.label}</p>
                        {i.notes && <p className="text-[10px] text-px-muted truncate">{i.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
