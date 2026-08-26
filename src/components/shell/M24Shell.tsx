"use client";

// R52 PHASE A -- PROJEXA adopts the M24 shell (claude_log id=13, cc_spec 187).
//
// WHAT CHANGES: AppShellFrame + AppSidebar are gone from the (app) layout.
// M24 deletes the left rail outright -- "HOME = THE GROUPED MODULE DIRECTORY,
// rendered in the RIGHT pane. It REPLACES the left rail, which is why the rail
// could be deleted at all." Every routed screen now renders inside the RIGHT
// 70% pane, which is Phase B's re-parenting done in the one place that governs
// all 53 routes rather than 53 times.
//
// WHAT DOES NOT CHANGE: VeriComposer keeps working exactly as it does today.
// It is mounted through the kit Composer's inputSlot, so it supplies bands 3
// and 4 while the kit supplies bands 1 and 2 -- the control strip and the
// conversation. Its chain/dispatch wiring to /api/assistant and /api/discuss is
// untouched. Phase C replaces it with PillStrip; Phase A does not pay for that
// twice.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Composer,
  TaskMaster,
  TopRail,
  cutChainFrom,
  resetChain,
  DEFAULT_CHAIN_MODE,
  type Chain,
  type ChainLoad,
  type ChainMode,
  type HistoryEntry,
  type TaskTab,
} from "@fchecklist/veridian-ui-kit/shell";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";

// M24: "MODE is sticky WITHIN a session and RESETS to Projects on a new
// session, so nobody returns to a view they forgot they set." sessionStorage is
// exactly that lifetime -- localStorage would survive the session and break the
// rule, which is the reason it is not used here.
const MODE_KEY = "veri.chain.mode";
const HISTORY_KEY = "veri.chain.history";

type Org = { id: string; name: string } | null;
type Project = { id: string; name: string };

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [org, setOrg] = useState<Org>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [draft, setDraft] = useState("");

  // Restore the session-sticky mode. A brand-new session finds nothing and
  // falls back to Projects, which is the rule, not a fallback.
  useEffect(() => {
    try {
      const m = sessionStorage.getItem(MODE_KEY) as ChainMode | null;
      if (m) setMode(m);
      const h = sessionStorage.getItem(HISTORY_KEY);
      if (h) setHistory(JSON.parse(h) as HistoryEntry[]);
    } catch {
      // A blocked or unavailable sessionStorage must not take the shell down.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(MODE_KEY, mode);
    } catch {}
  }, [mode]);

  // Org + projects for the top rail. Read the status before the body: an error
  // body parses perfectly well as JSON, and treating it as data is how a failed
  // request becomes a confident-looking empty state.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/organization");
        if (!res.ok) return;
        const d = await res.json();
        if (live && d?.id) setOrg({ id: d.id, name: d.name ?? "Organisation" });
      } catch {}
    })();
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const d = await res.json();
        const list: Project[] = Array.isArray(d) ? d : (d?.projects ?? []);
        if (live && Array.isArray(list)) setProjects(list.map((p) => ({ id: p.id, name: p.name })));
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, []);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId]
  );

  // THE CHAIN. The root segment IS the project, which is what makes
  // cutChainFrom()'s protection meaningful: the kit refuses to cut into a
  // segment of kind "root", so (x) can never leave the user without a project.
  const chain: Chain = useMemo(() => {
    const root = project ? [{ id: project.id, label: project.name, kind: "root" as const }] : [];
    return { mode, segments: [...root, ...segments] };
  }, [mode, project, segments]);

  // Every (x) goes through the kit's clamp. This component never slices the
  // segment array itself -- that is the whole point of the rule living in
  // chain.ts rather than in a component.
  const onCutFrom = useCallback(
    (index: number) => {
      const next = cutChainFrom(chain, index);
      setSegments(next.segments.filter((s) => s.kind !== "root"));
    },
    [chain]
  );

  const onReset = useCallback(() => {
    const next = resetChain(chain);
    setSegments(next.segments.filter((s) => s.kind !== "root"));
  }, [chain]);

  // LOADS AND STOPS. It sets the mode, restores the chain, and navigates --
  // navigation is a read. It does not call any action endpoint, and the
  // ChainLoad it receives has no way to express one.
  const onLoadChain = useCallback(
    (load: ChainLoad) => {
      setMode(load.mode);
      setSegments(load.chain.segments.filter((s) => s.kind !== "root"));
      if (load.route) router.push(load.route);
    },
    [router]
  );

  // TASK MASTER DATA, RECORDED HONESTLY (claude_log id=29, r52-log):
  // M24 rules the source is compliance.pipeline_tasks. R53 has created that
  // table (0 rows) but PROJEXA has no endpoint that can read it -- there is no
  // /api/v1/projexa/tasks (error_log E-120). /api/todos exists but reads a
  // DIFFERENT, older system, and wiring it here would contradict the ruling.
  // So this renders its real empty state until R53 ships the endpoint. It is
  // empty because the ruled source is unreachable, not because it is unfinished.
  const tabs: TaskTab[] = [
    { id: "home", label: "Home", count: 0 },
    { id: "approval-pending", label: "Approval Pending", count: 0 },
    { id: "in-queue", label: "In Queue", count: 0 },
    // M24: Completed and History carry no count -- nothing there needs action.
    { id: "completed", label: "Completed" },
    { id: "history", label: "History" },
  ];
  const [activeTab, setActiveTab] = useState<TaskTab["id"]>("home");

  return (
    <AppShell
      topRail={
        <TopRail
          brand={<span className="text-[13px] font-semibold tracking-tight">PROJEXA</span>}
          organisationName={org?.name ?? "—"}
          project={project}
          onSwitchProject={() => {
            // Cycle through real projects; the null state ("All projects") is
            // part of the cycle because M24 requires it to stay reachable for
            // CRM, pipeline and org-level work.
            if (projects.length === 0) return;
            const i = projects.findIndex((p) => p.id === projectId);
            const next = i === projects.length - 1 ? null : projects[i + 1] ?? projects[0];
            setProjectId(next ? next.id : null);
          }}
        />
      }
      taskMaster={
        <TaskMaster
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          needsYou={[]}
          waitingOnOthers={[]}
          onLoad={onLoadChain}
        />
      }
      composer={
        <Composer
          chain={chain}
          onModeChange={setMode}
          onCutFrom={onCutFrom}
          onHome={() => router.push(HOME_ROUTE)}
          onReset={onReset}
          history={history}
          onLoadChain={onLoadChain}
          value={draft}
          onChange={setDraft}
          // Bands 3+4 stay PROJEXA's working composer for Phase A.
          inputSlot={<VeriComposer />}
        />
      }
    >
      {children}
    </AppShell>
  );
}
