"use client";

// PROJEXA's port of VERIDIAN's veri-chat-context.tsx. Same two-axis design:
// `composerMode` answers "what am I about to DO" (drives the composer),
// `rightPanelView` answers "what am I currently LOOKING AT" (drives the
// panel's list) -- switching one must never disturb the other.
//
// Differences from VERIDIAN's version (real platform constraints, not
// oversights -- see the PROJEXA build session notes):
// - "tasks" is renamed "queries" throughout: PROJEXA has no async Tasks
//   system (dispatchTool() is synchronous, and VERIDIAN's createTask()
//   requires a real session, which PROJEXA's API-key proxy calls don't
//   have) -- activeQueryId points at a local assistant_queries row instead.
// - No aiThreadId/isAiThread conversation: Discuss chat history here is
//   kept in React state only (not persisted across reloads) for v1.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CapabilityInputField = { key: string; label: string; type: "number" | "text"; optional?: boolean };

export type CapabilityNode = {
  key: string;
  label: string;
  leaf: boolean;
  multi?: boolean;
  codeReference?: string | null;
  agentId?: string | null;
  fixedInputs?: Record<string, string>;
  inputFields?: CapabilityInputField[];
  children?: CapabilityNode[];
};

export type PathSegment = string | { multi: true; values: string[] };

export const FIXED_MODES = ["discuss", "chats", "todo"] as const;

type VeriChatState = {
  tree: CapabilityNode[];
  treeLoading: boolean;
  composerMode: string;
  setComposerMode: (mode: string) => void;
  activeQueryId: string | null;
  activeConversationId: string | null;
  openQuery: (id: string) => void;
  openConversation: (id: string) => void;
  closeThread: () => void;
  rightPanelView: "overview" | "queries" | "chats" | "todo";
  setRightPanelView: (v: "overview" | "queries" | "chats" | "todo") => void;
  refreshCounter: number;
  bumpRefresh: () => void;
  discussMessages: { role: "user" | "assistant"; content: string }[];
  appendDiscussMessage: (msg: { role: "user" | "assistant"; content: string }) => void;
};

const VeriChatContext = createContext<VeriChatState | null>(null);

export function VeriChatProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<CapabilityNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [composerMode, setComposerModeState] = useState("discuss");
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [rightPanelView, setRightPanelView] = useState<"overview" | "queries" | "chats" | "todo">("overview");
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [discussMessages, setDiscussMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  useEffect(() => {
    fetch("/api/capability-tree")
      .then((r) => r.json())
      .then((d) => setTree(d.nodes ?? []))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false));
  }, []);

  const setComposerMode = (mode: string) => {
    setComposerModeState(mode);
    setActiveQueryId(null);
    setActiveConversationId(null);
    if (mode === "chats") setRightPanelView("chats");
    else if (mode === "todo") setRightPanelView("todo");
  };

  const openQuery = (id: string) => {
    setActiveQueryId(id);
    setActiveConversationId(null);
  };

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    setActiveQueryId(null);
    setComposerModeState("chats");
  };

  const closeThread = () => {
    setActiveQueryId(null);
    setActiveConversationId(null);
  };

  const bumpRefresh = () => setRefreshCounter((c) => c + 1);
  const appendDiscussMessage = (msg: { role: "user" | "assistant"; content: string }) =>
    setDiscussMessages((prev) => [...prev, msg]);

  const value = useMemo<VeriChatState>(
    () => ({
      tree, treeLoading, composerMode, setComposerMode,
      activeQueryId, activeConversationId, openQuery, openConversation, closeThread,
      rightPanelView, setRightPanelView, refreshCounter, bumpRefresh,
      discussMessages, appendDiscussMessage,
    }),
    [tree, treeLoading, composerMode, activeQueryId, activeConversationId, rightPanelView, refreshCounter, discussMessages]
  );

  return <VeriChatContext.Provider value={value}>{children}</VeriChatContext.Provider>;
}

export function useVeriChat() {
  const ctx = useContext(VeriChatContext);
  if (!ctx) throw new Error("useVeriChat must be used within VeriChatProvider");
  return ctx;
}
