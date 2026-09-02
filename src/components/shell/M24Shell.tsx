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
  TaskMaster,
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
// R67 D-66/D-04: the kit's TopRail exposes no picker slot -- onSwitchProject
// is a bare callback, which is why this shell was CYCLING through projects
// one click at a time. Per D-09 the component is forked into projexa rather
// than released in the kit; everything else here still comes from the kit.
import { TopRail } from "@/components/shell/TopRail";
import { ProjectScopeProvider } from "@/components/shell/project-context";
import { PROJECT_COOKIE } from "@/lib/project-selection";
import { createClient } from "@/lib/supabase/client";
import { describeReadError, taskRowDetail } from "@/lib/task-errors";
import { asOfLabel } from "@/lib/pane-state";

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

// ─── R67 D-20: the rail-to-page sync contract ────────────────────────────
//
// THE SPLIT-BRAIN THIS CLOSES. This shell held its own `projectId` state
// (below) and the pages under it read `?projectId=` from the URL. Nothing
// connected the two. So the rail could say "All projects" while /moms
// rendered Cedar Heights, and switching project in the rail changed the
// composer's chain root without the page beneath it re-querying anything.
//
// THE RULE, one sentence: THE URL WINS. A route that carries ?projectId=
// sets this shell's state (never the other way round), and switching in the
// rail writes that same parameter -- preserving every OTHER parameter, so a
// list's own filter survives a project switch -- which is what makes the
// page re-query with the new id. The cookie is only a memory of the last
// choice, consulted when the URL says nothing at all.
const PROJECT_PARAM = "projectId";
// R67 D-66: the name lives in src/lib/project-selection.ts, which the SERVER
// components that read this cookie also import -- the writer and the readers
// cannot drift apart on a string literal.
const PROJECT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readProjectCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${PROJECT_COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(PROJECT_COOKIE.length + 1));
  return value || null;
}

