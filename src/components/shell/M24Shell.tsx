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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AppShell,
  COMPOSER_PILLS_BAND_RESERVE,
  OptionChain,
  TaskMaster,
  TopRail,
  cutChainFrom,
  resetChain,
  DEFAULT_CHAIN_MODE,
  type Chain,
  type ChainLoad,
  type ChainMode,
  type ChainOption,
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
import { PillStrip, type CardView, type ModuleEntryView, type RecentCardView } from "./PillStrip";
import { useShellScreen, type ScreenProjectSource } from "./shell-screen-context";
import {
  CARD_CATALOGUE,
  KIND_GLYPH,
  KIND_WORD,
  cardHref,
  cardUnmetReason,
  rankCards,
  rankedKeyForCard,
  targetForCard,
  type CardDef,
  type CardPreconditionId,
  type RankedEntry,
} from "@/lib/card-catalogue";
import {
  PILL_CATALOGUE,
  matchPillShortcut,
  pillEntryById,
  shortcutLabel,
  type PillEntry,
} from "@/lib/pill-catalogue";
import {
  canSend as canSendFrom,
  chainPrompt,
  sendLabel as sendLabelFor,
  type ComposerState,
} from "@/lib/chain-status";
import { deriveMode } from "@/lib/chain-mode";
import { navigationOutcome } from "@/lib/chain-navigation";
import { pickProject, readStoredProjectId, writeStoredProjectId } from "@/lib/project-preference";
import { useScreenModule } from "./use-screen-module";
import {
  MODULE_CATALOGUE,
  chainOptionsFor,
  moduleForPill,
  moduleHref,
  moduleRoute,
  noProjectPromptFor,
  normalisePathname,
  pillPointsAtCurrentScreen,
  type ModuleDef,
  type ModuleLeaf,
} from "@/lib/module-catalogue";
import { HOME_ROUTE } from "@/components/veri-chat/veri-chat-context";
import { SearchTrigger } from "@/components/search-command";
import { NotificationBell } from "@/components/NotificationBell";
import AccountMenu from "@/components/shell/AccountMenu";
import { createClient } from "@/lib/supabase/client";

// Ranking input, per user, per browser. localStorage rather than
// sessionStorage on purpose: this is the OFFLINE fallback ordering for when
// the server's own ranking does not answer, and a fallback that forgot itself
// every session would be no fallback at all.
const PILL_USAGE_KEY = "veri.pill.usage";

// R67 A-07 -- the last ranking the SERVER gave this browser, painted on the
// next first render so the strip never shows one set of cards and then swaps
// it for another. It is a cache of a server answer, never an input to one.
const RANKED_CARDS_KEY = "veri.pill.ranked";

// R67 A-07 -- how long a newly arrived ranking waits after the user last
// touched the band. Re-ordering cards under a moving finger is how a person
// clicks "Run WPR" and gets "Record progress"; five seconds is long enough
// that a deliberate reach is never overtaken, and short enough that the next
// navigation always applies the fresh order anyway.
const RANK_SETTLE_MS = 5000;

// R67 A-05. MODE_KEY ("veri.chain.mode") is GONE. It backed a row of three
// tabs -- Projects | Customers | Vendors -- that changed nothing on PROJEXA
// but their own colour, and a piece of sticky state remembering which one was
// lit. The VALUE still travels: POST /api/v1/projexa/tasks stores it on the
// submission row. It is now DERIVED from the chain by deriveMode(), because a
// chain whose first chosen step is Customers is a customers chain whether or
// not anyone clicked a tab. The request body is byte-for-byte unchanged.

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
  const route = mod ? moduleRoute(mod, t.projectId ?? railProjectId) : undefined;
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

/**
 * R67 A-13 -- THE URL'S OWN ?projectId=, reported up to the shell.
 *
 * WHY IT IS A SEPARATE COMPONENT BEHIND A SUSPENSE BOUNDARY. useSearchParams()
 * opts its whole page out of static rendering unless it sits inside one, and
 * this shell wraps all 161 app routes -- so calling it in M24Shell directly
 * would put that constraint on every page in the product at build time. The
 * repo already has this exact convention (search-command.tsx's
 * SearchDialogWithProject, AppSidebar's SidebarInnerWithProject); this is the
 * same shape. It renders nothing.
 *
 * WHY THE SHELL NEEDS IT AT ALL. Before this, the shell learned a screen's
 * project only if that screen PUBLISHED it (ScreenContext), which three pages
 * do. Everywhere else a URL could say ?projectId=X while the rail said "All
 * projects" and the composer refused to send for want of a project -- on a
 * screen already showing project X's data. The URL is the source of truth, and
 * the shell can read it directly.
 */
function RouteProjectIdReader({ onChange }: { onChange: (id: string | null) => void }) {
  const params = useSearchParams();
  const raw = params.get("projectId");
  const id = raw && raw.trim() ? raw : null;
  useEffect(() => {
    onChange(id);
  }, [id, onChange]);
  return null;
}

/** R67 A-09 -- a chain restored from history rather than built on this screen. */
type LoadedChain = {
  /** The route it belongs to, normalised. Null when the row named none. */
  route: string | null;
  /** The screen it came from, for the "from <screen>" label when pinned. */
  from: string | null;
  /** The user has said they mean to carry it across screens. */
  pinned: boolean;
};

