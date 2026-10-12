import { describe, expect, test } from "bun:test";
import { dateCellRenderers, formatListDate } from "./list-date-cells";

describe("list date cells", () => {
  test("one fixed format, whatever the runtime locale", () => {
    expect(formatListDate("2026-10-01")).toBe("10/1/2026");
    expect(formatListDate("2026-10-01T23:30:00Z")).toBe("10/1/2026");
  });
  test("empty is an en dash; text that is not a date is shown as it is", () => {
    expect(formatListDate(null)).toBe("–");
    expect(formatListDate("")).toBe("–");
    expect(formatListDate("TBC")).toBe("TBC");
  });
  test("only date columns get a renderer, and it reads that column's own field", () => {
    const r = dateCellRenderers([{ field: "endDate", type: "date" }, { field: "name", type: "text" }, { field: "issueDate", type: "date" }]);
    expect(Object.keys(r).sort()).toEqual(["endDate", "issueDate"]);
    expect(r.endDate!({ endDate: "2026-11-30", issueDate: "2026-01-02" })).toBe("11/30/2026");
    expect(r.issueDate!({ endDate: "2026-11-30", issueDate: "2026-01-02" })).toBe("1/2/2026");
  });
});

describe("never the runtime's own locale", () => {
  test("a runtime whose default locale writes day-first still gets the fixed format", () => {
    const original = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (this: Date, locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return locale === undefined ? "01/10/2026" : original.call(this, locale, options);
    } as typeof Date.prototype.toLocaleDateString;
    try {
      expect(formatListDate("2026-10-01")).toBe("10/1/2026");
    } finally {
      Date.prototype.toLocaleDateString = original;
    }
  });
});

describe("every list that uses the kit's ListScreen routes its date columns through renderCell", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  for (const [file, arg] of [["PermitsListClient.tsx", "columns"], ["BudgetsClient.tsx", "columns"], ["ProjectsListClient.tsx", "COLUMNS"]] as const) {
    test(file, () => {
      const src = readFileSync(join(import.meta.dir, "..", "components", file), "utf8");
      expect(src).toContain(`...dateCellRenderers(${arg})`);
    });
  }
});