function writeProjectCookie(projectId: string | null) {
  if (typeof document === "undefined") return;
  // A project id the user picked themselves -- not a credential, not
  // personal data. Lax so it is not sent on cross-site requests at all.
  document.cookie = projectId
    ? `${PROJECT_COOKIE}=${encodeURIComponent(projectId)}; path=/; max-age=${PROJECT_COOKIE_MAX_AGE}; SameSite=Lax`
    : `${PROJECT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

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
  // R67 D-03's 'needs_input' payload, added additively by
  // compliance-tracker's GET /api/v1/projexa/tasks. Optional because a row
  // that failed outside the closed five-code set carries no code at all, and
  // because an older backend simply will not send these fields.
  code?: string | null;
  missing?: string[] | null;
  errorContext?: { lineCode?: string; boqVersion?: number } | null;
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
  projectNameById: (id: string | null | undefined) => string | null
): TaskRow {
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
    // to find out, which is the load being removed."
    //
    // R67 D-03: it used to be `t.error ?? t.rawInput`, which put the executor's
    // developer text on screen -- "itemCode is required", "no project resolved
    // for this task", and (until the R66 fix) an internal IP:port. The
    // dictionary in src/lib/task-errors.ts turns the server's {code, missing}
    // into one closed-vocabulary sentence and, where the row failed for a
    // reason outside that set, passes the backend's own words through ONLY
    // when they are safe to show. The rawInput fallback for a healthy row is
    // unchanged.
    detail: taskRowDetail(
      { code: t.code, missing: t.missing, errorContext: t.errorContext, error: t.error, projectName: projectNameById(t.projectId) },
      t.rawInput
    ),
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
  const pathname = usePathname();

  const [mode, setMode] = useState<ChainMode>(DEFAULT_CHAIN_MODE);
  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pillUsage, setPillUsage] = useState<PillUsage[]>([]);
  const [rankedPills, setRankedPills] = useState<RankedPill[]>([]);
  const [needsYou, setNeedsYou] = useState<TaskRow[]>([]);
  const [waiting, setWaiting] = useState<TaskRow[]>([]);
  // R67 D-55/D-65: what the transport actually said, not a pre-formatted
  // sentence -- so the ONE shared dictionary in src/lib/task-errors.ts writes
  // the words, exactly as it already does for a failed task row.
  const [tasksError, setTasksError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [tasksLoadedAt, setTasksLoadedAt] = useState<Date | null>(null);
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
  // R67 D-55: null, not 0. A tab badge reading 0 over a failed read is a
  // claim nobody made; the kit renders no badge at all for an absent count,
  // which is the honest rendering of "we have not been told".
  const [counts, setCounts] = useState<{ home: number | null; approval: number | null; queue: number | null }>({
    home: null,
    approval: null,
    queue: null,
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
          // R67 D-66: "the list is empty" and "the list has not answered" are
          // different facts, and the chooser card says different things for
          // each. Only a 2xx sets this.
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
  // R67 D-03: BOQ_LINE_NOT_FOUND's sentence names the project ("There is no
  // line 1.01 on Cedar Heights Villa v2 -- pick a line"), and the task rows
  // carry a projectId, not a name. Held in a ref rather than a dependency so
  // loadTasks keeps its stable identity -- adding `projects` to its deps would
  // re-run the mount effect below on every project-list load.
  const projectsRef = useRef<Project[]>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  const projectNameById = useCallback(
    (id: string | null | undefined) => (id ? projectsRef.current.find((p) => p.id === id)?.name ?? null : null),
    []
  );

  const loadTasks = useCallback(async () => {
    {
      try {
        const res = await fetch("/api/tasks?limit=50");
        // Status before body: an error body parses perfectly well as JSON, and
        // treating it as data is how a failed request becomes a confident
        // empty list.
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          setTasksError({
            status: res.status,
            message: d && typeof d.error === "string" && d.error.trim() ? d.error : null,
          });
          // The counts are forgotten, not kept: a badge left over from the
          // last successful read would be asserting a number this read did
          // not confirm.
          setCounts({ home: null, approval: null, queue: null });
          return;
        }
        const data = (d ?? {}) as ApiTasks;
        setTasksError(null);
        setTasksLoadedAt(new Date());
        setCounts({
          home: Number(data.counts?.total) || 0,
          approval: Number(data.counts?.needsYou) || 0,
          queue: Number(data.counts?.running) || 0,
        });
        const g = data.groups ?? {};
        // "Needs you" carries what is stuck on the user: blocked first, because
        // a blocked row is the only loud one and the one that costs time.
        setNeedsYou([
          ...(g.blocked ?? []).map((t) => toTaskRow(t, "blocked", projectNameById)),
          ...(g.needsYou ?? []).map((t) => toTaskRow(t, "needsYou", projectNameById)),
        ]);
        // "Waiting on others" is everything not on the user's desk.
        setWaiting([
          ...(g.running ?? []).map((t) => toTaskRow(t, "running", projectNameById)),
          ...(g.done ?? []).map((t) => toTaskRow(t, "done", projectNameById)),
        ]);
      } catch (err) {
        setTasksError({ status: null, message: err instanceof Error ? err.message : null });
        setCounts({ home: null, approval: null, queue: null });
      }
    }
  }, [projectNameById]);

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

  // R67 D-20, the reading half of the contract: THE URL WINS. Read on mount,
  // on every route change, and on back/forward -- the same three triggers the
  // Task Master tab param below already uses, and for the same reason
  // (`window.location.search` rather than useSearchParams, so this shell,
  // which wraps all 53 routes, does not put every one of them behind a
  // Suspense boundary it does not otherwise need).
  //
  // With no ?projectId= in the URL the cookie is consulted ONCE, as a memory
  // of the user's last choice. It never overrides the URL, and it never
  // supplies a project to a screen that has opted into the all-projects mode
  // -- that screen reads the URL server-side, not this state.
  const adoptedCookie = useRef(false);
  useEffect(() => {
    const syncFromUrl = () => {
      const fromUrl = new URLSearchParams(window.location.search).get(PROJECT_PARAM);
      if (fromUrl) {
        adoptedCookie.current = true;
        setProjectId(fromUrl);
        writeProjectCookie(fromUrl);
        return;
      }
      if (!adoptedCookie.current) {
        adoptedCookie.current = true;
        const remembered = readProjectCookie();
        if (remembered) setProjectId(remembered);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [pathname]);

  // The writing half: switching project navigates, carrying every OTHER
  // search parameter through untouched so a list's filter (D-16's status /
  // date range / attendee, held in the URL) survives the switch instead of
  // being silently reset. scroll:false so the page does not jump.
  const selectProject = useCallback(
    (next: Project | null) => {
      setProjectId(next ? next.id : null);
      writeProjectCookie(next ? next.id : null);
      const params = new URLSearchParams(window.location.search);
      if (next) params.set(PROJECT_PARAM, next.id);
      else params.delete(PROJECT_PARAM);
      const qs = params.toString();
      router.push(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router]
  );

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  // R67 D-66 -- ONE ProjectContext. The rail, the breadcrumb, the composer
  // root and every page read the project from here and from nothing else, so
  // the disagreement R-253 recorded ("All projects" in the rail over
  // "Dashboard / Cedar Heights Villa" in the breadcrumb) has no second source
  // left to come from. `mode` is derived inside the provider, never stored.
  //
  // openSwitcher is a monotonic counter rather than a boolean: a breadcrumb
  // clicked twice must open the rail's list twice, and a boolean that is
  // already true is a no-op the second time.
  const [switcherOpenSignal, setSwitcherOpenSignal] = useState(0);
  const openSwitcher = useCallback(() => setSwitcherOpenSignal((n) => n + 1), []);
  const projectScope = useMemo(
    () => ({ projects, project, projectId, projectsLoaded, selectProject, openSwitcher }),
    [projects, project, projectId, projectsLoaded, selectProject, openSwitcher]
  );

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
      await loadTasks();
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, pendingFunctionId, mode, projectId, submitting, loadTasks]);

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
    { id: "home", label: "Home", count: counts.home ?? undefined },
    { id: "approval-pending", label: "Approval Pending", count: counts.approval ?? undefined },
    { id: "in-queue", label: "In Queue", count: counts.queue ?? undefined },
    // M24: Completed and History carry no count -- nothing there needs action.
    { id: "completed", label: "Completed" },
    { id: "history", label: "History" },
  ];
  const [activeTab, setActiveTab] = useState<TaskTab["id"]>("home");

  // "Couldn't load your tasks - ... (UPSTREAM_TIMEOUT)." from the same
  // dictionary a failed task row uses. Never "Nothing is waiting on you."
  const taskReadError = tasksError ? describeReadError("your tasks", tasksError) : null;

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
          // R67 D-66/D-04: a real list, not a cycle. "All projects" on top
          // (M24: "THE PROJECT SELECTOR NEEDS A NULL STATE so CRM, pipeline
          // and org-level work are reachable"), then every project, the
          // current one marked. R67 D-20: choosing one writes the URL through
          // selectProject(), so the page under the rail re-queries with the
          // new id instead of the rail and the page disagreeing.
          projects={projects}
          onSelectProject={selectProject}
          // R67 D-66: the breadcrumb's project name and the "pick a project"
          // chooser card both open THIS list rather than each growing a
          // switcher of their own.
          openSignal={switcherOpenSignal}
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
        {taskReadError ? (
          // Never an empty list in place of an error -- that is the exact
          // defect this codebase has shipped repeatedly, and it makes a broken
          // backend indistinguishable from "you have nothing to do".
          //
          // R67 D-55/D-65: the kit's TaskMaster prints "Nothing is waiting on
          // you." whenever BOTH lists are empty, so on a failure it is
          // rendered only when real rows survive from an earlier read --
          // greyed, and labelled with when they were true. The sentence comes
          // from the one shared dictionary, and Retry re-issues the read
          // rather than reloading the whole route.
          <div className="flex h-full flex-col">
            <div className="m-2 shrink-0 rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border)" }}>
              <p role="alert" className="text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>
                {taskReadError.sentence}
              </p>
              {taskReadError.detail && (
                <p className="mt-1 text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
                  {taskReadError.detail}
                </p>
              )}
              <button type="button" onClick={() => void loadTasks()} className="veri-view-tab mt-2">
                Retry
              </button>
            </div>
            {needsYou.length + waiting.length > 0 && (
              <div className="min-h-0 flex-1 opacity-70">
                <p className="px-3 pb-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
                  Showing what loaded {asOfLabel(tasksLoadedAt) ?? "earlier"}.
                </p>
                <TaskMaster
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabChange={onTabChange}
                  needsYou={needsYou}
                  waitingOnOthers={waiting}
                  onLoad={onLoadChain}
                />
              </div>
            )}
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
            // R67 D-66: the rail is where a project is chosen, so the reason
            // names that control rather than leaving the user to find it.
            (submitting ? "Sending…" : projectId || pendingFunctionId ? undefined : "Pick a project in the top bar")
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
      {/* R67 D-66: everything under the shell -- every module page, every
          breadcrumb, every chooser card -- reads the project from here.
          Nothing below this line derives its own. */}
      <ProjectScopeProvider value={projectScope}>{children}</ProjectScopeProvider>
    </AppShell>
  );
}
