"use client";

// PROJEXA's port of VERIDIAN's VeriComposer.tsx -- same DOM position on
// every page (mounted once in the app layout, never remounted on
// navigation). Mode pills answer "what am I about to do"; the cascading
// chain rows are pre-seeded from `tree`, which is now the concatenation of
// two real sources (see veri-chat-context.tsx's fetchCapabilityTree()):
// PROJEXA's own construction capability tree (Wave 130's
// /api/v1/projexa/capability-tree) and the org's full linked VERIDIAN
// module chain (VERI GRC AI / VERI ERP / etc, /api/module-chain, added by
// the "wire full VERIDIAN module chain into PROJEXA" task). Sending in the
// construction chain mode calls /api/assistant, which dispatches through
// the same worker-agent pipeline that tree was built from; the other,
// newer chain modes are real org-scoped browsable data without a wired
// dispatch endpoint yet (isDispatchableChain below).
//
// veridian-ui-kit migration: investigated adopting the shared package's own
// VeriComposer (@fchecklist/veridian-ui-kit/composer), and found a real,
// confirmed conflict -- same class of finding compliance-tracker's own
// migration (PR #471) made for its VCEL calculator inputs. The shared
// component's `onDispatch(path, text)` requires non-empty free text before
// a completed chain is even sendable (`if (!text) return`, mirroring
// VERIDIAN's real model of a typed instruction handed to an AI worker
// agent). PROJEXA's real dispatch is deterministic (a resolved leaf's
// codeReference + fixedInputs, sent to /api/assistant with zero required
// user text) -- forcing the shared component's text requirement here would
// make every query dispatch require the user to type filler text with no
// purpose, a real UX regression, not a paint-only difference. Kept local
// per this task's own "report the blocker, don't paper over it"
// instruction. Types (CapabilityNode/PathSegment/FIXED_MODES) still flow
// from the shared package transitively via veri-chat-context.tsx.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import {
  useVeriChat, FIXED_MODES, HOME_ROUTE, CONSTRUCTION_CHAIN_MODE_KEY, type CapabilityNode, type PathSegment,
} from "./veri-chat-context";

const FIXED_LABELS: Record<string, string> = { discuss: "Discuss", chats: "Chats", todo: "To Do" };

function pathSegmentDisplay(seg: PathSegment): string {
  if (typeof seg === "string") return seg;
  return "[" + seg.values.join(" + ") + "]";
}
function pathDisplayString(path: PathSegment[]): string {
  return path.map(pathSegmentDisplay).join(" › ");
}

function nodeChildrenAt(tree: CapabilityNode[], path: PathSegment[], depth: number): { children: CapabilityNode[] | null } {
  let level = tree;
  for (let i = 0; i < depth; i++) {
    const seg = path[i];
    if (typeof seg === "string") {
      const found = level.find((n) => n.key === seg);
      if (!found) return { children: null };
      if (found.leaf) return { children: null };
      level = found.children ?? [];
    } else {
      const union = new Map<string, CapabilityNode>();
      for (const v of seg.values) {
        const found = level.find((n) => n.key === v);
        (found?.children ?? []).forEach((c) => union.set(c.key, c));
      }
      level = Array.from(union.values());
    }
  }
  return { children: level };
}

function resolveLeaf(tree: CapabilityNode[], path: PathSegment[]): CapabilityNode | null {
  let level = tree;
  let node: CapabilityNode | null = null;
  for (const seg of path) {
    if (typeof seg !== "string") return null;
    const found = level.find((n) => n.key === seg);
    if (!found) return null;
    node = found;
    level = found.children ?? [];
  }
  return node;
}

