// R67 WS-A (A-07) -- PROJEXA'S CARD CATALOGUE. Verb + object, role-ranked.
//
// WHY IT LIVES HERE (correction C-12, decision D-09, owner approval D-10):
// the card list is PRODUCT data. The kit is a shared release dependency whose
// source is not in this repo, and platform.mode_pills has no reader in any
// codebase -- a row there is governance documentation, not a source of truth.
// So the cards, their order and their role weights are written down once, in
// projexa, here.
//
// D-10, VERBATIM CONSEQUENCE: the owner has approved reversing the 2026-08-26
// "ALL 14 UNIVERSAL PILLS STAY" ruling FOR PROJEXA ONLY. PROJEXA's first level
// is now role-ranked verb+object cards plus "All modules", which lists Sumeet's
// eleven modules in HIS order, then "Other - type it", then a Platform group
// that still holds the fourteen universal pills so the same name still reaches
// the same destination. The platform-wide default for other products is
// unchanged, and nothing here is a kit change.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//  1. A CARD IS A VERB AND AN OBJECT. "Permits" is a place; "Add permit" is a
//     thing you can do. The kind word (Record / Ask / Run) is rendered BESIDE
//     the glyph, never encoded in colour alone -- a strip whose meaning is
//     carried by hue is unreadable to a third of the site engineers using it
//     on a phone in daylight.
//
//  2. EVERY CARD'S DESTINATION IS A REAL ROUTE, and it is the SAME route the
//     screen's own header control produces. That is enforced structurally:
//     a card does not carry a path, it carries a leafId into
//     module-catalogue.ts, whose every path is checked against the shipped
//     route registry by module-catalogue.test.ts and nav-routes.test.ts. A
//     card cannot point at a page that does not exist.

import type { OrgRole } from "@/lib/authz/roles";
import {
  MODULE_CATALOGUE,
  moduleForPill,
  moduleHref,
  normalisePillKey,
  type ModuleDef,
  type ModuleLeaf,
} from "./module-catalogue";

/** What a card DOES, in the closed set the composer's Send button also uses. */
export type CardKind = "write" | "ask" | "run";

/** The word rendered beside the glyph. Colour never carries meaning alone. */
export const KIND_WORD: Readonly<Record<CardKind, string>> = {
  write: "Record",
  ask: "Ask",
  run: "Run",
};

/** Supplementary to the word above, never a substitute for it. */
export const KIND_GLYPH: Readonly<Record<CardKind, string>> = {
  write: "✎",
  ask: "?",
  run: "▶",
};

/**
 * A condition that must hold before a card can do anything. A card whose
 * precondition is unmet STAYS VISIBLE AND DISABLED with the reason in words --
 * hiding it would make the strip's contents depend on invisible state, and the
 * user would have no way to learn the control exists.
 */
export type CardPreconditionId = "project" | "boq";

export type CardPrecondition = {
  id: CardPreconditionId;
  /** The clause after the card's own name: "Run WPR - no BOQ on this project yet". */
  because: string;
};

export type CardDef = {
  /** Stable id. Also the compliance.pill_usage.pillKey this card records. */
  id: string;
  /** The card's own verb. May be narrower than the kind word ("Add", "Mark"). */
  verb: string;
  /** What the verb acts on. */
  object: string;
  /** verb + object, as one readable phrase. This is what the user reads. */
  label: string;
  kind: CardKind;
  /** The module this card belongs to, so the current screen's own cards can be
   *  excluded from the ranked six (they are already band 2). */
  moduleId: string;
  /** The leaf in module-catalogue.ts that owns this card's real route. */
  leafId?: string;
  /** Set only where a card arms an executable function rather than navigating. */
  functionId?: string;
  needsProject: boolean;
  requires?: readonly CardPrecondition[];
  /**
   * Cold-start ordering, per PROJEXA-native membership role (see
   * src/lib/authz/roles.ts). Higher wins. `default` is used for a role this
   * table does not name and for a signed-in user whose role has not loaded --
   * it must never leave the strip empty.
   */
  roleWeights: Readonly<Partial<Record<OrgRole | "default", number>>>;
};

const NEEDS_PROJECT: CardPrecondition = { id: "project", because: "pick a project first" };
const NEEDS_BOQ: CardPrecondition = { id: "boq", because: "no BOQ on this project yet" };

/**
 * THE CARDS. Ordered here only for readability -- what the user sees is
 * decided by rankCards() below (role weights, then the server's own ranking),
 * and the expanded "All modules" list is decided by SUMEET_MODULE_ORDER.
 */
