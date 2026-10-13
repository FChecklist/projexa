import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { importBoqFromBytes } from "./boq-excel-import";
import { isMalformedNumericCell, mapBoqHeaders, mapRowsToLines, parseAmount, toDrafts, toPreviewRows } from "./boq-excel-map";
import { formatNumber, readFirstSheet, readFirstSheetRecords, XlsxReadError } from "./xlsx-lite";
import { DOTTED_CODES_XLSX_BASE64, SUMEET_SHAPED_XLSX_BASE64 } from "./__fixtures__/boq-excel-fixtures";
import { collectLines } from "@/lib/boq-helpers";
import { validateBoqDraft } from "../shell/modules/scope-writes";

// Sumeet R-70 (a real sheet with sub-tasks and weights), R-71 (a malformed row is rejected readably, by row) and R-72 (the columns are matched by his
// headers), read ON THE LAPTOP with no server and no spreadsheet library. The sheets are written by SheetJS (an independent writer) and, for the
// variations, by a tiny zip writer below. The expected figures are the server importer's own oracle (compliance-tracker construction-boq-import-service.test.ts:
// item 1.01, 472 sqm at 108 = 50,976; Frame 01 at 30% = rate 32.40, amount 15,292.80).

const bytesOf = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

// ─── a minimal zip writer, to build workbooks by hand ────────────────────────────────────────────────────────────
function zip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => Uint8Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  const cat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(content);
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = cat(le(0x04034b50, 4), le(20, 2), le(0, 2), le(method, 2), le(0, 2), le(0, 2), le(0, 4), le(data.length, 4), le(raw.length, 4), le(nameB.length, 2), le(0, 2), nameB, data);
    central.push(cat(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(method, 2), le(0, 2), le(0, 2), le(0, 4), le(data.length, 4), le(raw.length, 4), le(nameB.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), nameB));
    parts.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, le(0x06054b50, 4), le(0, 2), le(0, 2), le(central.length, 2), le(central.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2));
}

const WORKBOOK = `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bill 1" sheetId="1" r:id="rId9"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/data.xml"/></Relationships>`;
const sheetOf = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const num = (ref: string, v: number | string) => `<c r="${ref}"><v>${v}</v></c>`;
const workbookWith = (sheet: string, extra: Record<string, string> = {}, method: 0 | 8 = 8) =>
  zip({ "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": RELS, "xl/worksheets/data.xml": sheet, ...extra }, method);

