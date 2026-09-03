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
import {
  PillStrip,
  type CardView,
  type ModuleEntryView,
  type RecentCardView,
  type ScreenCardView,
} from "./PillStrip";
import { cardsFor, chainForScreenCard, hrefForScreenCard, type ScreenCard } from "@/lib/composer-cards";
// R67 A-16 / decision D-09: the rail is forked too, for one reason -- the kit
// types `organisationName` as a string, so it cannot render "Organisation
// unavailable — [Retry]", and the string fallback it forced was a bare em-dash.
import { TopRail } from "./TopRail";
import { useShellScreen, type ScreenProjectSource } from "./shell-screen-context";
import {
  EMPTY_RANKED_CACHE,
  organisationLabel,
  parseRankedCache,
  rankingFor,
  readJsonWithRetry,
  rememberRanking,
  sameRanking,
  serialiseRankedCache,
  TASKS_UNAVAILABLE,
  type RankedCache,
} from "@/lib/shell-resilience";
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
  isRankablePill,
  matchPillShortcut,
  pillEntryById,
  shortcutLabel,
  type PillEntry,
} from "@/lib/pill-catalogue";
import { NOT_IN_PROJEXA, VERIDIAN_LINK, isPillRouteOpen, pillHref } from "@/lib/pill-routes";
import {
  MISSING_PROJECT,
  canSend as canSendFrom,
  chainPrompt,
  missingThings,
  sendLabel as sendLabelFor,
  type ComposerState,
} from "@/lib/chain-status";
import { deriveMode } from "@/lib/chain-mode";
import { isStripPainted, rankingArrival } from "@/lib/pill-ranking";
import { navigationOutcome } from "@/lib/chain-navigation";
import { pickProject, readStoredProjectId, writeStoredProjectId } from "@/lib/project-preference";
import { objectPromptLabel, objectSegmentFor, railDestinationForObject } from "@/lib/object-screens";
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
import { invalidateShell, useShell } from "@/lib/shell-store";
import { rememberSelectedProject } from "@/lib/project-cookie";
import { LEGACY_FALLBACK_MESSAGE, fixChainFor, legacyToCode, messageFor, rowDetailFor } from "@/lib/task-errors";

// R67 A-14 -- THE PINS, AND ONLY THE PINS.
//
// This key used to hold a LOCAL usage order: the last card clicked was pulled
// to the front and that order persisted across routes, so the same control sat
// somewhere different on every screen and the user had to re-read the whole row
// every time. That is deleted (A-07 moved usage to the server, where the
// ranking is actually computed; A-14 deletes the local ordering outright), and
// what remains in the browser is the user's own PINS -- which are a decision
// they made, not a guess about them.
//
// The key was renamed with it, because a key called "usage" holding pins is how
// the next reader concludes the local ordering is still there. The old key is
// read once so nobody loses the pins they had.
const PINNED_CARDS_KEY = "veri.pill.pinned";
const LEGACY_PILL_USAGE_KEY = "veri.pill.usage";

// R67 A-07 -- the last ranking the SERVER gave this browser, painted on the
// next first render so the strip never shows one set of cards and then swaps
// it for another. It is a cache of a server answer, never an input to one.
//
// R67 A-16 -- AND IT IS KEYED BY USER ID NOW. The value under this key used to
// be a bare array with no owner, so on a shared browser -- a site office
// laptop, a supervisor handing over a phone -- the second person's first paint
// was the first person's strip: a row of write actions ordered by somebody
// else's job. The shape is now { last, byUser }; parseRankedCache() still reads
// the old array so nobody loses their cached strip in the upgrade, but it is
// attributed to nobody and is used only for the pre-identity first paint.
const RANKED_CARDS_KEY = "veri.pill.ranked";