export const CARD_CATALOGUE: readonly CardDef[] = [
  {
    id: "permits.new",
    verb: "Add",
    object: "permit",
    label: "Add permit",
    kind: "write",
    moduleId: "permits",
    leafId: "permits.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, admin: 6, owner: 6, site_engineer: 3, member: 3, default: 4 },
  },
  {
    id: "permits.expiring",
    verb: "Ask",
    object: "which permits expire",
    label: "Expiring permits",
    kind: "ask",
    moduleId: "permits",
    leafId: "permits.expiring",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 6, owner: 6, admin: 5, client_viewer: 4, site_engineer: 2, default: 4 },
  },
  {
    id: "drawings.new",
    verb: "Add",
    object: "drawing",
    label: "Add drawing",
    kind: "write",
    moduleId: "drawings",
    leafId: "drawings.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 5, site_engineer: 4, admin: 4, owner: 3, default: 3 },
  },
  {
    id: "documents.upload",
    verb: "Upload",
    object: "document",
    label: "Upload document",
    kind: "write",
    moduleId: "documents",
    leafId: "documents.upload",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { admin: 5, pm: 5, owner: 4, site_engineer: 3, member: 3, default: 3 },
  },
  {
    id: "moms.new",
    verb: "File",
    object: "minutes",
    label: "File minutes",
    kind: "write",
    moduleId: "moms",
    leafId: "moms.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 8, owner: 6, admin: 5, site_engineer: 3, default: 4 },
  },
  {
    id: "scope.new",
    verb: "Create",
    object: "BOQ",
    label: "New BOQ",
    kind: "write",
    moduleId: "scope",
    leafId: "scope.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, admin: 5, owner: 5, site_engineer: 1, default: 3 },
  },
  {
    id: "work-progress.entry",
    verb: "Record",
    object: "progress",
    label: "Record progress",
    kind: "write",
    moduleId: "work-progress",
    leafId: "work-progress.entry",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    // The single most common thing a site engineer does, every day, and the
    // reason this whole card model exists.
    roleWeights: { site_engineer: 10, pm: 8, owner: 5, admin: 5, member: 5, default: 7 },
  },
  {
    id: "work-progress.report",
    verb: "Run",
    object: "WPR",
    label: "Run WPR",
    kind: "run",
    moduleId: "work-progress",
    leafId: "work-progress.report",
    needsProject: true,
    // The WPR is computed off the BOQ: with no BOQ there is nothing to report
    // against, and the card says so rather than running to an empty table.
    requires: [NEEDS_PROJECT, NEEDS_BOQ],
    roleWeights: { pm: 9, owner: 8, admin: 6, client_viewer: 5, site_engineer: 4, default: 6 },
  },
  {
    id: "work-progress.analytics",
    verb: "Ask",
    object: "how far along we are",
    label: "Progress analytics",
    kind: "ask",
    moduleId: "work-progress",
    leafId: "work-progress.analytics",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { owner: 6, pm: 5, client_viewer: 5, admin: 4, default: 4 },
  },
  {
    id: "labour.attendance",
    verb: "Mark",
    object: "attendance",
    label: "Mark attendance",
    kind: "write",
    moduleId: "labour",
    leafId: "labour.attendance",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 9, pm: 6, member: 5, admin: 3, owner: 3, default: 5 },
  },
  {
    id: "labour.new",
    verb: "Add",
    object: "worker",
    label: "Add worker",
    kind: "write",
    moduleId: "labour",
    leafId: "labour.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 5, pm: 5, admin: 4, owner: 3, default: 4 },
  },
  {
    id: "materials.receipt",
    verb: "Record",
    object: "receipt",
    label: "Record receipt",
    kind: "write",
    moduleId: "materials",
    leafId: "materials.receipt",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 8, pm: 6, member: 5, admin: 4, owner: 3, default: 5 },
  },
  {
    id: "materials.new",
    verb: "Add",
    object: "material",
    label: "Add material",
    kind: "write",
    moduleId: "materials",
    leafId: "materials.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 4, pm: 4, admin: 4, owner: 3, default: 3 },
  },
  {
    id: "budgets.new",
    verb: "Create",
    object: "budget",
    label: "New budget",
    kind: "write",
    moduleId: "budgets",
    leafId: "budgets.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { owner: 7, admin: 6, pm: 6, site_engineer: 0, client_viewer: 0, default: 3 },
  },
  {
    id: "schedule.task",
    verb: "Add",
    object: "task",
    label: "Add task",
    kind: "write",
    moduleId: "schedule",
    leafId: "schedule.task",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, owner: 5, admin: 5, site_engineer: 3, default: 4 },
  },
  {
    id: "schedule.time",
    verb: "Log",
    object: "time",
    label: "Log time",
    kind: "write",
    moduleId: "schedule",
    leafId: "schedule.time",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 6, member: 6, pm: 5, admin: 3, owner: 3, default: 5 },
  },
  {
    id: "reports.open",
    verb: "Run",
    object: "report",
    label: "Run report",
    kind: "run",
    moduleId: "reports",
    leafId: "reports.open",
    // The report catalogue is org-wide; a project only narrows it.
    needsProject: false,
    roleWeights: { owner: 7, admin: 6, pm: 6, client_viewer: 5, site_engineer: 2, default: 5 },
  },
] as const;

