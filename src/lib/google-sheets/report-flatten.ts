// Flattens one report's JSON response into a 2D grid of strings for writing
// into a sheet. Report shapes are genuinely arbitrary across the 17 known
// report names (confirmed by reading the other repo's routes) -- the only
// place in the product that already normalizes all of them generically is
// src/components/ReportsClient.tsx's <ReportOutput>, so this replicates its
// same dispatch (array -> columns from the first row's keys; object ->
// scalar key/value grid + recurse into nested arrays/objects; primitive ->
// a bare cell) rather than assuming one canonical shape.

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenArray(rows: unknown[]): string[][] {
  if (rows.length === 0) return [["(no rows)"]];
  const first = rows[0];
  if (!isPlainObject(first)) return rows.map((r) => [cellText(r)]);
  const columns = Object.keys(first);
  const grid: string[][] = [columns];
  for (const row of rows) {
    if (!isPlainObject(row)) {
      grid.push([cellText(row)]);
      continue;
    }
    grid.push(columns.map((c) => cellText(row[c])));
  }
  return grid;
}

function flattenObject(obj: Record<string, unknown>): string[][] {
  const scalarRows: string[][] = [];
  const nestedGrids: string[][] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      nestedGrids.push([key]);
      nestedGrids.push(...flattenArray(value));
      nestedGrids.push([]);
    } else if (isPlainObject(value)) {
      nestedGrids.push([key]);
      nestedGrids.push(...flattenObject(value));
      nestedGrids.push([]);
    } else {
      scalarRows.push([key, cellText(value)]);
    }
  }
  return [...scalarRows, [], ...nestedGrids];
}

// Returns rows ready to write starting at some cell; a title row is
// prepended when `title` is given so multiple reports can be stacked in one
// tab (see the Analysis tab, which stacks several fixed report names).
export function flattenReportToGrid(data: unknown, title?: string): string[][] {
  let body: string[][];
  if (Array.isArray(data)) body = flattenArray(data);
  else if (isPlainObject(data)) body = flattenObject(data);
  else body = [[cellText(data)]];

  return title ? [[`### ${title}`], ...body] : body;
}
