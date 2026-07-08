"use client";

// PROJEXA's port of VERIDIAN's VeriComposer.tsx -- same DOM position on
// every page (mounted once in the app layout, never remounted on
// navigation). Mode pills answer "what am I about to do"; the cascading
// chain rows are pre-seeded from the real construction capability tree
// (Wave 130's /api/v1/projexa/capability-tree). Sending in a chain mode
// calls /api/assistant, which dispatches through the same worker-agent
// pipeline the tree itself was built from.
import { useEffect, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoGrowTextarea } from "@/lib/use-autogrow-textarea";
import { useVeriChat, FIXED_MODES, type CapabilityNode, type PathSegment } from "./veri-chat-context";

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

  const [selectedPath, setSelectedPath] = useState<PathSegment[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useAutoGrowTextarea(value, 160);

  const chainModes = tree.filter((n) => !FIXED_MODES.includes(n.key as never)).map((n) => n.key);
  const preseedKeyForMode = (mode: string): string | null => {
    const node = tree.find((n) => n.key === mode);
    return node ? node.key : null;
  };
  const isChainMode = chainModes.includes(composerMode);

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

  async function dispatchQuery() {
    if (!completedLeaf?.codeReference) return;
    setSending(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeReference: completedLeaf.codeReference,
          breadcrumb: pathDisplayString(selectedPath),
          inputs: completedLeaf.fixedInputs ?? {},
        }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Done — ${completedLeaf.label}`);
      setValue("");
      setSelectedPath(preseedKeyForMode(composerMode) ? [preseedKeyForMode(composerMode)!] : []);
      bumpRefresh();
    } catch {
      toast.error("Couldn't reach the construction assistant — try again");
    } finally {
      setSending(false);
    }
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
    if (isChainMode && chainComplete && !isThreadOpen) return dispatchQuery();
  }

  const disabled = sending || isThreadOpen || (composerMode === "chats") || (composerMode === "todo") || (isChainMode && !chainComplete);
  const placeholder = isThreadOpen
    ? "Open a query above to see its result"
    : composerMode === "discuss"
      ? "Ask me anything — no data lookup needed…"
      : composerMode === "chats"
        ? "Pick a conversation in the panel to start typing"
        : composerMode === "todo"
          ? "Use the To Do panel to add items"
          : chainComplete
            ? `Ready — press send for "${completedLeaf?.label}"`
            : "Select an option above to begin…";

  return (
    <div className="shrink-0 border-t border-px-border bg-white/95 backdrop-blur px-6 py-3">
      <div className="w-full max-w-5xl mx-auto">
        <div className="inline-flex flex-wrap gap-0.5 rounded-full bg-px-cloud p-1 mb-2">
          {FIXED_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setComposerMode(m)}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-full whitespace-nowrap ${composerMode === m && !isThreadOpen ? "bg-white text-px-ink shadow-sm" : "text-px-muted"}`}
            >
              {FIXED_LABELS[m]}
            </button>
          ))}
          {tree.filter((n) => !FIXED_MODES.includes(n.key as never)).map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setComposerMode(n.key)}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-full whitespace-nowrap ${composerMode === n.key && !isThreadOpen ? "bg-white text-px-ink shadow-sm" : "text-px-muted"}`}
            >
              {n.label}
            </button>
          ))}
        </div>

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

        {composerMode === "discuss" && discussMessages.length > 0 && !isThreadOpen && (
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
            <div className="flex items-center justify-end mt-2">
              <button
                type="button"
                onClick={send}
                disabled={
                  sending ||
                  (composerMode === "discuss" ? !value.trim() : !(isChainMode && chainComplete))
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
              ? chainComplete ? "Enter sends, chain resets after each query" : "Complete the chain above to start typing"
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
