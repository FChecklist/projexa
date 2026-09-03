/// <reference types="bun-types" />
// R67 E-13 (R-131 / R-138), rendered.
//
// report-format.test.ts covers the pure formatter; this covers the CARD, which
// is where the item's actual complaints live: the field order and its three
// bands, the two relabelled percentages with the sentence that explains why
// they disagree, the raw cuid being gone, and an absent figure being an en dash
// a reader can hover -- none of which a formatter test can see.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const { ProjectStatusCard } = await import("./ProjectStatusCard");
const { LEDGER_BUDGET_LABEL, NOT_RECORDED_TITLE, PERCENT_DIVERGENCE_NOTE } = await import("@/components/report-format");

afterEach(cleanup);

const AED = { currency: "AED", pending: false };

/**
 * The real getProjectDashboard shape, with the two things the item is about:
 * budget absent (E-06 made it null, never 0, when there is no BOQ) and the two
 * percentages genuinely disagreeing.
 */
const PAYLOAD = {
  projectId: "clzz9q1k80000abcd1234efgh",
  projectName: "Cedar Heights Villa - Phase 1",
  contractValue: 475000,
  projectValue: 6500.5,
  budget: null,
  ledgerBudget: 250000,
  revenue: 0,
  expenses: 6500.5,
  earnedValue: 218500,
  percentByValue: 46,
  progressPercent: 61.25,
  taskCount: 12,
  delayedTaskCount: 3,
  photoCount: 48,
};

function renderCard(payload: Record<string, unknown> = PAYLOAD, financialsRedacted = false) {
  return render(<ProjectStatusCard data={payload} format={AED} financialsRedacted={financialsRedacted} />);
}

describe("the card has an explicit field order in three bands (R67 E-13)", () => {
  test("the bands are Money, Progress, Activity, in that order", () => {
    const { container } = renderCard();
    const bands = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    expect(bands).toEqual(["Money", "Progress", "Activity"]);
  });

  test("each band carries its own fields, in the item's order, and no camelCase key is used as a label", () => {
    const { container } = renderCard();
    const sections = [...container.querySelectorAll("section")];
    const labelsOf = (section: Element) => [...section.querySelectorAll(".text-xs")].map((d) => d.textContent);

    expect(labelsOf(sections[0])).toEqual([
      "Contract Value",
      "Project Value",
      "Budget",
      "Revenue",
      "Expenses",
      "Earned Value",
    ]);
    expect(labelsOf(sections[1])).toEqual(["% complete (by BOQ value)", "% complete (by activity log)"]);
    expect(labelsOf(sections[2])).toEqual(["Tasks", "Delayed Tasks", "Site Photos"]);

    // The defect R-131 names, not a naming preference: a label must never be a
    // database key.
    const allLabels = sections.flatMap(labelsOf).join(" ");
    expect(allLabels).not.toMatch(/percentByValue|progressPercent|contractValue|earnedValue|delayedTaskCount/);
  });

  test("the project's raw cuid is nowhere on the card -- it is an address, not a fact about a project", () => {
    const { container } = renderCard();
    expect(container.textContent ?? "").not.toContain(PAYLOAD.projectId);
  });
});

describe("the two percentages are relabelled AND explained (R-138)", () => {
  test("both figures render to one decimal under their new labels", () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="project-status-percentByValue"]')?.textContent).toBe("46.0%");
    expect(container.querySelector('[data-testid="project-status-progressPercent"]')?.textContent).toBe("61.3%");
  });

  test("the reason they differ is printed under BOTH of them, not left in a code comment", () => {
    const { container } = renderCard();
    const notes = [...container.querySelectorAll(".text-\\[11px\\]")].map((d) => d.textContent);
    expect(notes.filter((n) => n === PERCENT_DIVERGENCE_NOTE)).toHaveLength(2);
    expect(PERCENT_DIVERGENCE_NOTE).toBe("differs because activity logs are not weighted by BOQ value");
  });
});

describe("absent is an en dash with a reason; a real zero is still a zero", () => {
  test("a null budget is the en dash, titled 'not recorded', never 'AED 0'", () => {
    const { container } = renderCard();
    const budget = container.querySelector('[data-testid="project-status-budget"]')!;
    expect(budget.textContent).toBe("–");
    expect(budget.getAttribute("title")).toBe(NOT_RECORDED_TITLE);
    expect(budget.textContent).not.toContain("0");
  });

  test("a REAL zero still prints as money, and carries no 'not recorded' title", () => {
    const { container } = renderCard();
    const revenue = container.querySelector('[data-testid="project-status-revenue"]')!;
    expect(revenue.textContent).toBe("AED 0");
    expect(revenue.getAttribute("title")).toBeNull();
  });

  test("one money format down the whole card: whole figures lose the cents, real cents keep them", () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="project-status-contractValue"]')?.textContent).toBe("AED 475,000");
    expect(container.querySelector('[data-testid="project-status-projectValue"]')?.textContent).toBe("AED 6,500.50");
  });
});

describe("the ERP annual ledger sum rides under its own name (E-06)", () => {
  test("it is the Budget field's subtitle, so it can never read as a second, disagreeing Budget", () => {
    const { container } = renderCard();
    const subtitle = container.querySelector('[data-testid="project-status-ledger-budget"]')!;
    expect(subtitle.textContent).toBe(`${LEDGER_BUDGET_LABEL} AED 250,000`);
    expect(LEDGER_BUDGET_LABEL).toBe("Annual ledger budget");
  });

  test("a reader whose role hides the money is told so, rather than shown an absent figure", () => {
    const { container } = renderCard({ ...PAYLOAD, ledgerBudget: null }, true);
    expect(container.querySelector('[data-testid="project-status-ledger-budget"]')?.textContent).toBe("Needs manager role");
  });
});
