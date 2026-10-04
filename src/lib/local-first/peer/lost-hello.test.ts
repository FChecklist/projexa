import { describe, expect, test } from "bun:test";
import { createTestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop } from "./__fixtures__/laptop";
import { MAX_HELLO_RESENDS } from "./protocol";

// lf-e9, found by the real-browser peer e2e (e2e/lf-peer-versions.spec.ts, ~1 run in 3 in Chromium): the ANSWERING laptop's hello can be
// lost when it is sent the instant its data channel opens. The other laptop then never verifies it, drops its `have` (nothing but hello is
// read from an unverified peer) and never asks for anything; the answering side has verified and waits too. Both sit on a half-open session
// and the rows never move. Here the loss is reproduced on the in-memory transport by dropping B's first hello.

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";

async function two() {
  const signer = await createTestSigner();
  const A = await makeLaptop(signer, { org: "o1", view: "v1", nowMs: NOW, userId: "ua", projects: ["p1"] });
  const B = await makeLaptop(signer, { org: "o1", view: "v1", nowMs: NOW, userId: "ub", projects: ["p1"] });
  await B.seed({ project: "p1", kind: "tasks", id: "only-b", version: 2, updated_at: T1, data: { title: "Scaffold" } });
  return { A, B };
}

describe("a lost hello is asked for again", () => {
  test("B's first hello is lost: A asks once, B answers, both verify and B's row reaches A", async () => {
    const { A, B } = await two();
    let dropped = 0;
    const s = await connect(A, B, { nowMs: NOW, tapBtoA: (t) => (dropped === 0 && t.startsWith('{"t":"hello"') ? (dropped++, null) : t) });
    await new Promise((r) => setTimeout(r, 100));
    expect(dropped).toBe(1);
    expect(s.a.state).toBe("verified");
    expect(s.b.state).toBe("verified");
    expect((await A.get("tasks", "only-b"))?.serverVersion).toBe(2);
  });

  test("never a loop: a peer whose hellos are ALL lost is asked a bounded number of times", async () => {
    const { A, B } = await two();
    const asks: string[] = [];
    await connect(A, B, {
      nowMs: NOW,
      tapAtoB: (t) => { if (t.includes('"ask":true')) asks.push(t); return t; },
      tapBtoA: (t) => (t.startsWith('{"t":"hello"') ? null : t),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.length).toBeLessThanOrEqual(MAX_HELLO_RESENDS);
    expect(await A.get("tasks", "only-b")).toBeUndefined(); // still nothing is read from a peer that never proved who it is
  });
});
