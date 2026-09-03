/// <reference types="bun-types" />
// R67 D-23. Pins the grouping and signage rules the BOQ list depends on --
// which row is a lineage root, the Rev{version-1} numbering the customer
// counts in, and which revision is "Current".
//
// The signed-variation and status-chip rules this file also used to pin are
// gone with the helpers themselves: WS-G's format-money.ts and
// ui/status-pill.tsx own them product-wide and carry their own tests.
import { describe, expect, test } from "bun:test";
import {
  buildLineageRows,
  resolveCurrentId,
  resolveRootId,
  revisionLabel,
  type LineageBoq,
} from "./boq-lineage";

function boq(partial: Partial<LineageBoq> & { id: string; version: number }): LineageBoq {
  return {
    title: `BOQ ${partial.id}`,
    status: "draft",
    parentBoqId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("revisionLabel", () => {
  test("the backend's version 1 (the original) is the customer's Rev0", () => {
    expect(revisionLabel(1)).toBe("Rev0");
    expect(revisionLabel(2)).toBe("Rev1");
    expect(revisionLabel(3)).toBe("Rev2");
  });

  test("never renders a negative revision, whatever the row carries", () => {
    expect(revisionLabel(0)).toBe("Rev0");
    expect(revisionLabel(Number.NaN)).toBe("Rev0");
  });
});

describe("buildLineageRows", () => {
  const original = boq({ id: "a0", version: 1, title: "Villa 21 Fit-out", createdAt: "2026-08-01T00:00:00.000Z", status: "superseded" });
  const rev1 = boq({ id: "a1", version: 2, title: "Villa 21 Fit-out", parentBoqId: "a0", createdAt: "2026-08-10T00:00:00.000Z", status: "superseded" });
  const rev2 = boq({ id: "a2", version: 3, title: "Villa 21 Fit-out", parentBoqId: "a1", createdAt: "2026-08-28T00:00:00.000Z", status: "approved" });
  const otherRoot = boq({ id: "b0", version: 1, title: "Villa 21 MEP", createdAt: "2026-08-20T00:00:00.000Z" });

  test("orders one lineage root-first, revisions ascending -- Rev0, Rev1, Rev2", () => {
    // Deliberately fed in the backend's own version-DESC order, which is what
    // made three revisions read as three unrelated rows.
    const rows = buildLineageRows([rev2, rev1, original]);
    expect(rows.map((r) => r.revLabel)).toEqual(["Rev0", "Rev1", "Rev2"]);
    expect(rows.map((r) => r.boq.id)).toEqual(["a0", "a1", "a2"]);
  });

  test("indents revisions under their root and marks only the root as depth 0", () => {
    const rows = buildLineageRows([original, rev1, rev2]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(rows.map((r) => r.isRoot)).toEqual([true, false, false]);
    expect(rows.every((r) => r.rootId === "a0")).toBe(true);
  });

  test("keeps two interleaved lineages apart, newest lineage first", () => {
    const rows = buildLineageRows([rev1, otherRoot, rev2, original]);
    expect(rows.map((r) => r.boq.id)).toEqual(["b0", "a0", "a1", "a2"]);
  });

  test("tags the latest APPROVED revision as Current", () => {
    const rows = buildLineageRows([original, rev1, rev2]);
    expect(rows.filter((r) => r.isCurrent).map((r) => r.boq.id)).toEqual(["a2"]);
  });

  test("with nothing approved, the latest revision is Current", () => {
    const draftRev2 = { ...rev2, status: "draft" };
    const rows = buildLineageRows([original, rev1, draftRev2]);
    expect(rows.filter((r) => r.isCurrent).map((r) => r.boq.id)).toEqual(["a2"]);
  });

  test("a revision whose parent is not in the list still renders, as its own root", () => {
    const orphan = boq({ id: "z9", version: 4, parentBoqId: "not-loaded" });
    const rows = buildLineageRows([orphan]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isRoot).toBe(true);
    expect(rows[0].revLabel).toBe("Rev3");
  });

  test("a self-referencing row does not hang the walk", () => {
    const cyclic = boq({ id: "c1", version: 2, parentBoqId: "c1" });
    expect(resolveRootId(cyclic, new Map([["c1", cyclic]]))).toBe("c1");
  });

  test("an empty list produces no rows", () => {
    expect(buildLineageRows([])).toEqual([]);
  });
});

describe("resolveCurrentId", () => {
  test("returns null for an empty lineage", () => {
    expect(resolveCurrentId([])).toBeNull();
  });

  test("prefers a lower-numbered APPROVED revision over a higher-numbered draft", () => {
    const members = [
      boq({ id: "r0", version: 1, status: "superseded" }),
      boq({ id: "r1", version: 2, status: "approved" }),
      boq({ id: "r2", version: 3, status: "draft" }),
    ];
    expect(resolveCurrentId(members)).toBe("r1");
  });
});