describe("R-70 / R-71 / R-72: a real workbook written by SheetJS, read on the laptop", () => {
  test("the Sumeet-shaped sheet: category headers skipped, tasks and their unlabeled sub-tasks mapped, the oracle figures reproduced, the first sheet used", async () => {
    const r = await importBoqFromBytes(bytesOf(SUMEET_SHAPED_XLSX_BASE64), "Sumeet BOQ v5.xlsx");
    if (!r.ok) throw new Error(r.message);
    const v = r.value;
    expect([v.sheetName, v.title, v.totalRows]).toEqual(["BoQ", "Sumeet BOQ v5", 7]);
    expect(v.mapping).toEqual({
      itemCode: "Sl No", description: "Description (Task)", subTask: "Sub Task", unit: "UNIT", quantity: "QTY", rate: "RATE", breakdownPercentage: "Breakdown %", amount: "AMOUNT", category: "Category",
    });
    expect(v.preview.map((p) => [p.row, p.code, p.description, p.parentItemCode])).toEqual([
      [3, "1.01", "Partition wall as per drawing and specification.", null],
      [4, null, "Frame 01", "1.01"],
      [5, null, "Gypsum Board", "1.01"],
      [7, "2.01", "False ceiling in gypsum board & fixing (A/B)", null],
    ]);
    const frame = v.preview.find((p) => p.description === "Frame 01")!;
    expect([frame.quantity, Number(frame.rate.toFixed(2)), Number(frame.amount.toFixed(2)), frame.breakdownPercentage, frame.category]).toEqual([472, 32.4, 15292.8, 30, "Partition"]);
    const gypsum = v.preview.find((p) => p.description === "Gypsum Board")!;
    expect([Number(gypsum.rate.toFixed(2)), Number(gypsum.amount.toFixed(2)), gypsum.breakdownPercentage]).toEqual([75.6, 35683.2, 70]);
    expect(v.preview.find((p) => p.code === "1.01")!.amount).toBe(50976);
  });

  test("R-71: the malformed Qty row is named by sheet row and BLOCKING, the two category headers are named and skipped, and nothing is imported as a silent zero", async () => {
    const r = await importBoqFromBytes(bytesOf(SUMEET_SHAPED_XLSX_BASE64), "sumeet.xlsx");
    if (!r.ok) throw new Error(r.message);
    expect(r.value.issues).toEqual([
      { row: 2, message: 'Row 2: skipped (category header: "PARTITION AND LINING")', blocking: false },
      { row: 6, message: 'Row 6: skipped (category header: "FALSE CEILING")', blocking: false },
      { row: 8, message: "Row 8: Qty is not a number", blocking: true },
    ]);
    expect(r.value.blocking.map((i) => i.row)).toEqual([8]);
    expect(r.value.warnings).toContain('Row 8: skipped (Quantity "not-a-number" is not a number)');
    expect(r.value.preview.some((p) => p.description === "Cove lighting channel")).toBe(false);
  });

  test("the lines become the New BOQ grid's strings: a task keeps Qty and Rate, a sub-task leaves them blank and carries its Breakdown %; the grid accepts them (the same checks as a BOQ typed by hand)", async () => {
    const r = await importBoqFromBytes(bytesOf(SUMEET_SHAPED_XLSX_BASE64), "sumeet.xlsx");
    if (!r.ok) throw new Error(r.message);
    const [task, frame, gypsum, ceiling] = r.value.drafts;
    expect(task).toMatchObject({ itemCode: "1.01", unit: "Sqm", quantity: "472", rate: "108", parentItemCode: "", breakdownPercentage: "", category: "Partition" });
    expect(frame).toMatchObject({ description: "Frame 01", quantity: "", rate: "", parentItemCode: "1.01", breakdownPercentage: "30", category: "Partition" });
    expect(gypsum).toMatchObject({ parentItemCode: "1.01", breakdownPercentage: "70" });
    expect(ceiling).toMatchObject({ itemCode: "2.01", quantity: "80", rate: "700" });
    expect(collectLines(r.value.drafts).error).toBeNull();
    expect(validateBoqDraft("Sumeet BOQ", r.value.drafts)).toEqual({});
  });

  test("Sl No stored as numbers shown with two decimals keep their text (2.10 and 2.20, not 2.1 and 2.2), and the dotted code finds its parent 2", async () => {
    const r = await importBoqFromBytes(bytesOf(DOTTED_CODES_XLSX_BASE64), "dotted.xlsx");
    if (!r.ok) throw new Error(r.message);
    expect(r.value.preview.map((p) => [p.code, p.parentItemCode, p.breakdownPercentage])).toEqual([["2", null, null], ["2.10", "2", 40], ["2.20", "2", 60]]);
    expect(r.value.preview.map((p) => p.amount)).toEqual([5000, 2000, 3000]);
    expect(r.value.blocking).toEqual([]);
  });
});