export default function VeriComposer() {
  const {
    tree, treeLoading, composerMode, setComposerMode,
    activeQueryId, activeConversationId, closeThread, bumpRefresh,
    discussMessages, appendDiscussMessage,
  } = useVeriChat();
  const isHome = usePathname() === HOME_ROUTE;

  const [selectedPath, setSelectedPath] = useState<PathSegment[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<{ codeReference: string; fixedInputs: Record<string, string>; label: string; display: string }[]>([]);
  const textareaRef = useAutoGrowTextarea(value, 96);

  const chainModes = tree.filter((n) => !FIXED_MODES.includes(n.key as never)).map((n) => n.key);
  const preseedKeyForMode = (mode: string): string | null => {
    const node = tree.find((n) => n.key === mode);
    return node ? node.key : null;
  };
  const isChainMode = chainModes.includes(composerMode);
  // Only the construction chain (PROJEXA's own data, Wave 130) resolves to a
  // codeReference /api/assistant actually knows how to run -- every other
  // chain mode now offered (the new VERI GRC AI / VERI ERP / etc modules
  // from /api/module-chain) is real, org-scoped browsable data without a
  // wired dispatch endpoint yet (see veri-chat-context.tsx's
  // CONSTRUCTION_CHAIN_MODE_KEY comment). Gating on this, rather than just
  // disabling nothing, means picking a VERI GRC AI leaf can't silently
  // no-op or 400 against the construction-only /api/assistant allowlist.
  const isDispatchableChain = composerMode === CONSTRUCTION_CHAIN_MODE_KEY;

  useEffect(() => {
    const preseed = tree.find((n) => n.key === composerMode)?.key ?? null;
    setSelectedPath(preseed ? [preseed] : []);
  }, [composerMode, tree]);

  const { children: currentChildren } = tree.length ? nodeChildrenAt(tree, selectedPath, selectedPath.length) : { children: [] };
  const chainComplete = !treeLoading && (currentChildren === null || (currentChildren?.length ?? 0) === 0) && selectedPath.length > 0;
  const isThreadOpen = Boolean(activeQueryId || activeConversationId);
  const completedLeaf = chainComplete && tree.length ? resolveLeaf(tree, selectedPath) : null;

  function toggleSingle(depth: number, key: string) {
    setSelectedPath((prev) => {
      const atDepth = prev[depth];
      if (typeof atDepth === "string" && atDepth === key) return prev.slice(0, depth);
      return [...prev.slice(0, depth), key];
    });
  }

  async function dispatchLeaf(item: { codeReference: string; fixedInputs: Record<string, string>; label: string; display: string }) {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codeReference: item.codeReference,
        breadcrumb: item.display,
        inputs: item.fixedInputs,
      }),
    });
    // R38 (R-90/TC-70): the real backend message (e.g. "codeReference must
    // be one of: ...") was being discarded here -- throw new Error() carried
    // nothing, so every failure showed the same generic toast below
    // regardless of what actually went wrong. Read it the same way
    // ScopeClient.tsx already does (data.error, falling back only when the
    // response truly isn't JSON or has no error field).
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Couldn't reach the construction assistant");
    }
  }

  function resetChainForMode() {
    setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
  }

  async function dispatchQuery() {
    if (!completedLeaf?.codeReference) return;
    setSending(true);
    try {
      await dispatchLeaf({
        codeReference: completedLeaf.codeReference,
        fixedInputs: completedLeaf.fixedInputs ?? {},
        label: completedLeaf.label,
        display: pathDisplayString(selectedPath),
      });
      toast.success(`Done — ${completedLeaf.label}`);
      setValue("");
      resetChainForMode();
      bumpRefresh();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't reach the construction assistant — try again");
    } finally {
      setSending(false);
    }
  }

  // Stage the completed chain instead of sending immediately, so a second
  // query can be picked without losing the first -- e.g. checking budget
  // status for several projects in one visit. Mirrors VERIDIAN's
  // queueCurrent()/sendAllQueued() (VERI_CHAT_COMPOSER_DESIGN.md), adapted
  // for PROJEXA's structured dispatch: no free-text instruction to carry,
  // just the resolved leaf.
  function queueCurrent() {
    if (!completedLeaf?.codeReference || !chainComplete || !isDispatchableChain) return;
    setQueue((q) => [...q, {
      codeReference: completedLeaf.codeReference!,
      fixedInputs: completedLeaf.fixedInputs ?? {},
      label: completedLeaf.label,
      display: pathDisplayString(selectedPath),
    }]);
    resetChainForMode();
  }

  async function sendAllQueued() {
    if (queue.length === 0) return;
    setSending(true);
    const items = queue;
    setQueue([]);
    let failCount = 0;
    let firstFailureMessage: string | null = null;
    for (const item of items) {
      try {
        await dispatchLeaf(item);
      } catch (err) {
        if (!firstFailureMessage && err instanceof Error && err.message) firstFailureMessage = err.message;
        failCount += 1;
      }
    }
    if (failCount === 0) toast.success(`Done — ${items.length} ${items.length === 1 ? "query" : "queries"}`);
    // R38 (R-90/TC-70): surface the real backend message from the first
    // failure alongside the count, instead of only a generic "check Queries"
    // pointer -- a batch of one still reads naturally ("1 of 1 queries
    // failed: <real reason>").
    else toast.error(`${failCount} of ${items.length} queries failed${firstFailureMessage ? `: ${firstFailureMessage}` : " — check Queries for details"}`);
    bumpRefresh();
    setSending(false);
  }

  async function sendDiscuss() {
    const text = value.trim();
    if (!text) return;
    setSending(true);
    setValue("");
    appendDiscussMessage({ role: "user", content: text });
    try {
      const res = await fetch("/api/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: discussMessages }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      appendDiscussMessage({ role: "assistant", content: data.reply });
    } catch {
      toast.error("VERI AI didn't reply — try again");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (sending) return;
    if (composerMode === "discuss" && !isThreadOpen) return sendDiscuss();
    if (isChainMode && chainComplete && isDispatchableChain && !isThreadOpen) return dispatchQuery();
  }

  const disabled =
    sending || isThreadOpen || (composerMode === "chats") || (composerMode === "todo") ||
    (isChainMode && !(chainComplete && isDispatchableChain));
  const placeholder = isThreadOpen
    ? "Open a query above to see its result"
    : composerMode === "discuss"
      ? "Ask me anything — no data lookup needed…"
      : composerMode === "chats"
        ? "Pick a conversation in the panel to start typing"
        : composerMode === "todo"
          ? "Use the To Do panel to add items"
          : chainComplete
            ? isDispatchableChain
              ? `Ready — press send for "${completedLeaf?.label}"`
              : `Viewing "${completedLeaf?.label}" — live VERIDIAN data, dispatch coming soon for this module`
            : "Select an option above to begin…";

  return (
    <div className="shrink-0 px-3 pb-2 pt-1">
      <div className="w-full max-w-5xl mx-auto">
        {/* R52: THE MODE ROW WAS REMOVED HERE.
            It rendered Discuss | Chats | To Do | Construction Intelligence as a
            pill row directly beneath the M24 control strip, which already owns
            Mode (Projects | Customers | Vendors). Two bands answering the same
            question is the one thing M24's band rule forbids: "Five bands, each
            answering exactly ONE question, NOTHING appearing twice. If a control
            could plausibly live in two bands, THE MORE SPECIFIC ONE WINS."
            Confirmed on the live shell 2026-08-26 before removing it.
            composerMode still exists in state and every behaviour it drives is
            untouched -- only the duplicate selector is gone. Mode selection now
            happens once, on the strip, and what to DO is chosen from the kit's
            ranked PillStrip in band 3. */}
        
        {isChainMode && !isThreadOpen && (
          <div className="rounded-2xl border border-px-orange/30 bg-px-orange/5 px-4 py-2.5 mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-px-ink">Pick what you want the assistant to check.</span>
              <span className={`text-[11px] font-medium ${chainComplete ? "text-px-success" : "text-px-muted"}`}>
                {selectedPath.length ? (chainComplete ? "" : "Building: ") + pathDisplayString(selectedPath) : ""}
              </span>
            </div>
            <ChainRows tree={tree} selectedPath={selectedPath} onToggleSingle={toggleSingle} />
          </div>
        )}

        {queue.length > 0 && isChainMode && !isThreadOpen && (
          <div className="rounded-xl border border-px-border bg-px-cloud/50 px-3 py-2 mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-px-slate">Queued</span>
              <button type="button" onClick={sendAllQueued} disabled={sending} className="text-[11px] font-semibold text-px-orange disabled:opacity-40">
                Send all ({queue.length})
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {queue.map((item, idx) => (
                <span key={idx} className="inline-flex items-center gap-1.5 rounded-full border border-px-border bg-white px-2.5 py-1 text-[11px] text-px-ink">
                  {item.display}
                  <button type="button" onClick={() => setQueue((q) => q.filter((_, i) => i !== idx))} className="text-px-muted hover:text-px-error">×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Suppressed on HOME_ROUTE: HomeThreadSlot already renders this same
            discuss conversation in the main content area there (AppShellFrame's
            homeThreadSlot), so showing it here too would duplicate it. */}
        {composerMode === "discuss" && discussMessages.length > 0 && !isThreadOpen && !isHome && (
          <div className="mb-2 max-h-[220px] space-y-2 overflow-y-auto rounded-2xl border border-px-border bg-px-concrete/60 px-3 py-2.5">
            {discussMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${m.role === "user" ? "bg-px-ink text-white" : "bg-white border border-px-border text-px-ink"}`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isThreadOpen && (
          <div className="rounded-2xl border border-px-border bg-white shadow-sm px-4 pt-3 pb-2.5">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={placeholder}
              disabled={disabled && composerMode !== "discuss"}
              className="w-full bg-transparent text-[15px] text-px-ink placeholder:text-px-muted focus:outline-none resize-none max-h-[160px] overflow-y-auto disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              {isChainMode && (
                <button
                  type="button"
                  onClick={queueCurrent}
                  disabled={!chainComplete || sending || !isDispatchableChain}
                  title="Stage this and pick another query"
                  className="px-3 h-9 rounded-lg text-[12.5px] font-semibold text-px-slate border border-px-border hover:bg-px-cloud disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  + Add another
                </button>
              )}
              <button
                type="button"
                onClick={send}
                disabled={
                  sending ||
                  (composerMode === "discuss" ? !value.trim() : !(isChainMode && chainComplete && isDispatchableChain))
                }
                className="grid size-9 place-items-center rounded-lg bg-px-orange text-white hover:bg-px-orange-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-[18px]" />}
              </button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-px-muted mt-1.5 px-1">
          {isThreadOpen
            ? ""
            : isChainMode
              ? chainComplete
                ? isDispatchableChain
                  ? "Enter sends, chain resets after each query"
                  : "Browse-only for now — this module isn't wired up to send yet"
                : "Complete the chain above to start typing"
              : composerMode === "discuss"
                ? "Enter sends — general questions only, not live project data"
                : composerMode === "chats"
                  ? "Pick a conversation on the right to start typing"
                  : "Add items in the To Do panel on the right"}
        </p>

        {isThreadOpen && (
          <button type="button" onClick={closeThread} className="text-[11.5px] font-semibold text-px-orange mt-1">
            Back
          </button>
        )}
      </div>
    </div>
  );
}

function ChainRows({
  tree, selectedPath, onToggleSingle,
}: {
  tree: CapabilityNode[];
  selectedPath: PathSegment[];
  onToggleSingle: (depth: number, key: string) => void;
}) {
  const rows: { depth: number; parentLabel: string; options: CapabilityNode[] }[] = [];

  let options: CapabilityNode[] = tree;
  let parentLabel = "";

  for (let depth = 0; ; depth++) {
    if (!options || options.length === 0) break;
    rows.push({ depth, options, parentLabel });

    const sel = selectedPath[depth];
    if (sel === undefined || typeof sel !== "string") break;

    const found = options.find((o) => o.key === sel);
    if (!found || found.leaf) break;
    options = found.children ?? [];
    parentLabel = found.label;
  }

  return (
    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.depth} className="flex items-center gap-1.5 flex-wrap">
          {row.depth > 0 && <span className="text-[10.5px] text-px-muted shrink-0">{row.parentLabel}:</span>}
          {row.options.map((opt) => {
            const sel = selectedPath[row.depth];
            const isSelected = sel === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onToggleSingle(row.depth, opt.key)}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${
                  isSelected
                    ? opt.leaf ? "bg-px-success border-px-success text-white" : "bg-px-ink border-px-ink text-white"
                    : "bg-white border-px-border2 text-px-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
