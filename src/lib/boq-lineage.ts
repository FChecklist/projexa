// R67 D-23 (R-062 / R-065). Pure, DB-free helpers behind the BOQ list's
// lineage grouping and its two variation columns -- kept out of the component
// for the same reason boq-helpers.ts exists: every rule here (which row is the
// root, which one is "Current", how a signed money variation is spelled) is
// business logic a test can pin without mounting React or touching the network.
//
// THE FAULT THIS CLOSES: /scope rendered every BOQ row of a project as a flat,
// version-DESC list. Three revision chains of three revisions each therefore
// read as nine unrelated rows with nine unrelated titles, and the only clue
// that Rev2 superseded Rev1 was a "superseded" badge painted in the DESTRUCTIVE
// (rose) variant -- the colour this product reserves for late and error.
//
// Version numbering: the backend stores the ORIGINAL BOQ as version 1
// (construction-boq-service.ts's createBoq inserts `version: 1`) and each
// revision as parent.version + 1. The customer counts revisions from zero --
// the original is "Rev0", its first revision "Rev1". So the label is
// version - 1, and the old "Baseline (Rev0)" text that used to live in the
// variation column is now simply the version cell of the root row.

export type LineageBoq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
  // Additive fields the list payload MAY carry (WS-F/F-04, "C02-14 adds
  // totalVariation and totalVariationVsOriginal to the list payload"). They
  // are optional on purpose: until that lane lands, ScopeClient falls back to
  // its own per-revision compare calls and this module stays correct either
  // way. `null` means "the server computed it and it is genuinely unknown",
  // `undefined` means "the server did not send it".
  totalVariation?: number | null;
  totalVariationVsOriginal?: number | null;
};

export type LineageRow<T extends LineageBoq = LineageBoq> = {
  boq: T;
  /** 0 for the lineage root, 1 for every revision under it. */
  depth: 0 | 1;
  /** "Rev0", "Rev1", ... -- what the version cell renders. */
  revLabel: string;
  isRoot: boolean;
  /** The latest APPROVED revision of this lineage, or the latest of any status when none is approved. */
  isCurrent: boolean;
  rootId: string;
};

/** version 1 (the original) reads as Rev0. Never returns a negative revision. */
export function revisionLabel(version: number): string {
  const n = Number.isFinite(version) ? Math.trunc(version) - 1 : 0;
  return `Rev${n < 0 ? 0 : n}`;
}

/**
 * Walks parentBoqId to the top of the chain. A parent that is not in `byId`
 * (a revision whose root belongs to another project, or a partially loaded
 * list) terminates the walk at the last row we actually hold, so a row is
 * never dropped from the list because its ancestor is missing. The visited
 * set is the same cycle guard construction-boq-service.ts's resolveRootAncestor
 * uses -- a self-referencing row must not hang the render.
 */
