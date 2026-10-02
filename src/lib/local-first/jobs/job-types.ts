// LOCAL-FIRST work offload (compliance-tracker drizzle/0682): the four jobs a laptop may run for another.
//
// Each job type is a PURE, DETERMINISTIC reducer over rows that are already in the person's own local database:
// `init(params)` -> `step(state, row)` for every row -> `finish(state)`. Same rows + params in, same JSON out, on
// every machine, which is what lets a requester compare an offloaded answer with its own local fallback and what
// lets the worker slice the work (runReducer) so the page never freezes.
//
// A RESULT IS A PROPOSAL (server rule 2): these results are for display and export ONLY. Nothing here feeds money,
// approvals or permissions, and the server never writes a business row from one.
//
// MONEY THE PERSON MAY NOT SEE: the replica already holds the redacted rows (a role without cost access gets lines
// with amount/rate missing or null). boq_rollup therefore treats a missing/null/non-numeric amount as "hidden", never
// as zero, and says how many lines were hidden so a total is never mistaken for a complete one.

export const JOB_TYPES = ["boq_rollup", "csv_export", "report_preview", "search_index"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(v: unknown): v is JobType {
  return typeof v === "string" && (JOB_TYPES as readonly string[]).includes(v);
}

export type Reducer<S, R> = {
  init(params: unknown): S;
  step(state: S, row: unknown): void;
  finish(state: S): R;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── money: exact decimal arithmetic in micro-units (6 decimals), never floating point ────────────────────────
const ZERO = BigInt(0);
const MICRO = BigInt(1000000);

/** "1234.50" / 12 -> micro-units; null for anything that is not a plain decimal (null, "", "abc", NaN). */
export function parseMicros(v: unknown): bigint | null {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? "").slice(0, 6).padEnd(6, "0");
  const n = BigInt(m[2]) * MICRO + BigInt(frac);
  return m[1] === "-" ? -n : n;
}

/** Micro-units -> decimal text with at least 2 and at most 6 decimals ("1234.50"). */
export function formatMicros(n: bigint): string {
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const whole = abs / MICRO;
  let frac = (abs % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

// ── boq_rollup ─────────────────────────────────────────────────────────────────────────────────────────────
export type BoqRollupParams = { boqId?: string };
export type BoqGroup = { key: string; lineCount: number; amount: string | null };
export type BoqRollupResult = {
  lineCount: number;
  /** Lines whose amount this person can see (a plain number). */
  pricedLines: number;
  /** Lines with no visible amount: redacted for this role, or empty. Never counted as zero. */
  hiddenAmountLines: number;
  total: string | null;
  byCategory: BoqGroup[];
  byParent: Array<{ parentLineItemId: string; lineCount: number; amount: string | null }>;
};
type Acc = { count: number; sum: bigint; priced: number };
type BoqState = { boqId: string | null; lines: number; priced: number; total: bigint; cat: Map<string, Acc>; parent: Map<string, Acc> };
const bump = (m: Map<string, Acc>, key: string, amount: bigint | null) => {
  const a = m.get(key) ?? { count: 0, sum: ZERO, priced: 0 };
  a.count += 1;
  if (amount !== null) { a.sum += amount; a.priced += 1; }
  m.set(key, a);
};

export const boqRollup: Reducer<BoqState, BoqRollupResult> = {
  init(params) {
    return { boqId: isObj(params) ? str(params.boqId) : null, lines: 0, priced: 0, total: ZERO, cat: new Map(), parent: new Map() };
  },
  step(s, row) {
    if (!isObj(row)) return;
    if (s.boqId && row.boqId !== s.boqId) return;
    const amount = parseMicros(row.amount);
    s.lines += 1;
    if (amount !== null) { s.priced += 1; s.total += amount; }
    bump(s.cat, str(row.category) ?? "Uncategorised", amount);
    const parent = str(row.parentLineItemId);
    if (parent) bump(s.parent, parent, amount);
  },
  finish(s) {
    const group = (a: Acc) => (a.priced > 0 ? formatMicros(a.sum) : null);
    return {
      lineCount: s.lines,
      pricedLines: s.priced,
      hiddenAmountLines: s.lines - s.priced,
      total: s.priced > 0 ? formatMicros(s.total) : null,
      byCategory: [...s.cat.entries()].sort((a, b) => byText(a[0], b[0])).map(([key, a]) => ({ key, lineCount: a.count, amount: group(a) })),
      byParent: [...s.parent.entries()].sort((a, b) => byText(a[0], b[0])).map(([parentLineItemId, a]) => ({ parentLineItemId, lineCount: a.count, amount: group(a) })),
    };
  },
};

// ── csv_export ─────────────────────────────────────────────────────────────────────────────────────────────
export type CsvExportParams = { kind: string; columns?: string[] };
export type CsvExportResult = { kind: string; rowCount: number; columns: string[]; csv: string };
export const MAX_CSV_COLUMNS = 50;

/** One CSV cell: quoted when needed, quotes doubled, and a text that a spreadsheet would run as a formula is defused. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" || typeof v === "bigint" ? String(v) : JSON.stringify(v);
  if (typeof v === "string" && /^([=+@\t\r]|-(?![\d.]))/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type CsvState = { kind: string; columns: string[] | null; rows: Obj[] };
export const csvExport: Reducer<CsvState, CsvExportResult> = {
  init(params) {
    const p = isObj(params) ? params : {};
    const cols = Array.isArray(p.columns) ? p.columns.filter((c): c is string => typeof c === "string" && c.length > 0).slice(0, MAX_CSV_COLUMNS) : null;
    return { kind: str(p.kind) ?? "", columns: cols && cols.length > 0 ? cols : null, rows: [] };
  },
  step(s, row) {
    if (isObj(row)) s.rows.push(row);
  },
  finish(s) {
    let columns = s.columns;
    if (!columns) {
      const seen = new Set<string>();
      for (const r of s.rows) for (const k of Object.keys(r)) seen.add(k);
      columns = [...seen].sort(byText).slice(0, MAX_CSV_COLUMNS);
    }
    // stable row order whatever order the local database listed them in
    const rows = [...s.rows].sort((a, b) => byText(String(a.id ?? ""), String(b.id ?? "")) || byText(JSON.stringify(a), JSON.stringify(b)));
    const lines = [columns.map(csvCell).join(","), ...rows.map((r) => columns!.map((c) => csvCell(r[c])).join(","))];
    return { kind: s.kind, rowCount: rows.length, columns, csv: lines.join("\r\n") + "\r\n" };
  },
};

// ── report_preview ─────────────────────────────────────────────────────────────────────────────────────────
export type ReportPreviewParams = { kind: string; sampleSize?: number };
export type ReportPreviewResult = {
  kind: string;
  rowCount: number;
  columns: Array<{ name: string; filled: number }>;
  statusCounts: Array<{ status: string; count: number }>;
  sample: Obj[];
};
export const MAX_PREVIEW_SAMPLE = 50;
type PreviewState = { kind: string; sample: number; count: number; filled: Map<string, number>; status: Map<string, number>; rows: Obj[] };
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

export const reportPreview: Reducer<PreviewState, ReportPreviewResult> = {
  init(params) {
    const p = isObj(params) ? params : {};
    const n = typeof p.sampleSize === "number" && Number.isInteger(p.sampleSize) ? Math.min(Math.max(p.sampleSize, 0), MAX_PREVIEW_SAMPLE) : 10;
    return { kind: str(p.kind) ?? "", sample: n, count: 0, filled: new Map(), status: new Map(), rows: [] };
  },
  step(s, row) {
    if (!isObj(row)) return;
    s.count += 1;
    for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined && v !== "") s.filled.set(k, (s.filled.get(k) ?? 0) + 1);
    const st = str(row.status);
    if (st) s.status.set(st, (s.status.get(st) ?? 0) + 1);
    s.rows.push(row);
  },
  finish(s) {
    const sample = [...s.rows].sort((a, b) => byText(String(a.id ?? ""), String(b.id ?? ""))).slice(0, s.sample)
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => isScalar(v)).sort((a, b) => byText(a[0], b[0]))));
    return {
      kind: s.kind,
      rowCount: s.count,
      columns: [...s.filled.entries()].sort((a, b) => byText(a[0], b[0])).map(([name, filled]) => ({ name, filled })),
      statusCounts: [...s.status.entries()].sort((a, b) => byText(a[0], b[0])).map(([status, count]) => ({ status, count })),
      sample,
    };
  },
};

// ── search_index ───────────────────────────────────────────────────────────────────────────────────────────
/** Input rows for this type are `{ kind, row }` so one index can span several kinds of a project. */
export type SearchDoc = { kind: string; id: string; title: string };
export type SearchIndexResult = { docCount: number; tokenCount: number; docs: SearchDoc[]; postings: Array<[string, number[]]> };
const TITLE_FIELDS = ["title", "name", "subject", "code", "itemCode"];
const BODY_FIELDS = ["description", "details", "body", "notes", "summary"];
const MAX_TOKENS_PER_DOC = 200;
const STOP = new Set(["the", "and", "for", "with", "of", "to", "in", "on", "an", "is", "at", "by", "or"]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t));
}
const firstText = (o: Obj, fields: string[]) => fields.map((f) => str(o[f])).filter((x): x is string => x !== null);

type IndexState = { docs: SearchDoc[]; post: Map<string, number[]> };
export const searchIndex: Reducer<IndexState, SearchIndexResult> = {
  init() {
    return { docs: [], post: new Map() };
  },
  step(s, entry) {
    if (!isObj(entry) || !isObj(entry.row)) return;
    const kind = str(entry.kind);
    const id = str(entry.row.id);
    if (!kind || !id) return;
    const titles = firstText(entry.row, TITLE_FIELDS);
    const bodies = firstText(entry.row, BODY_FIELDS);
    const tokens = new Set(tokenize([...titles, ...bodies].join(" ")).slice(0, MAX_TOKENS_PER_DOC));
    if (tokens.size === 0) return;
    const docIndex = s.docs.length;
    s.docs.push({ kind, id, title: titles[0] ?? bodies[0] ?? id });
    for (const t of tokens) {
      const list = s.post.get(t);
      if (list) list.push(docIndex); else s.post.set(t, [docIndex]);
    }
  },
  finish(s) {
    // docs sorted by (kind, id) and postings renumbered so the answer never depends on the order rows arrived in
    const order = s.docs.map((d, i) => i).sort((a, b) => byText(`${s.docs[a].kind}\u0000${s.docs[a].id}`, `${s.docs[b].kind}\u0000${s.docs[b].id}`));
    const rank = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
    return {
      docCount: s.docs.length,
      tokenCount: s.post.size,
      docs: order.map((i) => s.docs[i]),
      postings: [...s.post.entries()].sort((a, b) => byText(a[0], b[0])).map(([t, list]) => [t, list.map((i) => rank.get(i)!).sort((a, b) => a - b)] as [string, number[]]),
    };
  },
};

/** Looks a query up in a finished index: every word must match (a prefix is enough). */
export function searchIndexQuery(index: SearchIndexResult, query: string): SearchDoc[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  let hits: Set<number> | null = null as Set<number> | null;
  for (const w of words) {
    const these = new Set<number>();
    for (const [token, list] of index.postings) if (token.startsWith(w)) for (const d of list) these.add(d);
    hits = hits === null ? these : new Set(Array.from(hits).filter((d) => these.has(d)));
  }
  return [...(hits ?? [])].sort((a, b) => a - b).map((i) => index.docs[i]);
}

// ── registry + the sliced runner ───────────────────────────────────────────────────────────────────────────
export class UnknownJobTypeError extends Error {
  constructor(type: unknown) {
    super(`Unknown job type: ${String(type)}`);
    this.name = "UnknownJobTypeError";
  }
}

const REDUCERS: Record<JobType, Reducer<any, unknown>> = { boq_rollup: boqRollup, csv_export: csvExport, report_preview: reportPreview, search_index: searchIndex };

export function reducerFor(type: unknown): Reducer<unknown, unknown> {
  if (!isJobType(type)) throw new UnknownJobTypeError(type);
  return REDUCERS[type];
}

export type SliceOptions = {
  /** Longest stretch of work between two yields. The owner's rule is 50 ms on the main thread. */
  budgetMs?: number;
  now?: () => number;
  /** Gives the thread back (default: a macrotask, so input and paint can run). */
  yieldFn?: () => Promise<void>;
  /** Rows between two looks at the clock. */
  checkEvery?: number;
  /** True once the caller no longer wants the answer (lease lost, opted out): the run stops and throws. */
  shouldStop?: () => boolean;
};

export const DEFAULT_SLICE_BUDGET_MS = 50;
const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const defaultNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class JobCancelledError extends Error {
  constructor() {
    super("The job was cancelled.");
    this.name = "JobCancelledError";
  }
}

/** Runs a reducer over `rows` in slices of at most `budgetMs`, yielding between slices. */
export async function runReducer<S, R>(def: Reducer<S, R>, rows: readonly unknown[], params: unknown, options: SliceOptions = {}): Promise<R> {
  const budget = options.budgetMs ?? DEFAULT_SLICE_BUDGET_MS;
  const now = options.now ?? defaultNow;
  const yieldFn = options.yieldFn ?? defaultYield;
  const every = Math.max(1, options.checkEvery ?? 16);
  const state = def.init(params);
  let sliceStart = now();
  for (let i = 0; i < rows.length; i++) {
    def.step(state, rows[i]);
    if ((i + 1) % every === 0 && now() - sliceStart >= budget) {
      await yieldFn();
      if (options.shouldStop?.()) throw new JobCancelledError();
      sliceStart = now();
    }
  }
  if (options.shouldStop?.()) throw new JobCancelledError();
  return def.finish(state);
}

/** Computes a job's answer. The same call is the requester's local fallback and the claimant's worker body. */
export async function computeJob(type: unknown, rows: readonly unknown[], params: unknown, options: SliceOptions = {}): Promise<unknown> {
  return runReducer(reducerFor(type), rows, params, options);
}
