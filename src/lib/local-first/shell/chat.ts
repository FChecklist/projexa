// P6 (aims 5-6): the typed-request chat box on the LAPTOP shell -- the logic, with everything injected so it is tested without a browser.
//
// The online app's chat box (shell/Composer.tsx + M24Shell.onSubmit) sends the typed words to POST /api/tasks and gets a VERDICT back;
// nothing is written until the person presses Confirm. This does the same on the laptop, with three rules from the owner:
//   1. The AI is the person's own; PROJEXA's own AI runs only when the organisation's owner allowed it. That is the SAME switch every
//      other laptop entry point uses (ai-off/internal-ai.ts guardInternalAi). While it is off, typed words show the plain AI-off
//      sentence (OWN_AI_SENTENCE): nothing is sent, nothing is queued, and there is never anything to confirm.
//   2. Offline (and the AI allowed), the typed words are KEPT as they were typed and the person is told so in one sentence; they are
//      sent when the laptop is connected. They live in the person's own local database (meta key below), never in the outbox that
//      carries finished edits, so the "your change was turned down" card never shows a request that simply has not run yet.
//   3. A confirmation is only ever the person's own act (the Confirm button); this file never confirms for them.
import { guardInternalAi, isInternalAiRefusal, OWN_AI_SENTENCE } from "../ai-off/internal-ai";
import type { MetaStore } from "../release/installer";

export const LAPTOP_CHAT_SAVED_SENTENCE = "Saved. It will run when you are connected.";
export const CHAT_QUEUE_KEY = "ai:chat-queue";

export type QueuedRequest = { id: string; text: string; projectId: string | null; at: number };

export type ChatQueue = {
  list(): Promise<QueuedRequest[]>;
  add(text: string, projectId: string | null): Promise<QueuedRequest>;
  remove(id: string): Promise<void>;
};

export function createChatQueue(meta: MetaStore, now: () => number = Date.now): ChatQueue {
  const read = async () => {
    const v = await meta.getMeta<QueuedRequest[]>(CHAT_QUEUE_KEY);
    return Array.isArray(v) ? v : [];
  };
  return {
    list: read,
    async add(text, projectId) {
      const item: QueuedRequest = { id: `chat-${now()}-${Math.random().toString(36).slice(2, 8)}`, text, projectId, at: now() };
      await meta.setMeta(CHAT_QUEUE_KEY, [...(await read()), item]);
      return item;
    },
    async remove(id) {
      await meta.setMeta(CHAT_QUEUE_KEY, (await read()).filter((q) => q.id !== id));
    },
  };
}

export type Reply = { text: string; confirmable: boolean; submissionId?: string };
export type ChatResult =
  | { kind: "own_ai"; sentence: string }
  | { kind: "saved"; sentence: string }
  | { kind: "reply"; reply: Reply }
  | { kind: "error"; message: string; network?: boolean };

export type ChatDeps = {
  online: boolean;
  queue: ChatQueue;
  /** The screen's own fetch of POST /api/tasks (viaPxApi). */
  send: (body: Record<string, unknown>) => Promise<Response>;
  /** Is PROJEXA's own AI allowed? Defaults to the laptop's stored manifest flag (guardInternalAi). */
  enabled?: () => Promise<boolean>;
};

type Verdict = { status?: string; message?: string; answer?: { text?: string }; understood?: { label?: string }; confirmable?: boolean; submissionId?: string };

function replyFrom(d: Verdict | null): Reply {
  const text = d?.message ?? d?.answer?.text ?? d?.understood?.label ?? "Done.";
  const confirmable = d?.confirmable === true && typeof d.submissionId === "string" && d.status !== "answered" && d.status !== "chat" && d.status !== "gap";
  return { text, confirmable, ...(confirmable ? { submissionId: d!.submissionId } : {}) };
}

const NETWORK_MESSAGE = "That did not reach the server. Try again when you are connected.";

async function run(text: string, projectId: string | null, deps: ChatDeps): Promise<ChatResult> {
  try {
    const res = await deps.send({ rawInput: text, mode: "Projects", projectId });
    const body = (await res.json().catch(() => null)) as (Verdict & { error?: string }) | null;
    if (isInternalAiRefusal(res.status, body)) return { kind: "own_ai", sentence: OWN_AI_SENTENCE };
    if (!res.ok) return { kind: "error", message: body?.error && body.error.trim() ? body.error : `That did not go through (HTTP ${res.status}).` };
    return { kind: "reply", reply: replyFrom(body) };
  } catch {
    return { kind: "error", message: NETWORK_MESSAGE, network: true };
  }
}

/** The person pressed Send. */
export async function submitTyped(text: string, projectId: string | null, deps: ChatDeps): Promise<ChatResult> {
  const typed = text.trim();
  if (!typed) return { kind: "error", message: "Type what you want done first." };
  const gate = await guardInternalAi({ route: "discuss" }, { enabled: deps.enabled });
  if (!gate.call) return { kind: "own_ai", sentence: gate.sentence };
  if (!deps.online) {
    await deps.queue.add(typed, projectId);
    return { kind: "saved", sentence: LAPTOP_CHAT_SAVED_SENTENCE };
  }
  return run(typed, projectId, deps);
}

/** The person pressed Confirm on a verdict. This is the ONLY place a confirm is sent, and only from that click. */
export async function confirmSubmission(submissionId: string, deps: Pick<ChatDeps, "send">): Promise<ChatResult> {
  try {
    const res = await deps.send({ confirm: true, submissionId });
    const body = (await res.json().catch(() => null)) as (Verdict & { error?: string }) | null;
    if (!res.ok) return { kind: "error", message: body?.error && body.error.trim() ? body.error : `That did not go through (HTTP ${res.status}).` };
    return { kind: "reply", reply: { text: body?.message ?? "Done.", confirmable: false } };
  } catch {
    return { kind: "error", message: NETWORK_MESSAGE, network: true };
  }
}

/** Back online: run what was kept. AI off => nothing is touched (the requests stay kept). Stops at the first network failure. */
export async function flushQueue(deps: ChatDeps): Promise<Array<{ request: QueuedRequest; result: ChatResult }>> {
  const out: Array<{ request: QueuedRequest; result: ChatResult }> = [];
  if (!deps.online) return out;
  const gate = await guardInternalAi({ route: "discuss" }, { enabled: deps.enabled });
  if (!gate.call) return out;
  for (const request of await deps.queue.list()) {
    const result = await run(request.text, request.projectId, deps);
    // A server answer (even a refusal) settles the request; only a network failure keeps it for the next time.
    if (result.kind === "error" && result.network) break;
    await deps.queue.remove(request.id);
    out.push({ request, result });
  }
  return out;
}
