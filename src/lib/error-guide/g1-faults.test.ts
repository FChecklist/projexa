/// <reference types="bun-types" />
// GUIDED ERRORS G1: every fault a person can make typing a project, a BOQ, a file or a baseline reference, found before anything is sent.
import { describe, expect, test } from "bun:test";
import { emptyLine, type LineItemDraft } from "@/lib/boq-helpers";
import {
  BOQ_TITLE_ID, baselineEvidenceFault, boqDraftFaults, boqLineId, budgetPercentFault, faultFailure, faultsByField, fieldFromServerMessage,
  importFileFault, moneyAmountFault, newLineFaults, panelMessage, plainNumber, projectDateFault, projectFormFaults,
} from "./g1-faults";

const line = (over: Partial<LineItemDraft> = {}): LineItemDraft => ({ ...emptyLine(), description: "Excavation", unit: "m3", quantity: "10", rate: "5", ...over });
const codes = (title: string, lines: LineItemDraft[]) => boqDraftFaults(title, lines).map((f) => f.code);

describe("plainNumber", () => {
  test("digits only", () => {
    expect(plainNumber("12.5")).toBe(12.5);
    expect(plainNumber(" 7 ")).toBe(7);
    expect(plainNumber(".5")).toBe(0.5);
    expect(plainNumber("12,500")).toBeNaN();
    expect(plainNumber("1 000")).toBeNaN();
    expect(plainNumber("abc")).toBeNaN();
    expect(plainNumber("")).toBeNaN();
    expect(plainNumber("Infinity")).toBeNaN();
  });
});

describe("boqDraftFaults: a good BOQ has no fault", () => {
  test("title and one complete line", () => expect(boqDraftFaults("Civil", [line()])).toEqual([]));
  test("a title-only BOQ is legitimate", () => expect(boqDraftFaults("Civil", [emptyLine()])).toEqual([]));
  test("blank rows in between are ignored", () => expect(boqDraftFaults("Civil", [line(), emptyLine(), line({ description: "Backfill" })])).toEqual([]));
  test("a sub-task needs no unit of its own when the parent has one", () => {
    const lines = [line({ itemCode: "A" }), { ...emptyLine(), description: "Sub", parentItemCode: "A", breakdownPercentage: "40" }];
    expect(boqDraftFaults("Civil", lines)).toEqual([]);
  });
  test("zero is allowed (a provisional item)", () => expect(boqDraftFaults("Civil", [line({ quantity: "0", rate: "0" })])).toEqual([]));
});

