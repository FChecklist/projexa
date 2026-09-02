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
  Composer,
  COMPOSER_PILLS_BAND_RESERVE,
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
  type RankedPill,
  type TaskRow,
  type TaskTab,
} from "@fchecklist/veridian-ui-kit/shell";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";
import { createClient } from "@/lib/supabase/client";
import { invalidateShell, useShell } from "@/lib/shell-store";
import { rememberSelectedProject } from "@/lib/project-cookie";

// M24: "MODE is sticky WITHIN a session and RESETS to Projects on a new
// session, so nobody returns to a view they forgot they set." sessionStorage is
// exactly that lifetime; localStorage would survive the session and break it.
const MODE_KEY = "veri.chain.mode";
const HISTORY_KEY = "veri.chain.history";
const PILL_USAGE_KEY = "veri.pill.usage";

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
};
type ApiTasks = {
  counts?: { needsYou?: number; running?: number; done?: number; blocked?: number; total?: number };
  groups?: { needsYou?: ApiTask[]; running?: ApiTask[]; done?: ApiTask[]; blocked?: ApiTask[] };
  tasks?: ApiTask[];
  /** R67 F-26: the keyset position of the next page, or null at the end. */
  nextCursor?: string | null;
};

// R67 F-26 (audit recommendation R-242). THE THREE NUMBERS THIS CHANGES.
//
// Task Master shows ten rows and was fetching FIFTY, on every navigation, at
// 590-1740 ms -- and again after every Send, which is why the composer sat
// empty and Send sat disabled for seconds with nothing to look at.
//
//   TASK_PAGE_SIZE   20, with an explicit "Show 20 more" at the foot of the
//                    pane. Twenty covers the ten visible rows plus the group
//                    the user is most likely to scroll into.
//   POLL_*           after a Send the minted row goes in AT ONCE from the POST
//                    response and only THAT row is polled -- fast while the
//                    user is still watching, then slowly, and never at all once
//                    the row reaches a terminal status.
//   TASK_REVALIDATE  the full list is otherwise re-read on a five-minute
//                    background schedule or an explicit refresh, not on every
//                    navigation.
const TASK_PAGE_SIZE = 20;
const POLL_FAST_MS = 1_000;
const POLL_FAST_FOR_MS = 10_000;
const POLL_SLOW_MS = 5_000;
/** Give up on a row that never settles, rather than polling for the life of the tab. */
const POLL_GIVE_UP_MS = 5 * 60_000;
const TASK_REVALIDATE_MS = 5 * 60_000;

const TERMINAL_TASK_STATUSES = new Set(["done", "blocked"]);

/** Which group a task row belongs to, from its status alone -- so an optimistic
 *  row and a listed row are always placed by the same rule. */
function groupForStatus(status?: string | null): "needsYou" | "running" | "done" | "blocked" {
  if (status === "done") return "done";
  if (status === "blocked") return "blocked";
  if (status === "in_progress") return "running";
  return "needsYou";
}

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

