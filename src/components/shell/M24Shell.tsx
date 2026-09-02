"use client";

// R52 PHASE A/B/C -- PROJEXA's M24 shell (claude_log id=13, cc_spec 187).
//
// WHAT CHANGES: AppShellFrame + AppSidebar are gone. M24 deletes the left rail
// outright -- "HOME = THE GROUPED MODULE DIRECTORY, rendered in the RIGHT pane.
// It REPLACES the left rail, which is why the rail could be deleted at all."
// Every routed screen renders inside the RIGHT 70% pane, done in the one place
// that governs all 53 routes rather than 53 times.
//
// THE COMPOSER IS NOW THE KIT'S OWN, END TO END. It was briefly VeriComposer
// mounted through inputSlot, which was the right call while R53's task surface
// did not exist -- adopting the frame without rebuilding a working composer.
// R53 has since shipped POST /api/v1/projexa/tasks (handshake, claude_log
// id=35), which takes BOTH the typed shape { rawInput } and the pill shape
// { functionId, params }. One endpoint for both input modes means ONE input
// and ONE Send, which is what M24's band rule actually asks for; two would be
// the same duplication the mode row was removed for.
//
// VeriComposer is NOT orphaned: /copilot still mounts it, so the
// /api/assistant and /api/discuss paths keep a live home and VeriChatProvider
// is still required by this layout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  COMPOSER_PILLS_BAND_RESERVE,
  TaskMaster,
  TopRail,
  cutChainFrom,
  resetChain,
  DEFAULT_CHAIN_MODE,
  UNIVERSAL_PILLS,
  type Chain,
  type ChainLoad,
  type ChainMode,
  type PillSelection,
  type PillUsage,
  type RankedPill,
  type TaskRow,
  type TaskTab,
} from "@fchecklist/veridian-ui-kit/shell";
// R67 A-01 / decision D-09: the composer, its control strip and its pill strip
// are PROJEXA's own forks now (src/components/shell/), because the programme
// changes their behaviour and the kit is a pinned dependency whose source is
// not in this repo. Everything the programme does NOT change -- AppShell,
// TaskMaster, the chain functions, the tokens -- still comes from the kit
// above, so the fork stays as small as the change requires.
//
// LANE G FORKED THE SAME TWO FILES (r67(G) #229, colour-signage-tokens) and
// this branch rebases on top of it, so both lanes' reasons for forking now
// live in one file. G's two are kept: the Send button's white-on-saffron text
// (2.60:1, a WCAG AA failure on the most-clicked control in the product) is
// navy on saffron here too, and G's rule that there is NO state in which Send
// is dead and unexplained is kept and strengthened -- see the Composer props
// below, where A-19 moves that sentence into the button's own label.
import { Composer } from "./Composer";
import { PillStrip } from "./PillStrip";
import { useShellScreen } from "./shell-screen-context";
import { canSend as canSendFrom, composerInstruction } from "@/lib/composer-instruction";
import {
  chainModuleForPathname,
  chainOptionsFor,
  moduleForPathname,
  moduleForPill,
  moduleHref,
  noProjectPromptFor,
  pillPointsAtCurrentScreen,
  type ModuleDef,
  type ModuleLeaf,
} from "@/lib/module-catalogue";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";
import { createClient } from "@/lib/supabase/client";

// M24: "MODE is sticky WITHIN a session and RESETS to Projects on a new
// session, so nobody returns to a view they forgot they set." sessionStorage is
// exactly that lifetime; localStorage would survive the session and break it.
const MODE_KEY = "veri.chain.mode";
const PILL_USAGE_KEY = "veri.pill.usage";

// R67 A-01. HISTORY_KEY ("veri.chain.history") is GONE, and with it the
// composer's HISTORY drop. Two facts made it indefensible: (a) two controls on
// one screen were called History -- the drop and the Task Master tab -- which
// is the duplicate-control finding correction C-03 left standing after
// withdrawing the separate "it covers the tabs" claim; and (b) nothing in this
// repo ever WROTE that key. `setHistory` was called in exactly one place, the
// hydration effect, so the drop rendered an empty list on every screen for its
// whole life. Loading a previous chain now lives where a user already looks
// for it -- the Task Master's own History tab, fed by real pipeline_tasks rows
// -- and keeps the same load-and-stop contract.

// R55_BUDGETS_TAB_NOT_IN_URL_01 / R55_SCHEDULE_TAB_NOT_IN_URL_01: the Task
// Master status tabs (Home/Approval Pending/In Queue/Completed/History)
// live in this ONE shell that wraps all 53 app routes, so the URL param
// lives here too rather than in any one page.
const TASK_TAB_PARAM = "taskTab";
const TASK_TAB_IDS = ["home", "approval-pending", "in-queue", "completed", "history"] as const;

type OrgInfo = { organization?: { id: string; name: string }; role?: string; email?: string };