describe("boqDraftFaults: each way to get it wrong", () => {
  test("no title", () => {
    const [f] = boqDraftFaults("   ", [line()]);
    expect(f.code).toBe("BOQ_TITLE_REQUIRED");
    expect(f.field).toBe(BOQ_TITLE_ID);
  });
  test("revision wording", () => expect(boqDraftFaults("", [line()], { titleLabel: "revision" })[0].message).toContain("The revision has no title"));
  test("description missing names the line and the input", () => {
    const [f] = boqDraftFaults("T", [line(), line({ description: "" })]);
    expect(f).toMatchObject({ code: "BOQ_LINE_DESCRIPTION_REQUIRED", line: 2, field: boqLineId(1, "description") });
  });
  test("description far too long", () => expect(codes("T", [line({ description: "x".repeat(2001) })])).toEqual(["BOQ_LINE_TEXT_TOO_LONG"]));
  test("unit missing / unit too long", () => {
    expect(codes("T", [line({ unit: "" })])).toEqual(["BOQ_LINE_UNIT_REQUIRED"]);
    expect(boqDraftFaults("T", [line({ unit: "u".repeat(41) })])[0]).toMatchObject({ code: "BOQ_LINE_TEXT_TOO_LONG", field: boqLineId(0, "unit") });
  });
  test("qty / rate empty", () => {
    expect(codes("T", [line({ quantity: "" })])).toEqual(["BOQ_LINE_QTY_REQUIRED"]);
    expect(codes("T", [line({ rate: "" })])).toEqual(["BOQ_LINE_RATE_REQUIRED"]);
  });
  test("negative, letters, commas, huge", () => {
    expect(boqDraftFaults("T", [line({ quantity: "-5" })])[0]).toMatchObject({ code: "BOQ_LINE_NUMBER_INVALID", field: boqLineId(0, "quantity") });
    expect(boqDraftFaults("T", [line({ rate: "forty" })])[0].message).toContain("is not a number");
    expect(boqDraftFaults("T", [line({ rate: "12,500" })])[0].message).toContain("type 12500, not 12,500");
    expect(boqDraftFaults("T", [line({ quantity: "9999999999999" })])[0].message).toContain("too large");
  });
  test("both qty and rate wrong gives two faults, in column order", () => {
    expect(boqDraftFaults("T", [line({ quantity: "-1", rate: "x" })]).map((f) => f.field)).toEqual([boqLineId(0, "quantity"), boqLineId(0, "rate")]);
  });
  test("sub-task: share missing, out of range, not a number", () => {
    const parent = line({ itemCode: "A" });
    const sub = (b: string) => ({ ...emptyLine(), description: "Sub", parentItemCode: "A", breakdownPercentage: b });
    expect(codes("T", [parent, sub("")])).toEqual(["BOQ_BREAKDOWN_REQUIRED"]);
    expect(codes("T", [parent, sub("150")])).toEqual(["BOQ_BREAKDOWN_RANGE"]);
    expect(codes("T", [parent, sub("-10")])).toEqual(["BOQ_BREAKDOWN_RANGE"]);
    expect(codes("T", [parent, sub("half")])).toEqual(["BOQ_BREAKDOWN_RANGE"]);
    expect(codes("T", [parent, sub("100")])).toEqual([]);
  });
  test("children adding to MORE or LESS than 100 % are not a fault: the customer's rule is that weights are not forced to add up (R-14)", () => {
    const parent = line({ itemCode: "A" });
    const sub = (d: string, b: string) => ({ ...emptyLine(), description: d, parentItemCode: "A", breakdownPercentage: b });
    expect(boqDraftFaults("T", [parent, sub("S1", "60"), sub("S2", "50")])).toEqual([]);
    expect(boqDraftFaults("T", [parent, sub("S1", "30")])).toEqual([]);
  });
  test("duplicate item code names the first line", () => {
    const f = boqDraftFaults("T", [line({ itemCode: "A-1" }), line({ description: "Other", itemCode: "A-1" })]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "BOQ_CODE_DUPLICATE", line: 2, field: boqLineId(1, "itemCode") });
    expect(f[0].message).toContain("line 1");
  });
  test("parent: itself, unknown, a loop", () => {
    const sub = (over: Partial<LineItemDraft>): LineItemDraft => ({ ...emptyLine(), description: "S", unit: "m3", breakdownPercentage: "50", ...over });
    expect(boqDraftFaults("T", [sub({ itemCode: "A", parentItemCode: "A" })])[0].message).toContain("own parent");
    expect(boqDraftFaults("T", [line({ itemCode: "A" }), sub({ parentItemCode: "ZZ" })])[0]).toMatchObject({ code: "BOQ_PARENT_INVALID", field: boqLineId(1, "parentItemCode") });
    const loop = boqDraftFaults("T", [sub({ itemCode: "A", parentItemCode: "B" }), sub({ itemCode: "B", parentItemCode: "A" })]);
    expect(loop.length).toBeGreaterThan(0);
    expect(loop.every((f) => f.code === "BOQ_PARENT_INVALID")).toBe(true);
    expect(loop[0].message).toContain("circle");
  });
  test("a parent typed on a LATER line is fine", () => {
    const sub = { ...emptyLine(), description: "S", parentItemCode: "A", breakdownPercentage: "50", unit: "m3" };
    expect(boqDraftFaults("T", [sub, line({ itemCode: "A" })])).toEqual([]);
  });
  test("faults come in reading order: title, then line by line", () => {
    const f = boqDraftFaults("", [line({ description: "" }), line({ quantity: "-1" })]);
    expect(f.map((x) => x.code)).toEqual(["BOQ_TITLE_REQUIRED", "BOQ_LINE_DESCRIPTION_REQUIRED", "BOQ_LINE_NUMBER_INVALID"]);
  });
});

