// A SMALL, DEPENDENCY-FREE READER FOR .xlsx FILES, so a BOQ spreadsheet can be read ON THE LAPTOP with no network (Sumeet R-70..R-72, checklist 3.1).
//
// WHY NOT A LIBRARY. PROJEXA has a standing rule that it gains no XLSX library (the server's parser lives in compliance-tracker); the online import sends the
// file to the server. With no network that is impossible, so this file reads the one thing the import needs: the first sheet of a workbook as rows of
// cell text. An .xlsx is a ZIP of XML files; the ZIP is opened with the platform's own DecompressionStream("deflate-raw") (every current browser, Bun and
// Node 18+), and the XML is read with a few anchored patterns, not a general XML parser (the files are machine-written and the parts read are fixed:
// xl/workbook.xml, its relationships, xl/sharedStrings.xml, xl/styles.xml and the sheet).
//
// WHAT IS READ: cell values (shared strings, inline strings, formula strings, numbers, booleans; an error cell is empty), the first sheet in workbook
// order, and the number format of a numeric cell where it changes the TEXT the person sees: a fixed number of decimals ("0.00" shows 1.10 as "1.10",
// not 1.1 -- an item code like 2.10 must not become 2.1) and a percentage ("0%" shows 0.3 as "30%"). Everything else is the plain number.
// WHAT IS NOT: formulas are not evaluated (the value Excel last stored is read), dates are left as their serial number (a BOQ has none), merged
// cells, hidden rows and other sheets are ignored, and encrypted or macro-binary (.xlsb/.xls) files are refused in words.
//
// THE SAME TEXT AS THE SERVER'S READER. The server (compliance-tracker src/lib/ingest/parser.ts) reads the first sheet with the first non-blank row as
// the header, blank rows skipped, a duplicate header suffixed _1, _2, an empty header named __EMPTY, __EMPTY_1, and a blank cell as null. readFirstSheetRecords
// does the same, so the rows the laptop maps are the rows the server would map.

export class XlsxReadError extends Error {
  constructor(readonly code: "NOT_XLSX" | "NO_SHEET" | "EMPTY" | "TOO_LARGE" | "UNSUPPORTED", message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

/** The most the laptop will unpack: a BOQ workbook is a few hundred KB; this stops a zip bomb, not a real file. */
export const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
export const MAX_SHEET_ROWS = 20_000;

type Entry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const utf8 = new TextDecoder("utf-8");

function readCentralDirectory(zip: Uint8Array): Map<string, Entry> {
  // the end-of-central-directory record is within the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("NOT_XLSX", "This file is not an Excel (.xlsx) workbook.");
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || u32(zip, p) !== 0x02014b50) throw new XlsxReadError("NOT_XLSX", "This file is not an Excel (.xlsx) workbook.");
    const flags = u16(zip, p + 8);
    const method = u16(zip, p + 10);
    const compressedSize = u32(zip, p + 20);
    const uncompressedSize = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const localOffset = u32(zip, p + 42);
    if (flags & 1) throw new XlsxReadError("UNSUPPORTED", "This workbook is password protected, so it cannot be read here.");
    const name = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new XlsxReadError("UNSUPPORTED", "This browser cannot open Excel files without a connection.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length > MAX_UNPACKED_BYTES || (expected > 0 && out.length !== expected)) throw new XlsxReadError("NOT_XLSX", "This Excel file looks damaged.");
  return out;
}

async function readEntry(zip: Uint8Array, entries: Map<string, Entry>, name: string): Promise<string | null> {
  const e = entries.get(name);
  if (!e) return null;
  if (e.uncompressedSize > MAX_UNPACKED_BYTES) throw new XlsxReadError("TOO_LARGE", "This workbook is too large to read on the laptop.");
  const p = e.localOffset;
  if (u32(zip, p) !== 0x04034b50) throw new XlsxReadError("NOT_XLSX", "This Excel file looks damaged.");
  const start = p + 30 + u16(zip, p + 26) + u16(zip, p + 28);
  const raw = zip.subarray(start, start + e.compressedSize);
  if (e.method === 0) return utf8.decode(raw);
  if (e.method === 8) return utf8.decode(await inflateRaw(raw, e.uncompressedSize));
  throw new XlsxReadError("UNSUPPORTED", "This Excel file uses a compression this reader does not know.");
}

// ─── XML helpers (anchored patterns over machine-written files) ─────────────────────────────────────────────────

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g: string) => {
    if (g.startsWith("#x")) return String.fromCodePoint(parseInt(g.slice(2), 16));
    if (g.startsWith("#")) return String.fromCodePoint(parseInt(g.slice(1), 10));
    return ENTITY[g] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]!) : null;
}

/** The text of a <si> / <is> element: every <t> in it, but not the phonetic runs (<rPh>). */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ""));
}