/**
 * SUMEET'S ORDER, fixed, for the expanded "All modules" list. It is NOT the
 * ranked order and must never be re-sorted by usage: the ranked six answer
 * "what do you do most", the expanded list answers "where is everything", and
 * a list that moves is a list you have to read every time.
 */
export const SUMEET_MODULE_ORDER: readonly string[] = [
  "permits",
  "drawings",
  "documents",
  "moms",
  "scope",
  "work-progress",
  "labour",
  "materials",
  "budgets",
  "schedule",
  "reports",
] as const;

/** The literal words for the free-text escape hatch, per D-10. */
export const OTHER_ENTRY_LABEL = "Other — type it";

/**
 * The fourteen universal pills, kept as a PLATFORM GROUP under "All modules"
 * (D-10) so that demoting them from the first level does not make any of them
 * unreachable, and so the same name still reaches the same destination.
 * `other` is excluded: it is the free-text entry above, and listing it twice
 * would be the duplicate vocabulary this programme is removing.
 */
export const PLATFORM_PILLS: readonly { key: string; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "projects", label: "Projects" },
  { key: "minutes_of_meeting", label: "Minutes of Meeting" },
  { key: "reports", label: "Reports" },
  { key: "analysis", label: "Analysis" },
  { key: "email", label: "Email" },
  { key: "policies", label: "Policies" },
  { key: "department", label: "Department" },
  { key: "teams", label: "Teams" },
  { key: "calendar", label: "Calendar" },
  { key: "task_master", label: "Task Master" },
  { key: "to_do", label: "To Do" },
] as const;

export type AllModulesEntry = {
  id: string;
  label: string;
  /** "module" | "other" | "platform" -- what a click on it means. */
  kind: "module" | "other" | "platform";
  /** The module this entry opens, when it has one in PROJEXA. */
  moduleId: string | null;
  /** Words explaining why it cannot be opened, when it cannot. */
  unavailable?: string;
};

/**
 * A-07's expanded list, flat and in one fixed order: Sumeet's eleven modules,
 * then "Other - type it", then the platform group.
 */
export function allModulesEntries(): AllModulesEntry[] {
  const modules: AllModulesEntry[] = SUMEET_MODULE_ORDER.map((id) => {
    const mod = MODULE_CATALOGUE.find((m) => m.id === id);
    // A module id with no catalogue entry is a programming error, not a
    // runtime condition -- allModulesEntries.test asserts it cannot happen.
    return { id, label: mod?.label ?? id, kind: "module" as const, moduleId: mod ? mod.id : null };
  });

  const platform: AllModulesEntry[] = PLATFORM_PILLS.map((pill) => {
    const mod = moduleForPill(pill.key, pill.label);
    return {
      id: `platform.${pill.key}`,
      label: pill.label,
      kind: "platform" as const,
      moduleId: mod?.id ?? null,
      unavailable: mod
        ? undefined
        : pill.key === "projects"
          ? "pick one in the top rail"
          : "not part of PROJEXA",
    };
  });

  return [...modules, { id: "other", label: OTHER_ENTRY_LABEL, kind: "other", moduleId: null }, ...platform];
}

/** The leaf a card navigates to, and the module that owns it. */
export function targetForCard(card: CardDef): { module: ModuleDef; leaf: ModuleLeaf } | null {
  const mod = MODULE_CATALOGUE.find((m) => m.id === card.moduleId);
  if (!mod) return null;
  const leaf = card.leafId ? mod.leaves.find((l) => l.id === card.leafId) : undefined;
  return leaf ? { module: mod, leaf } : null;
}

/** The real URL a card opens, carrying the project where it means something. */
export function cardHref(card: CardDef, projectId: string | null): string | null {
  const target = targetForCard(card);
  if (!target) return null;
  return moduleHref(target.leaf, projectId);
}

/**
 * The card's own name plus the reason it cannot run, in words:
 * "Run WPR - no BOQ on this project yet". Returns null when it can run.
 */
