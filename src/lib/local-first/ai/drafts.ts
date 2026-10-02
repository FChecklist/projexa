// LOCAL-FIRST browser AI: deletes an AI asks for wait here as DRAFTS until the PERSON confirms them with one click
// (requirement R7: "deletes by an AI are drafts the person confirms unless the person switches on 'let my AI act
// without asking'").
//
// WHY THE CONFIRM IS NOT ON THE AI SURFACE. Everything on window.projexa.ai can be called by any script in the page,
// which includes the person's browser AI. If confirm() were there, the AI would simply confirm its own drafts and the
// rule would mean nothing. So this store is handed to the page's own UI (AiDraftConfirm.tsx) and to nothing else; the
// AI can only LIST drafts (read-only copies), never confirm or discard one. The UI additionally requires a trusted
// user event (event.isTrusted), which a script cannot forge.
//
// Drafts live in memory: a reload drops an unconfirmed draft (the AI can ask again). Nothing was written, so nothing
// is lost.

export type AiDraft = {
  draftId: string;
  functionId: string;
  label: string;
  projectId: string;
  params: Record<string, unknown>;
  record: { kind: string; id: string };
  /** Plain words shown to the person: what will be removed. */
  summary: string;
  createdAt: number;
};

export type DraftStore = {
  add(draft: AiDraft): void;
  get(draftId: string): AiDraft | undefined;
  /** Read-only copies, oldest first. */
  list(): AiDraft[];
  remove(draftId: string): boolean;
  subscribe(listener: () => void): () => void;
};

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, AiDraft>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  const copy = (d: AiDraft): AiDraft => structuredClone(d);
  return {
    add(draft) { drafts.set(draft.draftId, copy(draft)); notify(); },
    get(draftId) { const d = drafts.get(draftId); return d ? copy(d) : undefined; },
    list: () => [...drafts.values()].sort((a, b) => a.createdAt - b.createdAt).map(copy),
    remove(draftId) { const had = drafts.delete(draftId); if (had) notify(); return had; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