/** The number format code of each cell style (index = the cell's s="" attribute), for the formats that change the shown text. */
function parseStyleFormats(xml: string | null): string[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = attr(m[0], "numFmtId");
    const code = attr(m[0], "formatCode");
    if (id !== null && code !== null) custom.set(Number(id), code);
  }
  const builtIn: Record<number, string> = { 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%" };
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    return custom.get(id) ?? builtIn[id] ?? "General";
  });
}

/** A numeric cell's text under its format: fixed decimals and percentages are honoured; anything else is the plain number (15 significant digits). */
export function formatNumber(raw: string, format: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const first = (format.split(";")[0] ?? "").replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, "").trim();
  const m = /^[#,]*0(?:\.(0+))?(%?)$/.exec(first);
  if (m) {
    const decimals = m[1]?.length ?? 0;
    const pct = m[2] === "%";
    return (pct ? n * 100 : n).toFixed(decimals) + (pct ? "%" : "");
  }
  return String(Number(n.toPrecision(15)));
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type SheetGrid = { name: string; rows: { row: number; cells: string[] }[] };

/** The first sheet of an .xlsx, as rows of cell text (a blank cell is ""). */
export async function readFirstSheet(bytes: Uint8Array): Promise<SheetGrid> {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new XlsxReadError("NOT_XLSX", "This file is not an Excel (.xlsx) workbook. Older .xls files must be saved as .xlsx first.");
  const entries = readCentralDirectory(bytes);
  if (!entries.has("xl/workbook.xml")) throw new XlsxReadError("NOT_XLSX", entries.has("xl/workbook.bin") ? "This is a binary workbook (.xlsb); save it as .xlsx first." : "This file is not an Excel (.xlsx) workbook.");
  const workbook = (await readEntry(bytes, entries, "xl/workbook.xml")) ?? "";
  const rels = (await readEntry(bytes, entries, "xl/_rels/workbook.xml.rels")) ?? "";
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  if (!firstSheet) throw new XlsxReadError("NO_SHEET", "This workbook has no sheets.");
  const name = attr(firstSheet, "name") ?? "Sheet1";
  const rid = attr(firstSheet, "r:id");
  let target: string | null = null;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attr(m[0], "Id") === rid) target = attr(m[0], "Target");
  }
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheetXml = await readEntry(bytes, entries, path);
  if (sheetXml === null) throw new XlsxReadError("NO_SHEET", "The first sheet of this workbook could not be found.");
  const strings = parseSharedStrings(await readEntry(bytes, entries, "xl/sharedStrings.xml"));
  const formats = parseStyleFormats(await readEntry(bytes, entries, "xl/styles.xml"));

  const rows: SheetGrid["rows"] = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= MAX_SHEET_ROWS) throw new XlsxReadError("TOO_LARGE", `This sheet has more than ${MAX_SHEET_ROWS} rows, too many to read on the laptop.`);
    const rowNo = Number(attr(rm[1] ?? "", "r") ?? rows.length + 1);
    const cells: string[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = attr(head, "r");
      const type = attr(head, "t");
      const style = Number(attr(head, "s") ?? 0);
      const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = strings[Number(unescapeXml(v ?? ""))] ?? "";
      else if (type === "inlineStr") text = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str") text = unescapeXml(v ?? "");
      else if (type === "b") text = v === "1" ? "true" : "false";
      else if (type === "e") text = "";
      else if (v !== undefined && v.trim() !== "") text = formatNumber(unescapeXml(v).trim(), formats[style] ?? "General");
      const col = ref ? columnIndex(ref) : cells.length;
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length > 0) rows.push({ row: rowNo, cells });
  }
  return { name, rows };
}

/** The server's shape: the first non-blank row is the header, every later non-blank row is a record keyed by header (a blank cell is null). */
export function toRecords(grid: SheetGrid): { headers: string[]; records: Record<string, string | null>[] } {
  const [headRow, ...body] = grid.rows;
  if (!headRow || body.length === 0) throw new XlsxReadError("EMPTY", "This Excel file is empty or has no data rows.");
  const seen = new Map<string, number>();
  const headers = headRow.cells.map((raw) => {
    const base = raw.trim() === "" ? "__EMPTY" : raw.trim();
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // SheetJS names a repeat Name_1, Name_2 and an unnamed column __EMPTY, __EMPTY_1 (the first is unsuffixed)
    return n === 0 ? base : `${base}_${n}`;
  });
  const records = body.map((r) => {
    const rec: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      const cell = r.cells[i];
      rec[h] = cell === undefined || cell === "" ? null : cell;
    });
    return rec;
  });
  return { headers, records };
}

export async function readFirstSheetRecords(bytes: Uint8Array) {
  const grid = await readFirstSheet(bytes);
  return { sheetName: grid.name, ...toRecords(grid) };
}
