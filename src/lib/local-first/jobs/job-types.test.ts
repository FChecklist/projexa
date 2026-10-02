import { describe, expect, test } from "bun:test";
import {
  JobCancelledError, UnknownJobTypeError, boqRollup, computeJob, csvCell, formatMicros, parseMicros, runReducer, searchIndexQuery, tokenize, type BoqRollupResult, type CsvExportResult,
  type ReportPreviewResult, type SearchIndexResult,
} from "./job-types";

const line = (id: string, over: Record<string, unknown> = {}) => ({ id, boqId: "b1", category: "Civil", parentLineItemId: null, amount: "100.50", ...over });

describe("money helpers", () => {
  test("parseMicros / formatMicros are exact and null-safe", () => {
    expect(parseMicros("1234.5")).toBe(1_234_500_000n);
    expect(parseMicros(12)).toBe(12_000_000n);
    expect(parseMicros("-0.25")).toBe(-250_000n);
    for (const bad of [null, undefined, "", "abc", "1e3", NaN, {}, "1,000"]) expect(parseMicros(bad)).toBeNull();
    expect(formatMicros(1_234_500_000n)).toBe("1234.50");
    expect(formatMicros(-250_000n)).toBe("-0.25");
    expect(formatMicros(333_333_333n)).toBe("333.333333");
    // 0.1 + 0.2 is exactly 0.3 here (a float would not be)
    expect(formatMicros(parseMicros("0.1")! + parseMicros("0.2")!)).toBe("0.30");
  });
});

describe("boq_rollup (golden)", () => {
  test("totals by category and by parent line", async () => {
    const rows = [
      line("1", { category: "Civil", amount: "100.50" }),
      line("2", { category: "Civil", amount: "200", parentLineItemId: "1" }),
      line("3", { category: "MEP", amount: "50.25", parentLineItemId: "1" }),
      line("4", { category: null, amount: "10" }),
      line("5", { boqId: "other", amount: "999" }),
    ];
    const r = (await computeJob("boq_rollup", rows, { boqId: "b1" })) as BoqRollupResult;
    expect(r).toEqual({
      lineCount: 4, pricedLines: 4, hiddenAmountLines: 0, total: "360.75",
      byCategory: [{ key: "Civil", lineCount: 2, amount: "300.50" }, { key: "MEP", lineCount: 1, amount: "50.25" }, { key: "Uncategorised", lineCount: 1, amount: "10.00" }],
      byParent: [{ parentLineItemId: "1", lineCount: 2, amount: "250.25" }],
    });
  });

  test("redacted money is hidden, never zero (null-safe)", async () => {
    const rows = [line("1", { amount: "40" }), line("2", { amount: null }), line("3", { amount: undefined, category: "MEP" }), "junk", null, line("4", { amount: "n/a", category: "MEP" })];
    const r = (await computeJob("boq_rollup", rows, {})) as BoqRollupResult;
    expect(r.lineCount).toBe(4);
    expect(r.pricedLines).toBe(1);
    expect(r.hiddenAmountLines).toBe(3);
    expect(r.total).toBe("40.00");
    expect(r.byCategory.find((g) => g.key === "MEP")).toEqual({ key: "MEP", lineCount: 2, amount: null });
  });

  test("a role that sees no money at all gets total null, not 0", async () => {
    const r = (await computeJob("boq_rollup", [line("1", { amount: null }), line("2", { amount: null })], {})) as BoqRollupResult;
    expect(r.total).toBeNull();
    expect(r.pricedLines).toBe(0);
  });

  test("order of input does not change the answer", async () => {
    const rows = [line("1"), line("2", { category: "MEP" }), line("3", { parentLineItemId: "1" })];
    expect(await computeJob("boq_rollup", [...rows].reverse(), {})).toEqual(await computeJob("boq_rollup", rows, {}));
  });
});

