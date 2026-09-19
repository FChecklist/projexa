// Applies one verb, for one digest item, after digest-item-service.ts's
// consumeDigestItem() has already atomically claimed it. Kept separate from
// the consume step for the same reason applyOneClickAction() is separate
// from consumeEmailActionToken() -- a caller needs to log/audit between
// "claimed" and "applied", and a failure here (e.g. VERIDIAN rejects the
// transition because the item's real state moved on since the digest was
// sent) must not un-claim the item; it's recorded as a failed application,
// not silently retried as if nothing happened.
//
// `todo` applies directly against PROJEXA's own Postgres. Every other
// entity type calls through veridian-client.ts's callVeridian() with the
// SAME path/body shape the authenticated routes already use
// (src/app/api/{rfis,submittals,punch-list,billing-claims}/[id]/route.ts --
// all confirmed to be thin proxies with no extra logic to extract), plus
// the acting-user attribution headers those routes themselves don't
// currently send, so a reply-driven change is attributed to the real
// person who replied, not to a shared service identity.
import { eq } from "drizzle-orm";
import { db, todos } from "@/lib/db";
import { callVeridian } from "@/lib/veridian-client";

export type DispatchContext = {
  organizationId: string;
  actingUserId: string;
  actingUserEmail: string | null;
};

export async function applyDigestItemVerb(entityType: string, entityId: string, verb: string, payloadText: string, ctx: DispatchContext): Promise<Record<string, unknown>> {
  switch (entityType) {
    case "todo":
      return applyTodoVerb(entityId, verb, payloadText);
    case "rfi":
      return applyRfiVerb(entityId, verb, payloadText, ctx);
    case "submittal":
      return applySubmittalVerb(entityId, verb, payloadText, ctx);
    case "punch_list":
      return applyPunchListVerb(entityId, verb, ctx);
    case "billing_milestone":
      return applyBillingMilestoneVerb(entityId, verb, payloadText, ctx);
    default:
      throw new Error(`Unknown digest item entity type: ${entityType}`);
  }
}

async function applyTodoVerb(todoId: string, verb: string, payloadText: string): Promise<Record<string, unknown>> {
  if (verb === "done") {
    await db.update(todos).set({ done: true }).where(eq(todos.id, todoId));
    return { done: true };
  }
  if (verb === "note") {
    const note = payloadText.slice(0, 2000);
    await db.update(todos).set({ note }).where(eq(todos.id, todoId));
    return { note };
  }
  throw new Error(`Unsupported todo verb: ${verb}`);
}

async function applyRfiVerb(rfiId: string, verb: string, payloadText: string, ctx: DispatchContext): Promise<Record<string, unknown>> {
  const body = verb === "close" ? { action: "close" } : verb === "answer" ? { action: "answer", answer: payloadText } : null;
  if (!body) throw new Error(`Unsupported RFI verb: ${verb}`);
  await callVeridian(`/rfis/${encodeURIComponent(rfiId)}`, {
    organizationId: ctx.organizationId,
    method: "PATCH",
    body,
    actingUserId: ctx.actingUserId,
    actingUserEmail: ctx.actingUserEmail ?? undefined,
  });
  return body;
}

const SUBMITTAL_STATUS_BY_VERB: Record<string, string> = {
  approved: "approved",
  approved_as_noted: "approved_as_noted",
  revise_resubmit: "revise_resubmit",
  rejected: "rejected",
};

async function applySubmittalVerb(submittalId: string, verb: string, payloadText: string, ctx: DispatchContext): Promise<Record<string, unknown>> {
  const status = SUBMITTAL_STATUS_BY_VERB[verb];
  if (!status) throw new Error(`Unsupported submittal verb: ${verb}`);
  const body = { action: "review", status, comments: payloadText || undefined };
  await callVeridian(`/submittals/${encodeURIComponent(submittalId)}`, {
    organizationId: ctx.organizationId,
    method: "PATCH",
    body,
    actingUserId: ctx.actingUserId,
    actingUserEmail: ctx.actingUserEmail ?? undefined,
  });
  return body;
}

async function applyPunchListVerb(itemId: string, verb: string, ctx: DispatchContext): Promise<Record<string, unknown>> {
  if (verb !== "ready" && verb !== "verify") throw new Error(`Unsupported punch list verb: ${verb}`);
  const body = { action: verb };
  await callVeridian(`/punch-list/${encodeURIComponent(itemId)}`, {
    organizationId: ctx.organizationId,
    method: "PATCH",
    body,
    actingUserId: ctx.actingUserId,
    actingUserEmail: ctx.actingUserEmail ?? undefined,
  });
  return body;
}

async function applyBillingMilestoneVerb(claimId: string, verb: string, payloadText: string, ctx: DispatchContext): Promise<Record<string, unknown>> {
  if (!["draft", "submit", "approve", "reject"].includes(verb)) throw new Error(`Unsupported billing milestone verb: ${verb}`);
  const body: Record<string, unknown> = { action: verb };
  if (verb === "reject") body.rejectionReason = payloadText || "No reason given";
  await callVeridian(`/billing-claims/${encodeURIComponent(claimId)}`, {
    organizationId: ctx.organizationId,
    method: "PATCH",
    body,
    actingUserId: ctx.actingUserId,
    actingUserEmail: ctx.actingUserEmail ?? undefined,
  });
  return body;
}
