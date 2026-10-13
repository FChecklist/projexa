// LOCAL-FIRST shell, Billing Milestones: a NEW BILLING MILESTONE with no network (Sumeet R-95, checklist 2.14; owner decision 2026-10-13).
//
// THE OWNER'S RULE (approved 2026-10-13): the laptop creates a DRAFT billing milestone. No money is posted and no invoice is made by an offline
// write; a person with the billing role confirms the milestone online. What the write does, step by step:
//
//   create_progress_claim  {projectId, boqId, customerId, milestoneDescription, scheduledDate, retentionPercent?}   registry: level 2, rank 3 (manager)
//
// The server (compliance-tracker executors/claims.ts -> createProgressClaim) stores ONE row, a progress claim in the state "milestone achieved",
// and nothing else: no invoice, no interim bill, no amount (compliance-tracker src/lib/pipeline/coverage-wave7.test.ts re-reads every table: one claim row, only in construction_progress_claims, nothing invoiced, and no function exists that approves or invoices a claim). From there it
// only moves when a person, online, drafts it, submits it, records the customer's approval and invoices it (the invoice is the step that posts
// money, and it is not available offline at all). So the milestone is a draft until that person confirms it, and the screen says so in words.
//
// THE RULES ARE THE SERVER'S, CHECKED AGAIN HERE so a refusal is never silent: a manager rank (the registry's min_role_rank for this function; the
// online screen asks only for a member, the link asks for more), a milestone text that is not blank (at most 2,000 letters), a billing date that is
// a real day, a retention between 0 and 100, a BOQ of this project that is APPROVED (the latest approved one, as the online screen picks it) and a
// customer that exists and is active. The one rule the laptop cannot check is that the customer is the project's own client's (or has an earlier
// claim on this project): the project's client is not copied to the laptop. The server checks it on arrival, and a refusal comes back as a card in
// the outbox with the person's text kept.

import { findFunction, rankOf } from "../../ai/registry";
import { localDbNameFor, openLocalDb } from "../../local-db";
import type { Outbox } from "../../outbox";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";

/** The kind of the project's progress claims (the sync service's `progress_claims`). */
export const PROGRESS_CLAIMS_KIND = "progress_claims";

export const CREATE_CLAIM_FUNCTION = "create_progress_claim";

/** Said on the screen and in the list for a milestone made here and not yet moved on by a person online. */
export const DRAFT_UNTIL_CONFIRMED = "Draft until confirmed: no money is posted and no invoice is made. A person with the billing role confirms it online (drafted, submitted, approved, then invoiced).";

export type BillingWriteAccess = { outbox?: Pick<Outbox, "enqueue">; newId?: () => string };

export type BillingRefusal =
  | "role" | "description" | "date" | "retention" | "no_boq" | "no_customer" | "not_on_laptop" | "failed";

export type BillingWriteResult = { queued: true; opId: string; tempId: string } | { queued: false; reason: BillingRefusal; message: string };

const REFUSALS: Record<BillingRefusal, string> = {
  role: "Creating a billing milestone needs the manager role. Nothing was saved.",
  description: "Write the milestone (what has been achieved), up to 2,000 letters. Nothing was saved.",
  date: "The billing date is not a real day. Choose it from the calendar. Nothing was saved.",
  retention: "Retention is a percentage from 0 to 100. Nothing was saved.",
  no_boq: "This project has no approved BOQ on this laptop yet, and a billing milestone needs one to bill against. Nothing was saved.",
  no_customer: "Choose who the milestone is billed to, from the customers on this laptop. Nothing was saved.",
  not_on_laptop: "This project is not on this laptop, so this cannot be kept here. Open it once while you are online. Nothing was saved.",
  failed: "This could not be kept on the laptop. Nothing was saved; please try again.",
};
const refuse = (reason: BillingRefusal): BillingWriteResult => ({ queued: false, reason, message: REFUSALS[reason] });

