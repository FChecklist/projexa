"use client";

// PROJEXA's port of VERIDIAN's VeriChatPanel.tsx -- same independent
// right-panel design (its own view tabs, never driven by composerMode).
// "Tasks" is renamed "Queries" throughout (see veri-chat-context.tsx for
// why PROJEXA has no async Tasks system).
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { useVeriChat } from "./veri-chat-context";

type QuerySummary = {
  id: string;
  code_reference: string;
  breadcrumb: string;
  status: "pending" | "done" | "error";
  result: unknown;
  error_message: string | null;
  created_at: string;
};
type ConvoSummary = {
  id: string;
  name: string;
  otherParticipantIds: string[];
  lastMessage: { content: string; created_at: string; sender_id: string } | null;
};
type OrgMember = { user_id: string; role: string; profiles: { email: string; display_name: string | null } | null };
type TodoItem = { id: string; text: string; done: boolean; created_at: string };

const STATUS_LABEL: Record<string, string> = { pending: "Working…", done: "Done", error: "Error" };
const STATUS_COLOR: Record<string, string> = { pending: "text-px-warning", done: "text-px-success", error: "text-px-error" };

export default function VeriChatPanel() {
  const { rightPanelView, setRightPanelView, activeQueryId, activeConversationId, openQuery, openConversation, closeThread, refreshCounter, bumpRefresh } = useVeriChat();

  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [conversations, setConversations] = useState<ConvoSummary[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [convoMessages, setConvoMessages] = useState<{ id: string; sender_id: string; content: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTodoText, setNewTodoText] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/assistant").then((r) => r.json()).then((d) => setQueries(d.queries ?? [])).catch(() => {}),
      fetch("/api/conversations").then((r) => r.json()).then((d) => setConversations(d.conversations ?? [])).catch(() => {}),
      fetch("/api/org-members").then((r) => r.json()).then((d) => setOrgMembers(d.members ?? [])).catch(() => {}),
      fetch("/api/todos").then((r) => r.json()).then((d) => setTodos(d.todos ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [refreshCounter]);

  useEffect(() => {
    if (!activeConversationId) { setConvoMessages([]); return; }
    fetch(`/api/conversations/${activeConversationId}/messages`).then((r) => r.json()).then((d) => setConvoMessages(d.messages ?? [])).catch(() => {});
  }, [activeConversationId, refreshCounter]);

  async function startConversation(userId: string) {
    const existing = conversations.find((c) => c.otherParticipantIds.length === 1 && c.otherParticipantIds[0] === userId);
    if (existing) { openConversation(existing.id); return; }
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantUserIds: [userId] }),
      });
      if (!res.ok) throw new Error();
      const convo = await res.json();
      bumpRefresh();
      openConversation(convo.id);
    } catch {
      toast.error("Couldn't start conversation — please try again");
    }
  }

  async function sendMessage(text: string) {
    if (!activeConversationId || !text.trim()) return;
    try {
      const res = await fetch(`/api/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim() }),
      });
      if (!res.ok) throw new Error();
      bumpRefresh();
    } catch {
      toast.error("Message didn't send — please try again");
    }
  }

  async function addTodo() {
    const text = newTodoText.trim();
    if (!text) return;
    setNewTodoText("");
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      bumpRefresh();
    } catch {
      toast.error("Couldn't add that to-do — please try again");
    }
  }

  async function toggleTodo(id: string, done: boolean) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done } : t)));
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update that to-do");
      bumpRefresh();
    }
  }

  const pendingQueryCount = queries.filter((q) => q.status === "pending").length;
  const todoCount = todos.filter((t) => !t.done).length;

  const activeQuery = activeQueryId ? queries.find((q) => q.id === activeQueryId) : null;
  const activeConvo = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;

  return (
    <aside className="border-l border-px-border bg-white flex flex-col h-full">
      <div className="border-b border-px-border px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <MessageSquare className="size-4 text-px-orange" />
          <span className="font-heading text-[15px] text-px-ink">PROJEXA Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {([
            { key: "overview", label: "Overview", count: 0 },
            { key: "queries", label: "Queries", count: pendingQueryCount },
            { key: "chats", label: "Chats", count: 0 },
            { key: "todo", label: "To Do", count: todoCount },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => { closeThread(); setRightPanelView(v.key); }}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${
                rightPanelView === v.key && !activeQueryId && !activeConversationId ? "bg-px-orange/10 text-px-orange border border-px-orange/30" : "text-px-muted hover:bg-px-cloud"
              }`}
            >
              {v.label}
              {v.count > 0 && <span className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-px-error text-white text-[9.5px] font-bold">{v.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid place-items-center h-32"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
        ) : activeQuery ? (
          <QueryThread query={activeQuery} onBack={closeThread} />
        ) : activeConvo ? (
          <ConvoThread convo={activeConvo} messages={convoMessages} onBack={closeThread} onSend={sendMessage} />
        ) : rightPanelView === "queries" ? (
          <QueryList queries={queries} onOpen={openQuery} />
        ) : rightPanelView === "chats" ? (
          <ChatList conversations={conversations} orgMembers={orgMembers} onOpen={openConversation} onStart={startConversation} />
        ) : rightPanelView === "todo" ? (
          <TodoPanel todos={todos} newText={newTodoText} onNewText={setNewTodoText} onAdd={addTodo} onToggle={toggleTodo} />
        ) : (
          <Overview queries={queries} conversations={conversations} todos={todos} onOpenQuery={openQuery} onOpenConvo={openConversation} onGoToTodo={() => setRightPanelView("todo")} />
        )}
      </div>
    </aside>
  );
}

