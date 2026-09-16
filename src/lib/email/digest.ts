// WO-PROJEXA-AI-LINK-001 Part 2: the digest email. `todos` is the task
// analog the work order asks to reuse rather than inventing a parallel
// table -- confirmed there was nothing else to reuse (no existing async
// task system in this repo's own Postgres).
//
// SCOPE, deliberately: this builds and sends ONE digest for ONE membership,
// proving the vertical slice end to end (seed -> digest -> click -> spend ->
// update -> audit -> re-click refused). It does NOT implement the mandatory
// cadence engine ("there is no off"), digest bundling across 3+
// organizations, or a cron trigger -- this repo's vercel.json has no crons
// key and none is added here. That is real, separate follow-up work, named
// so it isn't mistaken for done.
import { eq, and, isNull } from "drizzle-orm";
import { db, memberships, organizations, profiles, todos } from "@/lib/db";
import { issueEmailActionToken } from "@/lib/services/email-token-service";
import { sendEmail, emailTemplate, REPLY_DOMAIN } from "./send";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

export type DigestSendResult = { sent: boolean; todoCount: number; membershipId: string };

export async function sendDigestForMembership(membershipId: string): Promise<DigestSendResult> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  if (!membership) throw new Error(`No membership ${membershipId}`);

  const [org] = await db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1);
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, membership.userId)).limit(1);
  if (!org || !profile) throw new Error("Could not resolve organization/profile for this membership");

  const openTodos = await db
    .select()
    .from(todos)
    .where(and(eq(todos.organizationId, membership.organizationId), eq(todos.done, false)))
    .limit(10);

  const rows = await Promise.all(
    openTodos.map(async (t) => {
      const rawToken = await issueEmailActionToken({
        todoId: t.id,
        organizationId: membership.organizationId,
        membershipId: membership.id,
        action: "mark_done",
      });
      const clickUrl = `${APP_URL}/api/email/${rawToken}`;
      return { text: t.text, clickUrl };
    })
  );

  const bodyHtml =
    rows.length === 0
      ? `<p>Nothing open right now in <strong>${escapeHtml(org.name)}</strong>. We'll email you the next time something needs a look.</p>`
      : `<p><strong>${escapeHtml(org.name)}</strong> — ${rows.length} open item${rows.length === 1 ? "" : "s"}:</p>
         <ul style="padding-left:18px;margin:12px 0;">
           ${rows
             .map(
               (r) =>
                 `<li style="margin-bottom:10px;">${escapeHtml(r.text)}
                   &nbsp;<a href="${r.clickUrl}" style="color:#F5820A;font-weight:600;">Mark done →</a></li>`
             )
             .join("")}
         </ul>`;

  const html = emailTemplate(`Your open items in ${org.name}`, bodyHtml);

  const result = await sendEmail({
    to: profile.email,
    subject: `PROJEXA — ${rows.length} open item${rows.length === 1 ? "" : "s"} in ${org.name}`,
    html,
    replyTo: `${slugify(org.name)}@${REPLY_DOMAIN}`,
  });

  return { sent: result.sent, todoCount: rows.length, membershipId };
}

// Cron path for the digest -- the recurring, no-manual-trigger counterpart
// to sendDigestForMembership() above, wired to Vercel Cron via
// src/app/api/internal/email-digest-cadence/run/route.ts. Unlike the manual
// "get my digest" button (POST /api/email/send-digest), which always sends
// -- even an empty digest, as an interactive confirmation that the click
// worked -- this only sends to a membership whose organization actually has
// at least one open todo right now. A daily cron that emails every
// membership "nothing to report" is spam, not a digest, so that case is
// skipped here on purpose; the manual route's own empty-state behavior is
// left completely alone.
export type DigestCadenceOutcome = { membershipId: string; sent: boolean; error?: string };

export type DigestCadenceResult = {
  ranAt: string;
  checked: number;
  sent: number;
  failed: number;
  results: DigestCadenceOutcome[];
};

export async function runDigestCadence(): Promise<DigestCadenceResult> {
  const openOrgRows = await db
    .selectDistinct({ organizationId: todos.organizationId })
    .from(todos)
    .where(eq(todos.done, false));

  const results: DigestCadenceOutcome[] = [];

  for (const { organizationId } of openOrgRows) {
    const orgMemberships = await db.select().from(memberships).where(eq(memberships.organizationId, organizationId));
    for (const membership of orgMemberships) {
      try {
        const outcome = await sendDigestForMembership(membership.id);
        results.push({ membershipId: membership.id, sent: outcome.sent });
      } catch (error) {
        results.push({
          membershipId: membership.id,
          sent: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    checked: results.length,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    results,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