/** Whether this role may be offered the form: the registry's own rank for the function, decided again by the server. */
export function mayCreateBillingMilestone(role: string | null): boolean {
  const fn = findFunction(CREATE_CLAIM_FUNCTION);
  return fn !== undefined && rankOf(role) >= fn.min_role_rank;
}

const isDay = (v: string): boolean => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : Number.NaN;
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

export type NewBillingMilestone = {
  projectId: string;
  /** The approved BOQ it bills against (the screen offers the latest approved one). */
  boqId: string;
  customerId: string;
  milestoneDescription: string;
  /** YYYY-MM-DD */
  scheduledDate: string;
  /** As typed; empty = none (the server's 0). */
  retentionPercent?: string | number | null;
};

/** What the form offered the person from this laptop's copy (billing-adapter.ts BillingChoices fits): the latest approved BOQ and the active customers. */
export type BillingOffer = {
  boq: { id: string } | null;
  customers: readonly { id: string }[];
};

type Ctx = { orgId: string; outbox: Pick<Outbox, "enqueue">; newId: () => string };

async function context(data: ShellData, projectId: string, access: BillingWriteAccess): Promise<Ctx | null> {
  if (!data.orgId) return null;
  try {
    const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!idb) return null;
    const db = await openLocalDb(idb, localDbNameFor(data.userId));
    let manifest: StoredManifest | null | undefined;
    try {
      manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
    } finally {
      db.close();
    }
    if (!manifest || manifest.userId !== data.userId || manifest.orgId !== data.orgId || !manifest.projectIds.includes(projectId)) return null;
    const outbox = access.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(data.userId);
    return { orgId: data.orgId, outbox, newId: access.newId ?? (() => crypto.randomUUID()) };
  } catch {
    return null;
  }
}

/**
 * Keeps ONE create_progress_claim op and a row of the milestone on the laptop at once (marked waiting by the screen). The row says the state
 * the server will give it, "milestone achieved", the only state a new claim can have; it carries no amount, because there is none.
 */
export async function createBillingMilestoneOffline(
  data: ShellData,
  input: NewBillingMilestone,
  choices: BillingOffer,
  access: BillingWriteAccess = {}
): Promise<BillingWriteResult> {
  if (!mayCreateBillingMilestone(data.role)) return refuse("role");
  const description = (input.milestoneDescription ?? "").trim();
  if (!description || description.length > 2000) return refuse("description");
  if (!isDay((input.scheduledDate ?? "").trim())) return refuse("date");
  const rawRetention = typeof input.retentionPercent === "string" ? input.retentionPercent.trim() : input.retentionPercent;
  const retention = rawRetention === undefined || rawRetention === null || rawRetention === "" ? undefined : Number(rawRetention);
  if (retention !== undefined && !(Number.isFinite(retention) && retention >= 0 && retention <= 100)) return refuse("retention");
  if (!choices.boq || choices.boq.id !== input.boqId) return refuse("no_boq");
  if (!choices.customers.some((c) => c.id === input.customerId)) return refuse("no_customer");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const tempId = `local-${ctx.newId()}`;
  const scheduledDate = input.scheduledDate.trim();
  try {
    const { opId } = await ctx.outbox.enqueue({
      functionId: CREATE_CLAIM_FUNCTION,
      projectId: input.projectId,
      params: {
        projectId: input.projectId, boqId: input.boqId, customerId: input.customerId, milestoneDescription: description, scheduledDate,
        ...(retention !== undefined ? { retentionPercent: retention } : {}),
      },
      label: "New billing milestone (draft)",
      creates: { kind: PROGRESS_CLAIMS_KIND, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `${PROGRESS_CLAIMS_KIND}:${tempId}`, type: PROGRESS_CLAIMS_KIND, orgId: ctx.orgId, projectId: input.projectId,
          data: {
            id: tempId, boq_id: input.boqId, customer_id: input.customerId, milestone_description: description, scheduled_date: scheduledDate,
            retention_percent: retention ?? 0, status: "milestone_achieved", interim_bill_id: null,
          },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch {
    return refuse("failed");
  }
}