function toTaskRow(t: ApiTask, group: "needsYou" | "running" | "done" | "blocked"): TaskRow {
  const steps = t.derivedChain?.steps ?? [];
  const root = t.derivedChain?.root ?? null;
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

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pillUsage, setPillUsage] = useState<PillUsage[]>([]);
  const [rankedPills, setRankedPills] = useState<RankedPill[]>([]);
  const [needsYou, setNeedsYou] = useState<TaskRow[]>([]);
  const [waiting, setWaiting] = useState<TaskRow[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  // R67 F-26: the keyset position of the next page (null = this is the whole
  // list, so no "Show 20 more" control is rendered at all), whether that page
  // is in flight, when the list was last read in full, and which rows came from
  // a Send rather than from the server.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tasksFetchedAt, setTasksFetchedAt] = useState<number | null>(null);
  const tasksFetchedAtRef = useRef<number | null>(null);
  tasksFetchedAtRef.current = tasksFetchedAt;
  const optimisticIdsRef = useRef<Set<string>>(new Set());
  // What the SHELL itself could not load, separate from the task read.
  const [shellErrors, setShellErrors] = useState<{ what: string; detail: string }[]>([]);
  // The function the user picked via a pill. When set, submitting takes
  // R53's PILL PATH: { functionId, params } -- no classifier, no model call
  // ever. When null, the typed path { rawInput } is used and the server
  // classifies. Both are the same endpoint.
  const [pendingFunctionId, setPendingFunctionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pillFnRef = useRef<Record<string, string>>({});
  const [showAllPills, setShowAllPills] = useState(false);
  const [draft, setDraft] = useState("");
  const [counts, setCounts] = useState<{ home: number; approval: number; queue: number }>({
    home: 0,
    approval: 0,
    queue: 0,
  });

  // R67 F-19 (audit recommendation R-245). THE SHELL YIELDS TO THE FORM ON A
  // CREATE ROUTE.
  //
  // This shell refetches its organisation, projects, tasks and pill ranking on
  // every navigation -- 3.8-4.6 s to network idle -- INCLUDING on create
  // forms, which need none of them: /permits/new needs a project id (already
  // in the URL) and its own field lookups, and nothing else. Those shell calls
  // were competing with the form's own for the browser's connections and for
  // the main thread, on exactly the screens where the user is waiting to type.
  //
  // So on /new, /upload and /log-time the bootstrap is deferred to the first
  // idle callback: the form mounts, focuses its first field and issues its own
  // lookups first, and the shell fills in behind it. requestIdleCallback is
  // not in Safari, hence the setTimeout(0) fallback -- which still yields a
  // frame, which is the point. The 2 s timeout guarantees the rail is never
  // left empty on a page the user keeps open.
  const pathname = usePathname();
  const isCreateRoute = /\/(new|upload|log-time)$/.test(pathname ?? "");
  const [bootstrapReady, setBootstrapReady] = useState(!isCreateRoute);

  useEffect(() => {
    if (bootstrapReady) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const handle = win.requestIdleCallback(() => setBootstrapReady(true), { timeout: 2000 });
      return () => win.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(() => setBootstrapReady(true), 0);
    return () => clearTimeout(timer);
  }, [bootstrapReady]);

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

  // R67 F-21 (R-236). THE SHELL'S SIX LOOKUPS ARE NOW ONE CALL.
  //
  // This component used to fetch /api/organization (two or three times),
  // /api/projects, /api/notifications, /api/pill-usage and, through the chat
  // provider, /api/capability-tree ON EVERY NAVIGATION -- 3.8-4.6 s to network
  // idle for six answers that do not change between /permits and /scope. They
  // now come from GET /api/shell once per session, held in the store in
  // src/lib/shell-store.ts, which revalidates in the BACKGROUND on each key's
  // own schedule (5 min for projects and the pill ranking, 24 h for the
  // capability tree and currencies) and only when a write says to.
  //
  // F_025 IS PRESERVED, and this is the part that must not be lost: the
  // account menu's identity used to be a snapshot of whoever was signed in
  // when the tab first mounted. Sign in as A here, then as B in another tab of
  // the same browser (@supabase/ssr persists the session in COOKIES, which
  // GoTrueClient's localStorage `storage`-event sync never sees), and this tab
  // kept showing A forever. So the store is still refreshed on this tab's own
  // auth-state change AND on focus/visibility -- the cases where the identity
  // under us can have moved on with no event of any kind.
  const shell = useShell({ enabled: bootstrapReady });

  useEffect(() => {
    if (!shell.loaded) return;
    if (shell.organization?.name) {
      setInfo({
        organization: { id: shell.organization.id, name: shell.organization.name },
        role: shell.role ?? undefined,
        email: shell.email ?? undefined,
      });
    }
    setProjects((shell.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
    if (Array.isArray(shell.pillUsage)) {
      setRankedPills(shell.pillUsage as unknown as RankedPill[]);
      // R53's payload carries functionId per pill. Held in a ref so the submit
      // handler can read it without re-rendering the strip.
      pillFnRef.current = Object.fromEntries(
        shell.pillUsage.filter((x) => x.functionId).map((x) => [x.pillKey, x.functionId as string])
      );
    }
    // R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01: a half-loaded shell
    // says so, with the backend's own words, instead of rendering an em-dash
    // and an empty project switcher as if that were the answer.
    const labels: Record<string, string> = {
      organization: "your organisation",
      projects: "your projects",
      pillUsage: "your ranked modules",
      notifications: "your notifications",
      capabilityTree: "your module list",
      currencies: "your currencies",
      shell: "your workspace",
    };
    for (const [key, detail] of Object.entries(shell.errors)) {
      noteFailure(labels[key] ?? key, detail);
    }
  }, [shell.loaded, shell.organization, shell.projects, shell.pillUsage, shell.role, shell.email, shell.errors, noteFailure]);

  const refreshShell = shell.refresh;

  // F_025, first half: this tab's own sign-in/sign-out.
  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        void refreshShell();
      } else if (event === "SIGNED_OUT") {
        setInfo(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshShell]);

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
      if (document.visibilityState === "visible") void refreshShell();
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [refreshShell]);

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
  //
  // R67 F-26: `cursor` appends a page instead of replacing the pane, so "Show
  // 20 more" grows the list the user is reading rather than re-reading it.
  const loadTasks = useCallback(async (cursor?: string) => {
    const append = Boolean(cursor);
    if (append) setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ limit: String(TASK_PAGE_SIZE) });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/tasks?${qs.toString()}`);
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
      setNextCursor(data.nextCursor ?? null);
      if (!append) {
        setCounts({
          home: Number(data.counts?.total) || 0,
          approval: Number(data.counts?.needsYou) || 0,
          queue: Number(data.counts?.running) || 0,
        });
      }
      const g = data.groups ?? {};
      // "Needs you" carries what is stuck on the user: blocked first, because
      // a blocked row is the only loud one and the one that costs time.
      const pageNeedsYou = [
        ...(g.blocked ?? []).map((t) => toTaskRow(t, "blocked")),
        ...(g.needsYou ?? []).map((t) => toTaskRow(t, "needsYou")),
      ];
      // "Waiting on others" is everything not on the user's desk.
      const pageWaiting = [
        ...(g.running ?? []).map((t) => toTaskRow(t, "running")),
        ...(g.done ?? []).map((t) => toTaskRow(t, "done")),
      ];
      // Merge by id, never blind concat: the optimistic row inserted by a Send
      // is already in the pane and must be REPLACED by its server version, not
      // rendered twice.
      const merge = (previous: TaskRow[], page: TaskRow[]) => {
        if (!append) {
          const pageIds = new Set(page.map((r) => r.id));
          // A row the user just created that this page does not yet carry stays
          // put -- dropping it would make a successful Send look lost.
          return [...previous.filter((r) => optimisticIdsRef.current.has(r.id) && !pageIds.has(r.id)), ...page];
        }
        const seen = new Set(previous.map((r) => r.id));
        return [...previous, ...page.filter((r) => !seen.has(r.id))];
      };
      setNeedsYou((prev) => merge(prev, pageNeedsYou));
      setWaiting((prev) => merge(prev, pageWaiting));
      setTasksFetchedAt(Date.now());
    } catch {
      setTasksError("Couldn't reach the task service.");
    } finally {
      if (append) setLoadingMore(false);
    }
  }, []);

  // R67 F-21: the pill ranking moved into the /api/shell bootstrap above --
  // it was a separate per-navigation call for a list that changes when the
  // user clicks a pill, not when they change route.
  //
  // R67 F-26: and tasks no longer re-read on every navigation either. This
  // shell wraps all 53 app routes, so that read fired on every route change for
  // a list that changes when the USER acts -- and a Send now puts its own row
  // in directly. The full list is refreshed once per mount and then only on a
  // five-minute background schedule.
  useEffect(() => {
    if (!bootstrapReady) return;
    if (tasksFetchedAtRef.current !== null && Date.now() - tasksFetchedAtRef.current < TASK_REVALIDATE_MS) return;
    void loadTasks();
  }, [loadTasks, bootstrapReady, pathname]);

  // R67 F-26: place ONE row, by id, in whichever group its status belongs to --
  // used by both the optimistic insert after a Send and the single-task poll,
  // so a row can never end up in two groups or in the wrong one.
  //
  // `pinToNeedsYou` is the Send case: the task the user just submitted stays at
  // the top of "Needs you" with the running glyph while it is still executing,
  // because that is the row they are watching. Once it settles it takes its
  // real group and its real glyph.
  const upsertTaskRow = useCallback((api: ApiTask, pinToNeedsYou: boolean) => {
    const status = api.status ?? "";
    const settled = TERMINAL_TASK_STATUSES.has(status);
    const group = groupForStatus(status);
    const pinned = pinToNeedsYou && !settled;
    const row = toTaskRow(api, pinned ? "running" : group);
    const belongsInNeedsYou = pinned || group === "needsYou" || group === "blocked";
    setNeedsYou((prev) => {
      const without = prev.filter((r) => r.id !== row.id);
      return belongsInNeedsYou ? [row, ...without] : without;
    });
    setWaiting((prev) => {
      const without = prev.filter((r) => r.id !== row.id);
      return belongsInNeedsYou ? without : [row, ...without];
    });
  }, []);

  // Every scheduled poll, so none of them outlives the component.
  const pollTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = pollTimersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // R67 F-26: poll ONE row. Fast (1 s) while the user is still watching, then
  // slowly (5 s), and never once the row is done or blocked. A row that never
  // settles is abandoned after five minutes rather than polled for the life of
  // the tab. Self-scheduling through a ref so the callback can re-arm itself
  // without re-creating on every tick.
  const pollTaskRef = useRef<(taskId: string, startedAt: number) => void>(() => {});
  const pollTask = useCallback(
    (taskId: string, startedAt: number) => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_GIVE_UP_MS) {
        optimisticIdsRef.current.delete(taskId);
        return;
      }
      const timer = setTimeout(async () => {
        pollTimersRef.current.delete(timer);
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
          const body = await res.json().catch(() => null);
          const task = res.ok ? (body?.task as ApiTask | undefined) : undefined;
          if (task) {
            upsertTaskRow(task, true);
            if (TERMINAL_TASK_STATUSES.has(task.status ?? "")) {
              // Settled. Stop polling, and stop protecting it from the next
              // full list read -- the server now has the same row.
              optimisticIdsRef.current.delete(taskId);
              return;
            }
          }
        } catch {
          // A poll that could not reach the service is not a failure the user
          // needs to see -- the row is still on screen, and the next tick tries
          // again. The list's own error surface covers a real outage.
        }
        pollTaskRef.current(taskId, startedAt);
      }, elapsed < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS);
      pollTimersRef.current.add(timer);
    },
    [upsertTaskRow]
  );
  useEffect(() => {
    pollTaskRef.current = pollTask;
  }, [pollTask]);

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
    // Arm the pill path. R53: picking the function means the server does NOT
    // need to classify, so this submission costs no model call at all.
    // Looked up from the server's own pill payload rather than carried on
    // PillSelection. PillSelection is deliberately inert -- readonly
    // authorizes:false, no callable member -- and bolting a field onto it
    // for this would blur exactly what that type exists to guarantee.
    const knownFunctionId = pillFnRef.current[sel.pillKey] ?? null;
    setPendingFunctionId(knownFunctionId);
    // Sumeet audit fix (2026-08-30): the 14 universal pills (Customers,
    // Analysis, Reports, ...) are CATEGORY entry points, not single
    // zero-param functions -- pillFnRef is only ever populated from
    // /api/pill-usage's response, which returns a user's PAST usage
    // history (compliance.pill_usage rows), never a static catalog. The
    // FIRST time anyone clicks a given pill, knownFunctionId is genuinely
    // null. Before this fix, onSubmit's own guard
    // (`if (!typed && !pendingFunctionId) return`) made Send a SILENT
    // no-op in exactly that case -- reproduced by tracing pillConfig.ts ->
    // the real pill-usage route -> this handler, not guessed. M24's own
    // rule ("THE SAME NAME MUST REACH THE SAME DESTINATION... WHICHEVER
    // PATH YOU TOOK") means clicking "Customers" should behave the same as
    // TYPING "customers" and sending -- so a first-time pill click now
    // seeds the draft with the pill's own label (only when the draft is
    // still empty, so it never clobbers something the user already typed),
    // making the existing typed-path classifier the real destination
    // instead of a dead end. The "add detail first" placeholder text below
    // was already promising this was possible; it just never happened.
    if (!knownFunctionId) {
      setDraft((prev) => (prev.trim() ? prev : sel.label));
    }
  }, []);

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
      const body = pendingFunctionId
        ? { functionId: pendingFunctionId, params: {}, mode, projectId }
        : { rawInput: typed, mode, projectId };
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
      // R67 F-21: a Send re-ranks the pills server-side, so mark that ONE key
      // stale rather than re-reading the whole shell.
      invalidateShell("pillUsage");

      // R67 F-26 (R-242). THE MINTED TASK MUST APPEAR -- and it now appears
      // IMMEDIATELY, from this response, instead of after a 590-1740 ms re-read
      // of fifty rows during which the pane showed nothing new.
      //
      // verdict is PER TASK, not per submission (see this function's own
      // comment above), so every minted row is placed independently; a
      // chat-only submission mints none and nothing is inserted.
      const minted = ((d?.tasks ?? []) as {
        taskId: string;
        functionId?: string | null;
        status?: string | null;
        error?: string | null;
        segmentText?: string | null;
      }[]).filter((t) => typeof t.taskId === "string" && t.taskId);

      let addedNeedsYou = 0;
      let addedRunning = 0;
      for (const task of minted) {
        const api: ApiTask = {
          id: task.taskId,
          projectId,
          functionId: task.functionId ?? null,
          status: task.status ?? "in_progress",
          error: task.error ?? null,
          rawInput: task.segmentText ?? typed,
          mode,
        };
        optimisticIdsRef.current.add(task.taskId);
        upsertTaskRow(api, true);
        const group = groupForStatus(api.status);
        if (group === "needsYou" || group === "blocked") addedNeedsYou += 1;
        if (group === "running") addedRunning += 1;
        // Only a row that has not settled is worth polling. runDirectTask
        // executes synchronously, so a pill submission is frequently already
        // done or blocked by the time this response lands.
        if (!TERMINAL_TASK_STATUSES.has(api.status ?? "")) pollTaskRef.current(task.taskId, Date.now());
      }
      // The badge counts move with the rows, from THIS response -- reading them
      // back from a second endpoint is how tabs and list drift apart.
      if (minted.length > 0) {
        setCounts((c) => ({
          home: c.home + minted.length,
          approval: c.approval + addedNeedsYou,
          queue: c.queue + addedRunning,
        }));
      }
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, pendingFunctionId, mode, projectId, submitting, upsertTaskRow]);

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
            // R67 F-18: record the choice where the SERVER can read it. Module
            // pages resolve their project from ?projectId= or this cookie with
            // no network call at all (D-04); without the write, a module
            // opened from the directory rather than from a link would still
            // pay for the /dashboard hop.
            rememberSelectedProject(next ? next.id : null);
          }}
          search={<SearchTrigger />}
          alerts={<NotificationBell initialNotifications={shell.notifications as never} initialUnreadCount={shell.unreadCount} />}
          account={<AccountMenu email={info?.email} />}
        />
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
          needsYou={needsYou}
          waitingOnOthers={waiting}
          onLoad={onLoadChain}
        />
        )}
          </div>
          {/* R67 F-26 (R-242): the pane now loads 20 rows, not 50, and says so.
              Rendered ONLY when the backend handed back a cursor -- a control
              that loads nothing is a dead end, and M24 forbids dead ends. It
              sits below the kit's TaskMaster rather than inside it, so no kit
              file is forked for one button. */}
          {!tasksError && nextCursor && (
            <div className="shrink-0 border-t px-2 py-1.5" style={{ borderColor: "var(--color-ct-border)" }}>
              <button
                type="button"
                className="veri-view-tab w-full"
                onClick={() => void loadTasks(nextCursor)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : `Show ${TASK_PAGE_SIZE} more`}
              </button>
            </div>
          )}
        </div>
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
                // Server ranking wins and is rendered verbatim; the local
                // ranking is only the fallback when the call did not answer.
                ordered={showAllPills ? undefined : rankedPills}
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
          onSubmit={onSubmit}
          disabledReason={
            submitError ??
            (submitting ? "Sending…" : projectId || pendingFunctionId ? undefined : "Pick a project or a module first")
          }
          placeholder={
            pendingFunctionId
              ? "Press send to run this, or add detail first…"
              : "Describe what you need, or pick a module above."
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