describe("panel helpers", () => {
  test("faultsByField keeps the first sentence per input, without the closing 'Nothing was saved.'", () => {
    const f = boqDraftFaults("", [line({ description: "" })]);
    const map = faultsByField(f);
    expect(map[BOQ_TITLE_ID]).not.toContain("Nothing was saved");
    expect(Object.keys(map)).toHaveLength(2);
  });
  test("panelMessage counts the other problems", () => {
    expect(panelMessage(boqDraftFaults("T", [line({ quantity: "-1", rate: "x" })]))).toContain("1 other problem is marked on the form below");
    expect(panelMessage(boqDraftFaults("", [line({ quantity: "-1", rate: "x" })]))).toContain("2 other problems are marked");
    expect(panelMessage([])).toBe("");
  });
  test("faultFailure carries the code and the field so the guide takes the person to the input", () => {
    const failure = faultFailure(boqDraftFaults("T", [line({ rate: "" })]));
    expect(failure).toMatchObject({ kind: "not-sent", retryable: false, code: "BOQ_LINE_RATE_REQUIRED", field: boqLineId(0, "rate") });
    expect(faultFailure([])).toBeNull();
  });
});

describe("fieldFromServerMessage: the server's words back to an input", () => {
  const lines = [emptyLine(), line({ itemCode: "A-1" }), { ...emptyLine(), description: "Sub", parentItemCode: "A-1", breakdownPercentage: "50", itemCode: "A-1.1" }];
  test("line numbers count only non-blank rows", () => {
    expect(fieldFromServerMessage("line item 1 (A-1): quantity must be a non-negative number, got -4", lines)).toBe(boqLineId(1, "quantity"));
    expect(fieldFromServerMessage("line item 2 (A-1.1): breakdownPercentage is required when parentItemCode is set", lines)).toBe(boqLineId(2, "breakdownPercentage"));
    expect(fieldFromServerMessage('line item 2: duplicate itemCode "A-1" -- item codes must be unique within one BOQ', lines)).toBe(boqLineId(2, "itemCode"));
    expect(fieldFromServerMessage("line item 1: unit is required", lines)).toBe(boqLineId(1, "unit"));
    expect(fieldFromServerMessage("line item 1: description is required", lines)).toBe(boqLineId(1, "description"));
    expect(fieldFromServerMessage("line item 9: rate must be a non-negative number", lines)).toBeUndefined();
  });
  test("parent problems find the line by code", () => {
    expect(fieldFromServerMessage('parentItemCode "A-1" does not match any itemCode in this submission', lines)).toBe(boqLineId(2, "parentItemCode"));
    expect(fieldFromServerMessage('Circular parentItemCode reference detected at "A-1"', lines)).toBe(boqLineId(1, "parentItemCode"));
    expect(fieldFromServerMessage("Unresolvable parentItemCode reference(s) among: A-1.1", lines)).toBe(boqLineId(2, "parentItemCode"));
    expect(fieldFromServerMessage('breakdownPercentage is required for line item "Sub" (has a parentItemCode)', lines)).toBe(boqLineId(2, "breakdownPercentage"));
  });
  test("title and unnamed messages", () => {
    expect(fieldFromServerMessage("title is required", lines)).toBe(BOQ_TITLE_ID);
    expect(fieldFromServerMessage("Something unrelated", lines)).toBeUndefined();
  });
});

describe("project form", () => {
  const ok = { name: "Lakeview", description: "", startDate: "2026-01-01", targetDate: "2026-06-30" };
  test("good and empty-name forms pass", () => {
    expect(projectFormFaults(ok)).toEqual([]);
    expect(projectFormFaults({ name: "", description: "", startDate: "", targetDate: "" })).toEqual([]);
  });
  test("name too long, target before start, absurd year, nonsense day", () => {
    expect(projectFormFaults({ ...ok, name: "x".repeat(201) })[0]).toMatchObject({ code: "PROJECT_NAME_TOO_LONG", field: "name" });
    expect(projectFormFaults({ ...ok, targetDate: "2025-12-31" })[0]).toMatchObject({ code: "PROJECT_DATE_ORDER", field: "targetDate" });
    expect(projectFormFaults({ ...ok, startDate: "0002-01-01" })[0]).toMatchObject({ code: "PROJECT_DATE_INVALID", field: "startDate" });
    expect(projectFormFaults({ ...ok, targetDate: "20260-01-01" })[0]).toMatchObject({ code: "PROJECT_DATE_INVALID", field: "targetDate" });
    expect(projectDateFault("d", "f", "2026-02-30")?.message).toContain("not a real calendar day");
    expect(projectDateFault("d", "f", "")).toBeNull();
  });
  test("same day is fine", () => expect(projectFormFaults({ ...ok, startDate: "2026-03-01", targetDate: "2026-03-01" })).toEqual([]));
});

