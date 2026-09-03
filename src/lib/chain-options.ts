// R67 WS-C (C-04) -- THE LEVELS BAND 2 ASKS, BUILT FROM REAL DATA.
//
// WHERE THE RESOLVER LIVES, AND WHY IT LIVES HERE FOR NOW. C-04's design is
// GET /api/v1/projexa/chain-options on VERIDIAN, reached through a PROJEXA
// proxy so the org API key stays server-side (D-04). That VERIDIAN endpoint
// is WS-B's and does not exist yet; nothing in this repo may invent it. What
// this file does instead is resolve the same levels from the endpoints
// PROJEXA ALREADY PROXIES -- /scope for a project's BOQ -- and return them in
// exactly the shape C-04 describes, so when WS-B's endpoint ships the proxy
// swaps one fetch for another and this file's normaliseLevel() keeps
// guarding the contract.
//
// PURE. No fetch, no React. The route hands it the JSON it already fetched.

import type { ChainOptionDto, ChainOptionGroup, ChainOptionsLevel } from "./card-catalogue";

// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------

/** A level path: ["work_progress", "record_progress"] -> "Which BOQ line?" */
export type LevelPath = readonly string[];

export function parseLevelPath(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Narrow an untrusted level payload to the contract, or null.
 *
 * This is what makes swapping in WS-B's endpoint safe: a response that does
 * not carry a legend and an options array is not "an empty level", it is a
 * broken one, and the panel must show the error rather than the words
 * "nothing to choose here".
 */
export function normaliseLevel(raw: unknown): ChainOptionsLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.legend !== "string" || !r.legend.trim()) return null;
  if (!Array.isArray(r.options)) return null;
  const kind = r.kind === "action" || r.kind === "step" ? r.kind : "step";
  const options: ChainOptionDto[] = [];
  for (const o of r.options) {
    if (!o || typeof o !== "object") continue;
    const opt = o as Record<string, unknown>;
    if (typeof opt.id !== "string" || typeof opt.label !== "string") continue;
    options.push({
      id: opt.id,
      label: opt.label,
      keywords: typeof opt.keywords == "string" ? opt.keywords : undefined,
      isLeaf: opt.isLeaf === true,
      unavailableReason: typeof opt.unavailableReason === "string" ? opt.unavailableReason : undefined,
    });
  }
  const emptyPrompt =
    r.emptyPrompt && typeof r.emptyPrompt === "object"
      ? (() => {
          const p = r.emptyPrompt as Record<string, unknown>;
          return typeof p.text === "string"
            ? {
                text: p.text,
                actionLabel: typeof p.actionLabel === "string" ? p.actionLabel : undefined,
                route: typeof p.route === "string" ? p.route : undefined,
              }
            : undefined;
        })()
      : undefined;
  const groups: ChainOptionGroup[] = Array.isArray(r.groups)
    ? (r.groups as unknown[]).flatMap((g) => {
        if (!g || typeof g !== "object") return [];
        const group = g as Record<string, unknown>;
        if (typeof group.label !== "string" || !Array.isArray(group.optionIds)) return [];
        return [{ label: group.label, optionIds: group.optionIds.filter((id): id is string => typeof id === "string") }];
      })
    : [];
  const preselectedIds = Array.isArray(r.preselectedIds)
    ? (r.preselectedIds as unknown[]).filter((id): id is string => typeof id === "string")
    : undefined;
  return {
    legend: r.legend,
    kind,
    options,
    emptyPrompt,
    multi: r.multi === true,
    preselectedIds,
    groups: groups.length > 0 ? groups : undefined,
    searchBy: typeof r.searchBy === "string" ? r.searchBy : undefined,
  };
}

// ---------------------------------------------------------------------------
// THE ROSTER (R67 C-08)
// ---------------------------------------------------------------------------

export type RosterEntry = {
  id: string;
  name?: string | null;
  trade?: string | null;
  isActive?: boolean | null;
};

