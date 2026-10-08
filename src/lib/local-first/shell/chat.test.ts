/// <reference types="bun-types" />
// P6: the laptop chat logic. AI off => the plain AI-off sentence, nothing sent, nothing kept, nothing to confirm. Offline with the AI
// allowed => the typed words are kept and the person is told. Online => the verdict; confirm is separate.
// Falsifiability: in chat.ts submitTyped, delete the `if (!gate.call)` line (AI-off cases fail) or the queue.add (offline case fails).
import { describe, expect, test } from "bun:test";
import { confirmSubmission, createChatQueue, flushQueue, LAPTOP_CHAT_SAVED_SENTENCE, submitTyped, type ChatDeps } from "./chat";
import { OWN_AI_SENTENCE } from "../ai-off/internal-ai";

function rig(opts: { online: boolean; enabled: boolean; reply?: unknown; status?: number }) {
  const store = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const queue = createChatQueue({ getMeta: async <T,>(k: string) => store.get(k) as T | undefined, setMeta: async (k, v) => { store.set(k, v); } });
  const deps: ChatDeps = {
    online: opts.online, queue, enabled: async () => opts.enabled,
    send: async (b) => { sent.push(b); return new Response(JSON.stringify(opts.reply ?? { status: "ready", confirmable: true, submissionId: "s1", understood: { label: "New schedule task" } }), { status: opts.status ?? 200 }); },
  };
  return { deps, sent, queue };
}

describe("laptop chat", () => {
  for (const online of [true, false]) {
    test(`AI off (${online ? "online" : "offline"}): the AI-off sentence, nothing sent, nothing kept, nothing to confirm`, async () => {
      const { deps, sent, queue } = rig({ online, enabled: false });
      const r = await submitTyped("add a task: pour slab", "p1", deps);
      expect(r).toEqual({ kind: "own_ai", sentence: OWN_AI_SENTENCE });
      expect(sent).toHaveLength(0);
      expect(await queue.list()).toHaveLength(0);
    });
  }
  test("offline with the AI allowed: kept exactly as typed, with the plain sentence", async () => {
    const { deps, sent, queue } = rig({ online: false, enabled: true });
    const r = await submitTyped("  add a task: pour slab  ", "p1", deps);
    expect(r).toEqual({ kind: "saved", sentence: LAPTOP_CHAT_SAVED_SENTENCE });
    expect(sent).toHaveLength(0);
    expect((await queue.list()).map((q) => [q.text, q.projectId])).toEqual([["add a task: pour slab", "p1"]]);
  });
  test("online with the AI allowed: one send; a confirmable verdict is offered, never confirmed by itself", async () => {
    const { deps, sent } = rig({ online: true, enabled: true });
    const r = await submitTyped("add a task: pour slab", "p1", deps);
    expect(r).toMatchObject({ kind: "reply", reply: { confirmable: true, submissionId: "s1" } });
    expect(sent).toEqual([{ rawInput: "add a task: pour slab", mode: "Projects", projectId: "p1" }]);
  });
  test("an own-AI refusal from the server is shown as the same calm sentence, nothing to confirm", async () => {
    const { deps } = rig({ online: true, enabled: true, status: 403, reply: { code: "PROJEXA_INTERNAL_AI_OFF" } });
    expect(await submitTyped("hello", null, deps)).toEqual({ kind: "own_ai", sentence: OWN_AI_SENTENCE });
  });
  test("confirm sends {confirm:true, submissionId}", async () => {
    const { deps, sent } = rig({ online: true, enabled: true, reply: { message: "Created." } });
    expect(await confirmSubmission("s1", deps)).toMatchObject({ kind: "reply", reply: { text: "Created." } });
    expect(sent).toEqual([{ confirm: true, submissionId: "s1" }]);
  });
  test("back online: kept requests run once and are removed; AI off leaves them kept", async () => {
    const off = rig({ online: false, enabled: true });
    await submitTyped("a", null, off.deps);
    expect(await flushQueue({ ...off.deps, online: true, enabled: async () => false })).toHaveLength(0);
    expect(await off.queue.list()).toHaveLength(1);
    expect(await flushQueue({ ...off.deps, online: true, enabled: async () => true })).toHaveLength(1);
    expect(off.sent).toHaveLength(1);
    expect(await off.queue.list()).toHaveLength(0);
  });
});
