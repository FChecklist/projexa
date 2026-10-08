"use client";

// P6 (aims 5-6): the chat box on the LAPTOP shell. It is the SAME chat component the online app docks (shell/Composer.tsx), driven by
// the logic in chat.ts: the person types what they want done; the words go to the same endpoint (POST /api/tasks) when the laptop is
// connected and PROJEXA's own AI is allowed for the organisation; offline they are kept ("Saved. It will run when you are connected.");
// with the AI off the plain AI-off sentence is shown and there is nothing to confirm. Confirming is the person's own click.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/shell/Composer";
import { personMetaStore } from "../device-meta";
import { viaPxApi } from "@/lib/px-api";
import { confirmSubmission, createChatQueue, flushQueue, submitTyped, type ChatDeps, type ChatQueue, type ChatResult } from "./chat";

type Shown = { tone: "info" | "own_ai" | "saved" | "reply"; text: string; submissionId?: string };

export function LocalShellChat({ userId, projectId, online, queue, send, enabled }: {
  userId: string;
  projectId: string | null;
  online: boolean;
  queue?: ChatQueue;
  send?: ChatDeps["send"];
  enabled?: ChatDeps["enabled"];
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useMemo(() => queue ?? createChatQueue(personMetaStore(userId)), [queue, userId]);
  const post = useCallback<ChatDeps["send"]>(
    (body) => (send ? send(body) : viaPxApi("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    [send],
  );
  const deps = useMemo<ChatDeps>(() => ({ online, queue: q, send: post, enabled }), [online, q, post, enabled]);
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; }); // not during render (react-hooks/refs)

  const show = (r: ChatResult) => {
    setError(null);
    if (r.kind === "own_ai") setShown({ tone: "own_ai", text: r.sentence });
    else if (r.kind === "saved") { setShown({ tone: "saved", text: r.sentence }); setValue(""); }
    else if (r.kind === "reply") { setShown({ tone: "reply", text: r.reply.text, submissionId: r.reply.confirmable ? r.reply.submissionId : undefined }); setValue(""); }
    else setError(r.message);
  };

  // Back online: run what was kept.
  useEffect(() => {
    if (!online) return;
    let live = true;
    void flushQueue(depsRef.current).then((done) => {
      const last = done.at(-1);
      if (live && last) show(last.result);
    }).catch(() => {});
    return () => { live = false; };
  }, [online]);

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    try {
      show(await submitTyped(value, projectId, deps));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(submissionId: string) {
    setBusy(true);
    try {
      show(await confirmSubmission(submissionId, deps));
    } finally {
      setBusy(false);
    }
  }

  const conversation = shown ? (
    <div className="space-y-1 text-sm text-px-ink" data-testid="local-shell-chat-answer" data-tone={shown.tone}>
      <p>{shown.text}</p>
      {shown.submissionId ? (
        <button type="button" className="rounded-md bg-[#14C8B4] px-3 py-1 text-sm font-semibold text-white" data-testid="local-shell-chat-confirm" disabled={busy} onClick={() => void onConfirm(shown.submissionId!)}>
          Confirm
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="mx-auto mt-4 h-[18rem] max-w-6xl" data-testid="local-shell-chat" data-online={online ? "1" : "0"} aria-label="Chat">
      <Composer
        instruction={online ? "Send" : "Save for when you are connected"}
        sendLabel="Send"
        canSend={value.trim().length > 0}
        busy={busy}
        errorMessage={error}
        conversation={conversation}
        value={value}
        onChange={setValue}
        onSubmit={() => void onSubmit()}
        placeholder="Type what you want done"
      />
    </section>
  );
}
