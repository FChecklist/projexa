import { describe, expect, test } from "bun:test";
import { createTestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop } from "./__fixtures__/laptop";

// Two simulated laptops (separate fake-IndexedDB databases) talking over the in-memory transport: CONTRACT.md section 4.

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";
const T2 = "2026-10-02T09:00:00Z";
const base = { org: "org-1", view: "view-pm", nowMs: NOW };

async function two(o: { aProjects?: string[]; bProjects?: string[]; bOrg?: string; bView?: string; bExp?: number } = {}) {
  const signer = await createTestSigner();
  const A = await makeLaptop(signer, { ...base, userId: "ua", projects: o.aProjects ?? ["p1", "p2"] });
  const B = await makeLaptop(signer, { ...base, userId: "ub", org: o.bOrg ?? base.org, view: o.bView ?? base.view, projects: o.bProjects ?? ["p1", "p2"], exp: o.bExp });
  return { signer, A, B };
}

describe("hello: who may talk at all", () => {
  test("same org + same view class: verified both ways, rows flow", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: { subject: "Door" } });
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.a.state).toBe("verified");
    expect(s.b.state).toBe("verified");
    expect((await B.get("rfis", "r1"))?.data).toEqual({ subject: "Door" });
    expect((await B.get("rfis", "r1"))?.serverVersion).toBe(2);
  });

  test("a peer of another organisation is refused and receives NOTHING of ours", async () => {
    const { A, B } = await two({ bOrg: "org-2" });
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: { subject: "Secret" } });
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.refusedA).toContain("wrong_org");
    expect(s.a.state).toBe("closed");
    expect(await B.get("rfis", "r1")).toBeUndefined();
    expect(s.a.stats.sent).toBe(0);
  });

  test("a peer of another view class (role redaction) is refused and receives nothing", async () => {
    const { A, B } = await two({ bView: "view-site" });
    await A.seed({ project: "p1", kind: "boq_lines", id: "l1", version: 1, updated_at: T1, data: { rate: 120 } });
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.refusedA).toContain("wrong_view");
    expect(await B.get("boq_lines", "l1")).toBeUndefined();
    expect(s.a.stats.sent).toBe(0);
  });

  test("an expired attestation is refused", async () => {
    const { A, B } = await two({ bExp: Math.floor(NOW / 1000) - 1 });
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: {} });
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.refusedA).toContain("expired");
    expect(await B.get("rfis", "r1")).toBeUndefined();
  });

  test("before a verified hello nothing is processed: an unsolicited items message is ignored", async () => {
    const { signer, A, B } = await two();
    const forged = await signer.row("org-1", { project: "p1", kind: "rfis", id: "rx", version: 9, updated_at: T1, data: {} });
    // B's own hello is swallowed; it sends items straight away
    const s = await connect(A, B, { nowMs: NOW, tapBtoA: (t) => (JSON.parse(t).t === "hello" ? JSON.stringify({ t: "items", rows: [forged] }) : t) });
    expect(await A.get("rfis", "rx")).toBeUndefined();
    expect(s.a.peer).toBeNull();
  });
});

