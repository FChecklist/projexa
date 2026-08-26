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
// for. Those other top-level nodes are no longer offered as pills at all --
// see SHOW_UNDISPATCHABLE_MODULE_CHAINS below for why "not yet wired to a
// dispatch endpoint" and "safe to show a buyer" turned out to be different
// questions. This key is therefore now the ONE chain the composer offers,
// and R-80's "one full pill path works end to end" is exactly this path.
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

// R38 (R-81/TC-82, Master v5 G-5/P-9: "The 402 unwired pills -- hide, do not
// wire"). /api/module-chain's own leaf.deterministic flag is exactly the
// D-13 signal for "has a real codeReference, dispatches as software" vs
// "browsable data with no dispatch path yet" -- this file's own header
// comment already documents the latter as real but not-yet-wired. Selecting
// any of those in the composer either fails outright or forces VERI to
// improvise (D-13's own "the 5%" case), which is exactly what a buyer must
// never hit mid-demo. Prunes leaves with deterministic !== true, and any
// branch left with zero children as a result (an empty branch pill is its
// own kind of unwired dead end) -- recursively, so a branch several levels
// deep that loses every leaf disappears too, not just its direct children.
// PROJEXA's own construction tree (/api/capability-tree) is untouched: it's
// the one chain this composer can actually dispatch (CONSTRUCTION_CHAIN_MODE_KEY
// below), already real end-to-end, nothing to hide there.
function pruneUnwired(nodes: CapabilityNode[]): CapabilityNode[] {
  const pruned: CapabilityNode[] = [];
  for (const node of nodes) {
    if (node.leaf) {
      if (node.deterministic === true) pruned.push(node);
      continue;
    }
    const children = node.children ? pruneUnwired(node.children) : [];
    if (children.length > 0) pruned.push({ ...node, children });
  }
  return pruned;
}

// R-81, second pass ("NO visible pill may be unwired -- HIDE, do not wire").
//
// pruneUnwired() above hides leaves VERIDIAN itself cannot dispatch, and that
// was necessary but NOT sufficient -- which is why R-81 stayed open after it
// landed. `deterministic` is set upstream by compliance-tracker's
// markDeterministic() as `Boolean(codeReference || engineKey || reportUrl)`,
// i.e. "VERIDIAN can run this". PROJEXA's reach is far narrower: /api/assistant
// proxies VERIDIAN's /api/v1/projexa/assistant, whose ALLOWED_CODE_REFERENCES
// is exactly 7 entries, ALL construction (verified three ways on 2026-08-26 --
// the 7-entry allowlist in that route, the identical 7-entry codeRefs array in
// buildConstructionNodes(), and 7 matching tier='global' rows in
// platform.worker_agents). So a module-chain leaf could carry
// deterministic:true, survive the prune, render as a pill, and STILL dead-end:
// VeriComposer's own isDispatchableChain gate is hard-coded to the
// construction chain, so completing any other chain leaves the send button
// disabled under "Browse-only for now -- this module isn't wired up to send
// yet." A prospect clicking at random drills a full cascade and arrives at a
// disabled button. That is the dead end R-81 exists to prevent.
//
// So the rule enforced here is the one that matches what the composer can
// actually DO: a chain is offered only if PROJEXA can dispatch it. Today that
// is exactly PROJEXA's own construction tree.
//
// This HIDES; it deletes nothing. pruneUnwired() and the module-chain fetch
// are both kept intact and come back by flipping this one flag the day
// cross-module dispatch ships (its own auth/allowlist surface -- see
// CONSTRUCTION_CHAIN_MODE_KEY above). Keeping the flag false also spares the
// composer a dependency on /api/module-chain, one of the routes named in the
// R46 production incident as hanging until Vercel's 300s cap.
export const SHOW_UNDISPATCHABLE_MODULE_CHAINS: boolean = false;

// Pure, directly testable core of the merge, split out from the fetch so both
// flag states are unit-testable without stubbing module state.
export function mergeChainTrees(
  construction: CapabilityNode[],
  moduleChain: CapabilityNode[],
  showUndispatchable: boolean = SHOW_UNDISPATCHABLE_MODULE_CHAINS
): CapabilityNode[] {
  if (!showUndispatchable) return construction;
  return [...construction, ...pruneUnwired(moduleChain)];
}

// Fetches PROJEXA's own construction tree, plus -- only when the flag above is
// on -- the full VERIDIAN module chain, in parallel. The shared factory's
// `tree` is just "every top-level chain mode this composer offers," so this is
// the single place that decides what VeriComposer.tsx (which renders one
// pill/chain per top-level tree node, see its own header comment) can show.
// Neither fetch failing takes the other down.
export async function fetchCapabilityTree(): Promise<CapabilityNode[]> {
  const [construction, moduleChain] = await Promise.all([
    fetchJsonNodes("/api/capability-tree"),
    SHOW_UNDISPATCHABLE_MODULE_CHAINS ? fetchJsonNodes("/api/module-chain") : Promise.resolve<CapabilityNode[]>([]),
  ]);
  return mergeChainTrees(construction, moduleChain);
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
