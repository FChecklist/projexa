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
  PillStrip,
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
// R67 C-01, programme decision D-09: TaskMaster is PROJEXA'S FORK of the kit
// file. The kit renders two fixed groups whatever tab is selected (so the
// tabs never filtered), offers no per-row action (so a blocked row was a dead
// end), and borrows one empty-state sentence for every tab. The chain API it
// uses -- loadChain / ChainLoad, and therefore the load-never-execute
// contract -- is still imported from the kit inside that fork.
import { TaskMaster, type TaskTab } from "@/components/shell/TaskMaster";
import {
  tabView,
  toTaskRow,
  type ApiTask,
  type GroupedRows,
  type ProjexaTaskRow,
  type RowAction,
  type TaskTabId,
} from "@/components/shell/task-row";
// R67 C-02: band 2 of the composer, where the chain is built. The kit's
// OptionChain is mounted here (it had zero consumers), so the leaf the user
// clicks fills the strip in front of them instead of the strip reading
// "Select a module to begin" on the very screen it is docked to.
import { ChainOptionsPanel } from "@/components/shell/ChainOptionsPanel";
import { ConfirmCard } from "@/components/shell/ConfirmCard";
import {
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
  REPORTS_ENTITY_SEGMENT,
  REPORTS_PILL_KEY,
  actionLevelFor,
  cardActionById,
  cardForRoute,
  coldStartCards,
  periodLabel,
  periodOptionsLevel,
  reportLeafById,
  reportOptionsLevel,
  reportReceiptLine,
  reportRoute,
  resolvePeriod,
  resolveTaskTitle,
  timesheetReceiptLine,
  timesheetRoute,
  type CardDef,
  type ChainOptionsLevel,
  type PeriodId,
  type ProjectTask,
} from "@/lib/card-catalogue";
import { maskTechnical } from "@/lib/task-errors";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";
import { createClient } from "@/lib/supabase/client";

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

// R67 C-01: a blocked row the user dismissed. Per user-agent, not per server:
// dismissing is a reading decision ("I have seen this and it is not my next
// move"), not a state change on compliance.pipeline_tasks, and inventing a
// server-side dismissal would be another lane's schema change.
const DISMISSED_KEY = "veri.tasks.dismissed";

type OrgInfo = { organization?: { id: string; name: string }; role?: string; email?: string };

type ApiTasks = {
  counts?: { needsYou?: number; running?: number; done?: number; blocked?: number; total?: number };
  groups?: { needsYou?: ApiTask[]; running?: ApiTask[]; done?: ApiTask[]; blocked?: ApiTask[] };
  tasks?: ApiTask[];
};

const EMPTY_GROUPS: GroupedRows = { needsYou: [], running: [], done: [], blocked: [] };

// R67 C-01: what the composer says after a blocked row's Fix button has
// loaded its chain. The question is asked in the input, in words, from the
// SAME missing-step vocabulary D-03 uses for the row's own sentence -- so
// "Pick a BOQ line" on the row and the prompt in the box cannot drift.
const FIX_PROMPT: Readonly<Record<string, string>> = {
  boqLine: "Which BOQ line? Type its code, or open the line on the screen.",
  project: "Which project? Choose it in the top rail, then press Send.",
  value: "How much? Type a quantity or a percentage.",
};

type Project = { id: string; name: string };

