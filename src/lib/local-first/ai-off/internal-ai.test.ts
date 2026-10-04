import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, createReplica, type StoredManifest } from "../replica";
import { createSyncClient, type SyncClient } from "../sync-client";
import {
  BACKEND_OWN_AI_SENTENCE, INTERNAL_AI_OFF_CODE, OWN_AI_SENTENCE,
  callServerAi, guardInternalAi, internalAiFlagFrom, isInternalAiRefusal, readInternalAiEnabled, usesInternalAi,
} from "./internal-ai";

// PROJEXA's own AI is OFF unless the backend explicitly says otherwise (package lf-e6; backend ai-os/PROJEXA_AI_OFF.md).

describe("which requests would reach our model", () => {
  test("Discuss and the AI progress summary do; the deterministic tools do not", () => {
    expect(usesInternalAi({ route: "discuss" })).toBe(true);
    expect(usesInternalAi({ route: "assistant", codeReference: "generate_construction_progress_summary" })).toBe(true);
    for (const ref of ["get_construction_project_dashboard", "get_construction_budget_status", "detect_construction_budget_schedule_risk", "list_delayed_activities"]) {
      expect(usesInternalAi({ route: "assistant", codeReference: ref })).toBe(false);
    }
  });
});

describe("the guard: off by default, one calm sentence, never a call", () => {
  test("internal AI off: an AI request is answered with the sentence and must not be sent", async () => {
    expect(await guardInternalAi({ route: "discuss" }, { enabled: async () => false })).toEqual({ call: false, sentence: OWN_AI_SENTENCE });
  });
  test("a deterministic request always goes ahead, whatever the switch", async () => {
    expect(await guardInternalAi({ route: "assistant", codeReference: "get_construction_budget_status" }, { enabled: async () => false })).toEqual({ call: true });
  });
  test("only an explicit 'on' lets an AI request through; a failing check means off", async () => {
    expect(await guardInternalAi({ route: "discuss" }, { enabled: async () => true })).toEqual({ call: true });
    expect((await guardInternalAi({ route: "discuss" }, { enabled: async () => { throw new Error("db gone"); } })).call).toBe(false);
  });
  test("with nobody known on this laptop (no identity, no IndexedDB) it is off, and no network is touched", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("{}"); }) as unknown as typeof fetch;
    try {
      expect((await guardInternalAi({ route: "discuss" })).call).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
  test("the sentence points at the person's own AI and is one sentence", () => {
    expect(OWN_AI_SENTENCE).toContain("your own AI assistant");
    expect(OWN_AI_SENTENCE).toContain("/llms.txt");
    expect(OWN_AI_SENTENCE.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBe(1);
  });
});

describe("callServerAi: what Discuss, the composer's dispatch and the Copilot tools call (network spied)", () => {
  const spy = () => {
    const calls: string[] = [];
    const send = (status = 200, body: unknown = { reply: "hello" }) => async () => { calls.push("sent"); return new Response(JSON.stringify(body), { status }); };
    return { calls, send };
  };

  test("internal AI off: Discuss is answered with the sentence and the fetch is never made", async () => {
    const s = spy();
    expect(await callServerAi({ route: "discuss" }, s.send(), { enabled: async () => false })).toEqual({ kind: "own_ai", sentence: OWN_AI_SENTENCE });
    expect(s.calls).toEqual([]);
  });

  test("internal AI off: the AI progress summary is not sent; Budget Status (deterministic) is, and its answer comes back untouched", async () => {
    const s = spy();
    expect((await callServerAi({ route: "assistant", codeReference: "generate_construction_progress_summary" }, s.send(), { enabled: async () => false })).kind).toBe("own_ai");
    expect(s.calls).toEqual([]);
    const answer = await callServerAi({ route: "assistant", codeReference: "get_construction_budget_status" }, s.send(200, { result: 42 }), { enabled: async () => false });
    expect(s.calls).toEqual(["sent"]);
    expect(answer.kind).toBe("answer");
    if (answer.kind === "answer") {
      expect(answer.res.ok).toBe(true);
      expect(answer.body).toEqual({ result: 42 });
      expect(await answer.res.json()).toEqual({ result: 42 }); // the screen can still read the response itself
    }
  });

  test("the backend's own 403 refusal (an older laptop setting, a switched server) becomes the same calm sentence, not an error", async () => {
    const s = spy();
    const answer = await callServerAi({ route: "assistant", codeReference: "generate_construction_progress_summary" }, s.send(403, { error: BACKEND_OWN_AI_SENTENCE, code: null }), { enabled: async () => true });
    expect(s.calls).toEqual(["sent"]);
    expect(answer).toEqual({ kind: "own_ai", sentence: OWN_AI_SENTENCE });
  });

  test("an ordinary server error is passed back as it was (the screen's own error handling applies)", async () => {
    const s = spy();
    const answer = await callServerAi({ route: "assistant", codeReference: "get_construction_budget_status" }, s.send(500, { error: "boom" }));
    expect(answer.kind).toBe("answer");
    if (answer.kind === "answer") expect(answer.res.status).toBe(500);
  });
});

describe("the backend's refusal, should one still arrive, is recognised (shown calmly, not as an error)", () => {
  test("by code, by ruleCode, by its exact sentence; an ordinary error is not", () => {
    expect(isInternalAiRefusal(403, { error: BACKEND_OWN_AI_SENTENCE, code: null })).toBe(true);
    expect(isInternalAiRefusal(403, { error: "x", code: INTERNAL_AI_OFF_CODE })).toBe(true);
    expect(isInternalAiRefusal(403, { error: "x", ruleCode: INTERNAL_AI_OFF_CODE })).toBe(true);
    expect(isInternalAiRefusal(403, { error: "Forbidden" })).toBe(false);
    expect(isInternalAiRefusal(500, { error: BACKEND_OWN_AI_SENTENCE })).toBe(false);
  });
});

describe("the manifest decides, through the laptop's own copy", () => {
  test("a manifest that says nothing (today's backend) is OFF; internal_ai or features.internal_ai true is ON", () => {
    expect(internalAiFlagFrom({ user: {} })).toBeNull();
    expect(internalAiFlagFrom({ internal_ai: true })).toBe(true);
    expect(internalAiFlagFrom({ features: { internal_ai: false } })).toBe(false);
    expect(internalAiFlagFrom(null)).toBeNull();
  });

  async function syncWith(extra: Record<string, unknown> | null) {
    const idb = new IDBFactory();
    const server = createFakeSyncServer();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await server.fetchImpl(input, init);
      if (!String(input).endsWith("/manifest") || !extra) return res;
      return new Response(JSON.stringify({ ...(await res.json()), ...extra }), { status: 200 });
    }) as typeof fetch;
    const client: SyncClient = createSyncClient({ getAccessToken: async () => "t", baseUrl: "https://fake.sync.test/projexa-sync", fetchImpl, sleep: async () => {}, maxRetries: 0 });
    await createReplica({ userId: "u1", client, idb, yieldFn: async () => {} }).sync();
    return idb;
  }

  test("today's manifest (no field): stored without the flag, read as OFF", async () => {
    const idb = await syncWith(null);
    expect(await readInternalAiEnabled("u1", idb)).toBe(false);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.getMeta<StoredManifest>(MANIFEST_KEY))?.internalAi).toBeUndefined();
    db.close();
  });

  test("a manifest saying internal_ai: true is stored and read as ON; a different person's database is not consulted", async () => {
    const idb = await syncWith({ internal_ai: true });
    expect(await readInternalAiEnabled("u1", idb)).toBe(true);
    expect(await readInternalAiEnabled("u2", idb)).toBe(false);
    expect(await readInternalAiEnabled(null, idb)).toBe(false);
  });

  test("features.internal_ai is honoured the same way", async () => {
    expect(await readInternalAiEnabled("u1", await syncWith({ features: { internal_ai: true } }))).toBe(true);
    expect(await readInternalAiEnabled("u1", await syncWith({ internal_ai: false }))).toBe(false);
  });
});