function QueryList({ queries, onOpen }: { queries: QuerySummary[]; onOpen: (id: string) => void }) {
  if (queries.length === 0) return <EmptyState text="No assistant queries yet — use the Assistant pill below." />;
  return (
    <div>
      {queries.map((q) => (
        <button key={q.id} type="button" onClick={() => onOpen(q.id)} className="block w-full text-left px-4 py-3 border-b border-px-border/60 hover:bg-px-concrete/60 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-px-ink truncate flex-1">{q.breadcrumb}</span>
            <span className={`text-[11px] shrink-0 ${STATUS_COLOR[q.status]}`}>{STATUS_LABEL[q.status]}</span>
          </div>
          <p className="text-[11px] text-px-muted mt-0.5">{new Date(q.created_at).toLocaleString()}</p>
        </button>
      ))}
    </div>
  );
}

function ChatList({
  conversations, orgMembers, onOpen, onStart,
}: {
  conversations: ConvoSummary[]; orgMembers: OrgMember[]; onOpen: (id: string) => void; onStart: (userId: string) => void;
}) {
  const startedWith = new Set(conversations.filter((c) => c.otherParticipantIds.length === 1).map((c) => c.otherParticipantIds[0]));
  const startable = orgMembers.filter((m) => !startedWith.has(m.user_id));

  return (
    <div>
      {conversations.length === 0 && startable.length === 0 && <EmptyState text="No teammates to chat with yet." />}
      {conversations.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="flex items-start gap-3 w-full text-left px-4 py-3 border-b border-px-border/60 hover:bg-px-concrete/60 transition-colors">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-px-ink text-white text-xs font-bold">{c.name.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-px-ink">{c.name}</p>
            <p className="truncate text-xs text-px-muted mt-0.5">{c.lastMessage?.content ?? "No messages yet"}</p>
          </div>
        </button>
      ))}
      {startable.length > 0 && (
        <div className="px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-px-muted mb-1.5">Start a conversation</p>
          {startable.map((m) => (
            <button key={m.user_id} type="button" onClick={() => onStart(m.user_id)} className="flex items-center gap-2 w-full text-left py-1.5 text-[13px] text-px-ink hover:text-px-orange">
              <Plus className="size-3.5" /> {m.profiles?.display_name || m.profiles?.email || "Teammate"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TodoPanel({
  todos, newText, onNewText, onAdd, onToggle,
}: {
  todos: TodoItem[]; newText: string; onNewText: (v: string) => void; onAdd: () => void; onToggle: (id: string, done: boolean) => void;
}) {
  return (
    <div>
      <div className="px-4 py-3 border-b border-px-border/60">
        <input
          value={newText}
          onChange={(e) => onNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
          placeholder="Add a to-do for yourself…"
          className="w-full rounded-lg border border-px-border2 px-3 py-2 text-[13px] text-px-ink placeholder:text-px-muted focus:outline-none focus:ring-2 focus:ring-px-orange/20"
        />
      </div>
      {todos.length === 0 ? (
        <EmptyState text="Nothing on your to-do list right now." />
      ) : (
        todos.map((t) => (
          <label key={t.id} className="flex items-center gap-3 px-4 py-3 border-b border-px-border/60 cursor-pointer">
            <input type="checkbox" checked={t.done} onChange={(e) => onToggle(t.id, e.target.checked)} className="size-[15px] accent-px-orange shrink-0" />
            <span className={`text-[13px] ${t.done ? "text-px-muted line-through" : "text-px-ink"}`}>{t.text}</span>
          </label>
        ))
      )}
    </div>
  );
}

function QueryThread({ query, onBack }: { query: QuerySummary; onBack: () => void }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-px-cloud px-3 py-2">
        <span className="font-semibold text-px-ink text-[13px] truncate">{query.breadcrumb}</span>
        <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-px-orange shrink-0 ml-2">Back</button>
      </div>
      {query.status === "pending" && <p className="text-center text-[13px] text-px-muted py-6">Working…</p>}
      {query.status === "error" && <p className="text-[13px] text-px-error px-1">{query.error_message}</p>}
      {query.status === "done" && (
        <pre className="whitespace-pre-wrap break-words rounded-xl bg-px-concrete/60 p-3 text-[12.5px] text-px-ink">
          {JSON.stringify(query.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ConvoThread({
  convo, messages, onBack, onSend,
}: {
  convo: ConvoSummary; messages: { id: string; sender_id: string; content: string; created_at: string }[]; onBack: () => void; onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-px-cloud px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-px-slate">
          <span>Chatting with</span>
          <span className="font-semibold text-px-ink">{convo.name}</span>
        </div>
        <button type="button" onClick={onBack} className="text-[11.5px] font-semibold text-px-orange">Back</button>
      </div>
      <div className="space-y-3 mb-3">
        {messages.length === 0 && <p className="text-center text-[11px] text-px-muted">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2">
            <div className="rounded-2xl px-3.5 py-2 max-w-[85%] bg-white border border-px-border text-px-ink text-[13px] whitespace-pre-wrap break-words">
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { onSend(draft); setDraft(""); } }}
          placeholder="Message…"
          className="flex-1 rounded-lg border border-px-border2 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-px-orange/20"
        />
      </div>
    </div>
  );
}

function Overview({
  queries, conversations, todos, onOpenQuery, onOpenConvo, onGoToTodo,
}: {
  queries: QuerySummary[]; conversations: ConvoSummary[]; todos: TodoItem[];
  onOpenQuery: (id: string) => void; onOpenConvo: (id: string) => void; onGoToTodo: () => void;
}) {
  type Item = { key: string; type: "query" | "chat" | "todo"; ts: number; title: string; sub: string; onClick: () => void };

  const items: Item[] = [
    ...queries.slice(0, 10).map((q) => ({
      key: `q-${q.id}`, type: "query" as const, ts: new Date(q.created_at).getTime(), title: q.breadcrumb, sub: STATUS_LABEL[q.status], onClick: () => onOpenQuery(q.id),
    })),
    ...conversations.filter((c) => c.lastMessage).map((c) => ({
      key: `c-${c.id}`, type: "chat" as const, ts: new Date(c.lastMessage!.created_at).getTime(), title: c.name, sub: c.lastMessage!.content, onClick: () => onOpenConvo(c.id),
    })),
    ...todos.filter((t) => !t.done).map((t) => ({
      key: `d-${t.id}`, type: "todo" as const, ts: 0, title: t.text, sub: "To do", onClick: onGoToTodo,
    })),
  ].sort((a, b) => b.ts - a.ts);

  if (items.length === 0) return <EmptyState text="Nothing needs your attention right now." />;

  const ICON_BG: Record<Item["type"], string> = { query: "bg-px-orange", chat: "bg-px-ink", todo: "bg-px-success" };

  return (
    <div>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onClick} className="flex items-start gap-2.5 w-full text-left px-4 py-3 border-b border-px-border/60 hover:bg-px-concrete/60 transition-colors">
          <div className={`grid place-items-center size-[26px] rounded-lg shrink-0 text-white ${ICON_BG[item.type]}`}>
            {item.type === "query" ? "✓" : item.type === "chat" ? <MessageSquare className="size-3" /> : "☐"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-px-ink truncate">{item.title}</p>
            <p className="text-[12px] text-px-muted truncate mt-0.5">{item.sub}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-5 py-10 text-center text-sm text-px-muted">{text}</div>;
}
