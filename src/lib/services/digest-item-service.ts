// The atomic consume half of the digest-item reply flow -- mirrors
// email-token-service.ts's consumeEmailActionToken()/applyOneClickAction()
// split exactly (same reason: a route needs to log/audit between "spent"
// and "applied", and the spend itself must be a single atomic UPDATE ...
// WHERE consumed_at IS NULL so two near-simultaneous replies referencing
// the same item can't both apply).
import { eq, and, isNull } from "drizzle-orm";
import { db, emailDigestItem, emailDigestDelivery } from "@/lib/db";

export type DigestItemRow = typeof emailDigestItem.$inferSelect;
export type DigestDeliveryRow = typeof emailDigestDelivery.$inferSelect;

export async function findDeliveryByReplyToken(replyToken: string): Promise<DigestDeliveryRow | null> {
  const [row] = await db.select().from(emailDigestDelivery).where(eq(emailDigestDelivery.replyToken, replyToken)).limit(1);
  return row ?? null;
}

export async function listDigestItemsForDelivery(deliveryId: string): Promise<DigestItemRow[]> {
  return db.select().from(emailDigestItem).where(eq(emailDigestItem.deliveryId, deliveryId));
}

/**
 * Atomically marks one item consumed (used_at-style guard, `consumed_at IS
 * NULL` in the WHERE clause). Returns false if it was already consumed --
 * "lost the race" or a genuine replay -- the caller must not apply the verb
 * in that case.
 */
export async function consumeDigestItem(itemId: string, verb: string, appliedPayload: unknown): Promise<boolean> {
  const [updated] = await db
    .update(emailDigestItem)
    .set({ consumedAt: new Date(), appliedVerb: verb, appliedPayload: appliedPayload as Record<string, unknown> })
    .where(and(eq(emailDigestItem.id, itemId), isNull(emailDigestItem.consumedAt)))
    .returning();
  return !!updated;
}
