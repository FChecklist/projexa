import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, memberships, profiles, securityAuditLog, dailyReportNote } from "@/lib/db";
import { findDeliveryByReplyToken, listDigestItemsForDelivery, consumeDigestItem } from "@/lib/services/digest-item-service";
import { applyDigestItemVerb } from "@/lib/services/digest-item-dispatcher";
import { parseReply } from "@/lib/email/reply-parser";
import { sendEmail, emailTemplate } from "@/lib/email/send";

// PUBLIC, unauthenticated by necessity -- this is the inbound counterpart to
// GET /api/email/[token] (the existing one-click link consumer). Postmark
// Inbound (see HANDOFF_DNS_POSTMARK_INBOUND.md) POSTs here for any mail
// landing on reply.projexa-ai.com. Auth is HTTP Basic on the webhook URL
// itself (POSTMARK_INBOUND_USERNAME/PASSWORD), checked against the
// Authorization header, fail-closed exactly like a CRON_SECRET bearer
// check -- an unset credential always refuses.
//
// Safety posture, deliberately layered (see the plan/HANDOFF doc for the
// full reasoning): (1) the reply address itself only resolves to one
// specific delivery -- one membership, one org, the exact items shown in
// that one email; (2) the From address must match that membership's own
// profile email, or nothing is applied; (3) every applied verb is re-vetted
// against that item's own allowedVerbs, set at issue time from a fixed
// per-entity vocabulary; (4) every application is a real, single atomic
// "claim" (consumeDigestItem) before anything is applied, so a webhook
// retry can never double-apply; (5) every outcome -- applied, refused, or
// unmatched -- is logged, never silently dropped.
function isAuthorized(request: NextRequest): boolean {
  const user = process.env.POSTMARK_INBOUND_USERNAME;
  const pass = process.env.POSTMARK_INBOUND_PASSWORD;
  if (!user || !pass) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic (.+)$/);
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  return decoded.slice(0, sep) === user && decoded.slice(sep + 1) === pass;
}

type PostmarkInboundPayload = {
  From?: string;
  FromFull?: { Email?: string };
  To?: string;
  TextBody?: string;
  StrippedTextReply?: string;
};

function extractReplyToken(toHeader: string | undefined): string | null {
  if (!toHeader) return null;
  // toHeader can be "Name <d-abc123@reply.projexa-ai.com>" or a bare address.
  const addressMatch = toHeader.match(/([^\s<>,]+@[^\s<>,]+)/);
  const address = addressMatch ? addressMatch[1] : toHeader;
  const localPart = address.split("@")[0];
  return localPart.startsWith("d-") ? localPart.slice(2) : null;
}

async function logAudit(event: string, actor: string, metadata: Record<string, unknown>): Promise<void> {
  await db.insert(securityAuditLog).values({ event, actor, metadata });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as PostmarkInboundPayload | null;
  if (!payload) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const replyToken = extractReplyToken(payload.To);
  if (!replyToken) {
    await logAudit("email_reply_refused", "inbound_webhook", { reason: "no_reply_token", to: payload.To ?? null });
    return NextResponse.json({ ok: true }); // 200 so Postmark doesn't retry a mail we can never resolve
  }

  const delivery = await findDeliveryByReplyToken(replyToken);
  if (!delivery) {
    await logAudit("email_reply_refused", "inbound_webhook", { reason: "unknown_reply_token" });
    return NextResponse.json({ ok: true });
  }

  const [membership] = await db.select().from(memberships).where(eq(memberships.id, delivery.membershipId)).limit(1);
  const [profile] = membership ? await db.select().from(profiles).where(eq(profiles.id, membership.userId)).limit(1) : [];
  if (!membership || !profile) {
    await logAudit("email_reply_refused", "inbound_webhook", { reason: "delivery_membership_not_found", deliveryId: delivery.id });
    return NextResponse.json({ ok: true });
  }

  const fromEmail = (payload.FromFull?.Email ?? payload.From ?? "").trim().toLowerCase();
  if (!fromEmail || fromEmail !== profile.email.trim().toLowerCase()) {
    // Header-match trust, not DKIM verification -- documented limitation,
    // see HANDOFF_DNS_POSTMARK_INBOUND.md. Logged, not silently dropped.
    await logAudit("email_reply_refused", "inbound_webhook", { reason: "sender_mismatch", deliveryId: delivery.id, from: fromEmail || null });
    return NextResponse.json({ ok: true });
  }

  const items = await listDigestItemsForDelivery(delivery.id);
  const textBody = payload.StrippedTextReply ?? payload.TextBody ?? "";
  const parsed = parseReply(
    items.map((i) => ({ refCode: i.refCode, entityType: i.entityType, allowedVerbs: i.allowedVerbs as string[], consumedAt: i.consumedAt })),
    textBody
  );

  const itemsByRef = new Map(items.map((i) => [i.refCode, i]));
  const actor = membership.userId;
  const ctx = { organizationId: delivery.organizationId, actingUserId: membership.userId, actingUserEmail: profile.email };

  let appliedCount = 0;
  let failedCount = 0;

  for (const action of parsed.matched) {
    const item = itemsByRef.get(action.refCode);
    if (!item) continue; // shouldn't happen -- parseReply only matches known refCodes -- defensive only
    const claimed = await consumeDigestItem(item.id, action.verb, { payloadText: action.payloadText });
    if (!claimed) {
      await logAudit("email_reply_item_refused", actor, { deliveryId: delivery.id, refCode: action.refCode, reason: "already_consumed" });
      continue;
    }
    try {
      await applyDigestItemVerb(action.entityType, item.entityId, action.verb, action.payloadText, ctx);
      appliedCount++;
      await logAudit("email_reply_item_applied", actor, { deliveryId: delivery.id, refCode: action.refCode, entityType: action.entityType, verb: action.verb });
    } catch (error) {
      failedCount++;
      await logAudit("email_reply_item_apply_failed", actor, {
        deliveryId: delivery.id,
        refCode: action.refCode,
        entityType: action.entityType,
        verb: action.verb,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const refusal of parsed.refused) {
    await logAudit("email_reply_item_refused", actor, { deliveryId: delivery.id, refCode: refusal.refCode, reason: refusal.reason });
  }

  if (parsed.unmatchedText) {
    await db.insert(dailyReportNote).values({
      organizationId: delivery.organizationId,
      membershipId: delivery.membershipId,
      deliveryId: delivery.id,
      rawText: parsed.unmatchedText,
    });
    await logAudit("email_reply_unmatched_note", actor, { deliveryId: delivery.id });
  }

  await sendAcknowledgement(profile.email, appliedCount, failedCount, Boolean(parsed.unmatchedText));

  return NextResponse.json({ ok: true, applied: appliedCount, failed: failedCount, noted: Boolean(parsed.unmatchedText) });
}

async function sendAcknowledgement(to: string, appliedCount: number, failedCount: number, noted: boolean): Promise<void> {
  const parts: string[] = [];
  if (appliedCount > 0) parts.push(`updated ${appliedCount} item${appliedCount === 1 ? "" : "s"}`);
  if (noted) parts.push("saved your note");
  if (failedCount > 0) parts.push(`${failedCount} item${failedCount === 1 ? "" : "s"} couldn't be updated -- someone will follow up`);

  const summary = parts.length > 0 ? parts.join(", ") : "got your reply, but nothing in it matched a known item or had a note to save";
  const html = emailTemplate("Got it", `<p>${summary}.</p>`);
  await sendEmail({ to, subject: "PROJEXA — got your update", html });
}