// R53's task shape, from GET /api/v1/projexa/tasks (contract: claude_log id=35).
type ApiTask = {
  id: string;
  projectId?: string | null;
  derivedChain?: { full?: string; mode?: string; root?: string; steps?: string[] } | null;
  functionId?: string | null;
  status?: string | null;
  error?: string | null;
  rawInput?: string | null;
  mode?: string | null;
  /** Real column on compliance.pipeline_tasks, selected by the route's own
   *  query and already ordered desc -- used by the History tab's dedup. */
  createdAt?: string | null;
};
type ApiTasks = {
  counts?: { needsYou?: number; running?: number; done?: number; blocked?: number; total?: number };
  groups?: { needsYou?: ApiTask[]; running?: ApiTask[]; done?: ApiTask[]; blocked?: ApiTask[] };
  tasks?: ApiTask[];
};

// M24: "Line 1 must START WITH A VERB from a CLOSED SET ... Six words the user
// learns once." Task names are system-generated, which is exactly why the
// convention is enforceable. The verb is derived from the functionId rather
// than from free text, so it can never drift outside the set.
function verbFor(functionId?: string | null): TaskRow["verb"] {
  const f = (functionId ?? "").toLowerCase();
  if (f.startsWith("record_") || f.includes("progress")) return "Record";
  if (f.startsWith("import_") || f.includes("import")) return "Import";
  if (f.includes("approve")) return "Approve";
  if (f.includes("confirm")) return "Confirm";
  if (f.includes("sign")) return "Sign off";
  return "Review";
}

function toTaskRow(
  t: ApiTask,
  group: "needsYou" | "running" | "done" | "blocked",
  railProjectId: string | null
): TaskRow {
  const steps = t.derivedChain?.steps ?? [];
  const root = t.derivedChain?.root ?? null;
  // R67 A-01. A Task Master row now carries a real destination, so loading a
  // chain from the History tab opens the screen it belongs to instead of
  // restoring segments over whatever screen happens to be on show. The module
  // is resolved from PROJEXA's own catalogue (the pipeline's NAV_PATH_BY_
  // FUNCTION lives server-side and is not in this payload); a task whose module
  // this build does not know simply gets no route, which loadChain() already
  // treats as "restore the chain and stop".
  const mod = moduleForPill(t.functionId ?? steps[0] ?? "", steps[0]);
  const route = mod ? moduleHref({ path: mod.route }, t.projectId ?? railProjectId) : undefined;
  // M24's four glyphs are needs-you / running / waiting / done. A BLOCKED task
  // is one that needs you -- it is stuck on a decision or a correction only
  // the user can make -- so it takes the needs-you glyph and the loud pill.
  const state: TaskRow["state"] =
    group === "done" ? "done" : group === "running" ? "running" : "needs-you";
  return {
    id: t.id,
    state,
    verb: verbFor(t.functionId),
    // The chain's steps read as the object of the sentence: "Record Work
    // Progress > New entry". Falling back to the functionId is deliberate --
    // a row with no label at all would be worse than a technical one.
    object: steps.length ? steps.join(" > ") : (t.functionId ?? "task"),
    // M24: "line 2 is the DECIDING information - without it the user clicks in
    // to find out, which is the load being removed." R53 says render the
    // backend's OWN words on a blocked row; never a generic failure.
    detail: t.error ?? t.rawInput ?? undefined,
    urgency: group === "blocked" ? "late" : group === "done" ? "done" : "later",
    urgencyLabel: group === "blocked" ? "blocked" : group === "done" ? "done" : "queued",
    route,
    chain: {
      mode: (t.mode?.toLowerCase() as ChainMode) ?? DEFAULT_CHAIN_MODE,
      segments: [
        ...(root ? [{ id: t.projectId ?? root, label: root, kind: "root" as const }] : []),
        ...steps.map((label, i) => ({ id: `${t.id}-s${i}`, label, kind: "step" as const })),
      ],
    },
  };
}
type Project = { id: string; name: string };

/** Every task the shell has read, kept raw so each Task Master tab can render
 *  the rows that actually belong to it rather than all of them five times. */
type TaskGroups = {
  needsYou: ApiTask[];
  running: ApiTask[];
  done: ApiTask[];
  blocked: ApiTask[];
  /** The full list, newest first, exactly as the route ordered it. */
  all: ApiTask[];
};

