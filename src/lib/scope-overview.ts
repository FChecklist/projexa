// R-96 (Sumeet: "Scope of work in a project must be a real, usable concept in PROJEXA").
//
// Pure, DB-free helpers behind the project-level "Scope of Work" overview (the first tab of /scope). The overview adds no
// request of its own for BOQs: it is drawn from the SAME list the BOQ tab already holds (GET /api/scope?include=variation,
// compare,headers: headers only, no line items). The two variation rules below moved here out of ScopeClient so the
// overview and the BOQ list can never disagree on a figure.
import { buildLineageRows, type LineageBoq } from "@/lib/boq-lineage";

export type OverviewBoq = LineageBoq & {
  variationVsPrior?: number | null;
  lineDelta?: number | null;
  compare?: { lineCount: number; total: number; deltaAmount: number | null; deltaPct: number | null };
};

/** vs prior: F-29's compare aggregate first, F-23's variationVsPrior next, D-23's totalVariation last. */
export function priorVariationOf(boq: OverviewBoq): number | null | undefined {
  return boq.compare?.deltaAmount ?? boq.variationVsPrior ?? boq.totalVariation;
}

/**
 * vs original: the payload's own figure when present; for the FIRST revision of a lineage the parent IS the original, so
 * "vs prior" answers it exactly. Anything else is unknown (undefined), never fetched per row and never a made-up zero.
 */
export function originalVariationOf(boq: OverviewBoq, rootId: string): number | null | undefined {
  if (typeof boq.totalVariationVsOriginal === "number") return boq.totalVariationVsOriginal;
  if (boq.parentBoqId === rootId) return priorVariationOf(boq);
  return undefined;
}

export type ScopeOverview = {
  /** The Scope of Work in force: the highest approved revision, else the latest of any status (same rule as the BOQ list's "current" tag). */
  current: OverviewBoq | null;
  currentRevLabel: string | null;
  /** Is `current` actually approved? false means "this is only the latest draft/submitted, nothing is approved yet". */
  currentApproved: boolean;
  /** Every other revision of the same BOQ, newest first. */
  previous: { boq: OverviewBoq; revLabel: string }[];
  /** Revisions after the original (Rev1...) with their variation figures, oldest first. Empty for a BOQ with no revision. */
  variations: { boq: OverviewBoq; revLabel: string; vsPrior: number | null | undefined; vsOriginal: number | null | undefined }[];
  /** Other, unrelated BOQ lineages in the project (a project can carry e.g. "Fit-out" and "MEP"). */
  otherScopes: number;
};

export function buildScopeOverview(boqs: OverviewBoq[]): ScopeOverview {
  if (boqs.length === 0) {
    return { current: null, currentRevLabel: null, currentApproved: false, previous: [], variations: [], otherScopes: 0 };
  }
  const rows = buildLineageRows(boqs);
  const roots = rows.filter((r) => r.isRoot);
  // The Scope of Work in force (highest approved revision of a lineage, else its latest: boq-lineage.resolveCurrentId) is chosen among the CURRENT revisions of each lineage; with several lineages the one
  // with an approved current wins, then the most recently created root (buildLineageRows already orders roots that way).
  const currents = rows.filter((r) => r.isCurrent);
  const chosen =
    currents.find((r) => r.boq.status === "approved") ?? currents[0] ?? rows[0];
  const current = chosen.boq;
  const lineage = rows.filter((r) => r.rootId === chosen.rootId);
  const previous = lineage
    .filter((r) => r.boq.id !== current.id)
    .sort((a, b) => b.boq.version - a.boq.version)
    .map((r) => ({ boq: r.boq, revLabel: r.revLabel }));
  const variations = lineage
    .filter((r) => !r.isRoot)
    .sort((a, b) => a.boq.version - b.boq.version)
    .map((r) => ({
      boq: r.boq,
      revLabel: r.revLabel,
      vsPrior: priorVariationOf(r.boq),
      vsOriginal: originalVariationOf(r.boq, r.rootId),
    }));
  return {
    current,
    currentRevLabel: chosen.revLabel,
    currentApproved: current.status === "approved",
    previous,
    variations,
    otherScopes: roots.length - 1,
  };
}
