"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, LayoutDashboard, Clock, Wallet, AlertTriangle, Target, FileText, ShieldAlert, MessageSquare } from "lucide-react";
import { useVeriChat } from "@/components/veri-chat/veri-chat-context";
import { ReportOutput } from "@/components/ReportOutput";
import { formatDateTime } from "@/lib/format-date";

// This page is deliberately NOT a second chat UI. The real AI Copilot --
// Discuss chat, every registered tool (not just construction's 7), team
// Chats, and To Do -- is already docked on every page via VeriComposer
// (bottom) + VeriChatPanel (right), mounted once in (app)/layout.tsx. This
// page gives the sidebar's "AI Copilot" nav item somewhere real to land:
// one-click access to the 7 construction tools with the result shown
// inline (via the same /api/assistant endpoint and dispatch convention
// VeriComposer's dispatchLeaf() uses), plus a construction-filtered slice
// of query history the shared panel doesn't surface on its own.

type Tool = { codeReference: string; label: string; icon: typeof LayoutDashboard; needsProject: boolean; description: string };

const TOOLS: Tool[] = [
  { codeReference: "get_construction_project_dashboard", label: "Project Dashboard", icon: LayoutDashboard, needsProject: true, description: "Budget, revenue, expenses, progress for this project" },
  { codeReference: "get_construction_budget_status", label: "Budget Status", icon: Wallet, needsProject: true, description: "Budget vs actual for this project" },
  { codeReference: "get_construction_kpi_status", label: "KPI Status", icon: Target, needsProject: true, description: "KPI definitions vs actuals for this project" },
  { codeReference: "generate_construction_progress_summary", label: "AI Progress Summary", icon: FileText, needsProject: true, description: "AI-generated summary of recent progress" },
  { codeReference: "detect_construction_budget_schedule_risk", label: "AI Budget/Schedule Risk", icon: ShieldAlert, needsProject: true, description: "AI risk flags for budget and schedule" },
  { codeReference: "list_delayed_activities", label: "Delayed Activities", icon: Clock, needsProject: false, description: "Every project (org-wide) with a delayed task" },
  { codeReference: "list_over_budget_projects", label: "Over-Budget Projects", icon: AlertTriangle, needsProject: false, description: "Every project (org-wide) running over budget" },
];

const CONSTRUCTION_REFS = new Set(TOOLS.map((t) => t.codeReference));

type QueryRow = { id: string; code_reference: string; breadcrumb: string; status: string; result: unknown; error_message: string | null; created_at: string };

export default function CopilotClient({ projectId }: { projectId: string }) {
  const { setComposerMode, bumpRefresh } = useVeriChat();
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ tool: Tool; result: unknown } | null>(null);
  const [history, setHistory] = useState<QueryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // R52 / A4S14_copilot_01 (the load half). runTool below already reads res.ok
  // and surfaces the backend's own message, so a 504 on a "Run" card is
  // reported honestly -- that part of the recorded fault no longer holds. This
  // function did not: res.ok was unread, so a failed GET /api/assistant became
  // `data.queries === undefined`, `?? []` made it an empty array, and the
  // Recent Construction Queries list rendered as "none" instead of "failed".
  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await fetchJson<{ queries?: QueryRow[] }>("/api/assistant");
      setHistory((data.queries ?? []).filter((q) => CONSTRUCTION_REFS.has(q.code_reference)));
    } catch (err) {
      const message = errorMessage(err, "Couldn't load Copilot history");
      setHistory([]);
      setHistoryError(message);
      toast.error(message);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { loadHistory(); }, []);

  async function runTool(tool: Tool) {
    setRunning(tool.codeReference);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeReference: tool.codeReference,
          breadcrumb: tool.label,
          inputs: tool.needsProject ? { projectId } : {},
        }),
      });
      const row = await res.json();
      if (!res.ok) throw new Error(row?.error);
      toast.success(`Done — ${tool.label}`);
      setLastResult({ tool, result: row.result });
      bumpRefresh(); // keeps the docked Queries panel in sync with this page's dispatch
      loadHistory();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : `Couldn't run ${tool.label}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-card border-px-orange/30 bg-px-orange/5">
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-px-ink">
            The full AI Copilot — free-form chat, every registered tool, team messaging, and to-dos — is always
            available in the panel on the right and the composer at the bottom of every page. This page is a
            quick-launch for the 7 construction-specific tools, with results shown inline.
          </p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setComposerMode("discuss")}>
            <MessageSquare className="size-4" /> Open Discuss
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isRunning = running === tool.codeReference;
          return (
            <Card key={tool.codeReference} className="shadow-card">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2 font-medium text-px-ink"><Icon className="size-4 text-px-orange" />{tool.label}</div>
                <p className="text-xs text-px-muted">{tool.description}</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => runTool(tool)} disabled={running !== null}>
                  {isRunning ? <Loader2 className="size-4 animate-spin" /> : "Run"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {lastResult && (
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Result — {lastResult.tool.label}</CardTitle></CardHeader>
          <CardContent><ReportOutput data={lastResult.result} /></CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Recent Construction Queries</CardTitle></CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="grid h-20 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : historyError ? (
            <div className="space-y-2 py-6 text-center">
              <p role="alert" className="text-sm text-px-error">{historyError}</p>
              <Button size="sm" variant="outline" onClick={() => loadHistory()}>Retry</Button>
            </div>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">No construction Copilot queries yet — run one above.</p>
          ) : (
            <div className="space-y-2">
              {history.map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-lg border border-px-border px-3 py-2 text-sm">
                  <span className="text-px-ink">{q.breadcrumb}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-px-muted">{formatDateTime(q.created_at)}</span>
                    <Badge variant={q.status === "done" ? "default" : q.status === "error" ? "destructive" : "secondary"}>{q.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
