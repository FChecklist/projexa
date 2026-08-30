"use client";

// Real-screen conversion (2026-08-30): "New Mood Board" routes to a real
// create screen (MoodBoardCreateClient.tsx); cards route to a real Object
// Page (MoodBoardObjectClient.tsx, which gained real Edit/item-remove this
// conversion -- getMoodBoard()/updateMoodBoard() and a PROJEXA proxy for
// removeMoodBoardItem() didn't exist before) instead of the old "Add Item"
// Dialog popup and inline status buttons.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Image as ImageIcon } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type MoodBoardItem = { id: string; label: string | null; notes: string | null };
type MoodBoard = { id: string; title: string; roomOrArea: string | null; status: string; items: MoodBoardItem[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", shared: "secondary", approved: "default",
};

export default function MoodBoardsClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [boards, setBoards] = useState<MoodBoard[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ boards?: MoodBoard[] }>(`/api/mood-boards?projectId=${encodeURIComponent(projectId)}`);
      setBoards(data.boards ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load mood boards"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

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