export function resolveRootId<T extends LineageBoq>(boq: T, byId: Map<string, T>): string {
  let current = boq;
  const visited = new Set<string>([current.id]);
  while (current.parentBoqId) {
    const parent = byId.get(current.parentBoqId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * Groups a flat BOQ list into lineages: the root first, its revisions indented
 * beneath it in ASCENDING version order (Rev0, Rev1, Rev2). Lineages themselves
 * are ordered by their root's createdAt, newest first, with the root id as a
 * stable tiebreaker so two roots created in the same millisecond never swap
 * order between renders.
 */
export function buildLineageRows<T extends LineageBoq>(boqs: T[]): LineageRow<T>[] {
  const byId = new Map(boqs.map((b) => [b.id, b]));
  const groups = new Map<string, T[]>();
  for (const boq of boqs) {
    const rootId = resolveRootId(boq, byId);
    const group = groups.get(rootId);
    if (group) group.push(boq);
    else groups.set(rootId, [boq]);
  }

  const orderedRootIds = [...groups.keys()].sort((a, b) => {
    const rootA = byId.get(a);
    const rootB = byId.get(b);
    const timeA = rootA ? Date.parse(rootA.createdAt) : 0;
    const timeB = rootB ? Date.parse(rootB.createdAt) : 0;
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeB - timeA;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const rows: LineageRow<T>[] = [];
  for (const rootId of orderedRootIds) {
    const members = [...groups.get(rootId)!].sort((a, b) => a.version - b.version || (a.id < b.id ? -1 : 1));
    const currentId = resolveCurrentId(members);
    for (const boq of members) {
      const isRoot = boq.id === rootId;
      rows.push({
        boq,
        depth: isRoot ? 0 : 1,
        revLabel: revisionLabel(boq.version),
        isRoot,
        isCurrent: boq.id === currentId,
        rootId,
      });
    }
  }
  return rows;
}

/** The latest approved revision of one lineage; the latest of any status when none is approved. */
export function resolveCurrentId<T extends LineageBoq>(members: T[]): string | null {
  if (members.length === 0) return null;
  const approved = members.filter((m) => m.status === "approved");
  const pool = approved.length > 0 ? approved : members;
  return pool.reduce((best, m) => (m.version > best.version ? m : best), pool[0]).id;
}

export type VariationCell = {
  /** "up" | "down" | "flat" | "unknown" -- the glyph the cell renders. */
  kind: "up" | "down" | "flat" | "unknown";
  glyph: string;
  /** The money text, already signed and currency-prefixed. Empty for "unknown". */
  text: string;
  /** Screen-reader/title text. Only "unknown" carries one. */
  title?: string;
};

/**
 * "the same decimals down the column": one decimal count for EVERY cell of a
 * variation column, chosen once from the whole column. A column of whole
 * amounts stays whole (AED +2,025); a column with any fractional amount shows
 * two places on all of its rows, so the digits line up under each other.
 */
export function columnDecimals(values: ReadonlyArray<number | null | undefined>): 0 | 2 {
  return values.some((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v % 1) > 1e-9) ? 2 : 0;
}

const UP = "▲"; // ▲
const DOWN = "▼"; // ▼
const FLAT = "–"; // – en dash
const UNKNOWN = "—"; // — em dash

/**
 * One signed variation cell. A missing figure is an EM DASH titled "Variation
 * unavailable" -- never a fabricated "AED 0", which is a real and different
 * answer (the revision changed nothing).
 */
export function variationCell(
  value: number | null | undefined,
  currencyCode: string,
  decimals: 0 | 2 = 0
): VariationCell {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { kind: "unknown", glyph: UNKNOWN, text: "", title: "Variation unavailable" };
  }
  const money = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = currencyCode ? `${currencyCode} ` : "";
  if (value > 0) return { kind: "up", glyph: UP, text: `${prefix}+${money}` };
  if (value < 0) return { kind: "down", glyph: DOWN, text: `${prefix}-${money}` };
  return { kind: "flat", glyph: FLAT, text: `${prefix}${money}` };
}

export type BoqStatusChip = { glyph: string; label: string; className: string };

/**
 * Glyph plus WORD in the muted palette. Deliberately does NOT use the shared
 * Badge's `destructive` variant for "superseded": rose is reserved for late and
 * error in this product, and a superseded revision is neither -- it is simply
 * no longer the current one. (WS-G owns a product-wide status chip component;
 * until it lands this is the one mapping the scope screens read, kept pure so
 * that lane can adopt it rather than re-deriving the vocabulary.)
 */
export function boqStatusChip(status: string): BoqStatusChip {
  switch (status) {
    case "draft":
      return { glyph: "○", label: "Draft", className: "text-px-muted" }; // ○ hollow circle
    case "submitted":
      return { glyph: "◐", label: "Submitted", className: "text-px-info" }; // ◐ half circle
    case "approved":
      return { glyph: "●", label: "Approved", className: "text-px-success" }; // ● filled circle
    case "superseded":
      return { glyph: "↻", label: "Superseded", className: "text-px-muted" }; // ↻ recycle arrow
    default:
      return { glyph: "○", label: status || "Unknown", className: "text-px-muted" };
  }
}
