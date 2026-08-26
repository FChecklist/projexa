"use client";

// R52 PHASE A/B/C -- PROJEXA's M24 shell (claude_log id=13, cc_spec 187).
//
// WHAT CHANGES: AppShellFrame + AppSidebar are gone. M24 deletes the left rail
// outright -- "HOME = THE GROUPED MODULE DIRECTORY, rendered in the RIGHT pane.
// It REPLACES the left rail, which is why the rail could be deleted at all."
// Every routed screen renders inside the RIGHT 70% pane, done in the one place
// that governs all 53 routes rather than 53 times.
//
// WHAT DOES NOT CHANGE: VeriComposer keeps its real /api/assistant and
// /api/discuss wiring. It supplies band 4 (INPUT) through the kit Composer's
// inputSlot. Its own mode row was removed in R52 -- see that file's comment --
// because the control strip already owns Mode and M24's band rule forbids the
// same question being asked twice.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Composer,
  PillStrip,
  TaskMaster,
  TopRail,
  cutChainFrom,
  resetChain,
  DEFAULT_CHAIN_MODE,
  UNIVERSAL_PILLS,
  type Chain,
  type ChainLoad,
  type ChainMode,
  type HistoryEntry,
  type PillSelection,
  type PillUsage,
  type TaskTab,
} from "@fchecklist/veridian-ui-kit/shell";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";

// M24: "MODE is sticky WITHIN a session and RESETS to Projects on a new
// session, so nobody returns to a view they forgot they set." sessionStorage is
// exactly that lifetime; localStorage would survive the session and break it.
const MODE_KEY = "veri.chain.mode";
const HISTORY_KEY = "veri.chain.history";
const PILL_USAGE_KEY = "veri.pill.usage";