describe("the reader on its own: shapes a different writer produces", () => {
  test("a workbook written by hand: stored (uncompressed) and deflated entries, inline strings, entities, a sheet named by the workbook's relationship", async () => {
    const sheet = sheetOf(
      `<row r="1">${inline("A1", "Item Code")}${inline("B1", "Description")}${inline("C1", "Unit")}${inline("D1", "Qty")}${inline("E1", "Rate")}</row>` +
        `<row r="2">${inline("A2", "A&amp;1")}${inline("B2", "Tom &amp; Jerry &lt;tile&gt; &#233;")}${inline("C2", "m2")}${num("D2", "12")}${num("E2", "1.5E2")}</row>`
    );
    for (const method of [0, 8] as const) {
      const r = await readFirstSheetRecords(workbookWith(sheet, {}, method));
      expect(r.sheetName).toBe("Bill 1");
      expect(r.headers).toEqual(["Item Code", "Description", "Unit", "Qty", "Rate"]);
      expect(r.records).toEqual([{ "Item Code": "A&1", Description: "Tom & Jerry <tile> é", Unit: "m2", Qty: "12", Rate: "150" }]);
    }
  });

  test("shared strings (with rich-text runs and phonetic runs), a skipped column, blank rows and a blank cell", async () => {
    const shared = `<sst><si><t>Description</t></si><si><r><t>Plaster </t></r><r><t>work</t></r><rPh><t>IGNORED</t></rPh></si><si><t>Qty</t></si><si><t>Rate</t></si></sst>`;
    const sheet = sheetOf(
      `<row r="1"><c r="B1" t="s"><v>0</v></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c></row>` +
        `<row r="3"><c r="B3" t="s"><v>1</v></c><c r="D3"><v>20</v></c></row>`
    );
    const r = await readFirstSheetRecords(workbookWith(sheet, { "xl/sharedStrings.xml": shared }));
    expect(r.headers).toEqual(["__EMPTY", "Description", "__EMPTY_1", "Qty", "Rate"]);
    expect(r.records).toEqual([{ __EMPTY: null, Description: "Plaster work", __EMPTY_1: null, Qty: "20", Rate: null }]);
  });

  test("a repeated heading is suffixed _1 like the server's reader", async () => {
    const sheet = sheetOf(`<row r="1">${inline("A1", "Qty")}${inline("B1", "Qty")}</row><row r="2">${num("A2", 1)}${num("B2", 2)}</row>`);
    expect((await readFirstSheetRecords(workbookWith(sheet))).headers).toEqual(["Qty", "Qty_1"]);
  });

  test("number formats: fixed decimals and percentages are shown as Excel shows them; General is the plain number", () => {
    expect(formatNumber("2.1", "0.00")).toBe("2.10");
    expect(formatNumber("1234.5", "#,##0.00")).toBe("1234.50");
    expect(formatNumber("0.3", "0%")).toBe("30%");
    expect(formatNumber("0.125", "0.00%")).toBe("12.50%");
    expect(formatNumber("0.30000000000000004", "General")).toBe("0.3");
    expect(formatNumber("5", '"Rs "0.00')).toBe("5.00");
    expect(formatNumber("5", "dd-mm-yyyy")).toBe("5");
  });

  test("files that are not a workbook are refused in words: plain text, a zip that is not Excel, an old .xls name, a truncated file, an empty sheet, no data rows", async () => {
    const refuse = async (bytes: Uint8Array, name = "x.xlsx") => {
      const r = await importBoqFromBytes(bytes, name);
      if (r.ok) throw new Error("expected a refusal");
      return r.message;
    };
    expect(await refuse(new TextEncoder().encode("Description,Qty,Rate\nSlab,1,2"))).toContain("not an Excel");
    expect(await refuse(zip({ "readme.txt": "hello" }))).toContain("not an Excel");
    expect(await refuse(new Uint8Array(0))).toContain("not an Excel");
    expect(await refuse(workbookWith(sheetOf("")).subarray(0, 120))).toContain("not an Excel");
    expect(await refuse(new Uint8Array([1, 2, 3]), "old.xls")).toContain("Only .xlsx");
    expect(await refuse(workbookWith(sheetOf(`<row r="1">${inline("A1", "Description")}</row>`)))).toContain("no data rows");
    expect(await refuse(workbookWith(sheetOf(`<row r="1">${inline("A1", "Notes")}</row><row r="2">${inline("A2", "x")}</row>`)))).toContain("Description column");
    await expect(readFirstSheet(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).rejects.toBeInstanceOf(XlsxReadError);
  });
});

describe("the mapping rules (the server's, carried over)", () => {
  test("R-72: headers by alias in priority order; Description keeps its column when a Category column also exists, and Category is then its own field", () => {
    expect(mapBoqHeaders(["Sl No", "Category", "Description (Task)", "Qty", "Rate"])).toMatchObject({ description: "Description (Task)", category: "Category", itemCode: "Sl No" });
    expect(mapBoqHeaders(["Category", "Qty", "Rate"])).toMatchObject({ description: "Category" });
    expect(mapBoqHeaders(["S.No", "Description", "Unit", "Qty", "Rate", "Breakdown %"])).toEqual({ itemCode: "S.No", description: "Description", unit: "Unit", quantity: "Qty", rate: "Rate", breakdownPercentage: "Breakdown %" });
  });

  test("a missing Description, Quantity or Rate column is told in words", () => {
    expect(() => mapRowsToLines([{ a: "1" }], { quantity: "a", rate: "a" })).toThrow(/Description/);
    expect(() => mapRowsToLines([{ a: "1" }], { description: "a", rate: "a" })).toThrow(/Quantity/);
    expect(() => mapRowsToLines([{ a: "1" }], { description: "a", quantity: "a" })).toThrow(/Rate/);
  });

  test("dotted codes infer the parent; a row with no description, a blank Rate on a root row and a repeated Item Code are named; a printed amount that disagrees is reported and quantity x rate is used", () => {
    const map = { itemCode: "code", description: "desc", unit: "unit", quantity: "qty", rate: "rate", breakdownPercentage: "pct", amount: "amt" };
    const { lines, warnings, issues } = mapRowsToLines(
      [
        { code: "2", desc: "Main", unit: "cum", qty: "100", rate: "50", amt: "5000" },
        { code: "2.1", desc: "Sub A", unit: "cum", qty: "0", rate: "0", pct: "40" },
        { code: "2.1", desc: "Sub B (same code)", unit: "cum", qty: "0", rate: "0", pct: "60" },
        { code: "3", desc: "", unit: "nos", qty: "1", rate: "1" },
        { code: "4", desc: "No rate", unit: "nos", qty: "1", rate: "" },
        { code: "5", desc: "Disagrees", unit: "nos", qty: "10", rate: "10", amt: "90" },
      ],
      map
    );
    expect(lines.map((l) => [l.itemCode, l.parentItemCode, l.breakdownPercentage])).toEqual([["2", undefined, undefined], ["2.1", "2", 40], ["2.1", "2", 60], ["5", undefined, undefined]]);
    expect(warnings).toContain("Row 5: skipped (no description)");
    expect(warnings).toContain("Row 6: Rate is blank");
    expect(issues.filter((i) => i.blocking).map((i) => i.message)).toEqual(['Row 4: duplicate Item Code "2.1" (first used on row 3)']);
    expect(issues.some((i) => /printed amount 90 does not match quantity x rate \(100\)/.test(i.message) && !i.blocking)).toBe(true);
  });

  test("a sub-task with no Breakdown % is reported as blocking (the server refuses it on save)", () => {
    const { issues } = mapRowsToLines([{ c: "1", d: "Main", q: "1", r: "10", p: "" }, { c: "1.1", d: "Sub", q: "0", r: "0", p: "" }], { itemCode: "c", description: "d", quantity: "q", rate: "r", breakdownPercentage: "p" });
    expect(issues).toEqual([{ row: 3, message: 'Row 3: sub-task "Sub" has no Breakdown %', blocking: true }]);
  });

  test("a fraction in the Breakdown % column (0.3) is read as 30; a root row's category is inherited by its sub-tasks", () => {
    const { lines } = mapRowsToLines(
      [{ c: "1", d: "Main", q: "1", r: "10", p: "", k: "Civil" }, { c: "1.1", d: "Sub", q: "0", r: "0", p: "0.25", k: "" }],
      { itemCode: "c", description: "d", quantity: "q", rate: "r", breakdownPercentage: "p", category: "k" }
    );
    expect(lines[1]).toMatchObject({ breakdownPercentage: 25, category: "Civil" });
  });

  test("parseAmount and the malformed-cell test accept what the server accepts (5,000 / AED 50 / (100)) and reject garbage", () => {
    expect([parseAmount("5,000"), parseAmount("AED 50"), parseAmount("(100)"), parseAmount("TBD"), parseAmount("")]).toEqual([5000, 50, -100, 0, 0]);
    expect(["5,000", "AED 50", "(100)", "", "0"].map(isMalformedNumericCell)).toEqual([false, false, false, false, false]);
    expect(["not-a-number", "TBD", "N/A"].map(isMalformedNumericCell)).toEqual([true, true, true]);
  });

  test("a sub-task with no Sl No under an unlabeled parent row is attached to the nearest preceding task, which gets a plain generated code", () => {
    const { lines } = mapRowsToLines(
      [{ d: "Reception Counter", q: "1", r: "1000", s: "", p: "" }, { d: "", q: "", r: "", s: "Top", p: "30" }, { d: "", q: "", r: "", s: "Base", p: "70" }],
      { description: "d", quantity: "q", rate: "r", subTask: "s", breakdownPercentage: "p" }
    );
    expect(lines.map((l) => [l.itemCode, l.parentItemCode, l.description])).toEqual([["LI-0001", undefined, "Reception Counter"], [undefined, "LI-0001", "Top"], [undefined, "LI-0001", "Base"]]);
    const preview = toPreviewRows(lines);
    expect(preview.map((p) => p.amount)).toEqual([1000, 300, 700]);
    expect(toDrafts(lines)[1]).toMatchObject({ quantity: "", rate: "", parentItemCode: "LI-0001", breakdownPercentage: "30" });
  });
});
