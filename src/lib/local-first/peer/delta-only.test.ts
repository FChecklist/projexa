import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createTestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop, type Laptop } from "./__fixtures__/laptop";

// DELTA-ONLY, path 4 (docs/local-first/DELTA_ONLY.md): laptop <-> laptop. Two laptops that already hold the same data exchange only the
// rows that are newer on one side. We tap the link and count the rows that travel (`items` messages) and the bytes they cost.
// Run: bun test --isolate src/lib/local-first/peer/delta-only.test.ts

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";
const T2 = "2026-10-02T09:00:00Z";
const base = { org: "org-1", view: "view-pm", nowMs: NOW };
const KINDS = ["tasks", "rfis", "boq_lines"];
const PER_KIND = 60;
const BODY = "x".repeat(300); // a row body of a realistic size, so "no bodies sent" is a byte difference, not a rounding error

type Tap = { rowsSent: number; itemBytes: number; wantKnownIds: number; wantsFor: string[]; messages: number; haveOnly: boolean };
const newTap = (): Tap => ({ rowsSent: 0, itemBytes: 0, wantKnownIds: 0, wantsFor: [], messages: 0, haveOnly: true });

/** Both directions are tapped into one counter: what the pair moved in total during this connection. */
function tapInto(t: Tap) {
  return (text: string) => {
    t.messages += 1;
    const m = JSON.parse(text) as { t: string; rows?: unknown[]; known?: unknown[]; kind?: string };
    if (m.t === "items") { t.rowsSent += m.rows?.length ?? 0; t.itemBytes += text.length; t.haveOnly = false; }
    if (m.t === "want") { t.wantKnownIds += m.known?.length ?? 0; if (m.kind) t.wantsFor.push(m.kind); }
    return text;
  };
}

async function twoWithSameData() {
  const signer = await createTestSigner();
  const A = await makeLaptop(signer, { ...base, userId: "ua", projects: ["p1"] });
  const B = await makeLaptop(signer, { ...base, userId: "ub", projects: ["p1"] });
  for (const L of [A, B]) {
    for (const kind of KINDS) for (let i = 0; i < PER_KIND; i += 1) {
      await L.seed({ project: "p1", kind, id: `${kind}-${String(i).padStart(3, "0")}`, version: 1, updated_at: T1, data: { body: BODY, n: i } });
    }
  }
  return { A, B };
}

async function connectTapped(A: Laptop, B: Laptop) {
  const tap = newTap();
  const t = tapInto(tap);
  const pair = await connect(A, B, { nowMs: NOW, tapAtoB: t, tapBtoA: t });
  return { tap, pair };
}

describe("laptop <-> laptop moves only what is newer", () => {
  setDefaultTimeout(60_000); // seeding two laptops with a few hundred signed rows is slow on a busy machine
  test("two laptops holding the same data: connecting sends ZERO rows and no row body at all", async () => {
    const { A, B } = await twoWithSameData();
    const { tap } = await connectTapped(A, B);
    expect(tap.rowsSent).toBe(0);
    expect(tap.itemBytes).toBe(0);
    expect(tap.wantsFor).toEqual([]); // equal digests: not even a request for a kind
    expect(tap.messages).toBeLessThan(10); // hello + have, both ways, and the goodbyes
  });

  test("one row edited on A (version 2): exactly that one row crosses; the other 179 rows and the other two kinds are not touched", async () => {
    const { A, B } = await twoWithSameData();
    await A.seed({ project: "p1", kind: "rfis", id: "rfis-007", version: 2, updated_at: T2, data: { body: BODY, n: 7, answer: "yes" } });
    const { tap } = await connectTapped(A, B);
    expect(tap.rowsSent).toBe(1);
    expect([...new Set(tap.wantsFor)]).toEqual(["rfis"]); // the digest of tasks and boq_lines matched: no want for them
    const full = 3 * PER_KIND * (BODY.length + 120);
    expect(tap.itemBytes).toBeLessThan(BODY.length * 3); // about one row, nowhere near the 360-row project
    expect(tap.itemBytes).toBeLessThan(full / 50);
    expect((await B.get("rfis", "rfis-007"))?.serverVersion).toBe(2);
  });

  test("a reconnect right after: the other side already has it, so nothing is sent again", async () => {
    const { A, B } = await twoWithSameData();
    await A.seed({ project: "p1", kind: "tasks", id: "tasks-001", version: 2, updated_at: T2, data: { body: BODY, n: 1, edited: true } });
    await connectTapped(A, B);
    const again = await connectTapped(A, B);
    expect(again.tap.rowsSent).toBe(0);
    expect(again.tap.wantsFor).toEqual([]);
  });

  test("changes on BOTH sides: each row crosses once, in one direction, and both end up equal", async () => {
    const { A, B } = await twoWithSameData();
    await A.seed({ project: "p1", kind: "tasks", id: "tasks-010", version: 2, updated_at: T2, data: { body: BODY, side: "A" } });
    await B.seed({ project: "p1", kind: "boq_lines", id: "boq_lines-020", version: 2, updated_at: T2, data: { body: BODY, side: "B" } });
    const { tap } = await connectTapped(A, B);
    expect(tap.rowsSent).toBe(2);
    expect((await B.get("tasks", "tasks-010"))?.serverVersion).toBe(2);
    expect((await A.get("boq_lines", "boq_lines-020"))?.serverVersion).toBe(2);
  });

  test("what a changed kind costs to compare is ids and versions only: no row body is ever in a `want`", async () => {
    const { A, B } = await twoWithSameData();
    await A.seed({ project: "p1", kind: "rfis", id: "rfis-001", version: 2, updated_at: T2, data: { body: BODY, n: 1, changed: true } });
    const wants: string[] = [];
    const t = tapInto(newTap());
    await connect(A, B, { nowMs: NOW, tapAtoB: (x) => { if (JSON.parse(x).t === "want") wants.push(x); return t(x); }, tapBtoA: (x) => { if (JSON.parse(x).t === "want") wants.push(x); return t(x); } });
    expect(wants.length).toBeGreaterThan(0);
    for (const w of wants) expect(w).not.toContain(BODY);
  });
});
