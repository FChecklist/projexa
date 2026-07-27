"use client";

// AppShellFrame's `homeThreadSlot` -- the dashboard's merged-Home pattern:
// on HOME_ROUTE the right panel is hidden (AppShellFrame's own isHome
// branch) and this renders inline in the main content area instead.
// PROJEXA has no async AI-worker "task" thread (VeriComposer's header
// comment: dispatch is deterministic, not a typed instruction to a worker
// agent) -- its equivalent of compliance-tracker's singleton AI thread is
// the "Discuss" mode conversation (discussMessages), so that's what's
// mirrored here via the same shared ThreadView VeriChatPanel would use for
// a real thread. Query/conversation threads stay panel-only (as before),
// since those already have their own dedicated open/closed UI.
import { ThreadView, type ThreadMessage } from "@fchecklist/veridian-ui-kit/panel";
import { useVeriChat } from "./veri-chat-context";

export default function HomeThreadSlot() {
  const { discussMessages } = useVeriChat();

  if (discussMessages.length === 0) return null;

  const messages: ThreadMessage[] = discussMessages.map((m, i) => ({
    id: String(i),
    isUser: m.role === "user",
    content: m.content,
  }));

  return (
    <div className="max-w-3xl mx-auto px-6">
      <ThreadView messages={messages} assistantLabel="V" />
    </div>
  );
}