// R67 A-14 supersedes A-07's five-second settle window: a newly arrived ranking
// is never applied while the user is looking at the strip, only on the next
// navigation. The rule itself is pure and lives in src/lib/pill-ranking.ts.

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
  /**
   * R67 FIX PASS -- the row's stored English, for rows written before the
   * pipeline returned codes. It replaces the old `error` field: GET
   * /api/v1/projexa/tasks no longer returns pipeline_tasks.error verbatim,
   * because a legacy row could hold the R66 driver string with its internal
   * host:port and shipping that to a browser is the leak B-01 exists to
   * close. The server now converts any such string into a real failure code
   * itself, and only prose that discloses nothing arrives here.
   */
  legacyError?: string | null;
  rawInput?: string | null;
  mode?: string | null;
  /** Real column on compliance.pipeline_tasks, selected by the route's own
   *  query and already ordered desc -- used by the History tab's dedup. */
  createdAt?: string | null;
  // R67 B-06/B-01: the server now sends the function's HUMAN LABEL ("Record
  // progress") beside the id, so a row title never has to fall back to
  // "Record record_work_progress".
  label?: string | null;
  // R67 B-01/B-08 (D-03): the STRUCTURED failure. The sentence is composed
  // here, from src/lib/task-errors.ts, never sent by the server.
  failure?: { code?: string | null; missing?: string[]; context?: Record<string, string | number | null> | null } | null;
};
// R67 B-07's verdict envelope, from POST /api/v1/projexa/tasks. `status`
// 'ready' means nothing has run yet and the client must confirm; the server
// mints no task until it does.
type SubmissionVerdict = {
  verdict?: "task" | "chat" | "gap";
  status?: "ready" | "needs_input" | "answered" | "gap" | "chat";
  understood?: { functionId?: string; label?: string; projectId?: string | null; params?: Record<string, unknown> } | null;
  missing?: { name: string; field: string; label: string; code: string; options?: { id: string; label: string }[] }[];
  answer?: { rows?: unknown; text?: string | null; chain?: string } | null;
  links?: { label: string; route: string }[];
  chain?: string | null;
  message?: string;
  confirmable?: boolean;
  submissionId?: string | null;
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
/** The backend's own ceiling on ?limit=. A refresh may not ask for more. */
const TASK_MAX_LIMIT = 200;
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

/**
 * R67 B-08/B-10 -- line 2 of a Task Master row, in the closed vocabulary.
 *
 * Three sources, in order of how much the server knows:
 *   1. the TYPED failure (D-03): {code, context} -> the dictionary sentence.
 *   2. a LEGACY row, written before the pipeline returned codes: its stored
 *      English is mapped back to a code by legacyToCode() and then rendered
 *      through the SAME dictionary, so an old row reads like a new one and
 *      never shows its original text.
 *   3. no failure at all -> what the user typed.
 */
export function detailFor(t: ApiTask): string | undefined {
  const code = codeFor(t);
  if (code) return rowDetailFor(code, (t.failure?.context ?? {}) as Record<string, string | number | null>);
  if (t.legacyError) return LEGACY_FALLBACK_MESSAGE;
  return t.rawInput ?? undefined;
}

/**
 * R67 B-10: the code for a row, whichever way the server could give it --
 * the typed failure first, then a legacy row's stored English mapped back
 * into the vocabulary. Null means "nothing failed", not "we do not know".
 */
export function codeFor(t: ApiTask): string | null {
  if (t.failure?.code) return t.failure.code;
  if (t.legacyError) return legacyToCode(t.legacyError);
  return null;
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
    // Progress > New entry".
    //
    // R67 B-06: the fallback was `t.functionId`, which rendered rows reading
    // "Record record_work_progress" -- a function id on a site engineer's
    // screen. The server now resolves the id through the function catalogue
    // and sends its human label, so the fallback is a real name; "task" is
    // only reached when there is genuinely no function at all (an
    // unresolved segment), and is still a word rather than an identifier.
    object: steps.length ? steps.join(" > ") : (t.label ?? "task"),
    // M24: "line 2 is the DECIDING information - without it the user clicks in
    // to find out, which is the load being removed."
    //
    // R67 B-08/B-10 (D-03): this used to be `t.error ?? t.rawInput` -- the
    // server's own words, rendered verbatim. That is how "itemCode is
    // required", "no project resolved for this task" and "write
    // CONNECT_TIMEOUT 3.109.171.244:6543" reached a site engineer's screen
    // in the R66 walkthrough. The server now sends a CODE and this composes
    // the sentence from src/lib/task-errors.ts, which cannot emit a
    // camelCase parameter, a function id or an address. A row with no
    // failure at all still shows what the user typed.
    detail: detailFor(t),
    urgency: group === "blocked" ? "late" : group === "done" ? "done" : "later",
    urgencyLabel: group === "blocked" ? "blocked" : group === "done" ? "done" : "queued",
    // TWO LANES, ONE DESTINATION, and the more specific one wins.
    //
    // A-01 gives every row its MODULE's route, so loading a chain from the
    // History tab opens the screen it belongs to instead of restoring segments
    // over whatever screen happens to be on show.
    //
    // R67 B-10: a FAILED row has a better answer than "the module". Clicking it
    // does not just re-open it -- it LOADS THE FIX. The chain below is restored
    // into the composer (the kit's onLoad -> onLoadChain path, which loads and
    // stops, never executes) and this route puts the right pane on the screen
    // that can answer the same question with a form: one click from "Pick a BOQ
    // line" to the picker. A row that did not fail, or a code with no screen of
    // its own, falls back to A-01's module route rather than losing one.
    route: fixChainFor(codeFor(t))?.route ?? route,
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

/** GET /api/pill-usage, as PROJEXA's proxy returns it (R53 + A-08). */
type PillPayload = {
  pills?: { pillKey: string; label?: string; pinned?: boolean; functionId?: string }[];
  recentChains?: RecentCardView[];
};

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
function RouteProjectIdReader({
  onChange,
  onSearch,
}: {
  onChange: (id: string | null) => void;
  /** R67 A-17: the whole query string, so a pill can say whether ITS view is
   *  the one on screen ("/schedule?tab=board" is not open on the timeline). */
  onSearch: (search: string) => void;
}) {
  const params = useSearchParams();
  const raw = params.get("projectId");
  const id = raw && raw.trim() ? raw : null;
  const search = params.toString();
  useEffect(() => {
    onChange(id);
  }, [id, onChange]);
  useEffect(() => {
    onSearch(search);
  }, [search, onSearch]);
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
  // R67 F-26: the keyset position of the next page (null = this is the whole
  // list, so no "Show 20 more" control is rendered at all), whether that page
  // is in flight, when the list was last read in full, and which rows came from
  // a Send rather than from the server.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // A ref, not state: nothing RENDERS from "when did the list last load" -- it
  // only decides whether the navigation effect should go to the network -- and
  // a ref written inside loadTasks is read by that effect without adding a
  // render or a dependency that would re-run it.
  const tasksFetchedAtRef = useRef<number | null>(null);
  /** How many "Show 20 more" pages the user has pulled, so a refresh can ask
   *  for the list they are actually looking at rather than shrinking it. */
  const extraPagesRef = useRef(0);
  const optimisticIdsRef = useRef<Set<string>>(new Set());
  // R67 A-16 -- WHOSE STRIP IS THIS? The ranking is a statement about one
  // person's work, so the cache that paints it before the server answers is
  // keyed by the signed-in user. Resolved from this tab's own Supabase session,
  // which is the same identity every server read is made under.
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const rankedCacheRef = useRef<RankedCache>(EMPTY_RANKED_CACHE);
  // A-16: the organisation read failed twice. The rail says so, in the band
  // M24 says is never covered, with the one control that can change it.
  const [orgFailed, setOrgFailed] = useState(false);
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
  // R67 B-07: band 2 (CONVERSATION). What the server understood, and what it
  // still needs -- in the closed vocabulary, never a parameter name.
  const [notice, setNotice] = useState<{ chain: string | null; text: string | null } | null>(null);
  const pillFnRef = useRef<Record<string, string>>({});
  // The top rail's DOM, so a click that needs a project can send the user to
  // the control that chooses one (A-03) instead of only saying "no".
  const railRef = useRef<HTMLDivElement>(null);
  // The composer's own box, so a control whose whole meaning is "type it" can
  // put the cursor there rather than describing what the user should do next.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [showAllPills, setShowAllPills] = useState(false);
  // R67 A-15 -- the user chose "Other - type it". It adds no segment and asks
  // no new question; it puts the cursor in the box, shows an example of what
  // this box takes, and makes the Send button name what it is waiting for.
  const [awaitingText, setAwaitingText] = useState(false);
  // R67 A-17 -- the name the user picked belongs to VERIDIAN, not to PROJEXA.
  // Band 2 says so and offers the link; it is a destination, not a refusal.
  const [platformNotice, setPlatformNotice] = useState<string | null>(null);
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
  // `pathname` is already resolved above (A-01 needs it for the composer).
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
      // A-14: the pins, under their own name, falling back once to the key they
      // used to share with the deleted local usage order.
      const p = localStorage.getItem(PINNED_CARDS_KEY) ?? localStorage.getItem(LEGACY_PILL_USAGE_KEY);
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
    //
    // A-16: the identity is resolved asynchronously and this is the FIRST
    // render, so the browser's last user is what can be painted now. The moment
    // the real identity lands and disagrees, the effect below repaints from
    // that user's own entry -- or from nothing. Never from someone else's.
    try {
      const cache = parseRankedCache(localStorage.getItem(RANKED_CARDS_KEY));
      rankedCacheRef.current = cache;
      const painted = rankingFor(cache, null);
      if (painted) setRankedPills(painted as RankedEntry[]);
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

  // *** MERGE NOTE (F-21 x WS-A A-14/A-16). ***
  //
  // These two items rebuilt the same loading path for different reasons, so the
  // pieces are kept apart by what each is actually about.
  //
  // F-21 owns WHERE the data comes from: one GET /api/shell per session instead
  // of /api/organization, /api/projects, /api/notifications, /api/pill-usage and
  // /api/capability-tree on every navigation.
  //
  // A-14 and A-16 own WHAT IS DONE WITH IT: the ranking is never repainted under
  // a moving finger, an identical ranking is not a repaint at all, the strip can
  // paint from a per-user cache before the server answers, a failed organisation
  // read is stated in the rail, and only a successful projects read may say the
  // org has none.
  //
  // So A-16's loadOrgInfo()/loadProjects() pair is gone -- the bootstrap answers
  // both, and answering them twice was the cost F-21 exists to remove -- while
  // A-16's RETRY moved with them: readJsonWithRetry() now wraps the bootstrap
  // fetch itself in src/lib/shell-store.ts, so "each call is attempted twice"
  // still holds for the one call that replaced the four.

  // R67 A-14 -- WHEN A NEW RANKING MAY REPLACE WHAT IS ON SCREEN: NEVER, WHILE
  // THE USER IS LOOKING AT IT.
  //
  // The rule and its one exception are pure and written down in
  // src/lib/pill-ranking.ts; this is only the wiring. `paintedRef` is
  // maintained by an effect rather than read from state directly, because the
  // decision is taken inside an async fetch callback that has no render of its
  // own to read fresh state from.
  const deferredRankingRef = useRef<RankedEntry[] | null>(null);
  const paintedRef = useRef(false);
  // A-16: what is on screen, where the async ranking callback can read it. The
  // server's list replaces the strip only when it DIFFERS -- an identical
  // ranking must not cause a repaint, because a repaint is a frame in which the
  // cards under a moving finger can move.
  const rankedPillsRef = useRef<RankedEntry[] | null>(null);
  // A-16: has the SERVER answered in this session? A server answer is newer
  // than any cache, so the identity effect above must never overwrite it.
  const serverAnsweredRef = useRef(false);
  // The latest server answer, held so it can be written to the cache under the
  // right user even when the identity resolves after the ranking arrives.
  const latestServerRankingRef = useRef<RankedEntry[] | null>(null);

  const persistRanking = useCallback(() => {
    const id = userIdRef.current;
    const entries = latestServerRankingRef.current;
    if (!id || !entries) return;
    const next = rememberRanking(rankedCacheRef.current, id, entries);
    rankedCacheRef.current = next;
    try {
      localStorage.setItem(RANKED_CARDS_KEY, serialiseRankedCache(next));
    } catch {
      // A blocked or full storage costs the next visit a cached paint. It must
      // never cost this one its strip.
    }
  }, []);

  const applyRanking = useCallback((entries: RankedEntry[]) => {
    if (sameRanking(rankedPillsRef.current, entries)) {
      deferredRankingRef.current = null;
      return;
    }
    if (rankingArrival({ painted: paintedRef.current }) === "defer") {
      deferredRankingRef.current = entries;
      return;
    }
    deferredRankingRef.current = null;
    rankedPillsRef.current = entries;
    setRankedPills(entries);
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
    // Only a REAL, successful read can say the org has no projects. An empty
    // list before the call answers must never produce the "Create a project
    // first" sentence -- that would be a confident empty state standing in for
    // "not loaded yet", the exact defect this shell has been corrected for
    // twice already. The bootstrap reports the projects key's own failure, so
    // this is set from that and not merely from "the call returned".
    if (!shell.errors.projects) setProjectsLoaded(true);
    // A-16: the organisation read failed. The rail says so, in the band M24
    // says is never covered, with the one control that can change it.
    setOrgFailed(Boolean(shell.errors.organization));
    // A-16: and the RANKING's own failure is separate -- the cached strip
    // survives it. Setting this from the bootstrap's per-key error is what
    // keeps "the pill ranking could not be read" distinct from "this user has
    // earned no pills yet", which look identical on screen otherwise.
    setRankingFailed(Boolean(shell.errors.pillUsage));
    if (Array.isArray(shell.pillUsage)) {
      // R67 A-14/A-16: the bootstrap's ranking goes through applyRanking(), not
      // straight into state. That is what keeps the two rules the ranking has:
      // an IDENTICAL list must not repaint the strip, and a list that arrives
      // while the user is already looking at the cards is DEFERRED rather than
      // moved under their finger. F-21 changed where the ranking comes from --
      // one bootstrap instead of a per-navigation /api/pill-usage -- and
      // changed nothing about when it is allowed on screen.
      const entries = shell.pillUsage.map((p) => ({
        pillKey: p.pillKey,
        label: p.label ?? null,
        pinned: Boolean(p.pinned),
      })) as RankedEntry[];
      // A-07/A-16: cache it BEFORE deciding whether to paint it. The cache is
      // for the next first render, under this user's own key; A-14's rule
      // decides whether it may replace what is on screen NOW.
      serverAnsweredRef.current = true;
      latestServerRankingRef.current = entries;
      persistRanking();
      applyRanking(entries);
      // A-08: no recent chains is a normal first week and must render as
      // "role cards only", never as an error and never as a placeholder.
      setRecentChains(
        (shell.recentChains ?? []).map((c) => ({
          fullChain: c.fullChain,
          label: c.label,
          steps: (c.steps ?? []) as RecentCardView["steps"],
          projectId: c.projectId ?? null,
          outcome: (c.outcome ?? "ok") as RecentCardView["outcome"],
        }))
      );
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
  }, [shell.loaded, shell.organization, shell.projects, shell.pillUsage, shell.recentChains, shell.role, shell.email, shell.errors, noteFailure, applyRanking, persistRanking]);

  // R67 A-16 -- WHOSE RANKING IS CACHED. Read from this tab's own Supabase
  // session, which is the identity every server read above is made under. The
  // cache is repainted from the resolved user the moment it is known, so a
  // second person signing in on the same browser never inherits the first
  // person's strip.
  useEffect(() => {
    let live = true;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (live) setUserId(data.user?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  const refreshShell = shell.refresh;

  // F_025, first half: this tab's own sign-in/sign-out.
  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") {
        // A-16: the identity moves with the session, so the cached strip does
        // too -- a sign-in as somebody else must not leave the previous user's
        // ranking on screen.
        setUserId(session?.user?.id ?? null);
        // F-21: refreshing the bootstrap is what A-16's loadOrgInfo() call did
        // here, for all six answers rather than one.
        void refreshShell();
      } else if (event === "SIGNED_OUT") {
        setInfo(null);
        setUserId(null);
        // Covers the sign-out that happened in ANOTHER tab as well as this
        // one's own: the cookie is shared by every tab, so whichever tab sees
        // the event first must clear it.
        rememberSelectedProject(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshShell]);

  // A-16 -- THE CACHE FOLLOWS THE IDENTITY. Once the user is known, the strip
  // is repainted from THEIR cached ranking; if this browser has none for them,
  // the pre-identity paint (the previous user's) is dropped rather than left
  // standing. Nothing here can produce a ranking for the wrong person.
  useEffect(() => {
    userIdRef.current = userId;
    // A ranking that arrived before the identity did still belongs to this
    // user; write it under their key now rather than losing it.
    persistRanking();
    if (!userId) return;
    const mine = rankingFor(rankedCacheRef.current, userId) as RankedEntry[] | null;
    setRankedPills((current) => {
      if (sameRanking(current, mine)) return current;
      // A server answer already on screen outranks any cache: it is newer.
      if (serverAnsweredRef.current) return current;
      rankedPillsRef.current = mine;
      return mine;
    });
  }, [userId, persistRanking]);

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
  // R67 F-26 x A-16: F-26 owns the PAGING (a cursor appends a page instead of
  // replacing the pane, so "Show 20 more" grows the list the user is reading);
  // A-16 owns the RESILIENCE (two attempts, and a Retry that retries the read
  // rather than re-rendering an unrelated server component). They compose --
  // the retry wraps whichever page is being asked for.
  const loadTasks = useCallback(async (cursor?: string) => {
    const append = Boolean(cursor);
    if (append) setLoadingMore(true);
    try {
      // A REFRESH asks for as many rows as the user currently has on screen,
      // not for one page. Otherwise a five-minute background re-read would
      // collapse a list they had expanded to sixty rows back down to twenty,
      // under their cursor, for no reason they could see.
      const limit = append
        ? TASK_PAGE_SIZE
        : Math.min(TASK_MAX_LIMIT, TASK_PAGE_SIZE * (1 + extraPagesRef.current));
      const qs = new URLSearchParams({ limit: String(limit) });
      if (cursor) qs.set("cursor", cursor);
      // R67 A-16: attempted twice, one second apart, before the pane admits a
      // failure -- and the pane's Retry calls THIS, not router.refresh(), which
      // re-rendered a server component that does not own this list and so could
      // not actually retry the read. readJsonWithRetry() also reads the STATUS
      // before the body, which is what stops an error body that happens to
      // parse as JSON from becoming a confident empty list.
      const read = await readJsonWithRetry<ApiTasks>(`/api/tasks?${qs.toString()}`);
      if (!read.ok) {
        setTasksError(read.error);
        return;
      }
      const data = (read.data ?? {}) as ApiTasks;
      setTasksError(null);
      setNextCursor(data.nextCursor ?? null);
      setTasksLoaded(true);
      // Counts are refreshed on an APPENDED page too. They describe the whole
      // set (the backend computes them from a grouped aggregate, not from the
      // page it just returned), so a "Show 20 more" that left them alone would
      // freeze the badges at whatever the first page happened to see -- the
      // same disagreement between the tabs and the list under them that A-01's
      // comment below says can never happen.
      setCounts({
        home: Number(data.counts?.total) || 0,
        approval: Number(data.counts?.needsYou) || 0,
        queue: Number(data.counts?.running) || 0,
        done: Number(data.counts?.done) || 0,
      });
      const g = data.groups ?? {};
      // R67 A-01: kept RAW. The rows a tab shows are derived per tab further
      // down, because the five header tabs used to be pure decoration -- every
      // one of them rendered the same two lists, so clicking "Completed"
      // changed nothing on screen.
      //
      // R67 F-26: and a page is MERGED into what is already held, by id. A
      // blind concat would render a row twice, and a blind replace would drop
      // the optimistic row a Send just inserted -- making a successful Send
      // look lost until the next full read.
      const mergeRaw = (previous: ApiTask[], page: ApiTask[]) => {
        if (append) {
          const seen = new Set(previous.map((t) => t.id));
          return [...previous, ...page.filter((t) => !seen.has(t.id))];
        }
        const pageIds = new Set(page.map((t) => t.id));
        // A row the user just created that this page does not yet carry stays
        // put; the server's own version replaces it as soon as it appears.
        return [...previous.filter((t) => optimisticIdsRef.current.has(t.id) && !pageIds.has(t.id)), ...page];
      };
      setTaskGroups((prev) => ({
        needsYou: mergeRaw(prev.needsYou, g.needsYou ?? []),
        running: mergeRaw(prev.running, g.running ?? []),
        done: mergeRaw(prev.done, g.done ?? []),
        blocked: mergeRaw(prev.blocked, g.blocked ?? []),
        all: mergeRaw(prev.all, data.tasks ?? []),
      }));
      if (append) extraPagesRef.current += 1;
      else tasksFetchedAtRef.current = Date.now();
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
  // in directly. The full list is read once per mount, re-read on a navigation
  // that finds it older than five minutes, AND on a real five-minute timer.
  useEffect(() => {
    if (!bootstrapReady) return;
    if (tasksFetchedAtRef.current !== null && Date.now() - tasksFetchedAtRef.current < TASK_REVALIDATE_MS) return;
    void loadTasks();
  }, [loadTasks, bootstrapReady, pathname]);

  // The staleness check above only runs when something re-renders this effect
  // -- in practice, a navigation. A user who leaves Task Master open on one
  // route never navigates, so without this timer their pane would never
  // refresh at all, and a row another user or an executor moved would stay
  // wrong on screen indefinitely. (Single-row polling covers only the task
  // this user just sent.) Skipped while the tab is hidden: a background tab
  // waking up to fetch is cost with no reader, and the focus/visibility
  // handler above already refreshes on return.
  useEffect(() => {
    if (!bootstrapReady) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadTasks();
    }, TASK_REVALIDATE_MS);
    return () => clearInterval(id);
  }, [loadTasks, bootstrapReady]);

  // R67 F-26: place ONE task, by id, in whichever group its status belongs to
  // -- used by both the optimistic insert after a Send and the single-task
  // poll, so a task can never end up in two groups or in the wrong one.
  //
  // It writes the RAW task into A-01's groups rather than a rendered row: the
  // five header tabs derive their own rows from these groups, so a row built
  // here would be invisible to every tab but the one it was built for.
  //
  // `pinToNeedsYou` is the Send case: the task the user just submitted stays at
  // the top of "Needs you" while it is still executing, because that is the row
  // they are watching. Once it settles it takes its real group.
  const upsertTask = useCallback((api: ApiTask, pinToNeedsYou: boolean) => {
    const status = api.status ?? "";
    const settled = TERMINAL_TASK_STATUSES.has(status);
    const group = groupForStatus(status);
    const pinned = pinToNeedsYou && !settled;
    // A pinned task is shown under "Needs you" until it settles, whatever its
    // status says, so that is the group it is filed under while pinned.
    const target: keyof Omit<TaskGroups, "all"> = pinned ? "needsYou" : group;
    setTaskGroups((prev) => {
      const drop = (list: ApiTask[]) => list.filter((t) => t.id !== api.id);
      const next: TaskGroups = {
        needsYou: drop(prev.needsYou),
        running: drop(prev.running),
        done: drop(prev.done),
        blocked: drop(prev.blocked),
        all: [api, ...drop(prev.all)],
      };
      next[target] = [api, ...next[target]];
      return next;
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
            upsertTask(task, true);
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
    [upsertTask]
  );
  useEffect(() => {
    pollTaskRef.current = pollTask;
  }, [pollTask]);

  // *** MERGE NOTE (F-21 x A-08/A-16). ***
  //
  // A-16's loadRanking() lived here and read /api/pill-usage?limit=6 on every
  // navigation. F-21 folded that exact upstream call into the /api/shell
  // bootstrap, so the function is gone and the effect above applies its result
  // instead -- through the same applyRanking()/persistRanking() pair, so A-14's
  // "never repaint under a moving finger" and A-16's per-user cache are
  // untouched. `label`, `pinned` and `recentChains` were added to the bootstrap
  // payload for this, rather than the call being made a second time.

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
  // A-17: the current query string, for "is this pill's own view open".
  const [routeSearch, setRouteSearch] = useState("");
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

  // R67 A-21 -- AND THE RECORD ITSELF, ON AN OBJECT PAGE.
  //
  // A-13 wired the URL's ?projectId= into the shell and recorded what it could
  // NOT do: /scope/<id> and /moms/<id> carry no ?projectId= at all, resolve
  // nothing on the server, and fetch their record in the browser -- so the shell
  // fell back to the RAIL there. A bookmarked BOQ could therefore be described
  // in the strip under a different project's name than the one whose line items
  // were rendered beneath it. The record carries its own project, and the page
  // publishes it the moment it has one.
  const screenObject = routeScreen?.object ?? null;
  const objectProject = useMemo(() => {
    const id = screenObject?.projectId ?? null;
    if (!id) return null;
    // The page publishes the ID; the names are the shell's, from the one
    // /api/projects read it already makes. A project the user cannot reach
    // resolves to nothing rather than to a name invented here.
    return projects.find((p) => p.id === id) ?? null;
  }, [screenObject, projects]);

  // A-13 -- ONE ROOT, AND THE URL WINS. Route, then the record the URL names,
  // then whatever the screen published, then the rail's remembered choice.
  const project = routeProject ?? objectProject ?? routeScreen?.project ?? railProject;
  const projectId = project?.id ?? null;
  // HOW it was chosen, for the rail's label. A project named by the URL was
  // never automatic, whatever the page had to do to render it -- and neither
  // was one read off the record the URL names.
  const projectSource: ScreenProjectSource | null =
    routeProject || objectProject
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
  //
  // R67 A-21: on an OBJECT page the second fixed segment names the record --
  // "<project> › BOQ R66 Audit BOQ 1009b" -- and REPLACES the module segment
  // rather than following it. "BOQ" is the word this product already uses for a
  // Scope of Work record (the page's own breadcrumb reads "Scope / Bill of
  // Quantities"), so "<project> › Scope of Work › BOQ 1009b" would name the
  // module twice in one line. It is a root for the same reason the module is:
  // the user is standing in this record, so there is nothing to remove -- and
  // the kit's floor takes the LAST root, so both fixed segments are protected
  // by the same rule with no new mechanism.
  const objectSegment = useMemo(() => objectSegmentFor(screenObject), [screenObject]);
  const chain: Chain = useMemo(() => {
    const root = project ? [{ id: project.id, label: project.name, kind: "root" as const }] : [];
    const mod = objectSegment
      ? [{ id: objectSegment.id, label: objectSegment.label, kind: "root" as const }]
      : chainModule
        ? [{ id: `screen:${chainModule.id}`, label: chainModule.label, kind: "root" as const }]
        : [];
    const created = screen.createSegment
      ? [{ id: screen.createSegment.id, label: screen.createSegment.label, kind: "root" as const }]
      : [];
    return { mode, segments: [...root, ...mod, ...created, ...segments] };
  }, [mode, project, objectSegment, chainModule, screen.createSegment, segments]);

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
    setAwaitingText(false);
    setPlatformNotice(null);
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

  // R67 A-19 -- CHOOSING A PROJECT, FROM WHEREVER THE USER CHOSE IT.
  //
  // The rail cycles and band 2's chips name one directly, and both must do the
  // SAME thing -- otherwise a project picked from the chips would be forgotten
  // on the next reload, or would leave the URL naming a different one. Extracted
  // from the rail's own handler rather than copied, because two copies of this
  // are two chances for the rail and the pane to disagree, which is the defect
  // A-05 and A-13 both exist to close.
  const chooseProject = useCallback(
    (nextId: string | null) => {
      setProjectPrompt(null);
      setRailProjectId(nextId);
      // R67 A-05: remembered for this browser, in localStorage for the shell
      // and in a cookie so the SERVER resolves the same project -- then
      // re-render the pane, so the screen under the rail is about the project
      // the rail now names. Without the refresh the rail and the pane would
      // disagree for as long as the user stayed on the page.
      writeStoredProjectId(nextId);
      // R67 A-13 -- ON A SCREEN WHOSE URL NAMES THE PROJECT, THE CHOICE CHANGES
      // THE URL. The URL is the single source of truth, so a control that only
      // wrote local state would appear to do nothing at all here: the next
      // render would read the unchanged ?projectId= and put the old name
      // straight back.
      if (routeProjectId) {
        const params = new URLSearchParams(window.location.search);
        if (nextId) params.set("projectId", nextId);
        else params.delete("projectId");
        const qs = params.toString();
        router.push(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
        return;
      }
      // R67 A-21 -- ON AN OBJECT PAGE THE SWITCH LEAVES THE RECORD, ON PURPOSE.
      //
      // The record's own project now outranks the rail (that is the whole item),
      // so writing the preference here would leave a control that changes
      // nothing the user can see -- while making it change the strip would claim
      // this BOQ belongs to a project it does not. The honest third answer is the
      // one a person means by the switch: the same module, in the project they
      // just chose. It is exactly where this page's own Back button goes.
      const away = railDestinationForObject(screenObject, nextId);
      if (away) {
        router.push(away);
        return;
      }
      router.refresh();
    },
    [routeProjectId, router, screenObject]
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
      setAwaitingText(false);
      setPlatformNotice(null);
      setProjectPrompt(null);
      // R67 B-07: band 2 is shared with the verdict, and picking a module is a
      // NEW request -- leaving the previous answer up would pin "Understood:
      // <some other chain>" over the verbs of the module just chosen.
      setNotice(null);
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
      setAwaitingText(false);
      // A-12: one entity segment, replaced rather than chained -- a card IS the
      // whole verb+object, so a second card is a change of mind, not a step.
      setSegments([{ id: card.id, label: card.label, kind: "action" as const }]);
      // B-07: arming a card is a new request, so the previous verdict stands
      // down from band 2 (same reason as selectEntity above).
      setNotice(null);
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
  //
  // R67 A-17 -- AND THE DESTINATION IS NOW A TABLE, NOT A CHAIN OF CONDITIONS.
  // src/lib/pill-routes.ts says where each key goes; this switch only carries
  // it out. The branch that used to catch everything else and TYPE THE PILL'S
  // NAME INTO THE BOX has no successor here: "leave the draft untouched" is a
  // property of every arm below, and there is no arm that writes to it.
  //
  // WHAT IS RECORDED, AND WHAT IS DELIBERATELY NOT (review fix). Usage exists
  // for ONE purpose: to rank band 3's cards for this user. So a click is
  // recorded only when it names something band 3 can rank -- a module or a
  // view, both of which pass a derived chain whose last step resolves back
  // through moduleForPill(). The rail, "Other - type it" and the platform names
  // have no rankable card at all: rankCards() finds neither a card id nor a
  // module for "other" or "platform.email", pushes them to unknownKeys, and the
  // strip logs a warning and drops them -- after they have already consumed one
  // of the six slots the server returns, so the user's real sixth card never
  // reaches them. Recording them could only ever pollute the ranking it feeds.
  // card-catalogue.test.ts asserts that what IS recorded all resolves.
  const onModuleEntrySelect = useCallback(
    (entryId: string) => {
      const entry = pillEntryById(entryId);
      if (!entry) return;
      setShowAllPills(false);
      setPlatformNotice(null);
      switch (entry.destination) {
        case "input":
          // R67 A-15 -- "OTHER - TYPE IT" WRITES NOTHING, ANYWHERE.
          //
          // Not into the box (that was the old seeding branch, deleted in
          // A-02) and not into the strip: there is no segment for "I am about
          // to say something", and inventing one would put a word in the
          // sentence that the user did not choose. All it does is what its own
          // name says -- put the cursor in the box, show an example of the kind
          // of sentence this box takes, and let the Send button admit it is
          // waiting for words. On Send the ordinary { rawInput } classifier
          // path runs, entirely unchanged.
          //
          // The draft is normalised to empty rather than CLEARED: the item asks
          // for an empty input, and A-06 rules that words a person actually
          // typed are theirs. Whitespace is not words.
          setDraft((current) => (current.trim() ? current : ""));
          setAwaitingText(true);
          composerRef.current?.focus();
          return;
        case "rail":
          // "Projects" has no page in PROJEXA; its control is the top rail, so
          // the click goes there rather than nowhere.
          requestProject("Choose a project in the top rail");
          return;
        case "module": {
          const moduleId = entry.target?.kind === "module" ? entry.target.moduleId : entry.moduleId;
          const mod = moduleId ? MODULE_CATALOGUE.find((m) => m.id === moduleId) : undefined;
          if (!mod) return;
          if (isRankablePill(entry)) bumpUsage(entry.id, chainForUsage(mod.label, null));
          // D-08 / C-09: the second level is verbs. The module narrows the
          // sentence; its VERBS open routes (band 2).
          selectEntity(mod);
          return;
        }
        case "view": {
          // R67 A-17 -- A NAMED VIEW OPENS ITS REAL ROUTE. "Analysis" is a
          // screen, not a noun anyone finishes a sentence with, so it goes
          // where its name goes: the segment is appended to the strip, the URL
          // changes, and the draft is left exactly as the user left it.
          const href = entry.target ? pillHref(entry.target, projectId) : null;
          if (!href) return;
          // Policies (/grc?tab=policies) and Department (/employees?tab=
          // departments) are real PROJEXA screens with no module in this
          // catalogue, so nothing in band 3 could ever rank them either -- the
          // same reason the rail and the platform names record nothing.
          if (isRankablePill(entry)) bumpUsage(entry.id, chainForUsage(entry.label, null));
          setSegments([{ id: entry.id, label: entry.label, kind: "action" as const }]);
          setPendingFunctionId(null);
          setArmedCard(null);
          setAwaitingText(false);
          setProjectPrompt(null);
          setLoaded(null);
          router.push(href);
          return;
        }
        case "platform":
          // R67 A-17 -- NOT A DEAD END AND NOT A LIE. The name belongs to
          // VERIDIAN and has no PROJEXA screen; band 2 says so and offers the
          // one thing that helps, which is the way there.
          setPlatformNotice(entry.label);
          return;
      }
    },
    [bumpUsage, chainForUsage, projectId, requestProject, router, selectEntity, setLoaded]
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
      setAwaitingText(false);
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

  // R67 A-20 -- THE SCREEN'S OWN CARDS, KEYED BY ROUTE AND TAB.
  //
  // This replaces the row that rendered the MODULE's leaves. A module has one
  // set of leaves however many tabs it has, which is why eight of the
  // seventeen composer crops the audit captured were byte-for-byte identical:
  // the attendance register, the timesheet, the receipts book and the schedule
  // board all offered the same controls. The table (src/lib/composer-cards.ts)
  // is keyed by route AND tab, and a screen it does not name still falls back
  // to its module's leaves, so nothing loses the verbs it had.
  //
  // THE QUERY STRING IS PASSED, NOT ONLY THE TAB. A-01's rule -- never offer a
  // control whose only destination is the screen already on show -- is applied
  // to these cards by their RESOLVED DESTINATION (composer-cards.ts's
  // cardPointsAtCurrentScreen), and a destination is a path AND its parameters:
  // "Expiring soon" is a live control on /permits and a dead one on
  // /permits?withinDays=30. Without the search this row would keep offering the
  // filter the user is already looking at.
  const screenCards = useMemo(
    () => cardsFor(pathname ?? "/", new URLSearchParams(routeSearch).get("tab"), routeSearch),
    [pathname, routeSearch]
  );

  // A CARD CLICK NEVER EXECUTES. It opens a real page, or it loads its sentence
  // into the strip and stops -- and when it stops, the cursor goes to the box
  // and the Send button admits it is waiting for words, because a chain nobody
  // can finish is a dead end however good the sentence looks.
  const onScreenCardSelect = useCallback(
    (cardId: string) => {
      const card: ScreenCard | undefined = screenCards.find((c) => c.id === cardId);
      if (!card) return;
      const mod = MODULE_CATALOGUE.find((m) => m.id === card.moduleId) ?? null;
      bumpUsage(card.id, chainForUsage(card.label, mod?.label ?? null));
      setPendingFunctionId(null);
      setArmedCard(null);
      setPlatformNotice(null);
      // The sentence, minus the word the strip is already showing -- see
      // chainForScreenCard() for why the module must not be named twice, and
      // why leaving it in would stand this very card row down.
      setSegments(
        chainForScreenCard(card, chainModule?.id ?? null).map((s) => ({ id: s.id, label: s.label, kind: s.kind }))
      );
      const href = hrefForScreenCard(card, { pathname: pathname ?? "/", projectId });
      if (!href) {
        // Load-and-stop. Completing such a sentence in ONE more click is WS-C's
        // ConfirmCard over WS-B's registered executors -- this item's own
        // declared dependencies (C-16, B-11). Until they land the sentence is
        // finished in words, which is a path that works end to end today.
        setAwaitingText(true);
        composerRef.current?.focus();
        return;
      }
      if (mod && mod.needsProject !== false && !projectId && !href.includes("projectId=")) {
        requestProject(noProjectPromptFor(mod));
        return;
      }
      setAwaitingText(false);
      setProjectPrompt(null);
      router.push(href);
    },
    [bumpUsage, chainForUsage, chainModule, pathname, projectId, requestProject, router, screenCards]
  );

  const screenCardViews: ScreenCardView[] = useMemo(
    () => screenCards.map((c) => ({ id: c.id, label: c.label, verb: c.verb, opens: Boolean(c.open) })),
    [screenCards]
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
    setNotice(null);
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
      //
      // R67 A-22 -- WHY `mode` IS STILL IN THIS BODY.
      //
      // The item says to delete it, on the stated grounds that "the server
      // ignores it". IT DOES NOT. Checked, not assumed, in compliance-tracker
      // at src/app/api/v1/projexa/tasks/route.ts:49 -- `body.mode`, defaulting
      // to "Projects" -- and followed through:
      //
      //   run-submission.ts:196/446  writes it to compliance.submissions.mode,
      //                              which the same route's GET selects back
      //                              (:140) and this shell reads on every row.
      //   run-submission.ts:291      passes it into deriveChain(), where
      //   derive-chain.ts:170        a chain with NO project takes its root
      //                              from it: `All ${mode.toLowerCase()}`.
      //   run-submission.ts:631      writes it to compliance.chain_history,
      //                              the table A-08's "Do again" cards read.
      //
      // So deleting the field would not be a no-op: a chain the user started
      // from Customers with no project selected would be recorded, and shown
      // back to them in Task Master, rooted "All projects" -- a task filed
      // under the wrong noun. What the item is really objecting to is a mode
      // the USER sets and the app remembers, and that is gone: A-05 deleted the
      // tabs, the state and the sessionStorage key, and deriveMode() reads the
      // value off the chain itself. The value travels; the control does not.
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

      // R67 B-07: the TYPED path no longer executes on Send. It answers with
      // a VERDICT -- what the server understood, and what it still needs --
      // and mints nothing. Only a second POST {confirm:true, submissionId}
      // runs it. The PILL path is unchanged: the user already chose the
      // function, so there is nothing left to confirm.
      const verdict = pendingFunctionId ? null : (d as SubmissionVerdict | null);
      if (verdict && typeof verdict.status === "string") {
        if (verdict.status === "needs_input") {
          // The question, in the closed vocabulary. NEVER the parameter name.
          const gap = verdict.missing?.[0];
          setNotice({
            chain: verdict.chain ?? null,
            text: gap ? messageFor(gap.code) : "That needs a little more detail",
          });
          // The words the user typed stay in the box: they are most of the
          // answer, and clearing them would make them type it all again.
          return;
        }
        if (verdict.status === "gap" || verdict.status === "answered" || verdict.status === "chat") {
          setNotice({ chain: verdict.chain ?? null, text: verdict.message ?? verdict.answer?.text ?? null });
          setDraft("");
          await loadTasks();
          return;
        }
        if (verdict.confirmable && verdict.submissionId) {
          const confirmRes = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              confirm: true,
              submissionId: verdict.submissionId,
              functionId: verdict.understood?.functionId,
              params: {},
            }),
          });
          const confirmed = await confirmRes.json().catch(() => null);
          if (!confirmRes.ok) {
            setSubmitError(
              confirmed && typeof confirmed.error === "string" && confirmed.error.trim()
                ? confirmed.error
                : `Submit failed (HTTP ${confirmRes.status})`
            );
            return;
          }
          setNotice({ chain: verdict.chain ?? null, text: null });
        } else if (verdict.status === "ready" && verdict.links?.[0]?.route) {
          // A COMMAND verb ("Run the Work Progress Report") does not execute
          // anything server-side -- it opens the screen that already does the
          // thing, with its parameters attached. Navigating IS the action, so
          // there is nothing to confirm.
          setNotice({ chain: verdict.chain ?? null, text: null });
          router.push(verdict.links[0].route);
        }
      }

      setDraft("");
      setPendingFunctionId(null);
      setArmedCard(null);
      setAwaitingText(false);
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
      //
      // R67 MERGE (lane B x lane F2): the per-task shape is B-01's, not the
      // one F-26 was written against. `error: string` is GONE from
      // TaskOutcome on the VERIDIAN side -- deliberately, so no caller can
      // render a driver message verbatim -- and the structured
      // {code, missing, context} `failure` replaces it. The optimistic row
      // therefore carries `failure`, which is exactly what toTaskRow() already
      // renders through task-errors.ts. Keeping `error` here would not have
      // compiled, and mapping it to `legacyError` would have been worse: it
      // would route a brand-new failure through the LEGACY prose path.
      const minted = ((d?.tasks ?? []) as {
        taskId: string;
        functionId?: string | null;
        status?: string | null;
        failure?: { code?: string | null; missing?: string[]; context?: Record<string, string | number | null> | null } | null;
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
          failure: task.failure ?? null,
          rawInput: task.segmentText ?? typed,
          mode,
        };
        optimisticIdsRef.current.add(task.taskId);
        upsertTask(api, true);
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
          ...c,
          home: c.home + minted.length,
          approval: c.approval + addedNeedsYou,
          queue: c.queue + addedRunning,
          // `done` is carried through untouched: a Send mints work, it never
          // completes any, and A-10 reads counts.done as "has this account ever
          // finished a task".
        }));
      }
      // (A-10's setArmedCard/setAwaitingText resets moved to the top of this
      // block; A-16's `await loadTasks()` is deliberately gone -- the minted
      // rows are inserted from THIS response above, which is F-26's whole
      // point. "The minted task must APPEAR" still holds, sooner.)
    } catch {
      setSubmitError("Couldn't reach the task service.");
    } finally {
      setSubmitting(false);
    }
    // R67 MERGE (lane B x lane F2): the union of both lanes' dependencies. This
    // body still calls loadTasks() (B-07's verdict branch) and router.push()
    // (B-07's COMMAND verb) as well as upsertTask() (F-26's optimistic
    // insert), so all three must be listed or this closure goes stale.
  }, [draft, pendingFunctionId, mode, projectId, chainModule, submitting, upsertTask, loadTasks, router]);

  // A-07: pinning is how a user defeats the 7-day decay for work they know is
  // periodic (a month-end report used heavily on the 30th and invisible from
  // the 8th). It is stored per browser and applied on top of whatever the
  // server ranked, so a pin never has to wait for a round trip to take effect.
  const onTogglePin = useCallback((cardId: string) => {
    setPinnedCards((prev) => {
      const next = prev.includes(cardId) ? prev.filter((k) => k !== cardId) : [...prev, cardId];
      try {
        localStorage.setItem(PINNED_CARDS_KEY, JSON.stringify(next));
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
    // A-15: the "say what you need" prompt belonged to the screen it was
    // asked for; a new screen asks its own question. A-17: so did the "not
    // part of PROJEXA" line.
    setAwaitingText(false);
    setPlatformNotice(null);
    // A-14: a ranking that arrived while a strip was already on screen was held
    // back rather than re-ordering cards under the user's finger. A navigation
    // is the one moment they have already looked away, so it lands here -- and
    // this is the ONLY place the visible order ever changes.
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
    // B-07: an answer about the chain that was just cleared has nothing left to
    // describe, and band 2 would otherwise carry it onto an unrelated screen.
    setNotice(null);
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
        // R67 A-17: "the pill carries aria-pressed while its route is open".
        // For a view that is its own pathname AND its own query -- a pill for
        // /schedule?tab=board is not open while the timeline is showing.
        pressed: entry.target ? isPillRouteOpen(entry.target, pathname ?? "", routeSearch) : false,
        unavailable:
          entry.moduleId && pillPointsAtCurrentScreen(entry.moduleId, entry.label, pathname ?? "")
            ? "you are here"
            : undefined,
      })),
    [pathname, routeSearch]
  );

  // A-07: three skeletons appear ONLY when there is genuinely nothing to paint
  // -- no cached ranking from a previous visit and no role to order the
  // catalogue by. Painting the default order and then swapping it for the
  // role's order would be the same flicker in a different costume.
  const cardsLoading = rankedPills === null && !roleKnown;

  // A-14/A-16: keep the two answers the async ranking callback needs where it
  // can read them -- what is on screen, and whether anything real is on screen
  // at all.
  //
  // IT IS AN EFFECT, NOT A RENDER-PHASE WRITE. Writing a ref while rendering is
  // a React rule violation and this repo's lint enforces it (react-hooks/refs).
  // It is also not needed to be correct here: the only reader is the
  // /api/pill-usage callback, which is a promise resolution from a fetch STARTED
  // in a passive effect of an earlier commit. Every passive effect of a commit
  // -- including this one -- runs before any promise a sibling effect started
  // can resolve, so the mirror is never stale by the time A-14's rule reads it.
  useEffect(() => {
    rankedPillsRef.current = rankedPills;
    paintedRef.current = isStripPainted({ cachedRanking: rankedPills, roleKnown });
  }, [rankedPills, roleKnown]);

  // A-16 -- THE ORGANISATION, IN WORDS. Three states, three sentences, and none
  // of them is the bare em-dash the kit's string fallback produced.
  const orgLabel = organisationLabel({ name: info?.organization?.name, failed: orgFailed });

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
      // A-19: on an org-wide screen -- the Reports catalogue, Customers,
      // Vendors -- a project is not part of the sentence, so it is not a
      // missing thing and Send is not held hostage to choosing one.
      projectRequired: activeModule ? activeModule.needsProject !== false : true,
      projectName: project?.name ?? null,
      // A-11/A-12: the module in play -- the one just picked, else the one the
      // screen IS. One answer, so the next question names one module.
      //
      // A-21: on an object page, and until the user picks a different module,
      // the question names the RECORD's kind -- "type what you need on this
      // BOQ" -- because the strip beside it is saying "BOQ <title>" and calling
      // one thing two names on one screen is the defect being removed.
      moduleLabel:
        (!selectedModule ? objectPromptLabel(screenObject) : null) ?? activeModule?.label ?? null,
      action: armedCard ? { label: armedCard.label, object: armedCard.object, kind: armedCard.kind } : null,
      // HONEST LIMIT: the missing-step state is fully implemented here and in
      // chain-status.ts, and nothing populates it yet. The list of fields an
      // armed function still needs is WS-B's { code, missing } closed-
      // vocabulary payload (D-03), which the executor does not return today --
      // it returns raw strings. Inventing a list of "required fields" from the
      // client would be a guess dressed up as a validation.
      missing: [],
      hasText: draft.trim().length > 0,
      // A-19: the user's OWN segments. The screen's module is not one of them
      // -- standing on Permits is not the same as having said anything.
      hasSegment: segments.length > 0,
      // A-15: it changes the Send button's name and nothing else.
      awaitingText,
      busy: submitting,
      error: submitError ?? projectPrompt,
    }),
    [
      screen.shipped,
      projectsLoaded,
      projects.length,
      project,
      activeModule,
      selectedModule,
      screenObject,
      armedCard,
      draft,
      segments,
      awaitingText,
      submitting,
      submitError,
      projectPrompt,
    ]
  );
  const instruction = chainPrompt(composerState);
  const sendEnabled = canSendFrom(composerState);
  const sendButtonLabel = sendLabelFor(composerState);
  // A-19: what the button's own name is naming, so band 2 can offer the thing
  // it asks for rather than only reporting its absence.
  const missingSendItems = useMemo(() => missingThings(composerState), [composerState]);

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
    // R67 A-17 -- THE ONE LINE FOR A NAME PROJEXA DOES NOT HAVE. It outranks
    // the option chain because it IS the answer to the click that produced it:
    // "Email" has no verbs here, and offering another module's would be worse
    // than saying so.
    if (platformNotice) {
      return (
        <p className="flex items-center gap-2 text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
          <span>
            {platformNotice} — {NOT_IN_PROJEXA}
          </span>
          <a href={VERIDIAN_LINK} target="_blank" rel="noopener noreferrer" className="veri-view-tab">
            Open VERIDIAN
          </a>
        </p>
      );
    }
    // R67 A-19 -- "When the missing item is a project, band 2 shows the project
    // chips." The button says what is missing; this is where it can be supplied
    // without leaving the composer. It outranks the option chain because a
    // module's verbs all need the project anyway -- offering them first would
    // be offering a click that can only end in "choose a project".
    if (missingSendItems.includes(MISSING_PROJECT) && projects.length > 0) {
      return (
        <OptionChain
          legend="Which project?"
          options={projects.map((p) => ({ id: p.id, label: p.name }))}
          kind="root"
          selectedId={projectId}
          onAdvance={(segment) => chooseProject(segment.id)}
        />
      );
    }
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
  }, [
    platformNotice,
    missingSendItems,
    projects,
    projectId,
    chooseProject,
    selectedModule,
    screen.createSegment,
    segments,
    onLeafSelect,
  ]);

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
        // MERGE NOTE: A-13's rail replaces F-18's inline cookie write here.
        // chooseProject() already calls writeStoredProjectId() -- the one
        // writer rememberSelectedProject() now delegates to -- and also syncs
        // the URL, which the inline version did not. A-16's "Retry" calls
        // refreshShell(), since F-21 replaced loadOrgInfo() with the
        // bootstrap, and the bell renders from that same bootstrap.
        //
        // The wrapper exists so the composer can put keyboard focus on the
        // project control when a click could not proceed without one (A-03):
        // the rail is where that decision is made, so that is where the user
        // is sent, rather than being told "no" and left where they were.
        <div ref={railRef}>
          {/* A-13: the URL's own ?projectId=, read behind the Suspense boundary
              this repo already uses for useSearchParams(). Renders nothing. */}
          <Suspense fallback={null}>
            <RouteProjectIdReader onChange={setRouteProjectId} onSearch={setRouteSearch} />
          </Suspense>
          <TopRail
            brand={<span className="text-[13px] font-semibold tracking-tight">PROJEXA</span>}
            // A-16: "Organisation unavailable — [Retry]" when two attempts
            // failed, "Loading…" until the first answers, and the name once it
            // has. A lone "—" is not one of the reachable states any more.
            organisation={
              <>
                <span>{orgLabel.text}</span>
                {orgLabel.retry && (
                  <button
                    type="button"
                    onClick={() => void refreshShell()}
                    className="veri-view-tab"
                    style={{ minHeight: 24 }}
                  >
                    Retry
                  </button>
                )}
              </>
            }
            project={railLabelProject}
            onSwitchProject={() => {
              // Cycles through real projects and back through the null state.
              // M24: "THE PROJECT SELECTOR NEEDS A NULL STATE ('All projects')
              // so CRM, pipeline and org-level work are reachable." The cycle
              // starts from the project actually on show, which after A-03 may
              // be the one the SCREEN resolved rather than the last one clicked.
              if (projects.length === 0) return;
              const i = projects.findIndex((p) => p.id === projectId);
              const next = i === projects.length - 1 ? null : (projects[i + 1] ?? projects[0]);
              chooseProject(next ? next.id : null);
            }}
            search={<SearchTrigger />}
            alerts={<NotificationBell initialNotifications={shell.notifications as never} initialUnreadCount={shell.unreadCount} />}
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
              {/* A-16 -- ONE LINE, then the backend's own words under it. The
                  notice names the thing that failed in the user's language;
                  the detail is kept because it is the only sentence that can
                  tell an operator WHY, and hiding it in a tooltip would lose
                  it. Retry calls the task read itself: the old control called
                  router.refresh(), which re-renders a server component that
                  does not own this list, so the one control offered on a
                  failure could not actually retry it. */}
              <p role="alert" className="flex items-center gap-2 text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>
                <span>{TASKS_UNAVAILABLE}</span>
                <button type="button" onClick={() => void loadTasks()} className="veri-view-tab" style={{ minHeight: 24 }}>
                  Retry
                </button>
              </p>
              {tasksError && (
                <p className="mt-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
                  {tasksError}
                </p>
              )}
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
          // BAND 2 -- CONVERSATION. Two lanes land here and they are sequential,
          // not competing: A-12 gives the band the picked module's own verbs
          // while the user is still ASSEMBLING a request, and B-07 gives it the
          // server's answer once they have SENT one ("Understood: <chain>" plus
          // whatever is still missing). So a live verdict takes the band and the
          // module's verbs hold it the rest of the time. Picking a module clears
          // the verdict (onOptionLevel below), so the band always describes the
          // user's most recent action rather than stacking two conversations.
          //
          // The B-07 sentence comes from src/lib/task-errors.ts, so this band
          // can never print a camelCase parameter, a function id or an address.
          conversation={
            notice ? (
              <div className="px-1 py-0.5 text-[12px]" style={{ color: "var(--color-ct-navy)" }}>
                {notice.chain && (
                  <p style={{ color: "var(--color-ct-muted)" }}>Understood: {notice.chain}</p>
                )}
                {notice.text && <p>{notice.text}</p>}
              </div>
            ) : (
              optionLevel
            )
          }
          // BAND 3 -- the screen's own verbs first, then six role-ranked cards
          // and "All modules". M24 shows "their top five or six ... That IS the
          // load reduction"; D-10 makes those six verb+object CARDS rather than
          // module names, and keeps every demoted pill reachable under "All
          // modules" so nothing becomes a dead end.
          pills={
            <>
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
              <PillStrip
                cards={cardViews}
                // A-20: the screen's own verbs are a PROP of the strip now,
                // keyed by route AND tab, instead of a separate row above it
                // rendering the module's leaves. A module has one set of leaves
                // however many tabs it has, which is exactly why eight of the
                // seventeen captured composer crops were identical.
                screenCards={selectedModule ? [] : screenCardViews}
                onSelectScreenCard={onScreenCardSelect}
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
              {/* R67 A-22 -- AND NOTHING ELSE. This slot used to be a flex
                  column with a gap around TWO rows: the module's leaves above
                  the strip, and the strip. A-20 moved the leaves inside the
                  strip as screenCards, which left a container with a gap and a
                  single child -- a column of one, reserving space between rows
                  that no longer exist. */}
            </>
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
          //
          // A-15: "Other - type it" overrides both. It is the one control whose
          // whole meaning is "the box is where this happens", so the box shows
          // an example of the kind of sentence it takes.
          placeholder={
            awaitingText
              ? "Type what you need, e.g. mark all masons present today"
              : promptModule
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