const NO_TASKS: TaskGroups = { needsYou: [], running: [], done: [], blocked: [], all: [] };

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // R67 A-01: the composer must know which screen it is serving, so it can
  // stop offering the screen the user is already standing on.
  const pathname = usePathname();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // The RAIL's own selection. It is no longer the only answer to "which
  // project": a screen that resolved one from the URL outranks it (A-03).
  const [railProjectId, setRailProjectId] = useState<string | null>(null);
  const [pillUsage, setPillUsage] = useState<PillUsage[]>([]);
  const [rankedPills, setRankedPills] = useState<RankedPill[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroups>(NO_TASKS);
  const [tasksError, setTasksError] = useState<string | null>(null);
  // What the SHELL itself could not load, separate from the task read.
  const [shellErrors, setShellErrors] = useState<{ what: string; detail: string }[]>([]);
  // The function the user picked via a pill. When set, submitting takes
  // R53's PILL PATH: { functionId, params } -- no classifier, no model call
  // ever. When null, the typed path { rawInput } is used and the server
  // classifies. Both are the same endpoint.
  const [pendingFunctionId, setPendingFunctionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // R67 A-02: a leaf that needs a project and has none says so, in the
  // module's own words, instead of navigating to a screen that would then have
  // to explain itself.
  const [projectPrompt, setProjectPrompt] = useState<string | null>(null);
  const pillFnRef = useRef<Record<string, string>>({});
  // The top rail's DOM, so a click that needs a project can send the user to
  // the control that chooses one (A-03) instead of only saying "no".
  const railRef = useRef<HTMLDivElement>(null);
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
  //
  // R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01. Reading the status was
  // only half the job. `if (!res.ok) return;` reads it and then DROPS it, so
  // these two failures were invisible on every screen in the product -- the
  // task read beside them already reports itself (tasksError, below), but a
  // failed org or projects read said nothing at all. The user could not tell
  // the shell was degraded, and the top rail simply rendered an em-dash for
  // the organisation and an empty project switcher as if that were the answer.
  //
  // Now recorded with the backend's OWN message and shown in the Task Master
  // pane alongside tasksError, which is the one place in the shell that
  // already owns "something did not load".
  const noteFailure = useCallback((what: string, detail: string) => {
    setShellErrors((prev) => (prev.some((e) => e.what === what) ? prev : [...prev, { what, detail }]));
  }, []);

  // F_025 fix: this used to run exactly once, inline in the mount effect
  // below, with no way to re-invoke it. That made the account menu's
  // identity a snapshot of whoever was signed in at the moment THIS TAB
  // first mounted -- reproduced live: sign in as user A in one tab (menu
  // correctly shows A), then in a SEPARATE tab of the SAME browser sign in
  // as user B (Supabase's cookie-backed session is shared per-origin, so
  // this silently replaces A's session for every open tab). The first tab,
  // never having re-fetched, went on showing A indefinitely -- while a
  // fresh `fetch("/api/organization")` issued from that exact same tab
  // (same cookies) correctly returned B, because that route always reads
  // the CURRENT request's session fresh. The mismatch was never in
  // /api/organization or requireAuth() (both were already correct, per
  // that route's `email: ctx.user!.email` straight off the verified JWT) --
  // it was this component's `info` state going stale relative to the
  // session that now owns the tab. Extracted to a stable callback so it can
  // be re-run below on any Supabase auth-state change, not just on mount.
  const loadOrgInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/organization");
      const d = (await res.json().catch(() => null)) as (OrgInfo & { error?: string }) | null;
      if (!res.ok) {
        noteFailure("your organisation", d?.error || `HTTP ${res.status}`);
        return;
      }
      if (d?.organization?.name) setInfo(d);
    } catch (err) {
      noteFailure("your organisation", err instanceof Error ? err.message : "the request did not complete");
    }
  }, [noteFailure]);

  useEffect(() => {
    let live = true;
    void loadOrgInfo();
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          if (live) noteFailure("your projects", d?.error || `HTTP ${res.status}`);
          return;
        }
        const list: Project[] = Array.isArray(d) ? d : (d?.projects ?? []);
        if (live && Array.isArray(list)) {
          setProjects(list.map((p) => ({ id: p.id, name: p.name })));
          // Only a REAL, successful read can say the org has no projects. An
          // empty list before the call answers must never produce the "Create
          // a project first" sentence -- that would be a confident empty state
          // standing in for "not loaded yet", the exact defect this shell has
          // been corrected for twice already.
          setProjectsLoaded(true);
        }
      } catch (err) {
        if (live) noteFailure("your projects", err instanceof Error ? err.message : "the request did not complete");
      }
    })();
    return () => {
      live = false;
    };
  }, [noteFailure, loadOrgInfo]);

  // F_025: re-run the identity fetch whenever THIS tab's own Supabase client
  // reports a session change -- a sign-in/sign-out in this same tab (also
  // covers a token silently refreshing to the same user; re-fetching then
  // is a harmless no-op, not a reason to special-case which events fire).
  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        void loadOrgInfo();
      } else if (event === "SIGNED_OUT") {
        setInfo(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadOrgInfo]);

  // F_025, second half of the fix: onAuthStateChange above only catches a
  // session change that THIS tab's own GoTrueClient instance initiated or
  // observed. It does NOT cover the reproduction that actually matched the
  // fault report -- @supabase/ssr's browser client persists the session via
  // cookies, not localStorage, so the OTHER-tab-signed-in-as-someone-else
  // case (GoTrueClient's multi-tab sync is a `window` `storage` event
  // listener, which only fires for localStorage/sessionStorage writes, never
  // for a cookie set by another tab) leaves this tab's `info` state stale
  // with no event of any kind to react to, even though the cookie -- and
  // therefore every server-verified read, including this exact tab's own
  // fetch("/api/organization") -- has already moved on. Re-validating on
  // focus/visibility closes that gap the same way every other "did the data
  // under me change while I wasn't looking" case is handled: don't trust a
  // long-idle tab's state, confirm it against the server the moment a human
  // actually looks at it again.
  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") void loadOrgInfo();
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [loadOrgInfo]);

  // M24: "HEADER TABS WITH LIVE COUNTS ... Counts so the user knows before
  // clicking." Both the counts and the rows come from ONE call to
  // GET /api/tasks, which proxies VERIDIAN's /api/v1/projexa/tasks. R53's
  // handshake (claude_log id=35) is explicit that counts and groups are the
  // SAME rows -- which is why the tabs can never disagree with the list under
  // them. Reading counts from a second endpoint is how those two drift.
  //
  // The source is compliance.pipeline_tasks, as M24 rules -- NOT
  // compliance.tasks, the older 1,913-row system that /api/todos reads.
  // Extracted from the effect so a successful submit can call it again. The
  // final step of R-80 is that the minted task APPEARS in Task Master, and a
  // list that only loads once on mount cannot show that.
  const loadTasks = useCallback(async () => {
    {
      try {
        const res = await fetch("/api/tasks?limit=50");
        // Status before body: an error body parses perfectly well as JSON, and
        // treating it as data is how a failed request becomes a confident
        // empty list.
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          setTasksError(
            d && typeof d.error === "string" && d.error.trim() ? d.error : `Couldn't load tasks (HTTP ${res.status})`
          );
          return;
        }
        const data = (d ?? {}) as ApiTasks;
        setTasksError(null);
        setCounts({
          home: Number(data.counts?.total) || 0,
          approval: Number(data.counts?.needsYou) || 0,
          queue: Number(data.counts?.running) || 0,
        });
        const g = data.groups ?? {};
        // R67 A-01: kept RAW. The rows a tab shows are now derived per tab
        // (below), because the five header tabs used to be pure decoration --
        // every one of them rendered the same two lists, so clicking
        // "Completed" changed nothing on screen.
        setTaskGroups({
          needsYou: g.needsYou ?? [],
          running: g.running ?? [],
          done: g.done ?? [],
          blocked: g.blocked ?? [],
          all: data.tasks ?? [],
        });
      } catch {
        setTasksError("Couldn't reach the task service.");
      }
    }
  }, []);

  useEffect(() => {
    let live = true;
    void loadTasks();

    // The pill strip's ranking. R53 returns it ALREADY RANKED -- rendered in
    // order, never re-sorted here. isNewUser true means "nothing earned yet",
    // which must not look like a failed call.
    //
    // R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01 (reopened): this was
    // `if (!res.ok) return;` / `catch {}` -- the same silent-swallow the
    // org/projects effect above was fixed for in the first PR, just never
    // applied here. Same noteFailure() pattern, same shape: status read
    // before the body is treated as data, the backend's own message kept.
    (async () => {
      try {
        const res = await fetch("/api/pill-usage?limit=6");
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          if (live) noteFailure("your ranked modules", d?.error || `HTTP ${res.status}`);
          return;
        }
        if (live && Array.isArray(d?.pills)) {
          setRankedPills(d.pills as RankedPill[]);
          // R53's payload carries functionId per pill. Held in a ref so the
          // submit handler can read it without re-rendering the strip.
          pillFnRef.current = Object.fromEntries(
            (d.pills as { pillKey: string; functionId?: string }[])
              .filter((x) => x.functionId)
              .map((x) => [x.pillKey, x.functionId as string])
          );
        }
      } catch (err) {
        if (live) noteFailure("your ranked modules", err instanceof Error ? err.message : "the request did not complete");
      }
    })();

    return () => {
      live = false;
    };
  }, [noteFailure]);

  // R67 A-03 -- ONE PROJECT, AND THE SCREEN'S ANSWER WINS.
  //
  // A module page resolves its project on the server (the ?projectId= if there
  // is one, else the org's first) and renders that project's data. Before this,
  // the shell kept its own independent `projectId`, set only by the rail, so
  // the pane could be showing Cedar Heights' meetings while the rail said "All
  // projects" and the composer refused to send for want of a project. The
  // screen's own published answer is now the root, and the rail's selection is
  // the fallback for screens that publish nothing (a settings page, a 404).
  //
  // A publication is only trusted for the pathname it names -- see
  // shell-screen-context.tsx for why that is what makes it order-independent.
  const publishedScreen = useShellScreen();
  const routeScreen = publishedScreen.pathname === pathname ? publishedScreen : null;
  const railProject = useMemo(
    () => projects.find((p) => p.id === railProjectId) ?? null,
    [projects, railProjectId]
  );
  const project = routeScreen?.project ?? railProject;
  const projectId = project?.id ?? null;

  // R67 A-04 -- THE RAIL ADMITS AN AUTOMATIC CHOICE.
  //
  // When no URL and no rail selection said which project, the page picked one
  // (resolveSelectedProject's fallback) and rendered its data. Showing that
  // name plain would present a guess as the user's own decision -- and logging
  // progress against the wrong project is, in M24's own words, the most
  // expensive mistake available in this product. So the rail says
  // "<name> (auto-selected)" until someone actually chooses. The STRIP keeps
  // the plain name: it is a sentence about the work, not a claim about who
  // decided.
  const railLabelProject = useMemo(() => {
    if (!project) return null;
    return routeScreen?.source === "auto" ? { id: project.id, name: `${project.name} (auto-selected)` } : project;
  }, [project, routeScreen?.source]);

  // R67 A-01/A-02 -- THE SCREEN THE COMPOSER IS SERVING.
  //   screenModule    answers "which module do these pills belong to", and so
  //                   also "which pill would only point back at this screen".
  //   chainModule     answers "what does the strip already say" -- the same
  //                   module, except on the Dashboard, which IS the module
  //                   directory rather than a module ("Dashboard >" is not the
  //                   start of a sentence anyone finishes).
  const screenModule = useMemo(() => moduleForPathname(pathname ?? ""), [pathname]);
  const chainModule = useMemo(() => chainModuleForPathname(pathname ?? ""), [pathname]);

  // THE CHAIN. The root segment IS the project, which is what makes the kit's
  // cutChainFrom() protection meaningful: it refuses to cut into a "root"
  // segment, so (x) can never leave the user without a project.
  //
  // R67 A-02: the screen's own module is a FIXED part of the sentence, not
  // something the user chose and can therefore remove -- you are standing in
  // it. It is carried as a second "root" segment, which gets the two
  // behaviours it needs for free: canCutAt() refuses to offer it an ×, and
  // cutChainFrom()'s floor moves past it, so removing a later step can never
  // strip the screen's own context out of the strip.
  const chain: Chain = useMemo(() => {
    const root = project ? [{ id: project.id, label: project.name, kind: "root" as const }] : [];
    const mod = chainModule
      ? [{ id: `screen:${chainModule.id}`, label: chainModule.label, kind: "root" as const }]
      : [];
    return { mode, segments: [...root, ...mod, ...segments] };
  }, [mode, project, chainModule, segments]);

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

  // Usage is recorded on every pill and leaf click, so MP-RULE-3 can rank the
  // strip from what this user actually does. It is deliberately separate from
  // what the click DOES -- ranking must not depend on whether the click
  // navigated, and navigating must not depend on whether ranking worked.
  const bumpUsage = useCallback((pillKey: string) => {
    setPillUsage((prev) => {
      const now = Date.now();
      const existing = prev.find((r) => r.pillKey === pillKey);
      const next = existing
        ? prev.map((r) => (r.pillKey === pillKey ? { ...r, useCount: r.useCount + 1, lastUsedAt: now } : r))
        : [...prev, { pillKey: pillKey as PillUsage["pillKey"], useCount: 1, lastUsedAt: now, pinned: false }];
      try {
        localStorage.setItem(PILL_USAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // A pill click records usage and OPENS THE MODULE. It does NOT execute:
  // PillSelection carries authorizes:false and has no callable member.
  //
  // R67 A-02 -- THE TEXT SEEDING IS DELETED. A first-time pill click used to
  // type its own label into the box ("Permits", "Reports") and leave it there
  // for the classifier to interpret. It was a real fix for a real dead end --
  // Send did nothing at all before it -- but it makes the composer write words
  // the user did not, and it sends a module NAME to a classifier when the
  // module already has a real screen. A pill now goes where its name goes:
  // the module's own route, carrying the current project, which is the same
  // URL the screen's own header button produces. The same name reaches the
  // same destination whichever path you took, and the box stays the user's.
  const onPillSelect = useCallback(
    (sel: PillSelection) => {
      bumpUsage(sel.pillKey);
      // Arm the pill path when -- and only when -- the server told us this
      // pill maps to a real executable function. R53: picking the function
      // means the server does NOT need to classify, so the submission costs no
      // model call at all. pillFnRef is populated from /api/pill-usage's own
      // payload; a pill it does not name is a category entry point, not a
      // zero-parameter function, and is opened rather than armed.
      const knownFunctionId = pillFnRef.current[sel.pillKey] ?? null;
      setPendingFunctionId(knownFunctionId);
      setSegments((prev) =>
        prev.some((s) => s.id === sel.pillKey)
          ? prev
          : [...prev, { id: sel.pillKey, label: sel.label, kind: "action" as const }]
      );
      if (knownFunctionId) return;
      const mod = moduleForPill(sel.pillKey, sel.label);
      if (!mod) return; // a pill with no PROJEXA screen: nothing to open, nothing typed.
      setProjectPrompt(null);
      router.push(moduleHref({ path: mod.route }, projectId));
    },
    [bumpUsage, projectId, router]
  );

  // R67 A-03 -- ASK FOR THE PROJECT WHERE THE PROJECT IS CHOSEN. A click that
  // cannot proceed without a project says so in the module's own words AND
  // moves keyboard focus to the rail's project control, so the next keystroke
  // is the one that fixes it. Telling a user "no" and leaving them where they
  // were is how a dead end feels.
  const requestProject = useCallback((reason: string) => {
    setProjectPrompt(reason);
    const control = railRef.current?.querySelector<HTMLButtonElement>(
      'button[aria-label*="choose a project"], button[aria-label*="switch project"]'
    );
    control?.focus();
  }, []);

  // R67 A-02 -- THE SECOND LEVEL, as real routes. A leaf is the module's own
  // verb ("New", "Expiring soon", "Open") and it navigates to exactly the URL
  // the screen's own control produces. It never executes and never types.
  const onLeafSelect = useCallback(
    (mod: ModuleDef, leaf: ModuleLeaf) => {
      bumpUsage(leaf.id);
      if (leaf.needsProject !== false && !projectId) {
        // No fail-after-click and no silent no-op: say which decision is
        // missing, in the module's own words, and send the user to the rail.
        requestProject(noProjectPromptFor(mod));
        return;
      }
      setProjectPrompt(null);
      setSegments((prev) =>
        prev.some((s) => s.id === leaf.id) ? prev : [...prev, { id: leaf.id, label: leaf.label, kind: "step" as const }]
      );
      router.push(moduleHref(leaf, projectId));
    },
    [bumpUsage, projectId, requestProject, router]
  );

  // THE SUBMIT. R53's POST /api/v1/projexa/tasks takes EITHER shape, so there
  // is ONE input and ONE Send -- which is what M24's band rule requires.
  //
  // *** verdict IS PER TASK, NOT PER SUBMISSION. *** One message can return one
  // "task" and one "chat". R53 records that collapsing them into a single
  // verdict is the exact defect it removed -- a submission silently dropped
  // half of what the user asked for. So the result is never reduced to one
  // outcome here; the minted tasks are re-read from the list instead.
  const onSubmit = useCallback(async () => {
    if (submitting) return;
    const typed = draft.trim();
    if (!typed && !pendingFunctionId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // R67 A-03 -- THE MODULE HINT TRAVELS WITH THE SUBMISSION. When the user
      // types inside a module, the module is a fact about what they meant, and
      // the endpoint already has a field for it: `selectedChain`, which
      // POST /api/v1/projexa/tasks stores on the submission row.
      //
      // HONEST LIMIT, stated rather than implied: the pipeline deliberately
      // does NOT consult selectedChain when classifying today -- run-submission
      // .ts records that M25 calls it a HINT and M26 rules the phrase is the
      // authority. So this makes the hint real and recorded; making the
      // classifier PREFER a module's functions is a change to the pipeline and
      // belongs to WS-B's item, not to the shell.
      const hint = chainModule
        ? { module: chainModule.id, label: chainModule.label, route: chainModule.route }
        : undefined;
      const body = pendingFunctionId
        ? { functionId: pendingFunctionId, params: {}, mode, projectId, selectedChain: hint }
        : { rawInput: typed, mode, projectId, selectedChain: hint };
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Status before body: an error body parses fine and is truthy.
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setSubmitError(
          d && typeof d.error === "string" && d.error.trim() ? d.error : `Submit failed (HTTP ${res.status})`
        );
        return;
      }
      setDraft("");
      setPendingFunctionId(null);
      // The minted task must APPEAR. That is the last step of R-80 and the
      // only part of the path a unit test cannot stand in for.
      await loadTasks();
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, pendingFunctionId, mode, projectId, chainModule, submitting, loadTasks]);

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

  // R55_BUDGETS_TAB_NOT_IN_URL_01: the tab was pure local state, never
  // written to the URL -- a hard reload always fell back to "home", the
  // filter could not be shared or bookmarked, and browser back/forward did
  // nothing. Read on mount (covers the reload) and on `popstate` (covers
  // back/forward); "home" is the default and is kept OUT of the URL rather
  // than written as ?taskTab=home.
  useEffect(() => {
    const readTabFromUrl = () => {
      const raw = new URLSearchParams(window.location.search).get(TASK_TAB_PARAM);
      setActiveTab(raw && (TASK_TAB_IDS as readonly string[]).includes(raw) ? (raw as TaskTab["id"]) : "home");
    };
    readTabFromUrl();
    window.addEventListener("popstate", readTabFromUrl);
    return () => window.removeEventListener("popstate", readTabFromUrl);
  }, []);

  // Writes the other direction: a click updates the URL (so it is shareable
  // and bookmarkable) in addition to the local state TaskMaster renders from.
  const onTabChange = useCallback(
    (id: TaskTab["id"]) => {
      setActiveTab(id);
      const params = new URLSearchParams(window.location.search);
      if (id === "home") {
        params.delete(TASK_TAB_PARAM);
      } else {
        params.set(TASK_TAB_PARAM, id);
      }
      const qs = params.toString();
      router.push(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router]
  );

  // R67 A-01 -- THE TABS NOW FILTER, and the History tab is the ONE History.
  //
  // Before this, all five tabs rendered the identical two lists: the shell
  // computed "needs you" and "waiting on others" once and passed them whatever
  // was selected, so clicking Completed or History changed the underline and
  // nothing else. That is what made a second History control in the composer
  // look necessary. It is not: History is a real view of real rows.
  //
  // HISTORY = "things I do", deduplicated by the chain sentence with the most
  // recent occurrence winning -- M24's own rule for the drop this replaces
  // ("Running Daily entry six times leaves ONE row"), including FAILED chains,
  // because the commonest reason to re-run something is that it went wrong.
  // The rows are already newest-first: the route orders by created_at desc.
  const { needsYouRows, waitingRows } = useMemo(() => {
    const rows = (list: ApiTask[], group: "needsYou" | "running" | "done" | "blocked") =>
      list.map((t) => toTaskRow(t, group, projectId));
    switch (activeTab) {
      case "approval-pending":
        return { needsYouRows: rows(taskGroups.needsYou, "needsYou"), waitingRows: [] };
      case "in-queue":
        return { needsYouRows: [], waitingRows: rows(taskGroups.running, "running") };
      case "completed":
        return { needsYouRows: [], waitingRows: rows(taskGroups.done, "done") };
      case "history": {
        const seen = new Set<string>();
        const unique: TaskRow[] = [];
        for (const t of taskGroups.all) {
          const group: "needsYou" | "running" | "done" | "blocked" =
            t.status === "done"
              ? "done"
              : t.status === "in_progress"
                ? "running"
                : t.status === "blocked"
                  ? "blocked"
                  : "needsYou";
          const row = toTaskRow(t, group, projectId);
          const key = `${row.verb} ${row.object}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(row);
        }
        return { needsYouRows: [], waitingRows: unique };
      }
      default:
        return {
          // "Needs you" carries what is stuck on the user: blocked first,
          // because a blocked row is the only loud one and the one that costs
          // time.
          needsYouRows: [...rows(taskGroups.blocked, "blocked"), ...rows(taskGroups.needsYou, "needsYou")],
          // "Waiting on others" is everything not on the user's desk.
          waitingRows: [...rows(taskGroups.running, "running"), ...rows(taskGroups.done, "done")],
        };
    }
  }, [activeTab, taskGroups, projectId]);

  // R67 A-02 -- NO STALE CHAIN ACROSS A MODULE CHANGE.
  //
  // The strip used to carry whatever the user had built on the LAST screen: a
  // chain reading "Work Progress x > New entry x" sat under the Permits
  // heading, describing a task that belonged to another module, with the (x)
  // controls still offering to edit it. When the module the user is standing
  // in changes, the segments and the draft belonged to the old sentence and
  // are cleared; the new screen's own module is then already in the strip,
  // because it is derived from the pathname rather than clicked into place.
  const lastModuleRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = screenModule?.id ?? null;
    if (lastModuleRef.current === id) return;
    lastModuleRef.current = id;
    setSegments([]);
    setPendingFunctionId(null);
    setDraft("");
    setProjectPrompt(null);
    setSubmitError(null);
  }, [screenModule]);

  // R67 A-01: a pill whose destination is the screen already on show is a dead
  // end, so it is not offered at all.
  const hidePill = useCallback(
    (pill: { key: string; label: string }) => pillPointsAtCurrentScreen(pill.key, pill.label, pathname ?? ""),
    [pathname]
  );

  // R67 A-01 -- ONE INSTRUCTION, ONE SEND RULE, both derived from one state.
  const composerState = useMemo(
    () => ({
      hasProjects: !projectsLoaded || projects.length > 0,
      hasProject: Boolean(project),
      projectName: project?.name ?? null,
      moduleLabel: screenModule?.label ?? null,
      hasAction: Boolean(pendingFunctionId),
      hasText: draft.trim().length > 0,
      busy: submitting,
    }),
    [projectsLoaded, projects.length, project, screenModule, pendingFunctionId, draft, submitting]
  );
  const instruction = composerInstruction(composerState);
  const sendEnabled = canSendFrom(composerState);

  return (
    <AppShell
      // F_019 fix (2026-08-27): this shell always renders the composer's
      // `pills` slot below (never gated on a "composing" state -- see that
      // prop's own comment: hiding the module shortcuts "would be a dead
      // end, and M24 forbids dead ends"), so the composer's real resting
      // height is always taller than AppShell's own default reserve, which
      // assumes "control strip + one input line" with no pills band. Without
      // this, the composer's pointer-events-auto box silently overlaps
      // whatever page content has scrolled to the pane's bottom edge --
      // reproduced live on /reports: a real click on the report-catalog
      // "Run" button landed on the composer's own wrapper div
      // (document.elementFromPoint), not the button, and produced zero
      // network requests. See veridian-ui-kit's AppShell.tsx/Composer.tsx
      // for the full mechanism this constant accounts for.
      composerReserveExtra={COMPOSER_PILLS_BAND_RESERVE}
      topRail={
        // The wrapper exists so the composer can put keyboard focus on the
        // project control when a click could not proceed without one (A-03):
        // the rail is where that decision is made, so that is where the user
        // is sent, rather than being told "no" and left where they were.
        <div ref={railRef}>
          <TopRail
            brand={<span className="text-[13px] font-semibold tracking-tight">PROJEXA</span>}
            organisationName={info?.organization?.name ?? "—"}
            project={railLabelProject}
            onSwitchProject={() => {
              // Cycles through real projects and back through the null state.
              // M24: "THE PROJECT SELECTOR NEEDS A NULL STATE ('All projects')
              // so CRM, pipeline and org-level work are reachable." The cycle
              // starts from the project actually on show, which after A-03 may
              // be the one the SCREEN resolved rather than the last one clicked.
              if (projects.length === 0) return;
              setProjectPrompt(null);
              const i = projects.findIndex((p) => p.id === projectId);
              const next = i === projects.length - 1 ? null : (projects[i + 1] ?? projects[0]);
              setRailProjectId(next ? next.id : null);
            }}
            search={<SearchTrigger />}
            alerts={<NotificationBell />}
            account={<AccountMenu email={info?.email} />}
          />
        </div>
      }
      taskMaster={
        <div className="flex h-full min-h-0 flex-col">
          {/* R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01: the org and
              projects reads fail silently. This pane is where the shell
              already admits a failure, so it is where the other two belong --
              rather than the user being reassured by a Task Master sitting on
              top of two unreported backend errors. */}
          {shellErrors.length > 0 && (
            <div
              role="status"
              className="m-2 shrink-0 rounded-lg border p-3 text-[12px]"
              style={{ borderColor: "var(--color-ct-border)" }}
            >
              <p className="font-semibold" style={{ color: "var(--color-veri-status-late)" }}>
                This panel is showing less than it should.
              </p>
              <ul className="mt-1 space-y-0.5" style={{ color: "var(--color-ct-muted)" }}>
                {shellErrors.map((e) => (
                  <li key={e.what}>
                    Couldn&apos;t load {e.what}: {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="min-h-0 flex-1">
        {tasksError ? (
          // Never an empty list in place of an error -- that is the exact
          // defect this codebase has shipped repeatedly, and it makes a broken
          // backend indistinguishable from "you have nothing to do". The
          // backend's OWN words, with a retry that costs one click.
          <div className="flex h-full flex-col">
            <div className="m-2 rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border)" }}>
              <p role="alert" className="text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>
                {tasksError}
              </p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="veri-view-tab mt-2"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
        <TaskMaster
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          needsYou={needsYouRows}
          waitingOnOthers={waitingRows}
          onLoad={onLoadChain}
        />
        )}
          </div>
        </div>
      }
      composer={
        <Composer
          chain={chain}
          onCutFrom={onCutFrom}
          onHome={() => router.push(HOME_ROUTE)}
          onReset={onReset}
          value={draft}
          onChange={setDraft}
          // BAND 3 -- the ranked pill set. M24 keeps all 14 universal pills but
          // shows "their top five or six ... That IS the load reduction", so the
          // strip renders the ranked top 6 with an explicit way to see the rest.
          // Without that affordance the remaining modules would be unreachable
          // from here, which is a dead end, and M24 forbids dead ends.
          pills={
            <div className="flex flex-wrap items-center gap-1">
              {/* R67 A-02 -- THE SCREEN'S OWN VERBS COME FIRST. On a module
                  route the composer already knows the module, so band 3 leads
                  with that module's real leaf actions -- each one navigating
                  to exactly the URL the screen's own header control produces
                  -- and the ranked pills that follow are the ways OUT of this
                  screen. The module's own pill is not among them (A-01): it
                  would only point back here. */}
              {chainModule &&
                chainOptionsFor(chainModule).map((leaf) => (
                  <button
                    key={leaf.id}
                    type="button"
                    onClick={() => onLeafSelect(chainModule, leaf)}
                    className="veri-mode-pill active"
                  >
                    {leaf.label}
                  </button>
                ))}
              <PillStrip
                usage={pillUsage}
                now={Date.now()}
                // Server ranking wins and is rendered verbatim; the local
                // ranking is only the fallback when the call did not answer.
                ordered={showAllPills ? undefined : rankedPills}
                onSelect={onPillSelect}
                onTogglePin={onTogglePin}
                limit={showAllPills ? UNIVERSAL_PILLS.length : 6}
                // R67 A-01: never offer the screen the user is standing on.
                hide={hidePill}
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
          onSubmit={onSubmit}
          // R67 A-01: ONE state-derived sentence. It renders in the strip and
          // is reused verbatim as this button's tooltip and accessible name --
          // it is never printed twice, and the four strings it replaces
          // ("Select a module to begin", "Pick a project or a module first",
          // and the two placeholders below) are gone.
          //
          // THIS REPLACES LANE G'S disabledReason/emptyInputReason/
          // allowEmptySubmit TRIO (r67(G) #229) RATHER THAN SITTING BESIDE IT,
          // and the replacement is deliberate. G's rule was "there is no state
          // in which Send is dead and unexplained", and it bought that with a
          // separate sentence rendered next to the button. Those props do not
          // exist on this fork any more: A-19 moved the explanation INTO the
          // button's own label ("Send (pick a project, say what you need)"),
          // which keeps G's rule and makes it stronger -- the words are now the
          // control's accessible name, so a screen reader announces the same
          // sentence the eye reads, and the empty-input state G had to add
          // emptyInputReason for is one of the things missingThings() lists.
          // Keeping both mechanisms would print the reason twice, which is the
          // duplicate-instruction defect BOTH lanes were sent to remove.
          instruction={instruction}
          canSend={sendEnabled}
          busy={submitting}
          errorMessage={submitError ?? projectPrompt}
          placeholder={
            screenModule
              ? screenModule.placeholder
              : "Type a task, a question or a record — e.g. 'excavation 50%'"
          }
          // R67 A-02: two worked examples in the module's own vocabulary, so a
          // site engineer sees what a sentence this box accepts looks like
          // before typing one.
          examples={
            screenModule ? (
              <span>
                e.g. “{screenModule.examples[0]}” · “{screenModule.examples[1]}”
              </span>
            ) : undefined
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