/** Workers who are still on the books. An inactive one is not on site today. */
export function activeRoster(roster: readonly RosterEntry[]): RosterEntry[] {
  return roster.filter((r) => r.isActive !== false);
}

/** "Carpenter" / "No trade recorded" -- never a blank sub-heading. */
export function tradeOf(entry: RosterEntry): string {
  const trade = (entry.trade ?? "").trim();
  return trade || "No trade recorded";
}

/**
 * "Who was on site?" -- the whole crew, grouped by trade, EVERY ID ALREADY
 * TICKED.
 *
 * *** THE DEFAULT IS PRESENT, BECAUSE THAT IS THE TRUTH ON MOST DAYS. *** A
 * foreman marks the exceptions; asking him to tick twelve names to record a
 * normal morning is the twelve-round-trip form this replaces, with extra
 * steps.
 *
 * The groups are ordered by trade name so the grid does not reshuffle between
 * two loads of the same roster, and the workers inside a trade keep the
 * roster's own order.
 */
export function rosterLevel(roster: readonly RosterEntry[]): ChainOptionsLevel {
  const active = activeRoster(roster);
  const options: ChainOptionDto[] = active.map((r) => ({
    id: r.id,
    label: (r.name ?? "").trim() || "Unnamed worker",
    // C-08's search is "by name or trade", so the trade travels with the chip.
    keywords: tradeOf(r),
  }));
  const byTrade = new Map<string, string[]>();
  for (const entry of active) {
    const trade = tradeOf(entry);
    const bucket = byTrade.get(trade);
    if (bucket) bucket.push(entry.id);
    else byTrade.set(trade, [entry.id]);
  }
  const groups = [...byTrade.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, optionIds]) => ({ label, optionIds }));
  return {
    legend: "Who was on site?",
    kind: "step",
    options,
    multi: true,
    preselectedIds: options.map((o) => o.id),
    groups,
    searchBy: "name or trade",
    emptyPrompt: {
      text: "This project has no workers on its roster yet",
      actionLabel: "Add worker",
      route: "/labour/new",
    },
  };
}

// ---------------------------------------------------------------------------
// BOQ LINES
// ---------------------------------------------------------------------------

export type BoqLineItem = {
  id: string;
  itemCode?: string | null;
  description?: string | null;
  parentLineItemId?: string | null;
  unit?: string | null;
};

export type BoqRow = {
  id: string;
  version?: number | null;
  status?: string | null;
  createdAt?: string | null;
  lineItems?: BoqLineItem[] | null;
};

/**
 * The BOQ progress is recorded against: the newest one that has not been
 * superseded. Version first, then createdAt -- the same tiebreaker VERIDIAN's
 * own listBoqs() uses, because two independent BOQs can share a version and
 * "whichever the engine returned first" is not an answer.
 */
export function pickCurrentBoq(boqs: readonly BoqRow[]): BoqRow | null {
  const live = boqs.filter((b) => (b.status ?? "").toLowerCase() !== "superseded");
  const pool = live.length > 0 ? live : boqs;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const v = (b.version ?? 0) - (a.version ?? 0);
    if (v !== 0) return v;
    return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
  })[0];
}

/** "EX-01 Excavation" -- the code the user says, then the words they read. */
export function lineLabel(item: BoqLineItem): string {
  const code = (item.itemCode ?? "").trim();
  const description = (item.description ?? "").trim();
  if (code && description) return `${code} ${description}`;
  return code || description || "Untitled line";
}

/**
 * One chip per BOQ line.
 *
 * *** A PARENT LINE IS SHOWN AND DISABLED, NOT HIDDEN. *** Progress belongs
 * on the leaf that carries the quantity; a parent's percentage is derived
 * from its children. Hiding parents would leave the user hunting for a code
 * they can see on the BOQ itself, so the chip is rendered with the reason in
 * words -- which is the one thing the kit's OptionChain asks for in exchange
 * for showing an unpickable option at all.
 */
