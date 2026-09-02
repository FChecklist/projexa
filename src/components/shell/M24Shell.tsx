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
import { useRouter } from "next/navigation";
import {
  AppShell,
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
// R67 G-04, programme decision D-09: Composer (and, through it, ControlStrip)
// is PROJEXA'S FORK of the kit file, because the kit is an unpublished git
// dependency whose source is not on this machine. The fork fixes two things
// the kit cannot be asked to fix in this programme: the Send button's
// white-on-saffron 2.60:1 text, and a disabled reason that rendered at 11px
// in the bottom-left corner (behind Next's development badge) and was absent
// entirely when the button was disabled for an empty input. EVERYTHING ELSE
// -- AppShell, TopRail, TaskMaster, PillStrip, HistoryDrop, the chain API --
// is still the kit's, imported above.
import { Composer } from "@/components/shell/Composer";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";
import { createClient } from "@/lib/supabase/client";
import { cachedShellJson, invalidateShellCache, ShellFetchError, SHELL_PROJECTS_KEY, SHELL_SESSION_TTL_MS } from "@/lib/shell-cache";
import { afterFirstPaint } from "@/lib/after-paint";
// The two sessionStorage-backed caches this lane added. They are cleared on
// sign-out below -- sessionStorage outlives a sign-out inside one tab, and
// both hold org-scoped data.
import { clearCachedReports } from "@/lib/report-result-cache";
import { clearCurrenciesCache } from "@/lib/currency";

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
  //
  // R67 F-01 (R-006/R-011): this shell remounts on EVERY navigation, and it
  // re-fetched /api/organization each time -- from here, from the auth-state
  // effect, and from the focus/visibility effect below, all three of which
  // could fire within the same second. An organisation's name does not change
  // between two clicks. Reads now go through the tab-lifetime SWR store in
  // src/lib/shell-cache.ts (60 s), which also collapses concurrent callers
  // onto ONE request.
  //
  // `force` is what keeps F_025 intact: the two paths that exist BECAUSE the
  // identity may have changed under this tab (an auth-state event, and a human
  // returning to a long-idle tab) bypass the window entirely. Only the
  // per-navigation mount reads the cache -- which is precisely the call this
  // item set out to stop repeating.
  const loadOrgInfo = useCallback(async (options: { force?: boolean } = {}) => {
    try {
      // R67 F-13: ten minutes, not one. An organisation's name changes when a
      // human renames it, and a sign-in/sign-out invalidates this store
      // outright -- nothing else can move it under the user.
      const d = await cachedShellJson<OrgInfo>("shell:organization", "/api/organization", { force: options.force, ttlMs: SHELL_SESSION_TTL_MS });
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
        // R67 F-13: same ten-minute window, same reasoning -- and creating a
        // project invalidates SHELL_PROJECTS_KEY (see CreateProjectDialog), so
        // a new project still appears in the switcher immediately.
        const d = await cachedShellJson<Project[] | { projects?: Project[] }>(SHELL_PROJECTS_KEY, "/api/projects", { ttlMs: SHELL_SESSION_TTL_MS });
        const list: Project[] = Array.isArray(d) ? d : (d?.projects ?? []);
        if (live && Array.isArray(list)) setProjects(list.map((p) => ({ id: p.id, name: p.name })));
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
        // force: this event exists because the identity may have changed --
        // reading a cached answer here would be reading the PREVIOUS user.
        invalidateShellCache();
        void loadOrgInfo({ force: true });
      } else if (event === "SIGNED_OUT") {
        // Nothing cached may outlive the session it belongs to.
        //
        // R67 F-04/F-10 review fix: invalidateShellCache() clears the
        // IN-MEMORY store only, and two of this lane's caches live in
        // sessionStorage, which survives a sign-out inside the same tab. Both
        // hold org-scoped data -- remembered report results, and the org's
        // currency codes -- and both files' own headers promise that a
        // different sign-in cannot see the previous one's. This is where that
        // promise is kept; without these two lines it was only a comment.
        invalidateShellCache();
        clearCachedReports();
        clearCurrenciesCache();
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
      // force, for the same reason as the auth-state path above: this handler
      // exists precisely to catch a change this tab was never told about.
      if (document.visibilityState === "visible") void loadOrgInfo({ force: true });
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
  //
  // R67 F-13 (R-193/R-217): read through the shell store. Two navigations
  // inside a minute now cost ONE request instead of two, and two components
  // asking at once share one. It keeps the SHORT window deliberately -- a
  // pipeline task can finish server-side without the user doing anything, so a
  // ten-minute cache here would show "needs you" for work already done -- and
  // `force` is what a Send uses to see its own new task immediately.
  const loadTasks = useCallback(async (options: { force?: boolean } = {}) => {
    {
      try {
        // cachedShellJson reads the status before the body, and throws with the
        // backend's own message -- an error body parses perfectly well as JSON,
        // and treating it as data is how a failed request becomes a confident
        // empty list.
        const d = await cachedShellJson<ApiTasks>("shell:tasks", "/api/tasks?limit=50", { force: options.force });
        const data = (d ?? {}) as ApiTasks;
        setTasksError(null);
        setCounts({
          home: Number(data.counts?.total) || 0,
          approval: Number(data.counts?.needsYou) || 0,
          queue: Number(data.counts?.running) || 0,
        });
        const g = data.groups ?? {};
        // "Needs you" carries what is stuck on the user: blocked first, because
        // a blocked row is the only loud one and the one that costs time.
        setNeedsYou([
          ...(g.blocked ?? []).map((t) => toTaskRow(t, "blocked")),
          ...(g.needsYou ?? []).map((t) => toTaskRow(t, "needsYou")),
        ]);
        // "Waiting on others" is everything not on the user's desk.
        setWaiting([
          ...(g.running ?? []).map((t) => toTaskRow(t, "running")),
          ...(g.done ?? []).map((t) => toTaskRow(t, "done")),
        ]);
      } catch (err) {
        // The backend's own words when it gave them (ShellFetchError carries
        // the response's `error` string), and a plain reachability message when
        // the request never completed at all.
        setTasksError(
          err instanceof ShellFetchError ? err.message : "Couldn't reach the task service."
        );
      }
    }
  }, []);

  // The pill strip's ranking. R53 returns it ALREADY RANKED -- rendered in
  // order, never re-sorted here. isNewUser true means "nothing earned yet",
  // which must not look like a failed call.
  //
  // R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01 (reopened): this was
  // `if (!res.ok) return;` / `catch {}` -- the same silent-swallow the
  // org/projects effect above was fixed for in the first PR, just never
  // applied here. Same noteFailure() pattern, same shape: status read before
  // the body is treated as data, the backend's own message kept.
  //
  // R67 F-13 (R-193/R-217): through the shell store as well, and for the same
  // reason the task list is -- one request per minute across navigations,
  // shared between concurrent callers. It is NOT force-refreshed on a pill
  // CLICK: a click only records LOCAL usage (see onPillSelect); the server's
  // pill_usage row is written when the task is submitted, so a Send is the
  // event that can actually change this ranking, and that is where `force` is
  // passed from.
  const loadPillUsage = useCallback(async (options: { force?: boolean } = {}) => {
    try {
      const d = await cachedShellJson<{ pills?: RankedPill[] }>("shell:pill-usage", "/api/pill-usage?limit=6", { force: options.force });
      if (Array.isArray(d?.pills)) {
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
      noteFailure("your ranked modules", err instanceof Error ? err.message : "the request did not complete");
    }
  }, [noteFailure]);

  // R67 F-09 (R-122). These two reads used to run from a mount effect, i.e.
  // BEFORE the browser had painted, competing for connections with the page's
  // own data call during the exact window the user is waiting to see anything.
  // Neither is needed for the first frame: the Task Master renders its own
  // frame with an empty list, and the pill strip renders its locally ordered
  // set until the server's ranking arrives. So they are scheduled AFTER the
  // first paint -- see src/lib/after-paint.ts for why that takes two
  // requestAnimationFrame hops and not one.
  useEffect(() => {
    let live = true;
    const cancelAfterPaint = afterFirstPaint(() => {
      if (!live) return;
      void loadTasks();
      void loadPillUsage();
    });

    return () => {
      live = false;
      cancelAfterPaint();
    };
  }, [loadTasks, loadPillUsage]);

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
      // The minted task must APPEAR. That is the last step of R-80 and the
      // only part of the path a unit test cannot stand in for.
      //
      // R67 F-13: `force` -- this read exists BECAUSE the answer just changed,
      // so it must go past the window the shell store otherwise honours. The
      // same is true of the pill ranking: a submission is what writes the
      // server's pill_usage row, so this is the one moment it can differ.
      await loadTasks({ force: true });
      void loadPillUsage({ force: true });
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, pendingFunctionId, mode, projectId, submitting, loadTasks, loadPillUsage]);

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
          }}
          search={<SearchTrigger />}
          alerts={<NotificationBell />}
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
          // R67 G-04: EXACTLY ONE INSTRUCTION PER STATE. The order is
          // most-specific-first, so a real server refusal is never hidden
          // behind a generic prompt:
          //   1. the server said no        -> its own words
          //   2. the request is in flight  -> "Sending…"
          //   3. nothing to run it against -> "Pick a project or a module first"
          // The fourth state -- nothing typed yet -- is the one the kit left
          // silent, and the fork's emptyInputReason below now covers it, so
          // there is no state in which Send is dead and unexplained.
          disabledReason={
            submitError ??
            (submitting ? "Sending…" : projectId || pendingFunctionId ? undefined : "Pick a project or a module first")
          }
          // With a module armed there is something to run, so an empty
          // input is a real submission and Send stays live -- which is what
          // the placeholder has always claimed. Without one, the empty input
          // is genuinely blocking and gets the sentence that says so.
          allowEmptySubmit={Boolean(pendingFunctionId)}
          emptyInputReason="Type what you need, then press Send."
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
