import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

// P6: the laptop chat box. AI off => the plain AI-off sentence and no Confirm button, nothing sent. Offline (AI allowed) => the typed
// words are kept and the sentence says so. Online + allowed => the verdict with Confirm, which sends only on the person's click.
// Falsifiability: in LocalShellChat.tsx render the Confirm button for every answer, or skip submitTyped's gate, and these fail.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { LocalShellChat } from "./LocalShellChat";
import { createChatQueue, LAPTOP_CHAT_SAVED_SENTENCE } from "./chat";
import { OWN_AI_SENTENCE } from "../ai-off/internal-ai";

afterEach(cleanup);

function setup(o: { online: boolean; enabled: boolean }) {
  const store = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const queue = createChatQueue({ getMeta: async <T,>(k: string) => store.get(k) as T | undefined, setMeta: async (k, v) => { store.set(k, v); } });
  const send = async (b: Record<string, unknown>) => {
    sent.push(b);
    return new Response(JSON.stringify(b.confirm ? { message: "Created." } : { status: "ready", confirmable: true, submissionId: "s1", understood: { label: "New schedule task" } }), { status: 200 });
  };
  const view = render(<LocalShellChat userId="u1" projectId="p1" online={o.online} queue={queue} send={send} enabled={async () => o.enabled} />);
  const type = (t: string) => {
    // happy-dom does not run React onChange for fireEvent.change on a textarea; call the prop like the repo's other screen tests.
    const el = view.getByLabelText("Describe the task");
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps"))!;
    const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key];
    act(() => { props.onChange({ target: { value: t }, currentTarget: { value: t } }); });
  };
  return { ...view, sent, queue, type };
}

describe("LocalShellChat", () => {
  test("AI off: the AI-off sentence, no Confirm, nothing sent or kept", async () => {
    const t = setup({ online: true, enabled: false });
    t.type("add a task: pour slab");
    fireEvent.click(t.getByTestId("composer-send"));
    await waitFor(() => expect(t.getByTestId("local-shell-chat-answer").textContent).toContain(OWN_AI_SENTENCE));
    expect(t.queryByTestId("local-shell-chat-confirm")).toBeNull();
    expect(t.sent).toHaveLength(0);
    expect(await t.queue.list()).toHaveLength(0);
  });
  test("AI off and offline: still the AI-off sentence, not 'saved'", async () => {
    const t = setup({ online: false, enabled: false });
    t.type("add a task");
    fireEvent.click(t.getByTestId("composer-send"));
    await waitFor(() => expect(t.getByTestId("local-shell-chat-answer").textContent).toContain(OWN_AI_SENTENCE));
    expect(t.getByTestId("local-shell-chat-answer").textContent).not.toContain(LAPTOP_CHAT_SAVED_SENTENCE);
  });
  test("offline with the AI allowed: the words are kept and the sentence says so", async () => {
    const t = setup({ online: false, enabled: true });
    t.type("add a task: pour slab");
    fireEvent.click(t.getByTestId("composer-send"));
    await waitFor(() => expect(t.getByTestId("local-shell-chat-answer").textContent).toBe(LAPTOP_CHAT_SAVED_SENTENCE));
    expect((await t.queue.list()).map((q) => q.text)).toEqual(["add a task: pour slab"]);
    expect(t.sent).toHaveLength(0);
  });
  test("online with the AI allowed: a verdict with Confirm; the confirm is sent only on the click", async () => {
    const t = setup({ online: true, enabled: true });
    t.type("add a task: pour slab");
    fireEvent.click(t.getByTestId("composer-send"));
    await waitFor(() => expect(t.getByTestId("local-shell-chat-confirm")).toBeTruthy());
    expect(t.sent).toHaveLength(1);
    fireEvent.click(t.getByTestId("local-shell-chat-confirm"));
    await waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toEqual({ confirm: true, submissionId: "s1" });
  });
});