export function boqLineOptions(boq: BoqRow | null): ChainOptionDto[] {
  const items = boq?.lineItems ?? [];
  const parentIds = new Set(items.map((i) => i.parentLineItemId).filter((id): id is string => Boolean(id)));
  return items.map((item) => ({
    // THE ITEM CODE IS THE ID THE CHAIN CARRIES, not the row id. The executor
    // resolves a BOQ line by item_code within the project's current BOQ
    // (executor.ts's executeRecordWorkProgress), so carrying the row id here
    // would build a chain the write cannot use. The row id is the fallback
    // for a line with no code, which is the only case where it is the only
    // handle that exists.
    id: (item.itemCode ?? "").trim() || item.id,
    label: lineLabel(item),
    isLeaf: !parentIds.has(item.id),
    unavailableReason: parentIds.has(item.id) ? "Parent line — pick one of its sub-lines" : undefined,
  }));
}

/** "Which BOQ line?", with the way out when the project has no BOQ at all. */
export function boqLineLevel(boqs: readonly BoqRow[]): ChainOptionsLevel {
  const boq = pickCurrentBoq(boqs);
  return {
    legend: "Which BOQ line?",
    kind: "step",
    options: boqLineOptions(boq),
    emptyPrompt: {
      text: "This project has no BOQ yet",
      // C-04's own example says "Import BOQ". There is no import SCREEN in
      // this repo yet -- the importer is shipped server-side and C-07 adds
      // its UI -- so the way out names the screen that DOES exist rather
      // than a button that would go nowhere.
      actionLabel: "New BOQ",
      route: "/scope/new",
    },
  };
}

// ---------------------------------------------------------------------------
// THE VALUE STEP
// ---------------------------------------------------------------------------

/**
 * "How much?" -- the common percentages as chips, with the exact number
 * available as a labelled field in band 4. Chips are for the four answers
 * that cover most of a site engineer's day; the field is for the rest.
 */
export function progressValueLevel(): ChainOptionsLevel {
  return {
    legend: "How much?",
    kind: "step",
    options: [
      { id: "25", label: "25 %", isLeaf: true },
      { id: "50", label: "50 %", isLeaf: true },
      { id: "75", label: "75 %", isLeaf: true },
      { id: "100", label: "100 %", isLeaf: true },
    ],
  };
}

// ---------------------------------------------------------------------------
// THE ROUTER
// ---------------------------------------------------------------------------

/** Which upstream read a level needs, so the route fetches only that. */
export type LevelSource =
  | { kind: "boq"; projectId: string }
  | { kind: "roster"; projectId: string }
  | { kind: "static"; level: ChainOptionsLevel }
  | null;

/**
 * What a level path means. The route uses this to decide what to fetch; every
 * unknown path resolves to null, which the route answers with a 404 and the
 * panel renders as an error with Retry -- never as an empty chip row, because
 * "there is nothing here" and "I do not know what you asked for" are
 * different answers.
 */
export function levelSourceFor(path: LevelPath, projectId: string | null): LevelSource {
  const key = path.join("/");
  if (key === "work_progress/record_progress") {
    return projectId ? { kind: "boq", projectId } : null;
  }
  // R67 C-08: the crew, for a day's attendance in one write.
  if (key === "manpower/mark_attendance") {
    return projectId ? { kind: "roster", projectId } : null;
  }
  // R67 C-08: site photos get the same BOQ-line chip row, because "which line
  // is this a photo of" is the question that makes a photo useful later. The
  // line is OPTIONAL here -- the attach card saves with or without one -- so
  // nothing on this level blocks the upload.
  if (key === "work_progress/upload_photos") {
    return projectId ? { kind: "boq", projectId } : null;
  }
  if (path.length === 3 && path[0] === "work_progress" && path[1] === "record_progress") {
    return { kind: "static", level: progressValueLevel() };
  }
  return null;
}
