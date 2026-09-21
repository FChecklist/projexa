/// <reference types="bun-types" />
// PROJEXA-E2E-001 work order section 4 (2026-09-21). "A number on a dashboard
// must be provably derived, and clicking it should reach what produced it."
//
// Pure, DB-free tests of the id -> href map ReportOutput's generic renderer
// (~12 of the ~17 in-page reports) and ProjectStatusCard now read. Each test
// uses the REAL shape the relevant construction-reports-service.ts handler
// returns (`?format=legacy`), not an invented one -- see report-row-links.ts's
// own per-report comments for the source of each shape.
import { describe, expect, test } from "bun:test";
import { buildReportLinks, buildProjectStatusLinks } from "./report-row-links";

describe("buildReportLinks (PROJEXA-E2E-001 section 4)", () => {
  test("attendance: a worker row with a rosterId links to its Labour Roster entry", () => {
    const { rowLinks } = buildReportLinks("attendance", {
      rows: [],
      workers: [{ rosterId: "wrk_1", employeeCode: "W-01", name: "Ali Khan", company: null, trade: "Mason", daysPresent: 5, daysHalf: 0, daysAbsent: 0, salary: 2500 }],
      tradeSubtotals: [],
    });
    expect(rowLinks.name?.({ rosterId: "wrk_1", name: "Ali Khan" })).toBe("/labour/wrk_1");
  });

  test("attendance: a row with no rosterId (should never happen, but never fabricated) gets no link", () => {
    const { rowLinks } = buildReportLinks("attendance", { rows: [], workers: [], tradeSubtotals: [] });
    expect(rowLinks.name?.({ name: "Ali Khan" })).toBeFalsy();
  });

  test("site-picture: a photo row links to its Document object page", () => {
    const { rowLinks } = buildReportLinks("site-picture", { photos: [{ id: "doc_9", name: "Foundation day 3.jpg" }] });
    expect(rowLinks.name?.({ id: "doc_9", name: "Foundation day 3.jpg" })).toBe("/documents/doc_9");
  });

  test("scope: the latest boq's own 'version' field links to its own Object Page", () => {
    const { fieldLinks } = buildReportLinks("scope", { boq: { id: "boq_5", version: 3, status: "active" }, totalValue: 100, lineItemCount: 2, revisions: [] });
    expect(fieldLinks.version?.({ id: "boq_5", version: 3 })).toBe("/scope/boq_5");
  });

  test("scope: a revision row's own id links to ITS Object Page, not the latest boq's", () => {
    const { rowLinks } = buildReportLinks("scope", { boq: { id: "boq_5", version: 3 }, totalValue: 0, lineItemCount: 0, revisions: [{ id: "boq_3", version: 1, status: "superseded" }] });
    expect(rowLinks.version?.({ id: "boq_3", version: 1 })).toBe("/scope/boq_3");
  });

  test("scope: a project with no BOQ at all (boq: null) links nothing, never a fabricated href", () => {
    const { fieldLinks, rowLinks } = buildReportLinks("scope", { boq: null, totalValue: 0, lineItemCount: 0, revisions: [] });
    expect(fieldLinks.version?.({})).toBeFalsy();
    expect(rowLinks.version?.({ id: "x" })).toBe("/scope/x"); // a row's OWN id is still real even with no "latest" boq
  });

  test("vendor-cost: a vendor row links to its Vendor object page", () => {
    const { rowLinks } = buildReportLinks("vendor-cost", { labourVendorCosts: [{ vendorId: "ven_2", vendorName: "Acme Labour Co", total: 1000 }], note: "" });
    expect(rowLinks.vendorName?.({ vendorId: "ven_2", vendorName: "Acme Labour Co" })).toBe("/vendors/ven_2");
  });

  test("vendor-cost: a LEFT-joined row with a removed vendor (vendorId null) gets no link, not a broken one", () => {
    const { rowLinks } = buildReportLinks("vendor-cost", { labourVendorCosts: [{ vendorId: null, vendorName: null, total: 500 }], note: "" });
    expect(rowLinks.vendorName?.({ vendorId: null, vendorName: null })).toBeFalsy();
  });

  test("revenue: an invoice row links to its own Object Page by its real id, not its invoiceNumber", () => {
    const { rowLinks } = buildReportLinks("revenue", { invoices: [{ id: "inv_7", invoiceNumber: 1042, grandTotal: 5000 }], total: 5000 });
    expect(rowLinks.invoiceNumber?.({ id: "inv_7", invoiceNumber: 1042 })).toBe("/invoices/inv_7");
  });

  test("kpi: a definition row links to itself, an entry row links back to ITS definition", () => {
    const { rowLinks } = buildReportLinks("kpi", {
      definitions: [{ id: "kpidef_1", metricName: "Safety incidents" }],
      entries: [{ id: "kpient_1", kpiDefinitionId: "kpidef_1", period: "2026-08" }],
    });
    expect(rowLinks.metricName?.({ id: "kpidef_1", metricName: "Safety incidents" })).toBe("/kpis/kpidef_1");
    expect(rowLinks.period?.({ id: "kpient_1", kpiDefinitionId: "kpidef_1", period: "2026-08" })).toBe("/kpis/kpidef_1");
  });

  test("category-progress: every category row links to the SAME boqId the payload's top level carries", () => {
    const { rowLinks } = buildReportLinks("category-progress", {
      categories: [{ categoryId: "cat_1", name: "Civil", percentComplete: 40, totalAmount: 1000, completedAmount: 400, sharePercent: 50 }],
      uncategorizedAmount: 0,
      totalAmount: 2000,
      boqId: "boq_11",
    });
    expect(rowLinks.name?.({ categoryId: "cat_1", name: "Civil" })).toBe("/scope/boq_11");
  });

  test("category-progress: no BOQ (boqId null) links nothing -- not a fabricated /scope/null", () => {
    const { rowLinks } = buildReportLinks("category-progress", { categories: [{ categoryId: "cat_1", name: "Civil" }], uncategorizedAmount: 0, totalAmount: 0, boqId: null });
    expect(rowLinks.name?.({ categoryId: "cat_1", name: "Civil" })).toBeFalsy();
  });

  test("project-completion: byCategory rows use the SAME boqId contract as category-progress", () => {
    const { rowLinks } = buildReportLinks("project-completion", {
      overallPercentComplete: 55,
      byCategory: [{ categoryId: "cat_2", name: "MEP", percentComplete: 20 }],
      boqId: "boq_22",
    });
    expect(rowLinks.name?.({ categoryId: "cat_2", name: "MEP" })).toBe("/scope/boq_22");
  });

  test("manpower-cost and expense/budget-vs-actual style aggregates (no per-row id at all) get no map entries -- a real backend gap, not silently faked", () => {
    // manpower-cost's byTrade rows carry only a trade name, never registered.
    expect(buildReportLinks("manpower-cost", { byTrade: [{ trade: "Mason", totalCost: 100, workerDays: 4 }], date: null }).rowLinks).toEqual({});
  });

  test("an unknown/unmapped report name returns empty maps, never throws", () => {
    expect(buildReportLinks("kpi-report-that-does-not-exist", { anything: 1 })).toEqual({ rowLinks: {}, fieldLinks: {} });
    expect(buildReportLinks("expense", { byHead: [{ expenseHead: "Materials", total: 500 }], total: 500 })).toEqual({ rowLinks: {}, fieldLinks: {} });
  });
});