export default function M24Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // R67 A-01: the composer must know which screen it is serving, so it can
  // stop offering the screen the user is already standing on.
  const pathname = usePathname();

  const [segments, setSegments] = useState<Chain["segments"]>([]);
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // The RAIL's own selection. It is no longer the only answer to "which
  // project": a screen that resolved one from the URL outranks it (A-03).
  const [railProjectId, setRailProjectId] = useState<string | null>(null);
  // A-07: the user's own pinned cards, per browser. Pinning is how a user
  // defeats the 7-day decay for work they know is periodic, so it must survive
  // a session -- localStorage, not sessionStorage.
  const [pinnedCards, setPinnedCards] = useState<string[]>([]);
  // A-07 -- THE RANKING THAT IS ON SCREEN, which is deliberately NOT the same
  // thing as the last ranking the server sent. See applyRanking() below.
  const [rankedPills, setRankedPills] = useState<RankedEntry[] | null>(null);
  const [taskGroups, setTaskGroups] = useState<TaskGroups>(NO_TASKS);
  const [tasksError, setTasksError] = useState<string | null>(null);
  // What the SHELL itself could not load, separate from the task read.
  const [shellErrors, setShellErrors] = useState<{ what: string; detail: string }[]>([]);
  // The function the user picked via a pill. When set, submitting takes
  // R53's PILL PATH: { functionId, params } -- no classifier, no model call
  // ever. When null, the typed path { rawInput } is used and the server
  // classifies. Both are the same endpoint.
  const [pendingFunctionId, setPendingFunctionId] = useState<string | null>(null);
  // R67 A-10 -- WHICH card is armed, not merely that one is. The Send button is
  // named for what it will do ("Save progress", "Ask", "Run"), and a functionId
  // alone cannot say that: it is an identifier, not a verb and an object.
  const [armedCard, setArmedCard] = useState<CardDef | null>(null);
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
  // The composer's own box, so a control whose whole meaning is "type it" can
  // put the cursor there rather than describing what the user should do next.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [showAllPills, setShowAllPills] = useState(false);
  // A-08: a failed ranking read is admitted in one muted line rather than
  // silently producing a strip that looks like a considered answer.
  const [rankingFailed, setRankingFailed] = useState(false);
  // R67 A-08: the three "Do again" chains, computed by the server from the
  // SAME compliance.chain_history rows the History tab reads.
  const [recentChains, setRecentChains] = useState<RecentCardView[]>([]);
  // R67 A-09 -- IS THE CHAIN ON SCREEN ONE THE USER BUILT, OR ONE THEY LOADED?
  //
  // It matters on the next navigation. A chain built here describes work on
  // THIS screen and must not follow the user to another one; a chain LOADED
  // from history describes a task somewhere else entirely, and following the
  // user is exactly how "Work Progress x > New entry x" ended up under a
  // Permits heading. So a loaded chain is cleared when the user leaves its own
  // route -- unless they have pinned it, which is the one way to say "I mean to
  // carry this". The ref is written synchronously in the handlers so the
  // navigation effect below cannot read a stale value.
  const [loadedChain, setLoadedChain] = useState<LoadedChain | null>(null);
  const loadedChainRef = useRef<LoadedChain | null>(null);
  const setLoaded = useCallback((next: LoadedChain | null) => {
    loadedChainRef.current = next;
    setLoadedChain(next);
  }, []);
  const [draft, setDraft] = useState("");
  const [counts, setCounts] = useState<{ home: number; approval: number; queue: number; done: number }>({
    home: 0,
    approval: 0,
    queue: 0,
    // A-10: whether this account has EVER completed a task. It is the honest
    // signal for "has this person got a save to their name yet", and it comes
    // from the same one call the tabs are counted from -- never a second guess.
    done: 0,
  });
  const [tasksLoaded, setTasksLoaded] = useState(false);

  useEffect(() => {
    try {
      const p = localStorage.getItem(PILL_USAGE_KEY);
      const parsed = p ? JSON.parse(p) : null;
      if (Array.isArray(parsed)) setPinnedCards(parsed.filter((x): x is string => typeof x === "string"));
    } catch {
      // A blocked or unavailable storage must not take the shell down.
    }
    // R67 A-07 -- KILL THE FLICKER. Every page load used to paint one set of
    // cards from a local table for half a second to three seconds, then swap
    // it for the server's ranking: two different strips on one screen, and a
    // finger already moving toward the first one. The last ranking the server
    // gave THIS user is cached and painted immediately, so the strip that
    // appears is the strip that stays.
    try {
      const cached = localStorage.getItem(RANKED_CARDS_KEY);
      const parsed = cached ? JSON.parse(cached) : null;
      if (Array.isArray(parsed)) setRankedPills(parsed as RankedEntry[]);
    } catch {
      // No cache is a normal first run, not a failure.
    }
    // R67 A-05: the rail's last choice is restored before any request, so the
    // rail does not flash "All projects" on every reload and then correct
    // itself. It is only a hint -- the project list below is the authority, and
    // an id for a project the user can no longer reach resolves to nothing.
    setRailProjectId(readStoredProjectId());
  }, []);

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

  // R67 A-07 -- WHEN A NEW RANKING MAY REPLACE WHAT IS ON SCREEN.
  //
  // The ranking arrives asynchronously and can legitimately differ from the
  // cached one. Applying it the instant it lands re-orders the cards under
  // whatever the user is currently reaching for, which is how a person aiming
  // at "Run WPR" presses "Record progress" instead. So: apply it immediately
  // when the band has been untouched for five seconds, otherwise hold it and
  // let the next navigation -- when the user has already looked away -- put it
  // in place. Nothing is lost either way; only the moment changes.
  const lastInteractionRef = useRef<number>(0);
  const deferredRankingRef = useRef<RankedEntry[] | null>(null);

  const noteBandInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  const applyRanking = useCallback((entries: RankedEntry[]) => {
    if (Date.now() - lastInteractionRef.current < RANK_SETTLE_MS) {
      deferredRankingRef.current = entries;
      return;
    }
    deferredRankingRef.current = null;
    setRankedPills(entries);
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
          done: Number(data.counts?.done) || 0,
        });
        setTasksLoaded(true);
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
          if (live) {
            setRankingFailed(true);
            noteFailure("your ranked modules", d?.error || `HTTP ${res.status}`);
          }
          return;
        }
        if (live && Array.isArray(d?.pills)) {
          setRankingFailed(false);
          const entries = (d.pills as { pillKey: string; label?: string; pinned?: boolean }[]).map((p) => ({
            pillKey: p.pillKey,
            label: p.label ?? null,
            pinned: Boolean(p.pinned),
          }));
          // A-07: cache it BEFORE deciding whether to paint it. The cache is
          // for the next first render; the five-second rule below is only
          // about THIS one.
          try {
            localStorage.setItem(RANKED_CARDS_KEY, JSON.stringify(entries));
          } catch {}
          applyRanking(entries);
          // A-08: no recent chains is a normal first week and must render as
          // "role cards only", never as an error and never as a placeholder.
          setRecentChains(
            Array.isArray(d?.recentChains)
              ? (d.recentChains as RecentCardView[]).map((c) => ({
                  fullChain: c.fullChain,
                  label: c.label,
                  steps: c.steps ?? [],
                  projectId: c.projectId ?? null,
                  outcome: c.outcome ?? "ok",
                }))
              : []
          );
          // R53's payload carries functionId per pill. Held in a ref so the
          // submit handler can read it without re-rendering the strip.
          pillFnRef.current = Object.fromEntries(
            (d.pills as { pillKey: string; functionId?: string }[])
              .filter((x) => x.functionId)
              .map((x) => [x.pillKey, x.functionId as string])
          );
        }
      } catch (err) {
        if (live) {
          setRankingFailed(true);
          noteFailure("your ranked modules", err instanceof Error ? err.message : "the request did not complete");
        }
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
  // R67 A-13 -- AND THE URL OUTRANKS BOTH OF THEM. A screen's ?projectId= is a
  // fact the shell can read for itself on all 161 routes, not only on the three
  // that publish. The name comes from the projects list where it has loaded,
  // and from the screen's own publication before it has -- the two agree by
  // construction, because both are answers about the same id.
  const [routeProjectId, setRouteProjectId] = useState<string | null>(null);
  // The rail's own answer, applying the SAME rule the server page applies
  // (pickProject): the remembered choice if the user can still reach it, their
  // only project if they have exactly one, otherwise nothing -- the rail's null
  // state is "All projects", which M24 requires so org-level work stays
  // reachable. The shell never invents a project the way a page must.
  const railPick = useMemo(
    () => pickProject({ preferred: railProjectId, projects }),
    [projects, railProjectId]
  );
  const railProject = railPick.source === "auto" ? null : railPick.project;
  const routeProject = useMemo(() => {
    if (!routeProjectId) return null;
    const named = projects.find((p) => p.id === routeProjectId);
    if (named) return named;
    // The list has not loaded yet (or this id is not on it). The screen's own
    // publication is the only other place the NAME can come from, and it is
    // only trusted when it is about the same id.
    if (routeScreen?.project?.id === routeProjectId) return routeScreen.project;
    return null;
  }, [routeProjectId, projects, routeScreen]);

  // A-13 -- ONE ROOT, AND THE URL WINS. Route, then whatever the screen
  // published, then the rail's own remembered choice.
  const project = routeProject ?? routeScreen?.project ?? railProject;
  const projectId = project?.id ?? null;
  // HOW it was chosen, for the rail's label. A project named by the URL was
  // never automatic, whatever the page had to do to render it.
  const projectSource: ScreenProjectSource | null = routeProject
    ? "route"
    : routeScreen?.project
      ? routeScreen.source
      : railProject
        ? "preference"
        : null;

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
    return projectSource === "auto" ? { id: project.id, name: `${project.name} (auto-selected)` } : project;
  }, [project, projectSource]);

  // R67 A-01/A-02/A-06 -- THE SCREEN THE COMPOSER IS SERVING, derived from the
  // URL in ONE place (see use-screen-module.ts for the four questions it
  // answers and why they must not be answered separately).
  const screen = useScreenModule();
  const screenModule = screen.module;
  const chainModule = screen.chainModule;

  // R67 A-11/A-12 -- THE MODULE THE USER PICKED, as distinct from the one they
  // are standing on. It is DERIVED from the chain rather than kept beside it:
  // the strip's entity segment and "which module is the composer about" are the
  // same fact, and holding them in two pieces of state is how they come to
  // disagree (which is the whole reason the mode tabs were deleted in A-05).
  const selectedModule = useMemo(() => {
    const entity = segments.find((s) => s.kind === "action");
    return entity ? (MODULE_CATALOGUE.find((m) => m.id === entity.id) ?? null) : null;
  }, [segments]);

  // What the composer is ABOUT: the module just picked, else the screen's own.
  // The strip's next question comes from this one answer, so it cannot name two
  // different modules at once.
  const activeModule: ModuleDef | null = selectedModule ?? chainModule;

  // The placeholder and the worked examples take the Dashboard too -- it has
  // its own vocabulary ("how much of the BOQ is complete") even though
  // "Dashboard ›" is not the start of a sentence anyone finishes, which is why
  // it is excluded from the strip's own chain (see chainModuleForPathname).
  const promptModule: ModuleDef | null = selectedModule ?? screenModule;

  // R67 A-05: the mode is a fact about the chain, not a tab anyone clicks.
  const mode: ChainMode = useMemo(() => deriveMode(segments), [segments]);

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
  //
  // R67 A-06: a CREATE page is the third word of the same sentence, not a
  // different module -- "<project> › Permits › New permit". It is a fixed
  // segment for the same reason the module is: the user is standing on it, so
  // there is nothing to remove. Band 2 stays empty on these routes because the
  // page's own form IS the card.
  const chain: Chain = useMemo(() => {
    const root = project ? [{ id: project.id, label: project.name, kind: "root" as const }] : [];
    const mod = chainModule
      ? [{ id: `screen:${chainModule.id}`, label: chainModule.label, kind: "root" as const }]
      : [];
    const created = screen.createSegment
      ? [{ id: screen.createSegment.id, label: screen.createSegment.label, kind: "root" as const }]
      : [];
    return { mode, segments: [...root, ...mod, ...created, ...segments] };
  }, [mode, project, chainModule, screen.createSegment, segments]);

  // Every (x) goes through the kit's clamp. This component never slices the
  // segment array itself -- the whole point of the rule living in chain.ts.
  //
  // R67 A-09 -- AND IT TAKES THE TEXT THAT SEGMENT PUT THERE WITH IT. A pill
  // click used to type its own label into the box; removing the segment left
  // the word behind, so a user who cut "Permits" out of the chain still
  // submitted the word "Permits" to the classifier. The seeding branch is gone
  // (A-02), so this is a transitional guard for a draft that is still exactly
  // the removed segment's label and nothing else -- it can never delete words
  // a person actually wrote, because those would not match.
  const onCutFrom = useCallback(
    (index: number) => {
      const removed = chain.segments[index];
      if (removed && draft.trim() === removed.label) setDraft("");
      setSegments(cutChainFrom(chain, index).segments.filter((s) => s.kind !== "root"));
    },
    [chain, draft]
  );

  // R67 A-09 -- RESET CLEARS EVERYTHING THE USER CAN SEE.
  //
  // It used to clear the segments and nothing else: the typed draft stayed in
  // the box and an armed function stayed armed, so pressing reset and then Send
  // submitted the thing the user had just tried to abandon. "Reset" has one
  // meaning, and a control that half-does what it says is worse than one that
  // does nothing. The cursor then lands in the box, because after clearing the
  // sentence the next thing a person does is start a new one.
  const onReset = useCallback(() => {
    setSegments(resetChain(chain).segments.filter((s) => s.kind !== "root"));
    setPendingFunctionId(null);
    setArmedCard(null);
    setDraft("");
    setSubmitError(null);
    setProjectPrompt(null);
    setLoaded(null);
    composerRef.current?.focus();
  }, [chain, setLoaded]);

  // LOADS AND STOPS. Restores the chain and navigates. Navigation is a read.
  // It calls no action endpoint, and the ChainLoad it receives has no way to
  // express one.
  //
  // R67 A-05: load.mode is no longer applied as state -- restoring the chain
  // restores the mode with it, because deriveMode() reads it off the segments.
  // M24's rule that "a history click ALSO SETS MODE, so the strip never
  // contradicts itself" is now structural rather than a second assignment that
  // could be forgotten.
  const onLoadChain = useCallback(
    (load: ChainLoad) => {
      const steps = load.chain.segments.filter((s) => s.kind !== "root");
      setSegments(steps);
      // A-09: remember that this sentence was loaded, and where it belongs, so
      // the navigation effect can tell it apart from one built on this screen.
      setLoaded({
        route: load.route ? normalisePathname(load.route) : null,
        from: steps[0]?.label ?? null,
        pinned: false,
      });
      if (load.route) router.push(load.route);
    },
    [router, setLoaded]
  );

  // R67 A-07 -- USAGE IS RECORDED ON THE SERVER NOW, not only in this browser.
  //
  // Every card and leaf click was counted in localStorage and nowhere else, so
  // the ranking the SERVER computes was built from rows only the pipeline had
  // ever written -- and most card clicks NAVIGATE rather than execute. A site
  // engineer who opened "Record progress" forty times a week had that fact
  // recorded on one laptop and nowhere the ranking could see it. POST
  // /api/pill-usage closes that: one row per card, upserted, per user.
  //
  // IT IS DELIBERATELY SEPARATE FROM WHAT THE CLICK DOES. Ranking must not
  // depend on whether the click navigated, and navigating must never depend on
  // whether ranking worked -- so this is fire-and-forget and its failure is
  // swallowed. The click has already happened; reporting a failed counter as a
  // failed navigation would be a lie about what the user just did.
  const bumpUsage = useCallback((pillKey: string, chain?: { root: string | null; steps: string[]; full: string }) => {
    void fetch("/api/pill-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pillKey, chain }),
    }).catch(() => {});
  }, []);

  /** The chain a click means, in the words the strip is showing. Sent with the
   *  usage row so another device can label a card id it has never seen. */
  const chainForUsage = useCallback(
    (leafLabel: string, moduleLabel: string | null) => ({
      root: project?.name ?? null,
      steps: [...(moduleLabel ? [moduleLabel] : []), leafLabel],
      full: [project?.name, moduleLabel, leafLabel].filter(Boolean).join(" > "),
    }),
    [project]
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

  // R67 A-12 -- EXACTLY ONE ENTITY SEGMENT, REPLACED RATHER THAN CHAINED.
  //
  // Picking Minutes of Meeting and then Reports must leave the strip reading
  // "<project> › Reports", not "<project> › Minutes of Meeting › Reports": two
  // nouns in a row is not a sentence, and the second click plainly means the
  // user changed their mind. Replacing the whole user-built tail also drops the
  // steps that belonged to the module they just left, which would otherwise
  // survive under a heading that no longer describes them.
  const selectEntity = useCallback(
    (mod: ModuleDef) => {
      setSegments([{ id: mod.id, label: mod.label, kind: "action" as const }]);
      setPendingFunctionId(null);
      setArmedCard(null);
      setProjectPrompt(null);
      setLoaded(null);
    },
    [setLoaded]
  );

  // R67 A-07 -- A CARD CLICK. It records usage and OPENS THE CARD'S OWN ROUTE.
  // It does NOT execute: the callback carries a card id, a plain string, so
  // nothing on this path has a callable member.
  //
  // R67 A-02 -- THE TEXT SEEDING IS DELETED. A first-time pill click used to
  // type its own label into the box ("Permits", "Reports") and leave it there
  // for the classifier to interpret. It was a real fix for a real dead end --
  // Send did nothing at all before it -- but it makes the composer write words
  // the user did not, and it sends a module NAME to a classifier when the
  // module already has a real screen. A card now goes where its name goes: the
  // exact URL the screen's own header control produces.
  const onCardSelect = useCallback(
    (cardId: string) => {
      const card = CARD_CATALOGUE.find((c) => c.id === cardId);
      if (!card) return;
      const target = targetForCard(card);
      const moduleLabel = target?.module.label ?? null;
      bumpUsage(card.id, chainForUsage(card.label, moduleLabel));
      // Arm the pill path when -- and only when -- a real executable function
      // is known for this card. R53: picking the function means the server does
      // NOT need to classify, so the submission costs no model call at all.
      //
      // The server files a function_id under ITS key, which for every row the
      // pipeline wrote is the chain's first step ("Work Progress"), not the
      // card's id ("work-progress.entry"). rankedKeyForCard maps back, so the
      // rename to cards does not silently demote every click to the typed path.
      const rankedKey = rankedKeyForCard(card, rankedPills ?? []);
      const knownFunctionId =
        card.functionId ?? pillFnRef.current[card.id] ?? (rankedKey ? (pillFnRef.current[rankedKey] ?? null) : null);
      setPendingFunctionId(knownFunctionId);
      // A-10: the armed CARD, so the button can be named for what it will do.
      setArmedCard(knownFunctionId ? card : null);
      // A-12: one entity segment, replaced rather than chained -- a card IS the
      // whole verb+object, so a second card is a change of mind, not a step.
      setSegments([{ id: card.id, label: card.label, kind: "action" as const }]);
      if (knownFunctionId) return;
      const href = cardHref(card, card.needsProject ? projectId : null);
      if (!href) return;
      setProjectPrompt(null);
      router.push(href);
    },
    [bumpUsage, chainForUsage, projectId, rankedPills, router]
  );

  // R67 A-11/A-12 -- AN ENTRY IN THE EXPANDED "ALL MODULES" LIST.
  //
  // WHAT CHANGED, AND WHY IT NO LONGER NAVIGATES. A-07 made this open the
  // module's list route immediately. D-08 and correction C-09 rule that the
  // SECOND LEVEL IS VERBS, not free text and not a destination: "a module card
  // asks for its verbs and only navigates straight to a route when the verb is
  // a multi-field form". So picking Permits now says "Permits" in the strip and
  // offers New · Expiring soon · Open underneath it (band 2), and it is the
  // VERB that navigates. That is M24's own description of the mechanism --
  // "clicks a card -> THE STRIP FILLS IN AS HE WATCHES" -- and it is why a
  // module click is one deliberate selection rather than a page load the user
  // has to read before deciding anything.
  //
  // The ranked band above is unaffected: a CARD is already a verb and an
  // object ("File minutes"), so it still goes straight to its own screen.
  const onModuleEntrySelect = useCallback(
    (entryId: string) => {
      const entry = pillEntryById(entryId);
      if (!entry) return;
      setShowAllPills(false);
      switch (entry.destination) {
        case "input":
          // A-15 owns this branch.
          bumpUsage(entry.id);
          composerRef.current?.focus();
          return;
        case "rail":
          // "Projects" has no page in PROJEXA; its control is the top rail, so
          // the click goes there rather than nowhere.
          bumpUsage(entry.id);
          requestProject("Choose a project in the top rail");
          return;
        case "route": {
          const mod = entry.moduleId ? MODULE_CATALOGUE.find((m) => m.id === entry.moduleId) : undefined;
          if (!mod) return;
          bumpUsage(entry.id, chainForUsage(mod.label, null));
          selectEntity(mod);
          return;
        }
      }
    },
    [bumpUsage, chainForUsage, requestProject, selectEntity]
  );

  // R67 A-08 -- "DO AGAIN". It LOADS the sentence and STOPS.
  //
  // The chain is restored into the strip exactly as it was recorded and the
  // screen it belongs to is opened. What it deliberately does NOT do is carry
  // the old task's parameters: repeating "Record progress > EX-01" means doing
  // that job again TODAY, with today's date and this shift's quantity, and a
  // form pre-filled with last week's number is the most expensive kind of
  // convenience this product could offer. pendingFunctionId is left null, so
  // Send is not armed and nothing can execute from a single click.
  const onRecentSelect = useCallback(
    (chain: RecentCardView) => {
      bumpUsage(chain.steps[0] ?? chain.fullChain, {
        root: project?.name ?? null,
        steps: [...chain.steps],
        full: chain.fullChain,
      });
      setPendingFunctionId(null);
      setArmedCard(null);
      setSegments(
        chain.steps.map((label, i) => ({
          id: `again:${chain.fullChain}:${i}`,
          label,
          kind: i === 0 ? ("action" as const) : ("step" as const),
        }))
      );
      const mod = moduleForPill(chain.steps[0] ?? "", chain.steps[0]);
      // A-09: a repeated chain is a loaded chain -- same rule, same clean-up.
      setLoaded({
        route: mod ? normalisePathname(mod.route) : null,
        from: chain.steps[0] ?? null,
        pinned: false,
      });
      if (!mod) return;
      setProjectPrompt(null);
      router.push(moduleRoute(mod, chain.projectId ?? projectId));
    },
    [bumpUsage, project, projectId, router, setLoaded]
  );

  // R67 A-02 -- THE SECOND LEVEL, as real routes. A leaf is the module's own
  // verb ("New", "Expiring soon", "Open") and it navigates to exactly the URL
  // the screen's own control produces. It never executes and never types.
  const onLeafSelect = useCallback(
    (mod: ModuleDef, leaf: ModuleLeaf) => {
      bumpUsage(leaf.id, chainForUsage(leaf.label, mod.label));
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
    [bumpUsage, chainForUsage, projectId, requestProject, router]
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
      setArmedCard(null);
      // The minted task must APPEAR. That is the last step of R-80 and the
      // only part of the path a unit test cannot stand in for.
      await loadTasks();
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, pendingFunctionId, mode, projectId, chainModule, submitting, loadTasks]);

  // A-07: pinning is how a user defeats the 7-day decay for work they know is
  // periodic (a month-end report used heavily on the 30th and invisible from
  // the 8th). It is stored per browser and applied on top of whatever the
  // server ranked, so a pin never has to wait for a round trip to take effect.
  const onTogglePin = useCallback((cardId: string) => {
    setPinnedCards((prev) => {
      const next = prev.includes(cardId) ? prev.filter((k) => k !== cardId) : [...prev, cardId];
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

  // R67 A-02/A-06 -- NO STALE CHAIN ACROSS A NAVIGATION.
  //
  // The strip used to carry whatever the user had built on the LAST screen: a
  // chain reading "Work Progress x > New entry x" sat under the Permits
  // heading, describing a task that belonged to another module, with the (x)
  // controls still offering to edit it.
  //
  // A-06 widens A-02's rule from "the module changed" to "the PATHNAME
  // changed", because /permits and /permits/new are the same module and are
  // still two different sentences -- the segments built on the list page do not
  // describe the create page. usePathname() excludes the query string, so a tab
  // or filter change (?tab=report, ?withinDays=30) is correctly NOT a new
  // sentence and leaves the chain alone.
  //
  // AND IT KEEPS THE DRAFT. A-02 cleared the textarea here as well; A-06
  // rules that words the user typed are the user's, and deleting them because
  // they navigated is the composer writing (or unwriting) their input. The one
  // exception is a chain LOADED from history, whose text belongs to the old
  // sentence -- A-09 owns that branch below.
  const lastPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastPathRef.current === screen.pathname) return;
    lastPathRef.current = screen.pathname;
    setProjectPrompt(null);
    setSubmitError(null);
    setShowAllPills(false);
    // A-07: a ranking that arrived while the user was working the band was
    // held back rather than re-ordering cards under their finger. A navigation
    // is the moment they have already looked away, so it lands here.
    if (deferredRankingRef.current) {
      setRankedPills(deferredRankingRef.current);
      deferredRankingRef.current = null;
    }

    // R67 A-06/A-09 -- WHAT SURVIVES A NAVIGATION. The rule itself is a pure
    // function (src/lib/chain-navigation.ts) so all three outcomes can be
    // asserted without a browser; this effect only carries them out.
    //
    //   keep            a PINNED loaded chain, or arriving at the loaded
    //                   chain's own route -- which is the navigation the load
    //                   itself asked for, so clearing would delete what a click
    //                   just restored.
    //   clear-all       a loaded chain, gone elsewhere: the whole sentence
    //                   belonged to another screen, and so did any text typed
    //                   against it.
    //   clear-segments  an ordinary navigation. The DRAFT stays -- words a
    //                   person typed are theirs (A-06).
    const outcome = navigationOutcome({ loaded: loadedChainRef.current, nextPathname: screen.pathname });
    if (outcome === "keep") return;
    setSegments([]);
    setPendingFunctionId(null);
    setArmedCard(null);
    if (outcome === "clear-all") {
      setDraft("");
      setLoaded(null);
    }
  }, [screen.pathname, setLoaded]);

  // R67 A-07 -- BAND 3, AS CARDS.
  //
  // WHAT REPLACED WHAT. The strip used to render MODULE NAMES ranked by usage:
  // "Permits", "Reports", "Work Progress". A module name is a place, not a
  // thing you can do, so every click was a navigation followed by a second
  // decision on the next screen. Per owner approval D-10 the first level is
  // now six role-ranked VERB+OBJECT cards -- "Record progress", "Run WPR",
  // "Add permit" -- plus "All modules", which expands in place to Sumeet's
  // fixed order and never re-sorts itself.
  //
  // THE ORDER COMES FROM THE SERVER WHEN THERE IS ONE, and from this user's
  // ROLE when there is not. It is never a local guess dressed up as a ranking.
  const role = info?.role ?? null;
  const roleKnown = Boolean(info);
  const { cards: rankedCards, unknownKeys } = useMemo(
    () =>
      rankCards({
        ranked: rankedPills ?? [],
        role,
        // The module in play is already band 2 -- the screen's own, or the one
        // just picked. Offering it here as well would be the same words twice,
        // one of them pointing at where the user already is.
        excludeModuleId: selectedModule?.id ?? screenModule?.id ?? null,
        limit: 6,
      }),
    [rankedPills, role, screenModule, selectedModule]
  );

  // A-07 -- PRECONDITIONS, EVALUATED FROM WHAT THE SHELL ACTUALLY KNOWS.
  // A card whose precondition is unmet is rendered, disabled, with the reason
  // in words. Today the shell can answer one of them honestly -- whether a
  // project is resolved -- and it does. The BOQ precondition is declared on
  // the cards that have it and is never asserted here, because this shell has
  // no cheap signal for "does this project have a BOQ" (the only source is the
  // eight-second /api/scope fan-out), and a precondition guessed at is worse
  // than one not yet evaluated.
  const unmetPreconditions = useMemo(() => {
    const unmet = new Set<CardPreconditionId>();
    if (!projectId) unmet.add("project");
    return unmet;
  }, [projectId]);

  const cardViews: CardView[] = useMemo(
    () =>
      rankedCards.map((card: CardDef) => ({
        id: card.id,
        label: card.label,
        kindWord: KIND_WORD[card.kind],
        kindGlyph: KIND_GLYPH[card.kind],
        pinned: pinnedCards.includes(card.id),
        disabledReason: cardUnmetReason(card, unmetPreconditions),
      })),
    [rankedCards, pinnedCards, unmetPreconditions]
  );

  // A-07/A-11/A-14: the expanded list is FIXED (Sumeet's eleven, then "Other -
  // type it", then the Platform group), it is a FROZEN array built once at
  // module load, and it is NEVER re-ordered by usage -- see pill-catalogue.ts.
  // The only thing computed per screen is that the module you are already
  // standing in says so instead of pretending to be a destination, the same
  // no-dead-end rule A-01 applied to the ranked band.
  const allModules: ModuleEntryView[] = useMemo(
    () =>
      PILL_CATALOGUE.map((entry: PillEntry) => ({
        id: entry.id,
        label: entry.label,
        shortcut: shortcutLabel(entry),
        note: entry.note,
        unavailable:
          entry.moduleId && pillPointsAtCurrentScreen(entry.moduleId, entry.label, pathname ?? "")
            ? "you are here"
            : undefined,
      })),
    [pathname]
  );

  // A-07: three skeletons appear ONLY when there is genuinely nothing to paint
  // -- no cached ranking from a previous visit and no role to order the
  // catalogue by. Painting the default order and then swapping it for the
  // role's order would be the same flicker in a different costume.
  const cardsLoading = rankedPills === null && !roleKnown;

  // R67 A-01/A-10 -- ONE STATE, and every composer string is a function of it.
  // The strings themselves live in src/lib/chain-status.ts, where each state
  // maps to exactly one strip question and one Send label and no reachable
  // combination can bring back one of the four retired sentences.
  const composerState: ComposerState = useMemo(
    () => ({
      // A-06: an unshipped URL is a fact about the screen, and the strip says
      // so instead of asking a question about a page that is not there.
      shipped: screen.shipped,
      hasProjects: !projectsLoaded || projects.length > 0,
      hasProject: Boolean(project),
      projectName: project?.name ?? null,
      // A-11/A-12: the module in play -- the one just picked, else the one the
      // screen IS. One answer, so the next question names one module.
      moduleLabel: activeModule?.label ?? null,
      action: armedCard ? { label: armedCard.label, object: armedCard.object, kind: armedCard.kind } : null,
      // HONEST LIMIT: the missing-step state is fully implemented here and in
      // chain-status.ts, and nothing populates it yet. The list of fields an
      // armed function still needs is WS-B's { code, missing } closed-
      // vocabulary payload (D-03), which the executor does not return today --
      // it returns raw strings. Inventing a list of "required fields" from the
      // client would be a guess dressed up as a validation.
      missing: [],
      hasText: draft.trim().length > 0,
      busy: submitting,
      error: submitError ?? projectPrompt,
    }),
    [
      screen.shipped,
      projectsLoaded,
      projects.length,
      project,
      activeModule,
      armedCard,
      draft,
      submitting,
      submitError,
      projectPrompt,
    ]
  );
  const instruction = chainPrompt(composerState);
  const sendEnabled = canSendFrom(composerState);
  const sendButtonLabel = sendLabelFor(composerState);

  // A-10 -- THE FIRST-RUN HINT. One line, under the cards, for an account that
  // has never completed anything: the three-step shape of the whole product,
  // said once. It disappears the moment there is a single finished task, and it
  // is never shown before the task list has actually answered -- a hint offered
  // on the strength of "not loaded yet" would greet returning users too.
  const firstRunHint = tasksLoaded && counts.done === 0 && !tasksError;

  // R67 A-12 -- THE KEY HINTS ARE REAL, AND THEY WORK WHILE THE BOX IS FOCUSED.
  //
  // The chord is Alt+<letter>, never the bare letter: the control directly
  // below this row is a textarea people type sentences into, and a bare "P"
  // that jumped to Permits would make every word beginning with P unwritable.
  // The pill therefore renders "Alt+P" rather than "P" -- a hint that omits the
  // modifier is a shortcut that appears not to work. The listener is on the
  // window precisely so that focus in the composer does not disable it, which
  // is the case the item names.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const entry = matchPillShortcut(event);
      if (!entry) return;
      event.preventDefault();
      onModuleEntrySelect(entry.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onModuleEntrySelect]);

  // R67 A-12 -- BAND 2: THE SECOND LEVEL, UNDER THE STRIP.
  //
  // After a module pill narrows the sentence to one noun, this is where its
  // VERBS appear -- Permits › New · Expiring soon · Open -- so the user walks
  // ENTITY > ACTION > STEP one level at a time and watches the strip fill in.
  // The kit's OptionChain is used unchanged (D-09: fork only what you change),
  // and its own contract is the one that matters here: *** SELECTING AN OPTION
  // NEVER EXECUTES *** -- onAdvance hands back a segment, and it is the leaf's
  // own route that opens.
  //
  // IT RENDERS ONLY FOR A PICKED MODULE. Standing inside a module, that
  // module's verbs are the SCREEN's own cards and lead band 3 (A-02/A-04);
  // rendering them in both places would be the duplicate vocabulary this
  // programme is removing. Band 2 also stays empty on a create route, where
  // the page's own form is the card (A-06).
  const optionLevel = useMemo(() => {
    if (!selectedModule || screen.createSegment) return null;
    const leaves = chainOptionsFor(selectedModule);
    if (leaves.length === 0) return null;
    const options: ChainOption[] = leaves.map((leaf) => ({ id: leaf.id, label: leaf.label, isLeaf: true }));
    const chosen = segments.find((s) => s.kind === "step")?.id ?? null;
    return (
      <OptionChain
        legend="Which step?"
        options={options}
        kind="step"
        selectedId={chosen}
        onAdvance={(segment) => {
          const leaf = leaves.find((l) => l.id === segment.id);
          if (leaf) onLeafSelect(selectedModule, leaf);
        }}
      />
    );
  }, [selectedModule, screen.createSegment, segments, onLeafSelect]);

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
          {/* A-13: the URL's own ?projectId=, read behind the Suspense boundary
              this repo already uses for useSearchParams(). Renders nothing. */}
          <Suspense fallback={null}>
            <RouteProjectIdReader onChange={setRouteProjectId} />
          </Suspense>
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
              const nextId = next ? next.id : null;
              setRailProjectId(nextId);
              // R67 A-05: remembered for this browser, in localStorage for the
              // shell and in a cookie so the SERVER resolves the same project
              // -- then re-render the pane, so the screen under the rail is
              // about the project the rail now names. Without the refresh the
              // rail and the pane would disagree for as long as the user stayed
              // on the page, which is the defect this item exists to close.
              writeStoredProjectId(nextId);
              // R67 A-13 -- ON A SCREEN WHOSE URL NAMES THE PROJECT, THE RAIL
              // CHANGES THE URL. The URL is the single source of truth, so a
              // rail that only wrote local state would appear to do nothing at
              // all here: the next render would read the unchanged ?projectId=
              // and put the old name straight back. Changing the URL is the
              // rail doing exactly what it says.
              if (routeProjectId) {
                const params = new URLSearchParams(window.location.search);
                if (nextId) params.set("projectId", nextId);
                else params.delete("projectId");
                const qs = params.toString();
                router.push(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
                return;
              }
              router.refresh();
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
          // R67 A-08: HOME must never router.push the route the user is
          // already on -- a control that appears to navigate and does nothing
          // reads as a broken button. On the home screen it does the thing
          // HOME actually means here instead: opens the grouped module
          // directory, which on PROJEXA is the "All modules" list.
          onHome={() => {
            if (screen.pathname === HOME_ROUTE) {
              setShowAllPills(true);
              return;
            }
            router.push(HOME_ROUTE);
          }}
          onReset={onReset}
          value={draft}
          onChange={setDraft}
          // BAND 2 -- the picked module's own verbs (A-12).
          conversation={optionLevel}
          // BAND 3 -- the screen's own verbs first, then six role-ranked cards
          // and "All modules". M24 shows "their top five or six ... That IS the
          // load reduction"; D-10 makes those six verb+object CARDS rather than
          // module names, and keeps every demoted pill reachable under "All
          // modules" so nothing becomes a dead end.
          pills={
            <div className="flex flex-col gap-1">
              {/* R67 A-02 -- THE SCREEN'S OWN VERBS COME FIRST. On a module
                  route the composer already knows the module, so band 3 leads
                  with that module's real leaf actions -- each one navigating
                  to exactly the URL the screen's own header control produces
                  -- and the ranked cards that follow are the ways OUT of this
                  screen. The module's own cards are not among them (A-01/A-07):
                  they would only point back here.

                  A-12: once the user PICKS a different module, its verbs take
                  over band 2 and this row stands down -- two modules' verbs on
                  one screen is exactly the duplicate vocabulary being removed,
                  and the sentence in the strip names only one of them. */}
              {chainModule && !selectedModule && (
                <div className="flex flex-wrap items-center gap-1">
                  {chainOptionsFor(chainModule).map((leaf) => (
                    <button
                      key={leaf.id}
                      type="button"
                      onClick={() => onLeafSelect(chainModule, leaf)}
                      className="veri-mode-pill active"
                    >
                      {leaf.label}
                    </button>
                  ))}
                </div>
              )}
              <PillStrip
                cards={cardViews}
                recent={recentChains}
                onSelectRecent={onRecentSelect}
                onSelect={onCardSelect}
                onTogglePin={onTogglePin}
                loading={cardsLoading}
                expanded={showAllPills}
                onToggleExpanded={() => setShowAllPills((v) => !v)}
                allModules={allModules}
                onSelectModule={onModuleEntrySelect}
                unknownKeys={unknownKeys}
                onInteract={noteBandInteraction}
                // A-08: a failed ranking read must not look like a considered
                // answer. The role cards still stand; one muted line says why
                // the recent ones are missing. A-10: otherwise, an account with
                // nothing finished yet gets the one-line shape of the product.
                footnote={
                  rankingFailed
                    ? "Recent tasks unavailable"
                    : firstRunHint
                      ? "Click a task, then the thing it is about, then Save."
                      : undefined
                }
              />
            </div>
          }
          onSubmit={onSubmit}
          textareaRef={composerRef}
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
          // A-10: the button is named for what it will do, and never becomes
          // "Sending..." -- a spinner sits beside it instead.
          sendLabel={sendButtonLabel}
          canSend={sendEnabled}
          busy={submitting}
          // A-09: the strip admits when the sentence was loaded rather than
          // built here, and offers the pin that keeps it across a navigation.
          loaded={
            loadedChain
              ? {
                  from: loadedChain.from,
                  pinned: loadedChain.pinned,
                  onTogglePin: () => setLoaded({ ...loadedChain, pinned: !loadedChain.pinned }),
                }
              : null
          }
          errorMessage={submitError ?? projectPrompt}
          // A-10: one resting placeholder that shows all three things this box
          // takes -- a task, a question and a record -- overridden by the
          // module's own example when the user is standing in one.
          //
          // A-11/A-12: PICKING a module changes it too. The pill click sets the
          // placeholder and the two worked examples from that module, which is
          // the whole of what a pill is allowed to do to the input -- it must
          // never type into it (the seeding branch at the old :476-478 is gone).
          placeholder={
            promptModule
              ? promptModule.placeholder
              : "Type a task, a question or a record — e.g. 'excavation 50%', 'which permits expire this month', 'WPR January'"
          }
          // R67 A-02: two worked examples in the module's own vocabulary, so a
          // site engineer sees what a sentence this box accepts looks like
          // before typing one.
          examples={
            promptModule ? (
              <span>
                e.g. “{promptModule.examples[0]}” · “{promptModule.examples[1]}”
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
