import { describe, expect, test } from "bun:test";
import { MAX_FIELDS, MAX_MESSAGE_CHARS, MAX_TABLE_ROWS, copyTextToClipboard, momShareText, reportShareText, shareCell } from "./share-text";

// Sumeet R-C04 (minutes) and R-C15 (reports), checklist 3.4: the text a person pastes into WhatsApp, made on the laptop with no network. It states what the
// saved copy holds and nothing it works out; dates are dd-mm-yyyy; numbers are printed as the screen prints them; it is short and says what it left out.

const SAVED = Date.UTC(2026, 9, 13, 8, 30);

describe("shareCell prints a value as the report screen does", () => {
  test("numbers with thousands separators and at most two decimals, dates in the house form, a dash for nothing", () => {
    expect([shareCell(777000), shareCell(12.3456), shareCell(null), shareCell(""), shareCell(undefined), shareCell(true), shareCell(false)]).toEqual(["777,000", "12.35", "-", "-", "-", "Yes", "No"]);
    expect(shareCell("2026-10-05")).toBe("05-10-2026");
    expect(shareCell("  two   spaces ")).toBe("two spaces");
    expect(shareCell("2026-13-45")).toBe("2026-13-45");
    expect(shareCell([1, 2, 3])).toBe("3 items");
  });
});

describe("reportShareText", () => {
  const body = { contractValue: 777000, progressPercent: 42, startDate: "2026-09-01", byTrade: [{ trade: "Mason", workerDays: 30, cost: 24000 }, { trade: "Painter", workerDays: 12, cost: null }], summary: { risk: "low" } };

  test("the title in bold, which copy it is, the fields, each table's rows and each nested block", () => {
    const text = reportShareText({ title: "Project Status", projectName: "Cedar Heights", savedAt: SAVED, body });
    const lines = text.split("\n");
    expect(lines[0]).toBe("*Project Status - Cedar Heights*");
    expect(lines[1]).toMatch(/^Saved from PROJEXA on .* \(the last copy this laptop received\)$/);
    expect(lines).toContain("Contract value: 777,000");
    expect(lines).toContain("Progress percent: 42");
    expect(lines).toContain("Start date: 01-09-2026");
    expect(lines).toContain("*By trade*");
    expect(lines).toContain("- Trade Mason, Worker days 30, Cost 24,000");
    expect(lines).toContain("- Trade Painter, Worker days 12");
    expect(lines).toContain("*Summary*");
    expect(lines).toContain("Risk: low");
  });

  test("it computes nothing: no total is added, and a value the server hid (null) is not printed as a figure", () => {
    const text = reportShareText({ title: "Budget", projectName: null, savedAt: SAVED, body: { rows: [{ item: "A", amount: 100 }, { item: "B", amount: 50 }, { item: "C", amount: null }] } });
    expect(text).not.toContain("150");
    expect(text).toContain("- Item C");
    expect(text).not.toMatch(/Item C, Amount/);
    expect(text.startsWith("*Budget*")).toBe(true);
  });

  test("a long table is cut at the first rows and says how many are left; so are fields; the whole message is capped", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 7 }, (_, i) => ({ n: i + 1 }));
    const cut = reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: rows });
    expect(cut).toContain("(7 more rows are in the CSV)");
    expect(cut.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(MAX_TABLE_ROWS);
    const fields = Object.fromEntries(Array.from({ length: MAX_FIELDS + 4 }, (_, i) => [`f${i}`, i]));
    expect(reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: fields })).toContain("(4 more fields are in the CSV)");
    const huge = Array.from({ length: 5 }, () => ({ text: "x".repeat(2500) }));
    const capped = reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: { huge } });
    expect(capped.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 40);
    expect(capped.endsWith("(The rest is in the CSV.)")).toBe(true);
  });

  test("other shapes: an empty list, a bare value, a list of plain values", () => {
    expect(reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: [] })).toContain("No rows.");
    expect(reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: "all clear" })).toContain("all clear");
    expect(reportShareText({ title: "T", projectName: null, savedAt: SAVED, body: ["a", "b"] })).toContain("- b");
  });
});

describe("momShareText", () => {
  test("title, when, status, numbered agenda and the minutes; the server-only parts are not invented", () => {
    const text = momShareText({ title: "Weekly site meeting", scheduledAt: "2026-10-12T10:30:00Z", status: "draft", agenda: ["Slab", "Safety"], minutes: "  Pour agreed.  " });
    expect(text.split("\n")).toEqual(expect.arrayContaining(["*Weekly site meeting*", "*Agenda*", "1. Slab", "2. Safety", "*Minutes*", "Pour agreed."]));
    expect(text).toMatch(/Minutes of meeting, 12-10-2026.*\(draft\)/);
    expect(momShareText({ title: "T", scheduledAt: null, status: null, agenda: null, minutes: null })).toContain("No minutes recorded yet.");
  });
});

describe("copyTextToClipboard", () => {
  test("uses the clipboard when the browser gives it; false when nothing can copy", async () => {
    let got = "";
    Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { got = t; } } });
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(got).toBe("hello");
    Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("no"); } } });
    expect(await copyTextToClipboard("x")).toBe(false);
  });
});