// R67 E-25 (R-211). The three defects on the project dashboard's charts and
// cards, fixed where they can be tested: the trend series, the budget card's
// verdict, and the primary KPI's trend label. Pure -- no React, no fetch.

import { formatDayMonth } from "./format-date";

export type ProgressEntryLike = { entryDate?: string | null; quantityDone?: string | number | null };

export type ProgressSeries = {
  /** One point per DISTINCT DAY, cumulative, oldest first. */
  points: { label: string; value: number }[];
  distinctDays: number;
  /** The single day, when there is exactly one. */
  onlyDay: string | null;
};

/**
 * "Progress logged over time" used to be built from the LAST FIVE ROWS of the
 * entries list, reversed, with a running total taken over that window. Three
 * things were wrong with that: it silently dropped every earlier entry, it
 * plotted one point per ROW rather than per DAY (so two entries on one day
 * drew two points at the same x), and its running total restarted at whatever
 * the five-row window happened to begin with, so the line did not start from
 * the project's real cumulative position.
 *
 * This groups EVERY entry by its entry date and accumulates across days.
 */
export function cumulativeProgressSeries(entries: ProgressEntryLike[]): ProgressSeries {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const date = entry.entryDate ? String(entry.entryDate).slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const quantity = Number(entry.quantityDone ?? 0);
    byDay.set(date, (byDay.get(date) ?? 0) + (Number.isFinite(quantity) ? quantity : 0));
  }

  const days = Array.from(byDay.keys()).sort();
  let running = 0;
  const points = days.map((day) => {
    running += byDay.get(day) ?? 0;
    return { label: formatDayMonth(day), value: Math.round(running * 100) / 100 };
  });

  return { points, distinctDays: days.length, onlyDay: days.length === 1 ? days[0] : null };
}

/**
 * The sentence that replaces the chart frame when there is only one day. An
 * empty axis with the same date at both ends is not a trend and should not
 * pretend to be one.
 */
export function oneDayCaption(day: string): string {
  return `Only one day logged (${formatDayMonth(day)}) - a trend needs two or more days`;
}

export const NO_PROGRESS_CAPTION = "No progress logged yet";

export type BudgetCardModel = {
  /** The figure on the card. Always the spend -- that is the number that exists. */
  spend: number;
  /** The target the bullet bar is drawn against; null means NO BAR AT ALL. */
  target: number | null;
  /** Which budget is on screen, so the baseline can say. */
  source: "erp" | "boq" | "none";
  trendWord: string;
  tone: "context" | "needs-you" | "done";
  direction: "up" | "down" | "flat";
  baseline: string;
  /** Where the card goes. An unset budget sends the reader to the place that sets one. */
  href: string;
};

/**
 * Budget vs Actual.
 *
 * THE DEFECT: with no budget, the card rendered a full orange bullet bar
 * against a target of zero, an "up" arrow and the words "over budget". Every
 * project without an ERP cost-centre budget -- which is most of them, since a
 * PROJEXA org need not run VERIDIAN's ERP budgets at all -- was permanently
 * shown as failing. A zero target is not a target, and a bar against it is a
 * false alarm.
 *
 * THE RULE: a real ERP budget wins. Failing that, the BOQ-derived budget
 * (SUM of line amount x budget %) is used as the target and the baseline says
 * so, because the reader must know WHICH budget the verdict is against.
 * Failing both, the card shows the spend, the words "no budget set", no
 * arrow, and no bar.
 */
export function budgetCardModel(
  spend: number,
  erpBudget: number | null | undefined,
  boqBudget: number | null | undefined,
  projectHref: string,
  money: (value: number | null) => string
): BudgetCardModel {
  const erp = typeof erpBudget === "number" && Number.isFinite(erpBudget) && erpBudget > 0 ? erpBudget : null;
  const boq = typeof boqBudget === "number" && Number.isFinite(boqBudget) && boqBudget > 0 ? boqBudget : null;
  const target = erp ?? boq;

  if (target === null) {
    return {
      spend,
      target: null,
      source: "none",
      trendWord: "no budget set",
      tone: "context",
      direction: "flat",
      baseline: "Set budget % on the BOQ",
      href: projectHref,
    };
  }

  const over = spend > target;
  return {
    spend,
    target,
    source: erp !== null ? "erp" : "boq",
    trendWord: over ? "over budget" : "within budget",
    tone: over ? "needs-you" : "done",
    direction: over ? "up" : "down",
    baseline:
      erp !== null
        ? `budget ${money(target)} (cost centre)`
        : `budget ${money(target)} (BOQ x budget %, no cost-centre budget set)`,
    href: projectHref,
  };
}

/**
 * The primary KPI's trend label.
 *
 * When the BOQ figure is 0 and the activity log is not, the two numbers on
 * screen disagree and the reader deserves the reason and the fix rather than
 * a bare "Earned AED 0". The needs-you tone, because it IS something for them
 * to do.
 */
export function primaryTrendLabel(
  percentByValue: number | null,
  progressPercent: number | null,
  earnedValueText: string
): { label: string; tone: "context" | "needs-you" } {
  const byValue = typeof percentByValue === "number" ? percentByValue : null;
  const logged = typeof progressPercent === "number" ? progressPercent : null;
  if (byValue === 0 && logged !== null && logged > 0) {
    return { label: `${logged}% logged, not yet linked to BOQ lines`, tone: "needs-you" };
  }
  return { label: earnedValueText, tone: "context" };
}