describe("csv_export (golden)", () => {
  test("stable column order, row order and escaping", async () => {
    const rows = [
      { id: "b", name: 'He said "hi"', note: "a,b", qty: 2 },
      { id: "a", name: "plain", note: "line1\nline2", qty: 1, extra: true },
    ];
    const r = (await computeJob("csv_export", rows, { kind: "tasks" })) as CsvExportResult;
    expect(r.columns).toEqual(["extra", "id", "name", "note", "qty"]);
    expect(r.rowCount).toBe(2);
    expect(r.csv).toBe(['extra,id,name,note,qty', 'true,a,plain,"line1\nline2",1', ',b,"He said ""hi""","a,b",2'].join("\r\n") + "\r\n");
    expect(await computeJob("csv_export", [...rows].reverse(), { kind: "tasks" })).toEqual(r);
  });

  test("explicit columns win, in the order given", async () => {
    const r = (await computeJob("csv_export", [{ id: "1", a: "x", b: "y" }], { kind: "k", columns: ["b", "id"] })) as CsvExportResult;
    expect(r.csv).toBe("b,id\r\ny,1\r\n");
  });

  test("a cell a spreadsheet would run as a formula is defused; negative numbers are left alone", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("report_preview (golden)", () => {
  test("counts, filled columns, status breakdown and a sorted scalar sample", async () => {
    const rows = [
      { id: "2", status: "open", title: "B", nested: { x: 1 } },
      { id: "1", status: "open", title: "A", due: null },
      { id: "3", status: "closed", title: "" },
    ];
    const r = (await computeJob("report_preview", rows, { kind: "rfis", sampleSize: 2 })) as ReportPreviewResult;
    expect(r.rowCount).toBe(3);
    expect(r.columns).toEqual([{ name: "id", filled: 3 }, { name: "nested", filled: 1 }, { name: "status", filled: 3 }, { name: "title", filled: 2 }]);
    expect(r.statusCounts).toEqual([{ status: "closed", count: 1 }, { status: "open", count: 2 }]);
    expect(r.sample).toEqual([{ due: null, id: "1", status: "open", title: "A" }, { id: "2", status: "open", title: "B" }]);
  });
});

describe("search_index (golden)", () => {
  const rows = [
    { kind: "rfis", row: { id: "r1", title: "Clarify concrete grade", description: "Slab on the third floor" } },
    { kind: "tasks", row: { id: "t1", name: "Pour concrete", notes: "weather permitting" } },
    { kind: "tasks", row: { id: "t2", name: "Order rebar" } },
    { kind: "tasks", row: { id: "t3" } },
  ];
  test("tokenises, builds postings and answers queries", async () => {
    expect(tokenize("The Slab-on 3rd FLOOR!")).toEqual(["slab", "3rd", "floor"]);
    const idx = (await computeJob("search_index", rows, {})) as SearchIndexResult;
    expect(idx.docCount).toBe(3);
    expect(idx.docs.map((d) => `${d.kind}:${d.id}`)).toEqual(["rfis:r1", "tasks:t1", "tasks:t2"]);
    expect(idx.postings.find(([t]) => t === "concrete")![1]).toEqual([0, 1]);
    expect(searchIndexQuery(idx, "concrete").map((d) => d.id)).toEqual(["r1", "t1"]);
    expect(searchIndexQuery(idx, "concrete pour").map((d) => d.id)).toEqual(["t1"]);
    expect(searchIndexQuery(idx, "conc").length).toBe(2);
    expect(searchIndexQuery(idx, "zzz")).toEqual([]);
    expect(searchIndexQuery(idx, "")).toEqual([]);
  });
  test("row order does not change the index", async () => {
    expect(await computeJob("search_index", [...rows].reverse(), {})).toEqual(await computeJob("search_index", rows, {}));
  });
});

describe("registry", () => {
  test("an unknown type is refused, never run", async () => {
    await expect(computeJob("drop_table", [], {})).rejects.toBeInstanceOf(UnknownJobTypeError);
    await expect(computeJob("payroll_total", [], {})).rejects.toBeInstanceOf(UnknownJobTypeError);
  });
});

describe("slicing keeps the main thread free (50 ms budget)", () => {
  const lines = Array.from({ length: 10_907 }, (_, i) => line(String(i), { category: `c${i % 40}`, parentLineItemId: i % 7 === 0 ? String(i - 1) : null }));

  test("deterministic: with a fake clock where each row costs 0.1 ms, no slice exceeds 50 ms and the loop yields", async () => {
    let t = 0;
    const slow = { ...boqRollup, step: (s: Parameters<typeof boqRollup.step>[0], row: unknown) => { t += 0.1; boqRollup.step(s, row); } };
    const slices: number[] = [];
    let sliceStart = 0;
    let yields = 0;
    const result = await runReducer(slow, lines, {}, {
      budgetMs: 50, checkEvery: 16, now: () => t,
      yieldFn: async () => { slices.push(t - sliceStart); sliceStart = t; yields += 1; },
    });
    slices.push(t - sliceStart);
    expect((result as BoqRollupResult).lineCount).toBe(10_907);
    expect(yields).toBeGreaterThan(15); // ~1090 ms of work in <= ~51 ms pieces
    expect(Math.max(...slices)).toBeLessThanOrEqual(50 + 16 * 0.1 + 1e-6);
  });

  test("real clock: 10,907 BOQ lines, the longest stretch between yields is under 50 ms", async () => {
    let last = performance.now();
    let longest = 0;
    const result = (await runReducer(boqRollup, lines, {}, { budgetMs: 50, yieldFn: async () => { longest = Math.max(longest, performance.now() - last); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); } })) as BoqRollupResult;
    longest = Math.max(longest, performance.now() - last);
    expect(result.lineCount).toBe(10_907);
    expect(longest).toBeLessThan(50);
  });

  test("shouldStop cancels between slices", async () => {
    let t = 0;
    const slow = { ...boqRollup, step: (s: Parameters<typeof boqRollup.step>[0], row: unknown) => { t += 1; boqRollup.step(s, row); } };
    let stop = false;
    await expect(runReducer(slow, lines, {}, { budgetMs: 5, now: () => t, yieldFn: async () => { stop = true; }, shouldStop: () => stop })).rejects.toBeInstanceOf(JobCancelledError);
  });
});
