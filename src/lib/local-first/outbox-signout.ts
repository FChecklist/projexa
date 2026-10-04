// LOCAL-FIRST (FB data:F2 + data:F4): what a sign-out must know about a person's database BEFORE it deletes it.
//
// sign-out.ts (owned by packages E1/FC, not edited here) deletes a person's database when no op is pending. Since schema 4 a
// database can hold work with NO pending op: DRAFTS (what the person typed for an edit the server turned down) and NOTICES
// (the words saying so, including for an edit refused during the sign-out flush itself). Deleting it silently is exactly the
// loss review finding data:F2 describes ("the person leaves believing the edit was saved").
//
// keptWorkOnSignOut(idb, name) reads both and returns:
//   keep     true when the database holds drafts: deleting it would destroy what the person typed, so it is KEPT (like
//            pending ops), until they sign in again and send or discard it;
//   notice   the sentence to show at sign-out (or null): what was not saved, and that the text is still here / was lost.
//
// THE CHANGE sign-out.ts needs (step 2, before `deleteDatabase`):
//   const kept = await keptWorkOnSignOut(idb, name).catch(() => ({ keep: true, notice: null, drafts: 0, refused: [] }));
//   if (kept.keep) { result.pending += kept.drafts; notices.push(kept.notice); continue; }
//   if (kept.notice) notices.push(kept.notice);            // refused during the flush, nothing typed to keep: still SAY it
// and return the collected notices in `result.notice` (joined), instead of only pendingNotice().

import { OUTBOX_NOTICES_KEY, openLocalDb } from "./local-db";
import type { OutboxNotice } from "./outbox";

export type KeptWork = { keep: boolean; drafts: number; refused: string[]; notice: string | null };

export async function keptWorkOnSignOut(idb: IDBFactory, name: string): Promise<KeptWork> {
  const db = await openLocalDb(idb, name);
  try {
    const drafts = await db.listDrafts();
    const notices = (await db.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
    const draftIds = new Set(drafts.map((d) => d.opId));
    // A notice whose draft exists is said by the draft; a notice WITHOUT one (an older app, or nothing was typed) is said on its own.
    const refused = [...drafts.map((d) => d.message), ...notices.filter((n) => !draftIds.has(n.opId)).map((n) => n.message)];
    let notice: string | null = null;
    if (drafts.length > 0) {
      const n = drafts.length;
      notice = `${refused.join(" ")} ${n === 1 ? "What you typed is" : `What you typed for these ${n} changes is`} kept on this laptop: sign in again to send ${n === 1 ? "it" : "them"} again or discard ${n === 1 ? "it" : "them"}.`;
    } else if (refused.length > 0) {
      notice = refused.join(" ");
    }
    return { keep: drafts.length > 0, drafts: drafts.length, refused, notice };
  } finally {
    db.close();
  }
}