describe("buildProjectStatusLinks (PROJEXA-E2E-001 section 4, item 4)", () => {
  const withBoqAndProject = { boqId: "boq_99", projectId: "proj_1" };

  test("BOQ-derived Money fields link to the source BOQ's Object Page", () => {
    const links = buildProjectStatusLinks(withBoqAndProject);
    expect(links.contractValue).toBe("/scope/boq_99");
    expect(links.budget).toBe("/scope/boq_99");
    expect(links.earnedValue).toBe("/scope/boq_99");
    expect(links.percentByValue).toBe("/scope/boq_99");
  });

  test("activity-log progress links to the Work Progress report, not the BOQ", () => {
    const links = buildProjectStatusLinks(withBoqAndProject);
    expect(links.progressPercent).toBe("/work-progress?tab=report&projectId=proj_1");
  });

  test("expenses/tasks link to their own project-scoped list screens", () => {
    const links = buildProjectStatusLinks(withBoqAndProject);
    expect(links.expenses).toBe("/expenses?projectId=proj_1");
    expect(links.taskCount).toBe("/schedule?projectId=proj_1");
    expect(links.delayedTaskCount).toBe("/schedule?projectId=proj_1");
  });

  test("photoCount links to the site-picture report's own real, addressable run URL", () => {
    const links = buildProjectStatusLinks(withBoqAndProject);
    expect(links.photoCount).toBe("/reports?report=site-picture&projectId=proj_1");
  });

  test("revenue and projectValue are deliberately left unlinked -- no project-scoped destination exists for either", () => {
    const links = buildProjectStatusLinks(withBoqAndProject);
    expect(links.revenue).toBeFalsy();
    expect(links.projectValue).toBeFalsy();
  });

  test("no boqId (project genuinely has no BOQ) -- the BOQ-derived fields get no link, never a fabricated one", () => {
    const links = buildProjectStatusLinks({ projectId: "proj_1", boqId: null });
    expect(links.contractValue).toBeFalsy();
    expect(links.budget).toBeFalsy();
    expect(links.earnedValue).toBeFalsy();
    expect(links.percentByValue).toBeFalsy();
    // projectId-only fields are unaffected by the missing boqId.
    expect(links.expenses).toBe("/expenses?projectId=proj_1");
  });

  test("no projectId at all -- every field is unlinked", () => {
    const links = buildProjectStatusLinks({});
    expect(Object.values(links).every((href) => !href)).toBe(true);
  });
});