export function cardUnmetReason(card: CardDef, unmet: ReadonlySet<CardPreconditionId>): string | null {
  const blocked = card.requires?.find((r) => unmet.has(r.id));
  return blocked ? `${card.label} — ${blocked.because}` : null;
}

/** The cold-start weight this role gives a card. */
export function weightFor(card: CardDef, role: string | null | undefined): number {
  const byRole = role ? card.roleWeights[role as OrgRole] : undefined;
  return byRole ?? card.roleWeights.default ?? 0;
}

/**
 * The role's own ordering of the whole catalogue, highest weight first and
 * catalogue order as the tiebreak, so it is total and deterministic -- two
 * users with the same role see the same strip.
 */
export function cardsForRole(role: string | null | undefined): CardDef[] {
  return [...CARD_CATALOGUE]
    .map((card, index) => ({ card, index }))
    .sort((a, b) => weightFor(b.card, role) - weightFor(a.card, role) || a.index - b.index)
    .map((x) => x.card);
}

/** One entry of the server's ranking, as PROJEXA's proxy returns it. */
export type RankedEntry = { pillKey: string; label?: string | null; pinned?: boolean };

/**
 * The SERVER'S key for a card, when this user's ranking contains one.
 *
 * WHY THIS EXISTS. compliance.pill_usage carries a function_id per key, and
 * that is what lets a click take R53's PILL PATH -- the server already knows
 * the function, so the submission costs no classifier call and no model call
 * at all. But the server's key for a row the PIPELINE wrote is the chain's
 * first step ("Work Progress"), while a card's id is "work-progress.entry".
 * Looking the function up by card id alone would silently miss every one of
 * those rows and quietly demote every click to the typed path. This maps back.
 */
export function rankedKeyForCard(card: CardDef, ranked: readonly RankedEntry[]): string | null {
  for (const entry of ranked) {
    if (entry.pillKey === card.id) return entry.pillKey;
  }
  for (const entry of ranked) {
    const mod = moduleForPill(entry.pillKey, entry.label ?? undefined);
    if (mod && mod.id === card.moduleId) return entry.pillKey;
  }
  return null;
}

export type RankCardsInput = {
  /** The server's ranking, in the server's order. Empty when it has not
   *  answered, or when this user has earned no ranking yet. */
  ranked: readonly RankedEntry[];
  role: string | null | undefined;
  /** The module the user is standing in. Its cards are already band 2. */
  excludeModuleId?: string | null;
  limit?: number;
};

export type RankCardsResult = {
  cards: CardDef[];
  /** Ranked keys this build has no card for. The caller warns; it does NOT
   *  render them, because a raw key on a strip is worse than a shorter strip. */
  unknownKeys: string[];
};

/**
 * A-07's ranking. The server's order WINS and is applied verbatim; the role's
 * cold-start order only TOPS UP the remaining slots, so a user who has earned
 * a ranking never sees it silently re-sorted by a table checked into this repo.
 *
 * A ranked key is resolved as a CARD first (leaf ids are what A-07 records),
 * then as a MODULE (every row R53's pipeline wrote is a module name), in which
 * case that module's highest-weighted card stands in for it -- "Work Progress"
 * ranked highly means this user records progress, and the card says so.
 */
export function rankCards({ ranked, role, excludeModuleId, limit = 6 }: RankCardsInput): RankCardsResult {
  const byId = new Map(CARD_CATALOGUE.map((c) => [c.id, c]));
  const roleOrder = cardsForRole(role);
  const chosen: CardDef[] = [];
  const unknownKeys: string[] = [];
  const taken = new Set<string>();

  const take = (card: CardDef | undefined) => {
    if (!card || taken.has(card.id)) return false;
    if (excludeModuleId && card.moduleId === excludeModuleId) return false;
    taken.add(card.id);
    chosen.push(card);
    return true;
  };

  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    const key = entry.pillKey;
    const direct = byId.get(key);
    if (direct) {
      take(direct);
      continue;
    }
    const mod = moduleForPill(key, entry.label ?? undefined);
    if (mod) {
      // The module's own best card for this role stands in for the module.
      const stand = roleOrder.find((c) => c.moduleId === mod.id && !taken.has(c.id));
      if (stand) {
        take(stand);
        continue;
      }
      // Every card of that module is already chosen or excluded: not unknown.
      continue;
    }
    // Not a card, not a module this build knows. The caller warns and drops it.
    if (normalisePillKey(key)) unknownKeys.push(key);
  }

  for (const card of roleOrder) {
    if (chosen.length >= limit) break;
    take(card);
  }

  return { cards: chosen.slice(0, limit), unknownKeys };
}