describe("import file", () => {
  const f = (name: string, size = 1000) => ({ name, size });
  test("good files", () => {
    expect(importFileFault(f("boq.xlsx"))).toBeNull();
    expect(importFileFault(f("BOQ.CSV"))).toBeNull();
  });
  test("no file, wrong type, empty, too big", () => {
    expect(importFileFault(null)?.code).toBe("IMPORT_NO_FILE");
    expect(importFileFault(f("boq.pdf"))).toMatchObject({ code: "IMPORT_WRONG_TYPE", field: "import-file" });
    expect(importFileFault(f("boq.xls"))?.message).toContain("old Excel");
    expect(importFileFault(f("photo.jpg"))?.message).toContain("photo.jpg");
    expect(importFileFault(f("boq.xlsx", 0))?.code).toBe("IMPORT_EMPTY_FILE");
    expect(importFileFault(f("boq.xlsx", 11 * 1024 * 1024))).toMatchObject({ code: "IMPORT_TOO_BIG" });
    expect(importFileFault(f("boq.xlsx", 10 * 1024 * 1024))).toBeNull();
  });
});

describe("baseline and budget", () => {
  test("evidence", () => {
    expect(baselineEvidenceFault("")?.field).toBe("baseline-evidence");
    expect(baselineEvidenceFault("   ")?.code).toBe("BASELINE_EVIDENCE_REQUIRED");
    expect(baselineEvidenceFault("PO 4411")).toBeNull();
    expect(baselineEvidenceFault("x".repeat(501))).not.toBeNull();
  });
  test("budget percent", () => {
    expect(budgetPercentFault("25", "f")).toBeNull();
    expect(budgetPercentFault("0", "f")).toBeNull();
    expect(budgetPercentFault("100", "f")).toBeNull();
    expect(budgetPercentFault("101", "f")?.code).toBe("BUDGET_PERCENT_RANGE");
    expect(budgetPercentFault("-1", "f")?.code).toBe("BUDGET_PERCENT_RANGE");
    expect(budgetPercentFault("", "f")?.message).toContain("nothing");
  });
  test("money amount", () => {
    expect(moneyAmountFault("Vendor amount", "1500.50", "f")).toBeNull();
    expect(moneyAmountFault("Vendor amount", "-3", "f")?.code).toBe("BUDGET_AMOUNT_INVALID");
    expect(moneyAmountFault("Vendor amount", "1,500", "f")).not.toBeNull();
  });
});

describe("newLineFaults: Add a scope item", () => {
  const existing = [line({ itemCode: "A-1" }), line({ description: "Backfill", itemCode: "A-2" })];
  test("only the new rows are reported, numbered as the form shows them", () => {
    const items = [line({ description: "New slab", itemCode: "B-1", quantity: "-4" })];
    const f = newLineFaults(boqDraftFaults("T", [...existing, ...items]), existing.length);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "BOQ_LINE_NUMBER_INVALID", line: 1, field: boqLineId(0, "quantity") });
    expect(f[0].message.startsWith("Line 1:")).toBe(true);
  });
  test("a code already used by an existing line says so without a confusing number", () => {
    const f = newLineFaults(boqDraftFaults("T", [...existing, line({ description: "Dup", itemCode: "A-1" })]), existing.length);
    expect(f[0].code).toBe("BOQ_CODE_DUPLICATE");
    expect(f[0].message).toContain("an existing line of this BOQ");
    expect(f[0].field).toBe(boqLineId(0, "itemCode"));
  });
  test("a parent code that is one of the BOQ's own lines is fine", () => {
    const sub = { ...emptyLine(), description: "Sub", unit: "m3", parentItemCode: "A-1", breakdownPercentage: "20" };
    expect(newLineFaults(boqDraftFaults("T", [...existing, sub]), existing.length)).toEqual([]);
  });
});