describe("rows: what a receiver accepts", () => {
  test("a tampered row is refused (signature)", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: { subject: "Door" } });
    const s = await connect(A, B, {
      nowMs: NOW,
      tapAtoB: (t) => {
        const m = JSON.parse(t);
        if (m.t === "items") for (const r of m.rows) r.data = { subject: "Window" };
        return JSON.stringify(m);
      },
    });
    expect(await B.get("rfis", "r1")).toBeUndefined();
    expect(s.b.stats.rejected.bad_signature).toBe(1);
  });

  test("a row for a project not in BOTH tokens is refused, even when validly signed", async () => {
    const { signer, A, B } = await two({ aProjects: ["p1", "p2"], bProjects: ["p1"] });
    await A.seed({ project: "p2", kind: "rfis", id: "r2", version: 1, updated_at: T1, data: {} });
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: T1, data: {} });
    const p2row = await signer.row("org-1", { project: "p2", kind: "rfis", id: "r9", version: 1, updated_at: T1, data: {} });
    const s = await connect(A, B, {
      nowMs: NOW,
      tapAtoB: (t) => {
        const m = JSON.parse(t);
        if (m.t === "items") m.rows.push(p2row); // A misbehaves and pushes a p2 row
        return JSON.stringify(m);
      },
    });
    expect(await B.get("rfis", "r1")).toBeDefined();
    expect(await B.get("rfis", "r2")).toBeUndefined();
    expect(await B.get("rfis", "r9")).toBeUndefined();
    expect(s.b.stats.rejected.not_shared).toBe(1);
  });

  test("an older or equal version is ignored; a newer one replaces", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "old", version: 2, updated_at: T1, data: { v: "A2" } });
    await B.seed({ project: "p1", kind: "rfis", id: "old", version: 5, updated_at: T2, data: { v: "B5" } });
    await A.seed({ project: "p1", kind: "rfis", id: "new", version: 7, updated_at: T2, data: { v: "A7" } });
    await B.seed({ project: "p1", kind: "rfis", id: "new", version: 6, updated_at: T1, data: { v: "B6" } });
    await connect(A, B, { nowMs: NOW });
    expect((await B.get("rfis", "old"))?.data).toEqual({ v: "B5" });
    expect((await A.get("rfis", "old"))?.data).toEqual({ v: "B5" }); // A learnt the newer one from B
    expect((await B.get("rfis", "new"))?.data).toEqual({ v: "A7" });
  });

  test("an older version pushed anyway by a misbehaving peer is rejected as not_newer", async () => {
    const { signer, A, B } = await two();
    await B.seed({ project: "p1", kind: "rfis", id: "r1", version: 5, updated_at: T2, data: { v: "B5" } });
    await A.seed({ project: "p1", kind: "rfis", id: "other", version: 1, updated_at: T1, data: {} });
    const stale = await signer.row("org-1", { project: "p1", kind: "rfis", id: "r1", version: 3, updated_at: T1, data: { v: "A3" } });
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => { const m = JSON.parse(t); if (m.t === "items") m.rows.push(stale); return JSON.stringify(m); } });
    expect((await B.get("rfis", "r1"))?.data).toEqual({ v: "B5" });
    expect(s.b.stats.rejected.not_newer).toBe(1);
  });

  test("a tombstone is never accepted from a peer", async () => {
    const { signer, A, B } = await two();
    await B.seed({ project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: T1, data: {} });
    await A.seed({ project: "p1", kind: "rfis", id: "x", version: 1, updated_at: T1, data: {} });
    const del = { ...(await signer.row("org-1", { project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T2, data: {} })), deleted: true };
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => { const m = JSON.parse(t); if (m.t === "items") m.rows.push(del); return JSON.stringify(m); } });
    expect(await B.get("rfis", "r1")).toBeDefined();
    expect((await B.get("rfis", "r1"))?.serverVersion).toBe(1);
    expect(s.b.stats.rejected.tombstone).toBe(1);
  });

  test("a dirty row is never overwritten by a peer", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 9, updated_at: T2, data: { v: "server9" } });
    await B.seed({ project: "p1", kind: "rfis", id: "r1", version: 3, updated_at: T1, data: { v: "my edit" } }, { dirty: "op-1" });
    const s = await connect(A, B, { nowMs: NOW });
    const row = await B.get("rfis", "r1");
    expect(row?.data).toEqual({ v: "my edit" });
    expect(row?.dirty).toBe("op-1");
    expect(row?.serverVersion).toBe(3);
    expect(s.b.stats.rejected.dirty).toBe(1);
  });
});

