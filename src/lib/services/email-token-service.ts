// WO-PROJEXA-AI-LINK-001 Part 2: membership-scoped, one-click email action
// tokens. Same "the token IS the enforcement" posture the work order asks
// for -- the real guard is the BEFORE INSERT trigger on
// public.email_action_token (check_email_action_token_org_match,
// drizzle/0023_ai_link_and_email.sql), which rejects at the database any
// token whose membership does not belong to the same org as its target
// todo. This file cannot silently skip that check even if a future edit
// here has a bug, because the check does not live in this file.
//
// The raw token exists only in the emailed link; only its SHA-256 hash is
// stored (a deviation the equivalent VERIDIAN work order's Owner already
// approved once -- "correct, and better than what I specified" -- applied
// here from the start).
import { randomBytes, createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, emailActionToken, todos } from "@/lib/db";

const ONE_CLICK_ACTIONS = ["mark_done", "reassign_ping", "note_ack"] as const;
export type OneClickAction = (typeof ONE_CLICK_ACTIONS)[number];

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type IssueTokenInput = {
  todoId: string;
  organizationId: string;
  membershipId: string;
  action: OneClickAction;
  ttlHours?: number;
};

/** Returns the RAW token -- put it straight into the email link and never store it. */
export async function issueEmailActionToken(input: IssueTokenInput): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 24 * 7) * 60 * 60 * 1000);

  // The trigger enforces the real safety property; this insert can still
  // fail (and should) if todoId/membershipId/organizationId don't line up --
  // that failure is not caught here, it is the trigger doing its job.
  await db.insert(emailActionToken).values({
    todoId: input.todoId,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    action: input.action,
    tokenHash: hashToken(raw),
    expiresAt,
  });

  return raw;
}

export type ConsumeResult =
  | { ok: true; todoId: string; action: OneClickAction }
  | { ok: false; reason: "not_found" | "already_used" | "expired" };

/**
 * One-time use, verified by re-reading the row after the UPDATE: this is
 * the "clicking the same link a second time is refused, and that refusal
 * is itself recorded" step the work order's vertical slice explicitly asks
 * to prove. `used_at IS NULL` in the WHERE clause makes the spend atomic --
 * two simultaneous clicks on the same link cannot both succeed.
 */
export async function consumeEmailActionToken(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);

  const [existing] = await db.select().from(emailActionToken).where(eq(emailActionToken.tokenHash, tokenHash)).limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.usedAt) return { ok: false, reason: "already_used" };
  if (new Date(existing.expiresAt) < new Date()) return { ok: false, reason: "expired" };

  const [updated] = await db
    .update(emailActionToken)
    .set({ usedAt: new Date() })
    .where(and(eq(emailActionToken.tokenHash, tokenHash), isNull(emailActionToken.usedAt)))
    .returning();

  if (!updated) return { ok: false, reason: "already_used" }; // lost the race to a simultaneous click

  return { ok: true, todoId: updated.todoId, action: updated.action as OneClickAction };
}

/** Apply the one-click action itself, after a successful consume. Kept separate from consumeEmailActionToken so a route can log/audit between "spent" and "applied". */
export async function applyOneClickAction(todoId: string, action: OneClickAction): Promise<void> {
  switch (action) {
    case "mark_done":
      await db.update(todos).set({ done: true }).where(eq(todos.id, todoId));
      return;
    case "reassign_ping":
    case "note_ack":
      // No further write needed -- these actions ARE the audit event
      // (someone acknowledged/pinged), not a todos column change.
      return;
  }
}
