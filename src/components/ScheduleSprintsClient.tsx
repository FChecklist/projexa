"use client";

// Priority 17 Wave 1: Sprints/cycles view for the Schedule module, over the
// previously-unexposed VERIDIAN pms-sprint-service.ts (Plane's CycleIssue
// parity). New tab alongside the existing Timeline/Board views. Sprint
// mutations (create/update/close/issue-assign) work through PROJEXA's
// shared API key with no known identity-bridge gap -- pms_sprints carries
// no per-user attribution column, unlike wiki/timesheets.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Sprint = {
  id: string; name: string; goal: string | null; startDate: string | null; endDate: string | null;
  status: string; progressSnapshot: { total: number; completed: number; cancelled: number; remaining: number } | null;
};
type SprintIssue = { id: string; number: number; title: string; priority: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planned: "outline", active: "default", completed: "secondary",
};

export default function ScheduleSprintsClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sprintIssues, setSprintIssues] = useState<Record<string, SprintIssue[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/sprints?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sprints");
      setSprints(data.sprints ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sprints");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function toggleExpand(sprintId: string) {
    if (expanded === sprintId) { setExpanded(null); return; }
    setExpanded(sprintId);
    if (!sprintIssues[sprintId]) {
      try {
        const data = await fetchJson(`/api/schedule/sprints/${encodeURIComponent(sprintId)}/issues`);
        setSprintIssues((prev) => ({ ...prev, [sprintId]: data.issues ?? [] }));
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load sprint issues"));
      }
    }
  }

  async function closeSprint(sprintId: string) {
    try {
      const res = await fetch(`/api/schedule/sprints/${encodeURIComponent(sprintId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to close sprint");
      toast.success("Sprint closed");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close sprint");
    }
  }

  // Real screen navigation (2026-08-30) -- replaces the old "New Sprint"
  // Dialog popup with a real create route.
  const newSprintButton = (
    <Button onClick={() => router.push(`/schedule/sprints/new?projectId=${projectId}`)}><Plus className="size-4" /> New Sprint</Button>
  );

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load sprints: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{newSprintButton}</div>
      {sprints.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-px-muted">No sprints yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {sprints.map((sprint) => (
            <Card key={sprint.id} className="shadow-card">
              <CardHeader className="cursor-pointer pb-2" onClick={() => toggleExpand(sprint.id)}>
                <CardTitle className="flex items-center justify-between font-heading text-sm">
                  <span className="flex items-center gap-2">
                    {expanded === sprint.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    {sprint.name}
                    <Badge variant={STATUS_VARIANT[sprint.status] ?? "outline"} className="text-[10px]">{sprint.status}</Badge>
                  </span>
                  <span className="flex items-center gap-2 text-xs font-normal text-px-muted">
                    {sprint.startDate && sprint.endDate ? `${sprint.startDate} → ${sprint.endDate}` : null}
                    {sprint.status !== "completed" && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); closeSprint(sprint.id); }}>
                        Close Sprint
                      </Button>
                    )}
                  </span>
                </CardTitle>
                {sprint.goal && <p className="pl-6 text-xs text-px-muted">{sprint.goal}</p>}
              </CardHeader>
              {sprint.progressSnapshot && (
                <CardContent className="pt-0 pl-9 pb-2 text-xs text-px-muted">
                  Closed with {sprint.progressSnapshot.completed}/{sprint.progressSnapshot.total} completed,{" "}
                  {sprint.progressSnapshot.cancelled} cancelled, {sprint.progressSnapshot.remaining} remaining.
                </CardContent>
              )}
              {expanded === sprint.id && (
                <CardContent className="pt-0 pl-9">
                  {!sprintIssues[sprint.id] ? (
                    <Loader2 className="size-4 animate-spin text-px-muted" />
                  ) : sprintIssues[sprint.id].length === 0 ? (
                    <p className="text-xs text-px-muted">No issues assigned to this sprint yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {sprintIssues[sprint.id].map((issue) => (
                        <li key={issue.id} className="flex items-center gap-2 text-sm">
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
                            onClick={() => router.push(`/schedule/tasks/${issue.id}`)}
                          >
                            <span className="font-mono text-xs text-px-muted">#{issue.number}</span>
                            {issue.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
