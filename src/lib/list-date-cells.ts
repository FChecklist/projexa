// UAT 2026-10-12: the shared kit's ListScreen formats a `type: "date"` column with `d.toLocaleDateString()` and no arguments -- the runtime's own
// locale, which is the deployment's on the server pass and the visitor's in the browser. Result: a hydration error on the Permits list
// ("1/10/2026" on the server, "10/1/2026" in the browser: the same day written two ways) and a date a person can read as the wrong month.
// WorkProgressListClient already solved this with renderCell (D-74); this does it once for every list that passes registry columns, so a
// column the registry adds later is covered too. The raw ISO value stays in the row, so the kit's sort still orders by date.
import { formatDate } from "@/lib/format-date";

type ColumnLike = { field: string; type?: string };

/** What a date cell shows: the app's one fixed format; empty -> an en dash; text that is not a date is shown as it is. */
export function formatListDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value !== "string" && typeof value !== "number") return String(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : formatDate(d);
}

/**
 * UAT 2026-10-13 (F58): the kit's FormSection shows a `type: "date"` field in DISPLAY mode with `toLocaleDateString()` too ("10/1/2026", month first,
 * the runtime's locale), so the permit detail read differently from the permits list. In display mode a date column is shown as plain text carrying
 * the house form (dd-mm-yyyy); in edit mode the columns and values are returned untouched, so the date picker keeps its ISO value.
 */
export function houseDateDisplay<C extends ColumnLike>(columns: readonly C[], values: Record<string, unknown>, mode: "display" | "edit"): { columns: C[]; values: Record<string, unknown> } {
  if (mode !== "display") return { columns: [...columns], values };
  const shown: Record<string, unknown> = { ...values };
  const out = columns.map((c) => {
    if (c.type !== "date") return c;
    shown[c.field] = formatListDate(values[c.field]);
    return { ...c, type: "text" };
  });
  return { columns: out, values: shown };
}

/** One renderCell entry per `type: "date"` column. */
export function dateCellRenderers(columns: readonly ColumnLike[]): Record<string, (row: Record<string, unknown>) => string> {
  const out: Record<string, (row: Record<string, unknown>) => string> = {};
  for (const c of columns) {
    if (c.type === "date") out[c.field] = (row) => formatListDate(row[c.field]);
  }
  return out;
}
