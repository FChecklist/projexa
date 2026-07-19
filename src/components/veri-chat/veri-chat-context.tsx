"use client";

// PROJEXA's own thin wrapper around
// @fchecklist/veridian-ui-kit/context's createVeriChatContext() factory --
// the shared package owns the two-axis state machine (composerMode /
// activeView, capability-tree fetch-on-module-change); this file layers
// PROJEXA's real, product-specific state on top exactly as the package's
// own README/scope-boundary documents.
//
// What PROJEXA does NOT hand to the factory, and why:
// - "tasks" is renamed "queries" throughout, and activeQueryId/openQuery
//   are kept as PROJEXA's own state rather than the factory's
//   activeTaskId/openTask -- the factory's openTask() forces composerMode
//   to "tasks" as a side effect (a real VERIDIAN-only behavior), but
//   PROJEXA has no async Tasks system (dispatchTool() is synchronous) and
//   opening a query here has never touched composerMode. Reusing
//   activeTaskId/openTask would silently strand the composer in a
//   composerMode with no matching capability-tree node once a query's
//   thread is closed.
// - discussMessages/appendDiscussMessage: Discuss chat history is kept in
//   React state only (not persisted across reloads) for v1 -- no
//   equivalent in the shared factory, which never fetches/stores messages
//   itself.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createVeriChatContext, FIXED_MODES } from "@fchecklist/veridian-ui-kit/context";
import type { CapabilityNode, CapabilityInputField, PathSegment } from "@fchecklist/veridian-ui-kit/context";

export type { CapabilityNode, CapabilityInputField, PathSegment };
export { FIXED_MODES };

export type RightPanelView = "overview" | "queries" | "chats" | "todo";

async function fetchCapabilityTree(): Promise<CapabilityNode[]> {
  const res = await fetch("/api/capability-tree");
  const data = await res.json();
  return data.nodes ?? [];
}

const base = createVeriChatContext<RightPanelView>({
  fetchTree: fetchCapabilityTree,
  defaultView: "overview",
  defaultComposerMode: "discuss",
});

type DiscussMessage = { role: "user" | "assistant"; content: string };

type QueryThreadState = {
  activeQueryId: string | null;
  setActiveQueryId: (id: string | null) => void;
  discussMessages: DiscussMessage[];
  appendDiscussMessage: (msg: DiscussMessage) => void;
};

const QueryThreadContext = createContext<QueryThreadState | null>(null);

function QueryThreadProvider({ children }: { children: ReactNode }) {
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const [discussMessages, setDiscussMessages] = useState<DiscussMessage[]>([]);

  const appendDiscussMessage = (msg: DiscussMessage) => setDiscussMessages((prev) => [...prev, msg]);

  const value = useMemo<QueryThreadState>(
    () => ({ activeQueryId, setActiveQueryId, discussMessages, appendDiscussMessage }),
    [activeQueryId, discussMessages]
  );

  return <QueryThreadContext.Provider value={value}>{children}</QueryThreadContext.Provider>;
}

export function VeriChatProvider({ children }: { children: ReactNode }) {
  return (
    <base.VeriChatProvider>
      <QueryThreadProvider>{children}</QueryThreadProvider>
    </base.VeriChatProvider>
  );
}

export function useVeriChat() {
  const state = base.useVeriChat();
  const query = useContext(QueryThreadContext);
  if (!query) throw new Error("useVeriChat must be used within VeriChatProvider");

  const openQuery = (id: string) => {
    query.setActiveQueryId(id);
    state.closeThread();
  };
  const openConversation = (id: string) => {
    query.setActiveQueryId(null);
    state.openConversation(id);
  };
  const closeThread = () => {
    query.setActiveQueryId(null);
    state.closeThread();
  };
  const setComposerMode = (mode: string) => {
    query.setActiveQueryId(null);
    state.setComposerMode(mode);
  };

  return {
    tree: state.tree,
    treeLoading: state.treeLoading,
    composerMode: state.composerMode,
    setComposerMode,
    activeQueryId: query.activeQueryId,
    activeConversationId: state.activeConversationId,
    openQuery,
    openConversation,
    closeThread,
    isThreadOpen: Boolean(query.activeQueryId) || state.isThreadOpen,
    rightPanelView: state.activeView,
    setRightPanelView: state.setActiveView,
    refreshCounter: state.refreshCounter,
    bumpRefresh: state.bumpRefresh,
    discussMessages: query.discussMessages,
    appendDiscussMessage: query.appendDiscussMessage,
  };
}
