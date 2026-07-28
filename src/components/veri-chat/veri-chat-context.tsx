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

// The route AppShellFrame treats as "Home" for the merge behavior -- shared
// between layout.tsx (passed to AppShellFrame's `homeRoute` prop) and
// VeriComposer (to suppress its own inline discuss preview there, since
// HomeThreadSlot already renders that same conversation in the main
// content area on that route).
export const HOME_ROUTE = "/dashboard";

// The one top-level chain-mode key PROJEXA can actually dispatch (its own
// construction codeReferences, via /api/assistant's fixed allowlist) --
// see VeriComposer.tsx. Every other top-level node in `tree` comes from
// /api/module-chain (the full VERI GRC AI / VERI ERP / etc chain PROJEXA's
// linked VERIDIAN org exposes) and is real, org-scoped, browsable data, but
// not yet wired to a dispatch endpoint -- dispatching an arbitrary
// cross-module action from PROJEXA is a separate, larger feature (its own
// auth/allowlist surface, mirroring how /api/v1/projexa/assistant is
// deliberately NOT a general dispatchTool() proxy) than this task's
// SUCCESS_CRITERIA (fetch + render + drill into real scoped records) asks
// for.
export const CONSTRUCTION_CHAIN_MODE_KEY = "construction_intelligence";

export async function fetchJsonNodes(url: string): Promise<CapabilityNode[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.nodes ?? [];
  } catch {
    return [];
  }
}

// Fetches PROJEXA's own construction tree AND the new full VERIDIAN module
// chain in parallel and concatenates them -- the shared factory's `tree` is
// just "every top-level chain mode this composer offers," so merging here is
// the only change needed to make VeriComposer.tsx (which already renders
// one pill/chain per top-level tree node, see its own header comment) offer
// both alongside each other. Neither fetch failing takes the other down.
export async function fetchCapabilityTree(): Promise<CapabilityNode[]> {
  const [construction, moduleChain] = await Promise.all([
    fetchJsonNodes("/api/capability-tree"),
    fetchJsonNodes("/api/module-chain"),
  ]);
  return [...construction, ...moduleChain];
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
