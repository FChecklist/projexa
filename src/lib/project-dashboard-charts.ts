// R67 E-25 (R-211). The three defects on the project dashboard's charts and
// cards, fixed where they can be tested: the trend series, the budget card's
// verdict, and the primary KPI's trend label. Pure -- no React, no fetch.

import { formatDateDMY, formatDayMonth } from "./format-date";

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
 * The caption under a one-point series.
 *
 * R67 E-40 (R-272 / R-297) settles a sentence three items wrote differently.
 * E-25 shipped "Only one day logged (25 Aug) - a trend needs two or more days";
 * E-29 asked for "Progress will chart after the second entry"; E-40 specifies
 * this one EXPLICITLY as the merge of R-272 and R-297, so this is the final
 * wording and the other two are retired. The date is dd-mm-yyyy (formatDateDMY,
 * DE-23) rather than "25 Aug", because E-40 quotes it that way and because a
 * caption that is the only thing on screen should carry the year.
 *
 * E-40 also changes what is DRAWN: E-25 replaced the frame with this sentence,
 * E-40 keeps the single point and puts the sentence under it (see
 * oneDayAxis below).
 */
export function oneDayCaption(day: string): string {
  return `Only one day of progress logged (${formatDateDMY(day)}) — not enough to draw a trend`;
}

export const NO_PROGRESS_CAPTION = "No progress logged yet";

export type OneDayAxis = { leftLabel: string; rightLabel: string; pointFraction: number };

/**
 * R67 E-40 (R-272): "draw the single labelled point on an x-axis extended to
 * today".
 *
 * The axis runs from the one logged day to today, so the reader sees BOTH the
 * point and how much time has passed with nothing logged since -- which the
 * bare sentence E-25 rendered instead did not show.
 *
 * The right-hand end is the WORD "today", never today's date. E-40's own rule
 * is that no chart may render "empty axes with the same date at both ends", and
 * when the single logged day IS today, printing the date twice is exactly that.
 * The word is also more useful: it says what the far end of the axis means.
 */
export function oneDayAxis(day: string, today: string): OneDayAxis {
  const dayMs = Date.parse(`${day}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  // The point anchors the LEFT end whenever there is any span at all; with no
  // span (the logged day is today) it sits at the right, under the word that
  // names it.
  const hasSpan = Number.isFinite(dayMs) && Number.isFinite(todayMs) && todayMs > dayMs;
  return {
    leftLabel: formatDateDMY(day),
    rightLabel: "today",
    pointFraction: hasSpan ? 0 : 1,
  };
}

export type BudgetCardModel = {
  /** The figure on the card. Always the spend -- that is the number that exists. */
  spend: number;
  /**
   * R67 E-39 (R-271): the value AS WRITTEN. With no budget it reads
   * "AED 185,000 spent" -- the word matters, because without a budget beside
   * it a bare money figure on a card labelled "Budget vs Actual" reads as the
   * budget.
   */
  value: string;
  /** The target the bullet bar is drawn against; null means NO BAR AT ALL. */
  target: number | null;
  /** Which budget is on screen, so the baseline can say. */
  source: "erp" | "boq" | "none";
  /**
   * R67 E-39: NULL when there is no budget, and null means NO TREND ROW AT
   * ALL -- no arrow, no verdict word. There is nothing to compare the spend
   * with, so any direction would be invented; an arrow is a claim.
   */
  trend: { word: string; tone: "context" | "needs-you" | "done"; direction: "up" | "down" | "flat" } | null;
  baseline: string;
  /**
   * Where the card goes. ONE destination, never a second link nested inside the
   * tile -- a link inside a link is invalid markup and is exactly what produces
   * the "click one card, land on its neighbour" bug R-270 observed.
   *
   * R67 E-38: /budgets is where a budget is READ, /budgets/new is where one is
   * SET, and with no budget at all the second is the only useful door.
   */
  href: string;
};

/**
 * R67 E-38 (R-270): the two real budget destinations, both carrying the
 * project. Passed in rather than built here so this module stays pure and the
 * routes live with the screen that owns them.
 */
export type BudgetCardHrefs = { budgets: string; setBudget: string };

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
 * Failing both, the card reads "<spend> spent" with "No budget set — Set
 * budget", NO arrow, NO verdict word and NO bar (R67 E-39 refines E-25 here:
 * E-25 removed the false alarm and left the words "no budget set" in the trend
 * row, which still rendered an arrow beside them; E-39 removes the trend row
 * entirely, because an arrow with nothing to point away from is a claim).
 */
export function budgetCardModel(
  spend: number,
  erpBudget: number | null | undefined,
  boqBudget: number | null | undefined,
  hrefs: BudgetCardHrefs,
  money: (value: number | null) => string
): BudgetCardModel {
  const erp = typeof erpBudget === "number" && Number.isFinite(erpBudget) && erpBudget > 0 ? erpBudget : null;
  const boq = typeof boqBudget === "number" && Number.isFinite(boqBudget) && boqBudget > 0 ? boqBudget : null;
  const target = erp ?? boq;

  if (target === null) {
    return {
      spend,
      // R67 E-39: "AED 185,000 spent", not a bare figure on a card called
      // "Budget vs Actual" -- with no budget beside it, the bare figure reads
      // as the budget.
      value: `${money(spend)} spent`,
      target: null,
      source: "none",
      // R67 E-39: no trend AT ALL. No arrow, and no "over budget".
      trend: null,
      baseline: "No budget set — Set budget",
      // R67 E-38: with no budget, the door is the place that SETS one, and the
      // whole tile is that link -- never a second anchor nested inside it.
      href: hrefs.setBudget,
    };
  }

  const over = spend > target;
  return {
    spend,
    value: money(spend),
    target,
    source: erp !== null ? "erp" : "boq",
    trend: {
      word: over ? "over budget" : "within budget",
      tone: over ? "needs-you" : "done",
      direction: over ? "up" : "down",
    },
    baseline:
      erp !== null
        ? `budget ${money(target)} (cost centre)`
        : `budget ${money(target)} (BOQ x budget %, no cost-centre budget set)`,
    href: hrefs.budgets,
  };
}

/**
 * The line UNDER the top-left number.
 *
 * When the BOQ figure is 0 and the activity log is not, the two numbers on
 * screen disagree and the reader deserves the reason and the fix rather than
 * a bare "Earned AED 0". The needs-you tone, because it IS something for them
 * to do.
 *
 * R67 E-39 (R-297) REFINES E-25's wording here, deliberately and once. E-25
 * said "60% logged, not yet linked to BOQ lines"; E-39 specifies "Activity log
 * says 60% — no quantities booked against BOQ lines yet", which names WHICH
 * measure the 60% belongs to (this screen carries two progress figures and
 * both were called "progress") and states the actual cause -- no quantity has
 * been booked against a BOQ line -- rather than the symptom. Two sentences for
 * one fact would have been the duplication this programme keeps removing, so
 * E-25's is replaced, not added to.
 */
export function primaryTrendLabel(
  percentByValue: number | null,
  progressPercent: number | null,
  earnedValueText: string
): { label: string; tone: "context" | "needs-you" } {
  const byValue = typeof percentByValue === "number" ? percentByValue : null;
  const logged = typeof progressPercent === "number" ? progressPercent : null;
  if (byValue === 0 && logged !== null && logged > 0) {
    return {
      label: `Activity log says ${logged}% — no quantities booked against BOQ lines yet`,
      tone: "needs-you",
    };
  }
  return { label: earnedValueText, tone: "context" };
}
