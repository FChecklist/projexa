import { describe, expect, test } from "bun:test";
import { createFakeNtfy, createFakeRealtime } from "./__fixtures__/fake-signalling";
import { MAX_SIGNAL_BYTES, broadcastChannelProvider, connectFirst, createSignalHub, ntfyProvider, ntfyTopic, supabaseRealtimeProvider, type SignalEnvelope, type SignalProvider } from "./signalling";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("provider race", () => {
  test("Supabase down -> the ntfy path is chosen", async () => {
    const rt = createFakeRealtime({ down: true });
    const nt = createFakeNtfy();
    const c = await connectFirst([supabaseRealtimeProvider(rt.client), ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl })], "chan1", "me");
    expect(c.name).toBe("ntfy");
    c.close();
  });
  test("both up: the first that connects wins and the loser is closed", async () => {
    const rt = createFakeRealtime({ delayMs: 1 });
    const nt = createFakeNtfy();
    const c = await connectFirst([supabaseRealtimeProvider(rt.client), ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl })], "chan1", "me");
    expect(c.name).toBe("supabase");
    await tick();
    expect([...(nt.subs.values())].reduce((n, s) => n + s.size, 0)).toBe(0); // the ntfy subscription was closed
  });
  test("everything down: rejects (the laptop keeps using the server, or nothing)", async () => {
    const rt = createFakeRealtime({ down: true });
    const nt = createFakeNtfy({ down: true });
    // bounded: a race that never settles must fail this test, not hang it
    const outcome = await Promise.race([
      connectFirst([supabaseRealtimeProvider(rt.client), ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl })], "c", "me").then(() => "connected", () => "rejected"),
      new Promise((r) => setTimeout(() => r("hung"), 500)),
    ]);
    expect(outcome).toBe("rejected");
  });
});

describe("ntfy fallback", () => {
  test("the topic is derived, not the channel; messages on the wire are encrypted; peers decrypt them", async () => {
    const nt = createFakeNtfy();
    const p = ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl });
    const a = await p.connect("secret-channel", "a");
    const b = await p.connect("secret-channel", "b");
    const got: SignalEnvelope[] = [];
    b.onmessage = (m) => got.push(m);
    a.send({ id: "m1", from: "a", kind: "announce" });
    await tick();
    expect(got.map((m) => m.id)).toEqual(["m1"]);
    expect(nt.state.posts[0].url).toBe(`https://ntfy.sh/${await ntfyTopic("secret-channel")}`);
    expect(nt.state.posts[0].url).not.toContain("secret-channel");
    expect(nt.state.posts[0].body).not.toContain("announce");
    // another channel's key cannot read it
    const c = await p.connect("other-channel", "c");
    const other: SignalEnvelope[] = [];
    c.onmessage = (m) => other.push(m);
    a.send({ id: "m2", from: "a", kind: "announce" });
    await tick();
    expect(other).toEqual([]);
  });
  test("rate-limited and size-capped", async () => {
    const nt = createFakeNtfy();
    let t = 0;
    const p = ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl, now: () => t, burst: 3, refillMs: 1000 });
    const a = await p.connect("ch", "a");
    for (let i = 0; i < 10; i++) a.send({ id: `m${i}`, from: "a", kind: "announce" });
    await tick();
    expect(nt.state.posts.length).toBe(3);
    t = 2000;
    a.send({ id: "later", from: "a", kind: "announce" });
    a.send({ id: "big", from: "a", kind: "rtc", rtc: { type: "offer", sdp: "x".repeat(MAX_SIGNAL_BYTES) } });
    await tick();
    expect(nt.state.posts.length).toBe(4); // the refilled one went, the oversized one did not
  });
});

describe("hub", () => {
  test("local + remote both deliver, but each message reaches the app once; own and foreign-addressed messages are dropped", async () => {
    const rt = createFakeRealtime();
    // a BroadcastChannel stand-in shared by both "tabs"
    const bcs = new Set<{ onmessage: ((e: { data: unknown }) => void) | null }>();
    class BC { onmessage: ((e: { data: unknown }) => void) | null = null; constructor() { bcs.add(this); } postMessage(d: unknown) { for (const x of bcs) if (x !== this) setTimeout(() => x.onmessage?.({ data: d }), 0); } close() { bcs.delete(this); } }
    const local = broadcastChannelProvider(BC as unknown as typeof BroadcastChannel);
    const remote: SignalProvider[] = [supabaseRealtimeProvider(rt.client)];
    const ha = createSignalHub({ channel: "c", selfId: "a", remote, local: [local] });
    const hb = createSignalHub({ channel: "c", selfId: "b", remote, local: [local] });
    expect(await ha.ensure()).toBe("supabase");
    await hb.ensure();
    const got: SignalEnvelope[] = [];
    hb.onmessage = (m) => got.push(m);
    await tick();
    got.length = 0; // presence joins
    ha.send({ kind: "announce" });
    ha.send({ kind: "announce", to: "someone-else" });
    await tick();
    expect(got.filter((m) => m.from === "a" && m.kind === "announce").length).toBe(1);
    ha.close();
    hb.close();
  });
  test("a hub re-races when its winner closes (Supabase drops -> ntfy next time)", async () => {
    const rt = createFakeRealtime();
    const nt = createFakeNtfy();
    const hub = createSignalHub({ channel: "c", selfId: "a", remote: [supabaseRealtimeProvider(rt.client), ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl })] });
    expect(await hub.ensure()).toBe("supabase");
    rt.kill();
    expect(hub.remote).toBeNull();
    expect(await hub.ensure()).toBe("ntfy");
    hub.close();
  });
});