describe("rows: what a sender hands over", () => {
  test("a dirty row and an unsigned row are never sent", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "dirty", version: 4, updated_at: T1, data: { v: "local edit" } }, { dirty: "op-9" });
    await A.seed({ project: "p1", kind: "rfis", id: "unsigned", version: 4, updated_at: T1, data: {} }, { unsigned: true });
    await A.seed({ project: "p1", kind: "rfis", id: "clean", version: 4, updated_at: T1, data: {} });
    const seen: string[] = [];
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => { const m = JSON.parse(t); if (m.t === "items") for (const r of m.rows) seen.push(r.id); return t; } });
    expect(seen).toEqual(["clean"]);
    expect(await B.get("rfis", "dirty")).toBeUndefined();
    expect(await B.get("rfis", "unsigned")).toBeUndefined();
    expect(s.a.stats.sent).toBe(1);
  });

  test("rows travel in size-capped batches", async () => {
    const { A, B } = await two();
    for (let i = 0; i < 40; i++) await A.seed({ project: "p1", kind: "tasks", id: `t${String(i).padStart(2, "0")}`, version: 1, updated_at: T1, data: { text: "x".repeat(400) } });
    let batches = 0;
    let maxLen = 0;
    await connect(A, B, { nowMs: NOW, a: { maxBatchBytes: 4096 }, tapAtoB: (t) => { if (JSON.parse(t).t === "items") { batches++; maxLen = Math.max(maxLen, t.length); } return t; } });
    expect(batches).toBeGreaterThan(5);
    expect(maxLen).toBeLessThan(4096 + 1024);
    expect((await B.db.listByOrg("org-1", "tasks")).length).toBe(40);
  });
});

describe("convergence", () => {
  test("two laptops starting from different data end up holding the same rows", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "a1", version: 1, updated_at: T1, data: { from: "A" } });
    await A.seed({ project: "p2", kind: "tasks", id: "a2", version: 3, updated_at: T1, data: { from: "A" } });
    await A.seed({ project: "p1", kind: "rfis", id: "both", version: 2, updated_at: T1, data: { from: "A2" } });
    await B.seed({ project: "p1", kind: "rfis", id: "b1", version: 1, updated_at: T1, data: { from: "B" } });
    await B.seed({ project: "p1", kind: "rfis", id: "both", version: 4, updated_at: T2, data: { from: "B4" } });
    await B.seed({ project: "p2", kind: "punch_list", id: "b2", version: 1, updated_at: T1, data: { from: "B" } });
    const s = await connect(A, B, { nowMs: NOW });
    const view = async (L: typeof A) => (await L.db.listByOrg("org-1")).map((r) => `${r.id}@${r.serverVersion}`).sort();
    expect(await view(A)).toEqual(await view(B));
    expect(await view(A)).toEqual(["punch_list:b2@1", "rfis:a1@1", "rfis:b1@1", "rfis:both@4", "tasks:a2@3"]);
    // a second round moves nothing
    const before = s.a.stats.accepted + s.b.stats.accepted;
    await s.a.resync(2000);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.a.stats.accepted + s.b.stats.accepted).toBe(before);
  });

  test("resync picks up a row that arrived (from the server) after the first exchange", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "a1", version: 1, updated_at: T1, data: {} });
    const s = await connect(A, B, { nowMs: NOW });
    await A.seed({ project: "p1", kind: "rfis", id: "late", version: 1, updated_at: T2, data: { late: true } });
    await s.b.resync(2000);
    expect((await B.get("rfis", "late"))?.data).toEqual({ late: true });
  });

  test("an oversized or garbage message ends the session", async () => {
    const { A, B } = await two();
    await A.seed({ project: "p1", kind: "rfis", id: "a1", version: 1, updated_at: T1, data: {} });
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => (JSON.parse(t).t === "have" ? "{not json" : t) });
    expect(s.b.state).toBe("closed");
    expect(s.refusedB).toContain("protocol");
  });
});