// R67 C-02: the chain segments the Reports level owns, so choosing a second
// report REPLACES the first rather than appending a second sentence.
const REPORT_SEGMENT_PREFIX = "report:";
const PERIOD_SEGMENT_PREFIX = "period:";
// R67 C-04: a segment produced by walking the option chain. The depth is in
// the id so cutting the strip can cut the level path to match.
const LEVEL_SEGMENT_PREFIX = "lvl:";
const REPORTS_ROUTE = "/reports";

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pillUsage, setPillUsage] = useState<PillUsage[]>([]);
  const [rankedPills, setRankedPills] = useState<RankedPill[]>([]);
  // R67 C-01: ONE source for the rows AND the counts. The kit read counts from
  // the API's own `counts` object and rows from `groups`, which is how a badge
  // can disagree with the list beneath it -- and it did, because a dismissed
  // or filtered row still counted. `loadedAt` travels with the rows so
  // "older than 24 h" and "before today" are measured against the read that
  // produced them, not against whenever a re-render happened.
  const [taskData, setTaskData] = useState<{ groups: GroupedRows; loadedAt: number }>({
    groups: EMPTY_GROUPS,
    loadedAt: Date.now(),
  });
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  // R67 C-01: which blocked row's "Fix" was pressed, and which picker the
  // loaded chain should open. Set by a Fix click, cleared by a reset. It
  // deliberately carries NO way to execute -- the missing step is a question
  // to the user, not an instruction to the server.
  const [fixTarget, setFixTarget] = useState<{
    taskId: string;
    functionId: string | null;
    missingStep: RowAction["missingStep"];
  } | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  // What the SHELL itself could not load, separate from the task read.
  const [shellErrors, setShellErrors] = useState<{ what: string; detail: string }[]>([]);
  // The function the user picked via a pill. When set, submitting takes
  // R53's PILL PATH: { functionId, params } -- no classifier, no model call
  // ever. When null, the typed path { rawInput } is used and the server
  // classifies. Both are the same endpoint.
  const [pendingFunctionId, setPendingFunctionId] = useState<string | null>(null);
  // R67 C-02: what a pill click means when the server has never seen this
  // user run that pill, so pillFnRef has no functionId for it. It used to be
  // written straight into the textarea (":485-487"), which is the one thing a
  // card or a pill must never do -- M24's box is the user's sentence, not the
  // product's. The label is carried HERE instead and is used as the typed
  // path's rawInput on Send, so "click Customers" still reaches exactly where
  // "type customers" reaches, with the textarea left alone.
  const [pendingRawInput, setPendingRawInput] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // R67 C-02: the Reports chain -- which report leaf and which period the
  // user has picked. Neither is armed to run: Send is still a separate,
  // deliberate act.
  const [reportId, setReportId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<PeriodId>(DEFAULT_PERIOD);
  // Band 2's receipt: what was just run, and the link to look at it.
  const [receipt, setReceipt] = useState<{ text: string; href: string } | null>(null);
  // The pipeline's own words when it could not record the run. Kept separate
  // from the receipt because they are different facts and hiding either one
  // would be the silent-failure defect this programme is removing.
  const [bandNote, setBandNote] = useState<string | null>(null);
  // R67 C-03: the timesheet confirmation card. It exists between the PREVIEW
  // (POST /api/classify, which never executes) and the write (POST
  // /api/timesheets), which is the whole point: the user checks what the
  // sentence was read as before any hours are logged.
  const [timesheetDraft, setTimesheetDraft] = useState<{
    sentence: string;
    issueId: string;
    hours: string;
    spentOn: string;
    activityType: string;
    /** what the user actually said, kept so "Edit" can restore the sentence. */
    typed: string;
    /** the words the user used for the task, for the fuzzy pre-selection. */
    taskQuery: string;
    /** true when the fuzzy match was ambiguous and the user must choose. */
    unmatched: boolean;
  } | null>(null);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  // R67 C-04: the ENTITY > ACTION > STEP walk. `levelPath` is the server's
  // own addressing for "which question comes next"; the segments on the strip
  // are its human rendering. They move together, and an (x) that cuts the
  // strip cuts this too.
  const [levelPath, setLevelPath] = useState<string[]>([]);
  const [serverLevel, setServerLevel] = useState<ChainOptionsLevel | null>(null);
  const [levelLoading, setLevelLoading] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [levelReload, setLevelReload] = useState(0);
  // The scalar value the last step asks for, when it asks for one.
  const [scalarValue, setScalarValue] = useState("");
  const [scalarError, setScalarError] = useState<string | null>(null);
  const pillFnRef = useRef<Record<string, string>>({});
  // R67 C-01: the selected project's NAME, for D-03's BOQ_LINE_NOT_FOUND
  // sentence ("There is no line 1.02 on Cedar Heights Villa - Phase 1 v3").
  // Held in a ref, not read from state inside loadTasks, so switching project
  // does not re-enter the task read.
  const projectNameRef = useRef<string | null>(null);
  const [showAllPills, setShowAllPills] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      const m = sessionStorage.getItem(MODE_KEY) as ChainMode | null;
      if (m) setMode(m);
      const h = sessionStorage.getItem(HISTORY_KEY);
      if (h) setHistory(JSON.parse(h) as HistoryEntry[]);
      const p = localStorage.getItem(PILL_USAGE_KEY);
      if (p) setPillUsage(JSON.parse(p) as PillUsage[]);
      const d = localStorage.getItem(DISMISSED_KEY);
      if (d) setDismissedIds(JSON.parse(d) as string[]);
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
        const g = data.groups ?? {};
        // R67 C-01: the rows are built ONCE, here, and every tab's list and
        // every tab's count are then derived from these same four arrays --
        // which is why a badge can no longer disagree with the list under it.
        // The API's own `counts` object is deliberately not read: it counts
        // rows this pane may have filtered or dismissed.
        const loadedAt = Date.now();
        const ctx = { now: loadedAt, projectName: projectNameRef.current };
        setTaskData({
          loadedAt,
          groups: {
            blocked: (g.blocked ?? []).map((t) => toTaskRow(t, "blocked", ctx)),
            needsYou: (g.needsYou ?? []).map((t) => toTaskRow(t, "needsYou", ctx)),
            running: (g.running ?? []).map((t) => toTaskRow(t, "running", ctx)),
            done: (g.done ?? []).map((t) => toTaskRow(t, "done", ctx)),
          },
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

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  useEffect(() => {
    projectNameRef.current = project?.name ?? null;
  }, [project]);

  // R67 C-02: THE STRIP STOPS READING "Select a module to begin" ON THE
  // SCREEN IT IS DOCKED TO. Arriving on /reports seeds the entity segment
  // after the project, so the sentence already reads
  // "Projects > Cedar Heights Villa - Phase 1 > Reports" before a click, and
  // pins the Reports pill so the module the user is standing in is not
  // ranked off the strip.
  useEffect(() => {
    if (pathname !== REPORTS_ROUTE) return;
    setSegments((prev) =>
      prev.some((s) => s.id === REPORTS_ENTITY_SEGMENT.id) ? prev : [...prev, REPORTS_ENTITY_SEGMENT]
    );
    setPillUsage((prev) => {
      if (prev.some((r) => r.pillKey === REPORTS_PILL_KEY && r.pinned)) return prev;
      const existing = prev.find((r) => r.pillKey === REPORTS_PILL_KEY);
      const next = existing
        ? prev.map((r) => (r.pillKey === REPORTS_PILL_KEY ? { ...r, pinned: true } : r))
        : [...prev, { pillKey: REPORTS_PILL_KEY, useCount: 0, lastUsedAt: Date.now(), pinned: true }];
      try {
        localStorage.setItem(PILL_USAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [pathname]);

  // R67 C-03: the card whose chain this route already IS. On /schedule/log-time
  // (and on /design-studio once D-07 ships it) the strip is seeded with the
  // top-rail project and a "Timesheet" segment -- so there is no second
  // project selector on a screen that already has one.
  const routeCard = useMemo(() => cardForRoute(pathname ?? ""), [pathname]);

  useEffect(() => {
    if (!routeCard) return;
    setSegments((prev) =>
      prev.some((s) => s.id === routeCard.entitySegment.id) ? prev : [...prev, routeCard.entitySegment]
    );
  }, [routeCard]);

  // The PROJEXA cards shown beside the kit's ranked pill strip: what this
  // role is cold-started with, plus the card the user is standing in.
  const cards = useMemo(
    () => coldStartCards(info?.role ?? null, pathname ?? ""),
    [info?.role, pathname]
  );

  // *** A CARD CLICK LOADS THE CHAIN AND STOPS. *** It arms no functionId, so
  // the next Send is a deliberate second act; it opens the card's own screen,
  // because opening a screen is a read; and it never writes into the textarea.
  const onCardSelect = useCallback(
    (card: CardDef) => {
      setSegments((prev) =>
        prev.some((s) => s.id === card.entitySegment.id) ? prev : [...prev, card.entitySegment]
      );
      setSubmitError(null);
      if (pathname !== card.route) router.push(card.route);
    },
    [pathname, router]
  );

  const onReportsRoute = pathname === REPORTS_ROUTE;
  const reportsChainActive = useMemo(
    () => segments.some((s) => s.id === REPORTS_ENTITY_SEGMENT.id),
    [segments]
  );

  // WHICH QUESTION BAND 2 IS ASKING. One level at a time, in the order the
  // sentence is built: the report, then the period it covers.
  const bandLevel: ChainOptionsLevel | null = useMemo(() => {
    if (!reportsChainActive) return null;
    return reportId ? periodOptionsLevel() : reportOptionsLevel();
  }, [reportsChainActive, reportId]);

  const bandSelectedId = reportId ? periodId : null;

  // R67 C-04 -- THE SERVER-FED LEVELS. Fetched through PROJEXA's own proxy so
  // the org API key stays server-side (D-04). A failed read renders the
  // backend's words with Retry; it NEVER renders as an empty chip row, which
  // would tell the user this project has no BOQ when the truth is that the
  // read did not answer.
  useEffect(() => {
    if (levelPath.length === 0) {
      setServerLevel(null);
      setLevelError(null);
      setLevelLoading(false);
      return;
    }
    let live = true;
    setLevelLoading(true);
    setLevelError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ path: levelPath.join(",") });
        if (projectId) qs.set("projectId", projectId);
        const res = await fetch(`/api/chain-options?${qs.toString()}`);
        const d = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) {
          setServerLevel(null);
          setLevelError(d?.error || `Couldn't load the next step (HTTP ${res.status})`);
          return;
        }
        setServerLevel(d as ChainOptionsLevel);
      } catch {
        if (live) {
          setServerLevel(null);
          setLevelError("Couldn't reach the construction data service.");
        }
      } finally {
        if (live) setLevelLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [levelPath, projectId, levelReload]);

  // The action level is local -- it is PROJEXA's own catalogue (C-12), not a
  // read -- so it renders instantly, before any fetch.
  const actionLevel = useMemo(() => (routeCard ? actionLevelFor(routeCard) : null), [routeCard]);

  /**
   * *** ONE CLICK, ONE SEGMENT, NO EXECUTION. ***
   *
   * Advancing appends the picked option to the strip AND to the level path,
   * so the sentence the user reads and the question the server is asked can
   * never describe different things. Nothing here posts.
   */
  const onLevelAdvance = useCallback(
    (seg: { id: string; label: string }) => {
      setSegments((prev) => [
        ...prev,
        { id: `${LEVEL_SEGMENT_PREFIX}${levelPath.length}:${seg.id}`, label: seg.label, kind: "step" as const },
      ]);
      setLevelPath((prev) => [...prev, seg.id]);
      setScalarValue("");
      setScalarError(null);
    },
    [levelPath.length]
  );

  /** Starting the walk from an action chip: the level path opens with the card. */
  const onActionAdvance = useCallback(
    (seg: { id: string; label: string }) => {
      if (!routeCard) return;
      const action = cardActionById(routeCard, seg.id);
      setSegments((prev) => [
        ...prev,
        { id: `${LEVEL_SEGMENT_PREFIX}0:${seg.id}`, label: action?.label ?? seg.label, kind: "action" as const },
      ]);
      setLevelPath([routeCard.id, seg.id]);
      setScalarValue("");
      setScalarError(null);
    },
    [routeCard]
  );

  // Whether the deepest level asks for a number the user already knows. The
  // chips cover the common answers; this covers every other one.
  const wantsScalar = levelPath.length >= 3 && levelPath[0] === "work_progress";

  /**
   * R67 C-04 -- WHAT SEND WOULD RUN, once the chain is a complete sentence.
   *
   * Null until every value the write needs is on the strip, which is what
   * lets the composer say "Pick a BOQ line" instead of accepting a Send that
   * can only come back blocked. `itemCode` is the chain's own segment id --
   * see chain-options.ts's boqLineOptions() for why the chip carries the item
   * code rather than the row id.
   */
  const chainRun = useMemo(() => {
    if (levelPath[0] !== "work_progress" || levelPath[1] !== "record_progress") return null;
    const itemCode = levelPath[2];
    if (!itemCode) return null;
    const percent = Number(levelPath[3] ?? scalarValue);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    return { functionId: "record_work_progress", params: { itemCode, percent } };
  }, [levelPath, scalarValue]);

  // *** A LEAF CLICK LOADS THE CHAIN AND STOPS. *** It appends segments and
  // nothing else: no POST, no navigation, and -- the rule C-02 exists to
  // restore -- no write into the textarea.
  const onChainAdvance = useCallback((seg: { id: string; label: string }) => {
    const leaf = reportLeafById(seg.id);
    if (leaf) {
      setReportId(leaf.id);
      setPeriodId(DEFAULT_PERIOD);
      setSegments((prev) => [
        // Choosing a second report REPLACES the first: the strip is one
        // sentence, and two report names in it read as neither.
        ...prev.filter(
          (s) => !s.id.startsWith(REPORT_SEGMENT_PREFIX) && !s.id.startsWith(PERIOD_SEGMENT_PREFIX)
        ),
        { id: `${REPORT_SEGMENT_PREFIX}${leaf.id}`, label: leaf.label, kind: "step" as const },
        // C-02: the period step is appended with the default already chosen,
        // so the sentence is complete and runnable in one click.
        {
          id: `${PERIOD_SEGMENT_PREFIX}${DEFAULT_PERIOD}`,
          label: periodLabel(DEFAULT_PERIOD),
          kind: "step" as const,
        },
      ]);
      return;
    }
    const period = PERIOD_OPTIONS.find((p) => p.id === seg.id);
    if (period) {
      setPeriodId(period.id);
      setSegments((prev) =>
        prev.map((s) =>
          s.id.startsWith(PERIOD_SEGMENT_PREFIX)
            ? { ...s, id: `${PERIOD_SEGMENT_PREFIX}${period.id}`, label: period.label }
            : s
        )
      );
    }
  }, []);

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
      const kept = cutChainFrom(chain, index).segments.filter((s) => s.kind !== "root");
      setSegments(kept);
      // R67 C-02: the strip and the composer's own state are ONE sentence. An
      // (x) that removes the report segment must also un-choose the report,
      // or Send would still run a report the strip no longer shows.
      if (!kept.some((s) => s.id.startsWith(REPORT_SEGMENT_PREFIX))) {
        setReportId(null);
        setPeriodId(DEFAULT_PERIOD);
      }
      // R67 C-04: the level path is the machine reading of the same sentence,
      // so it is cut to exactly the depth the strip was cut to. Leaving it
      // deeper would leave band 2 asking a question about a step the user has
      // just removed.
      const depth = kept.filter((s) => s.id.startsWith(LEVEL_SEGMENT_PREFIX)).length;
      setLevelPath((prev) => (depth === 0 ? [] : prev.slice(0, depth + 1)));
      setScalarValue("");
      setScalarError(null);
    },
    [chain]
  );

  const onReset = useCallback(() => {
    setSegments(resetChain(chain).segments.filter((s) => s.kind !== "root"));
    // The reset glyph clears the whole sentence, so the question a "Fix"
    // click was asking goes with it -- leaving it armed would ask about a
    // chain that is no longer on the strip.
    setFixTarget(null);
    setReportId(null);
    setPeriodId(DEFAULT_PERIOD);
    setLevelPath([]);
    setScalarValue("");
    setScalarError(null);
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
    // R67 C-02: THE SAME NAME MUST STILL REACH THE SAME DESTINATION, WITHOUT
    // WRITING INTO THE BOX.
    //
    // The 14 universal pills are CATEGORY entry points, not zero-param
    // functions, and pillFnRef is only ever populated from /api/pill-usage --
    // this user's PAST usage. The first time anyone clicks a given pill,
    // knownFunctionId is genuinely null, and onSubmit's guard used to make
    // Send a silent no-op in exactly that case. The previous fix seeded the
    // TEXTAREA with the pill's label, which restored the destination at the
    // cost of the rule M24 is most explicit about: a card or a pill never
    // types for the user. The label is carried in state instead and becomes
    // the typed path's rawInput on Send, so clicking "Customers" behaves
    // exactly like typing "customers" -- and the box stays the user's.
    setPendingRawInput(knownFunctionId ? null : sel.label);
  }, []);

  // R67 C-03: the project's REAL tasks, loaded when the card opens so the
  // Task field is a picker over what exists rather than free text -- and so
  // the fuzzy match the sentence implied can be pre-selected and CHECKED.
  const cardOpen = timesheetDraft !== null;
  useEffect(() => {
    if (!cardOpen || !projectId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`);
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          if (live) setCardError(d?.error || `Couldn't load this project's tasks (HTTP ${res.status})`);
          return;
        }
        const list: ProjectTask[] = Array.isArray(d?.tasks) ? d.tasks : [];
        if (!live) return;
        setProjectTasks(list);
        setTimesheetDraft((prev) => {
          if (!prev || prev.issueId) return prev;
          // *** AN AMBIGUOUS MATCH IS NEVER RESOLVED FOR THE USER. ***
          // resolveTaskTitle returns a task only when exactly one matches;
          // otherwise the field stays empty and Save says "pick a task".
          const match = resolveTaskTitle(list, prev.taskQuery);
          return match ? { ...prev, issueId: match.id, unmatched: false } : { ...prev, unmatched: true };
        });
      } catch {
        if (live) setCardError("Couldn't reach this project's tasks.");
      }
    })();
    return () => {
      live = false;
    };
  }, [cardOpen, projectId]);

  /**
   * R67 C-03 -- SAVE. The ONLY thing on this card that writes.
   *
   * It posts through /api/timesheets, the same route Design Studio's own
   * screen uses and the one measured returning 201 on the demo org, rather
   * than a second write path for the same table.
   */
  const onSaveTimesheet = useCallback(async () => {
    const draft = timesheetDraft;
    if (!draft || cardBusy) return;
    setCardBusy(true);
    setCardError(null);
    try {
      const res = await fetch("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId: draft.issueId,
          hours: draft.hours,
          spentOn: draft.spentOn,
          activityType: draft.activityType || undefined,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setCardError(
          d && typeof d.error === "string" && d.error.trim() ? d.error : `Couldn't log the time (HTTP ${res.status})`
        );
        return;
      }
      const task = projectTasks.find((t) => t.id === draft.issueId) ?? null;
      setReceipt({
        text: timesheetReceiptLine({ hours: draft.hours, task }),
        href: timesheetRoute(projectId),
      });
      setTimesheetDraft(null);
      setDraft("");
      router.push(timesheetRoute(projectId));
      await loadTasks();
    } catch {
      setCardError("Couldn't reach the time service.");
    } finally {
      setCardBusy(false);
    }
  }, [timesheetDraft, cardBusy, projectTasks, projectId, router, loadTasks]);

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
    const typed = draft.trim() || pendingRawInput?.trim() || "";
    // R67 C-02: a third runnable shape -- a report leaf chosen in band 2.
    const runningReport = reportsChainActive && reportId ? reportId : null;
    if (!typed && !pendingFunctionId && !runningReport && !chainRun) return;
    setSubmitting(true);
    setSubmitError(null);
    setBandNote(null);
    try {
      // R67 C-03 -- PREVIEW BEFORE WRITE, for the typed path.
      //
      // POST /api/classify is VERIDIAN's own read-only half of the pipeline:
      // it resolves the sentence and returns `executed: false` in every
      // response. When it reads the sentence as a TIMESHEET, band 2 shows the
      // confirmation card and NOTHING is posted to /api/tasks -- the hours
      // are written only when the user presses Save on that card.
      //
      // Scoped to the one registered write that has a card today. Every other
      // verdict falls through to the existing submit unchanged, so this
      // cannot quietly change what any other sentence does.
      if (typed && !pendingFunctionId && !runningReport && !chainRun) {
        const preview = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawInput: typed, mode, projectId }),
        });
        const p = await preview.json().catch(() => null);
        const segs: {
          verdict?: string;
          functionId?: string | null;
          params?: Record<string, unknown>;
          derivedChain?: { full?: string } | null;
        }[] = preview.ok && Array.isArray(p?.segments) ? p.segments : [];
        const timesheet = segs.find((s) => s.functionId === "record_timesheet");
        if (timesheet) {
          const params = timesheet.params ?? {};
          const hours = typeof params.hours === "number" ? String(params.hours) : String(params.hours ?? "");
          setTimesheetDraft({
            sentence: timesheet.derivedChain?.full ?? "Timesheet › New entry",
            issueId: "",
            hours,
            spentOn:
              typeof params.spentOn === "string" ? params.spentOn : new Date().toISOString().slice(0, 10),
            activityType: typeof params.activityType === "string" ? params.activityType : "",
            typed,
            taskQuery: typeof params.task === "string" ? params.task : "",
            unmatched: false,
          });
          setProjectTasks([]);
          setCardError(projectId ? null : "Pick a project in the top rail before logging time.");
          return;
        }
        // A preview that could not be reached is not a reason to refuse: the
        // submit below is the authority and re-runs the same ladder.
      }

      const range = runningReport ? resolvePeriod(periodId, new Date()) : null;
      const body = runningReport
        ? {
            // The REPORT archetype's own registry function id -- the same one
            // compliance.screen_definitions carries for this screen.
            functionId: "reports.report",
            params: { report: runningReport, projectId, from: range!.from, to: range!.to },
            mode,
            projectId,
          }
        : chainRun
          ? // R67 C-04: the chain the user BUILT, run only now, on a
            // deliberate Send. Every chip click before this one loaded and
            // stopped.
            { functionId: chainRun.functionId, params: chainRun.params, mode, projectId }
          : pendingFunctionId
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
      if (runningReport && range) {
        const leaf = reportLeafById(runningReport);
        const href = reportRoute({ report: runningReport, projectId, from: range.from, to: range.to });
        // ONE RECEIPT LINE, in band 2, naming what ran, for which project and
        // over which dates -- so the answer to "did that do anything?" is on
        // screen instead of inferred from a pane that changed.
        setReceipt({
          text: reportReceiptLine({
            reportLabel: leaf?.label ?? "report",
            projectName: project?.name ?? null,
            from: range.from,
            to: range.to,
          }),
          href,
        });
        // If the pipeline could not RECORD the run, say so in its own words
        // rather than letting a clean receipt imply an audit row that does
        // not exist. The screen still opens: opening it is a read.
        const messages = Array.isArray(d?.chatMessages) ? (d.chatMessages as unknown[]) : [];
        if (d?.status === "failed" && typeof messages[0] === "string") {
          setBandNote(maskTechnical(messages[0]));
        }
        router.push(href);
      }
      if (chainRun) {
        // The chain has been run, so the question band 2 was asking is
        // answered: clear the walk and leave the receipt in its place. The
        // strip keeps the sentence, which is the record of what was done.
        const label = segments.find((s) => s.id.startsWith(`${LEVEL_SEGMENT_PREFIX}1:`))?.label;
        setReceipt({
          text: `Recorded ${chainRun.params.percent}% on ${label ?? chainRun.params.itemCode}`,
          href: `/work-progress${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
        });
        setLevelPath([]);
        setScalarValue("");
        setScalarError(null);
      }
      setDraft("");
      setPendingFunctionId(null);
      setPendingRawInput(null);
      // The minted task must APPEAR. That is the last step of R-80 and the
      // only part of the path a unit test cannot stand in for.
      await loadTasks();
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [
    draft,
    pendingRawInput,
    pendingFunctionId,
    reportsChainActive,
    reportId,
    periodId,
    chainRun,
    segments,
    project,
    mode,
    projectId,
    submitting,
    loadTasks,
    router,
  ]);

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

  const [activeTab, setActiveTab] = useState<TaskTabId>("home");

  // A dismissed row leaves BOTH the list and the count, because they are now
  // computed from the same array.
  const visibleGroups = useMemo<GroupedRows>(() => {
    if (dismissedIds.length === 0) return taskData.groups;
    const hidden = new Set(dismissedIds);
    const keep = (rows: ProjexaTaskRow[]) => rows.filter((r) => !hidden.has(r.id));
    return {
      needsYou: keep(taskData.groups.needsYou),
      running: keep(taskData.groups.running),
      done: keep(taskData.groups.done),
      blocked: keep(taskData.groups.blocked),
    };
  }, [taskData.groups, dismissedIds]);

  // R67 C-01: every tab's rows AND its badge, from one pure function
  // (task-row.ts's tabView) over one set of rows. Computed for ALL FIVE tabs,
  // not just the active one, because the badges are visible while another tab
  // is open and a badge that is only correct once clicked is not a badge.
  const views = useMemo(() => {
    const out = {} as Record<TaskTabId, ReturnType<typeof tabView>>;
    for (const id of TASK_TAB_IDS) out[id] = tabView(visibleGroups, id, taskData.loadedAt);
    return out;
  }, [visibleGroups, taskData.loadedAt]);

  const activeView = views[activeTab];

  const tabs: TaskTab[] = [
    { id: "home", label: "Home", count: views.home.count },
    { id: "approval-pending", label: "Approval Pending", count: views["approval-pending"].count },
    { id: "in-queue", label: "In Queue", count: views["in-queue"].count },
    { id: "completed", label: "Completed", count: views.completed.count },
    { id: "history", label: "History", count: views.history.count },
  ];

  // *** RETRY IS THE ONLY ROW ACTION THAT TOUCHES THE SERVER. *** It re-posts
  // the IDENTICAL body, and only for a transport failure -- BACKEND_UNAVAILABLE
  // means nothing was written, so repeating it cannot double-write. Every
  // other action loads the chain and stops.
  const retryTask = useCallback(
    async (row: ProjexaTaskRow) => {
      if (submitting) return;
      const body = row.functionId
        ? { functionId: row.functionId, params: row.params, mode: row.chain.mode, projectId: row.projectId }
        : row.rawInput
          ? { rawInput: row.rawInput, mode: row.chain.mode, projectId: row.projectId }
          : null;
      if (!body) {
        setSubmitError("This row carries nothing to retry.");
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          setSubmitError(
            d && typeof d.error === "string" && d.error.trim() ? d.error : `Retry failed (HTTP ${res.status})`
          );
          return;
        }
        await loadTasks();
      } catch {
        setSubmitError("Couldn't reach the task service.");
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, loadTasks]
  );

  const onRowAction = useCallback(
    (row: ProjexaTaskRow, action: RowAction) => {
      if (action.kind === "dismiss") {
        setDismissedIds((prev) => {
          const next = prev.includes(row.id) ? prev : [...prev, row.id];
          try {
            localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }
      if (action.kind === "retry") {
        void retryTask(row);
        return;
      }
      // "fix": LOADS THE CHAIN AND STOPS. It arms no functionId, so the next
      // Send is a deliberate second act by the user and this button can never
      // re-run the write that failed.
      setMode(row.chain.mode);
      setSegments(row.chain.segments.filter((s) => s.kind !== "root"));
      if (row.projectId) setProjectId(row.projectId);
      setSubmitError(null);
      setFixTarget({ taskId: row.id, functionId: row.functionId, missingStep: action.missingStep });
    },
    [retryTask]
  );

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

  // NO FAIL-AFTER-CLICK: the card's primary button carries its own reason,
  // in its own label, derived from the same values that disable it.
  const timesheetBlockedReason = !timesheetDraft
    ? undefined
    : !projectId
      ? "pick a project"
      : !timesheetDraft.issueId
        ? "pick a task"
        : !(Number(timesheetDraft.hours) > 0)
          ? "type the hours"
          : !timesheetDraft.spentOn
            ? "pick a date"
            : undefined;

  const fieldClass = "rounded border px-2 py-1 text-[12px]";
  const fieldStyle = { borderColor: "var(--color-ct-border2)", color: "var(--color-ct-navy)" } as const;

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
          // The active tab's OWN rows, with its OWN heading and its OWN empty
          // sentence -- all three from task-row.ts's tabView, so the tab that
          // is highlighted is the tab that is rendered.
          primary={{ label: activeView.primaryLabel, empty: activeView.primaryEmpty, rows: activeView.primary }}
          secondary={
            activeView.secondary
              ? {
                  label: activeView.secondaryLabel ?? "Waiting on others",
                  empty: activeView.secondaryEmpty ?? "Nothing outstanding with anyone else.",
                  rows: activeView.secondary,
                  // ONE-LINE for waiting. The density difference is itself a
                  // signal about which group matters (M24).
                  twoLine: false,
                }
              : undefined
          }
          onLoad={onLoadChain}
          onRowAction={onRowAction}
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
              {/* R67 C-03 / D-10: PROJEXA's OWN CARDS, ahead of the kit's
                  ranked pills. They are here rather than inside PillStrip
                  because the kit's PillKey union is closed at fourteen and
                  this catalogue is PROJEXA's (correction C-12) -- adding a
                  key to the kit would be a release this programme does not
                  take (D-09). A card click loads the chain and stops. */}
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onCardSelect(card)}
                  className="veri-rchip"
                  aria-label={`${card.label} — opens the ${card.label} screen`}
                >
                  {card.label}
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
          // BAND 2 -- THE CONVERSATION BAND. Declared by the kit's Composer
          // since it shipped and never rendered by anything. It carries the
          // question the chain is asking (the kit's OptionChain, mounted at
          // last) and the receipt for what was just run.
          conversation={
            bandLevel || receipt || bandNote || timesheetDraft || levelPath.length > 0 || actionLevel ? (
              <div className="space-y-2">
                {timesheetDraft && (
                  <ConfirmCard
                    title={timesheetDraft.sentence}
                    error={cardError}
                    busy={cardBusy}
                    primaryLabel={timesheetBlockedReason ? `Save (${timesheetBlockedReason})` : "Save"}
                    primaryDisabledReason={timesheetBlockedReason}
                    onPrimary={() => void onSaveTimesheet()}
                    secondaryLabel="Edit"
                    onSecondary={() => {
                      // Back to the sentence, with nothing written and the
                      // user's own words restored so they can correct them.
                      setDraft(timesheetDraft.typed);
                      setTimesheetDraft(null);
                      setCardError(null);
                    }}
                    fields={[
                      {
                        id: "task",
                        label: "Task",
                        note: timesheetDraft.unmatched && timesheetDraft.taskQuery
                          ? `"${timesheetDraft.taskQuery}" did not match exactly one task`
                          : undefined,
                        control: (
                          <select
                            className={fieldClass}
                            style={fieldStyle}
                            value={timesheetDraft.issueId}
                            onChange={(e) =>
                              setTimesheetDraft((prev) =>
                                prev ? { ...prev, issueId: e.target.value, unmatched: false } : prev
                              )
                            }
                          >
                            <option value="">Pick a task…</option>
                            {projectTasks.map((t) => (
                              <option key={t.id} value={t.id}>
                                #{t.number} {t.title}
                              </option>
                            ))}
                          </select>
                        ),
                      },
                      {
                        id: "category",
                        label: "Category",
                        control: (
                          <input
                            type="text"
                            className={fieldClass}
                            style={fieldStyle}
                            value={timesheetDraft.activityType}
                            placeholder="optional"
                            onChange={(e) =>
                              setTimesheetDraft((prev) => (prev ? { ...prev, activityType: e.target.value } : prev))
                            }
                          />
                        ),
                      },
                      {
                        id: "date",
                        label: "Date",
                        control: (
                          <input
                            type="date"
                            className={fieldClass}
                            style={fieldStyle}
                            value={timesheetDraft.spentOn}
                            onChange={(e) =>
                              setTimesheetDraft((prev) => (prev ? { ...prev, spentOn: e.target.value } : prev))
                            }
                          />
                        ),
                      },
                      {
                        id: "hours",
                        label: "Hours",
                        control: (
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            className={fieldClass}
                            style={fieldStyle}
                            value={timesheetDraft.hours}
                            onChange={(e) =>
                              setTimesheetDraft((prev) => (prev ? { ...prev, hours: e.target.value } : prev))
                            }
                          />
                        ),
                      },
                    ]}
                  />
                )}
                {/* R67 C-04: ENTITY > ACTION > STEP. The action level is
                    PROJEXA's own catalogue and renders instantly; every level
                    after it comes from the server through the proxy, with a
                    real loading state and a real error state -- never an
                    empty chip row standing in for either. */}
                {levelPath.length > 0 ? (
                  <ChainOptionsPanel
                    level={serverLevel}
                    loading={levelLoading}
                    loadingLegend={levelPath.length === 2 ? "Which BOQ line?" : "How much?"}
                    error={levelError}
                    onRetry={() => setLevelReload((n) => n + 1)}
                    onAdvance={onLevelAdvance}
                    onEmptyAction={(route) => router.push(route)}
                  />
                ) : actionLevel ? (
                  <ChainOptionsPanel level={actionLevel} onAdvance={onActionAdvance} />
                ) : null}
                {bandLevel && (
                  <ChainOptionsPanel
                    level={bandLevel}
                    selectedId={bandSelectedId}
                    onAdvance={onChainAdvance}
                    onEmptyAction={(route) => router.push(route)}
                  />
                )}
                {receipt && (
                  <p className="text-[12px]" style={{ color: "var(--color-ct-navy)" }}>
                    {receipt.text}{" "}
                    <button
                      type="button"
                      className="veri-view-tab"
                      onClick={() => router.push(receipt.href)}
                    >
                      Open
                    </button>
                  </p>
                )}
                {bandNote && (
                  <p className="text-[11.5px]" style={{ color: "var(--color-ct-muted)" }}>
                    {bandNote}
                  </p>
                )}
              </div>
            ) : undefined
          }
          // BAND 4 -- the chain's SCALAR value, as a labelled field beside the
          // box, validated on blur. The chips above cover 25/50/75/100; a
          // site engineer with 37% types it here rather than being told those
          // are the only answers. Same pattern as /labour/new's "Save (Name,
          // Daily Rate)": the field says what it wants before the click.
          fieldsSlot={
            wantsScalar ? (
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
                  Quantity or %
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  className="w-28 rounded border px-2 py-1 text-[12px]"
                  style={{ borderColor: "var(--color-ct-border2)", color: "var(--color-ct-navy)" }}
                  value={levelPath[3] ?? scalarValue}
                  onChange={(e) => {
                    setScalarValue(e.target.value);
                    setScalarError(null);
                  }}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      setScalarError(null);
                      return;
                    }
                    const n = Number(raw);
                    setScalarError(
                      Number.isFinite(n) && n >= 0 && n <= 100 ? null : "Type a number between 0 and 100"
                    );
                  }}
                  aria-invalid={scalarError ? true : undefined}
                  aria-describedby={scalarError ? "veri-scalar-error" : undefined}
                />
                {scalarError && (
                  <span
                    id="veri-scalar-error"
                    role="alert"
                    className="text-[10.5px]"
                    style={{ color: "var(--color-veri-status-late)" }}
                  >
                    {scalarError}
                  </span>
                )}
              </label>
            ) : undefined
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
          // R67 C-02: on the Reports screen the sentence that is true is the
          // one about REPORTS -- "Pick a project or a module first" is
          // neither, on the screen the module is already open.
          disabledReason={
            submitError ??
            (submitting
              ? "Sending…"
              : levelPath.length >= 2 && !chainRun
                ? // R67 C-04: the chain is half-built. Say which answer is
                  // still missing rather than letting Send fire a submission
                  // that can only come back blocked.
                  levelPath.length === 2
                  ? "Pick a BOQ line"
                  : "Type quantity or %"
                : projectId || pendingFunctionId || pendingRawInput || reportId || chainRun
                  ? undefined
                  : onReportsRoute
                    ? "Choose a report or type what you need"
                    : "Pick a project or a module first")
          }
          // With a module armed -- or a report leaf chosen -- there is
          // something to run, so an empty input is a real submission and Send
          // stays live, which is what the placeholder has always claimed.
          // Without one, the empty input is genuinely blocking and gets the
          // sentence that says so.
          allowEmptySubmit={Boolean(pendingFunctionId || pendingRawInput || (reportsChainActive && reportId) || chainRun)}
          emptyInputReason="Type what you need, then press Send."
          placeholder={
            // A Fix click loaded a chain and stopped; the box then asks the
            // ONE question that row was blocked on, rather than repeating the
            // generic prompt and leaving the user to work it out.
            (fixTarget?.missingStep ? FIX_PROMPT[fixTarget.missingStep] : undefined) ??
            // R67 C-03: on the card's own screen the box shows the sentence
            // that screen understands, so a first-time user can see the shape
            // of what to type instead of guessing at "describe what you need".
            routeCard?.placeholder ??
            (pendingFunctionId || pendingRawInput || (reportsChainActive && reportId)
              ? "Press send to run this, or add detail first…"
              : "Describe what you need, or pick a module above.")
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
