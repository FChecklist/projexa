import { createClient } from "@/lib/supabase/server";

// Real notification content builders + the fan-out helper that actually
// inserts rows. Kept as small pure functions (buildXNotification) so the
// "what does this event say" logic is unit-testable without a live DB --
// same rationale as compliance-tracker's own search-service.test.ts, which
// only tests its pure predicate and leaves the DB-touching function
// untested.

export type NotificationContent = {
  title: string;
  message: string;
  type: string;
  metadata: Record<string, unknown>;
};

export function buildRfiCreatedNotification(rfi: { id: string; subject: string }, projectId: string, actorEmail: string | null): NotificationContent {
  return {
    title: "New RFI raised",
    message: `${actorEmail ?? "A teammate"} raised an RFI: "${rfi.subject}"`,
    type: "rfi_created",
    metadata: { rfiId: rfi.id, projectId },
  };
}

export function buildSubmittalStatusChangedNotification(
  submittal: { id: string; title: string; status: string },
  projectId: string,
  actorEmail: string | null
): NotificationContent {
  return {
    title: "Submittal status updated",
    message: `${actorEmail ?? "A teammate"} marked submittal "${submittal.title}" as ${submittal.status.replace(/_/g, " ")}`,
    type: "submittal_status_changed",
    metadata: { submittalId: submittal.id, projectId },
  };
}

export function buildPunchListCreatedNotification(
  item: { id: string; description: string; priority: string },
  projectId: string,
  actorEmail: string | null
): NotificationContent {
  return {
    title: "New punch list item",
    message: `${actorEmail ?? "A teammate"} added a ${item.priority}-priority punch list item: "${item.description}"`,
    type: "punch_list_created",
    metadata: { punchListItemId: item.id, projectId },
  };
}

// Fans a notification out to every OTHER member of the org (the actor
// already knows what they just did). Uses the org's real membership roster
// (public.memberships, RLS-visible to any member via the same
// user_organization_ids() helper /api/org-members already relies on -- see
// drizzle/0008_memberships_org_visibility.sql) rather than any
// per-record "assignee" field, because none of PROJEXA's VERIDIAN-backed
// RFI/submittal/punch-list entities carry a PROJEXA user id to assign to
// (confirmed by reading their real field shapes in RfisClient.tsx etc. --
// `ballInCourt` is a free-text party/role string, not a user id).
//
// Failure here must never break the primary action (creating the RFI etc.)
// -- caught and logged, not rethrown.
export async function notifyOrgMembers(organizationId: string, actorUserId: string, content: NotificationContent): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: members, error: membersError } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", organizationId);
    if (membersError || !members) {
      console.error("[notification-service] couldn't load org members, skipping notification:", membersError?.message);
      return;
    }

    const recipientIds = members.map((m) => m.user_id as string).filter((id) => id !== actorUserId);
    if (recipientIds.length === 0) return;

    const { error: insertError } = await supabase.from("notifications").insert(
      recipientIds.map((userId) => ({
        organization_id: organizationId,
        user_id: userId,
        title: content.title,
        message: content.message,
        type: content.type,
        metadata: content.metadata,
      }))
    );
    if (insertError) {
      console.error("[notification-service] failed to insert notifications:", insertError.message);
    }
  } catch (err) {
    console.error("[notification-service] notifyOrgMembers failed:", err instanceof Error ? err.message : err);
  }
}