type OrgInfo = { organization?: { id: string; name: string }; role?: string; email?: string };
type Project = { id: string; name: string };

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pillUsage, setPillUsage] = useState<PillUsage[]>([]);
  const [showAllPills, setShowAllPills] = useState(false);
  const [draft, setDraft] = useState("");
  const [counts, setCounts] = useState<{ home: number; approval: number; queue: number }>({
    home: 0,
    approval: 0,
    queue: 0,
  });

  useEffect(() => {
    try {
      const m = sessionStorage.getItem(MODE_KEY) as ChainMode | null;
      if (m) setMode(m);
      const h = sessionStorage.getItem(HISTORY_KEY);
      if (h) setHistory(JSON.parse(h) as HistoryEntry[]);
      const p = localStorage.getItem(PILL_USAGE_KEY);
      if (p) setPillUsage(JSON.parse(p) as PillUsage[]);
    } catch {
      // A blocked or unavailable storage must not take the shell down.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(MODE_KEY, mode);
    } catch {}
  }, [mode]);

  // Org + projects for the top rail. Read the STATUS before the body: an error
  // body parses perfectly well as JSON, and treating it as data is how a failed
  // request becomes a confident-looking empty state.
  //
  // R52 FIX: this previously read `d.id` and so always rendered the org as an
  // em-dash on the live shell. /api/organization returns
  // { organization, role, email } -- the name is one level down. Confirmed
  // against src/app/api/organization/route.ts:26 rather than guessed.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/organization");
        if (!res.ok) return;
        const d = (await res.json()) as OrgInfo;
        if (live && d?.organization?.name) setInfo(d);
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

  // M24: "HEADER TABS WITH LIVE COUNTS ... Counts so the user knows before
  // clicking." The ruled source is compliance.pipeline_tasks (NOT
  // compliance.tasks, a different older system with 1,913 rows). PROJEXA has no
  // endpoint that reads it yet -- error_log E-120, and R53's handshake
  // (claude_log id=28) confirms the table is live with 0 rows and the read API
  // is still to come. The wiring is here and correct, so the counts light up
  // the moment that endpoint exists; until then a failed fetch leaves them at
  // zero and no badge renders. Deliberately NOT wired to /api/todos, which
  // exists but reads the wrong system and would contradict the ruling.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/tasks/counts");
        if (!res.ok) return;
        const d = await res.json();
        if (!live) return;
        setCounts({
          home: Number(d?.home) || 0,
          approval: Number(d?.approvalPending) || 0,
          queue: Number(d?.inQueue) || 0,
        });
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, []);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  // THE CHAIN. The root segment IS the project, which is what makes the kit's
  // cutChainFrom() protection meaningful: it refuses to cut into a "root"
  // segment, so (x) can never leave the user without a project.
  const chain: Chain = useMemo(() => {
    const root = project ? [{ id: project.id, label: project.name, kind: "root" as const }] : [];
    return { mode, segments: [...root, ...segments] };
  }, [mode, project, segments]);

  // Every (x) goes through the kit's clamp. This component never slices the
  // segment array itself -- the whole point of the rule living in chain.ts.
  const onCutFrom = useCallback(
    (index: number) => {
      setSegments(cutChainFrom(chain, index).segments.filter((s) => s.kind !== "root"));
    },
    [chain]
  );

  const onReset = useCallback(() => {
    setSegments(resetChain(chain).segments.filter((s) => s.kind !== "root"));
  }, [chain]);

  // LOADS AND STOPS. Sets the mode, restores the chain, navigates. Navigation
  // is a read. It calls no action endpoint, and the ChainLoad it receives has
  // no way to express one.
  const onLoadChain = useCallback(
    (load: ChainLoad) => {
      setMode(load.mode);
      setSegments(load.chain.segments.filter((s) => s.kind !== "root"));
      if (load.route) router.push(load.route);
    },
    [router]
  );

  // A pill click records usage (so MP-RULE-3 can rank it) and appends the
  // module to the chain. It does NOT execute: PillSelection carries
  // authorizes:false and has no callable member.
  const onPillSelect = useCallback((sel: PillSelection) => {
    setPillUsage((prev) => {
      const now = Date.now();
      const existing = prev.find((r) => r.pillKey === sel.pillKey);
      const next = existing
        ? prev.map((r) =>
            r.pillKey === sel.pillKey ? { ...r, useCount: r.useCount + 1, lastUsedAt: now } : r
          )
        : [...prev, { pillKey: sel.pillKey, useCount: 1, lastUsedAt: now, pinned: false }];
      try {
        localStorage.setItem(PILL_USAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setSegments((prev) =>
      prev.some((s) => s.id === sel.pillKey) ? prev : [...prev, { id: sel.pillKey, label: sel.label, kind: "action" as const }]
    );
  }, []);

  const onTogglePin = useCallback((key: PillUsage["pillKey"]) => {
    setPillUsage((prev) => {
      const existing = prev.find((r) => r.pillKey === key);
      const next = existing
        ? prev.map((r) => (r.pillKey === key ? { ...r, pinned: !r.pinned } : r))
        : [...prev, { pillKey: key, useCount: 0, lastUsedAt: Date.now(), pinned: true }];
      try {
        localStorage.setItem(PILL_USAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const tabs: TaskTab[] = [
    { id: "home", label: "Home", count: counts.home },
    { id: "approval-pending", label: "Approval Pending", count: counts.approval },
    { id: "in-queue", label: "In Queue", count: counts.queue },
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
          organisationName={info?.organization?.name ?? "—"}
          project={project}
          onSwitchProject={() => {
            // Cycles through real projects and back through the null state.
            // M24: "THE PROJECT SELECTOR NEEDS A NULL STATE ('All projects') so
            // CRM, pipeline and org-level work are reachable."
            if (projects.length === 0) return;
            const i = projects.findIndex((p) => p.id === projectId);
            const next = i === projects.length - 1 ? null : (projects[i + 1] ?? projects[0]);
            setProjectId(next ? next.id : null);
          }}
          search={<SearchTrigger />}
          alerts={<NotificationBell />}
          account={<AccountMenu email={info?.email} />}
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
          // BAND 3 -- the ranked pill set. M24 keeps all 14 universal pills but
          // shows "their top five or six ... That IS the load reduction", so the
          // strip renders the ranked top 6 with an explicit way to see the rest.
          // Without that affordance the remaining modules would be unreachable
          // from here, which is a dead end, and M24 forbids dead ends.
          pills={
            <div className="flex flex-wrap items-center gap-1">
              <PillStrip
                usage={pillUsage}
                now={Date.now()}
                onSelect={onPillSelect}
                onTogglePin={onTogglePin}
                limit={showAllPills ? UNIVERSAL_PILLS.length : 6}
              />
              <button
                type="button"
                onClick={() => setShowAllPills((v) => !v)}
                className="veri-mode-pill"
                style={{ color: "var(--color-ct-muted)" }}
              >
                {showAllPills ? "Show fewer" : "More modules"}
              </button>
            </div>
          }
          // BAND 4 -- PROJEXA's own working input.
          inputSlot={<VeriComposer />}
        />
      }
    >
      {children}
    </AppShell>
  );
}
