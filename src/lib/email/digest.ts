// WO-PROJEXA-AI-LINK-001 Part 2, extended 2026-09-19 for the org-configurable
// start-of-day/end-of-day digest (Owner directive). The original vertical
// slice here (single `sendDigestForMembership`, `todos` only, a fixed daily
// cron) is kept working as a manual "send me my digest now" trigger; the
// real per-org-timezone, multi-entity, reply-by-email cadence lives in
// buildAndSendDigest()/runDigestCadence() below.
import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, memberships, organizations, profiles, todos, emailDigestRun, emailDigestDelivery, emailDigestItem } from "@/lib/db";
import { issueEmailActionToken } from "@/lib/services/email-token-service";
import { sendEmail, emailTemplate, REPLY_DOMAIN } from "./send";
import { callVeridianResult } from "@/lib/veridian-client";
import { listEnabledSchedules, isDue, getOrgLocalDateTime } from "./schedule-service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

export type DigestSlot = "morning" | "evening" | "custom" | "manual";
export type DigestSendResult = { sent: boolean; itemCount: number; membershipId: string; deliveryId: string };

type CollectedItem = {
  entityType: "todo" | "rfi" | "submittal" | "punch_list" | "billing_milestone";
  entityId: string;
  displayText: string;
  allowedVerbs: string[];
};

const MAX_TODOS = 10;
const MAX_PROJECTS = 3; // caps how many of the org's projects actually feed the digest -- keeps the email itself bounded. Which MAX_PROJECTS is decided by real open-item count (see rankProjectsByOpenItems below), not by /projects' own name-sorted order: a genuinely active project must not be skipped just because a near-empty one alphabetically sorts first.
const MAX_ITEMS_PER_ENTITY_PER_PROJECT = 5;

type ProjectRef = { id: string; name: string; status?: string };
type ProjectItemBundle = {
  project: ProjectRef;
  rfis: Array<{ id: string; number: number; subject: string; status: string }>;
  submittals: Array<{ id: string; number: number; title: string; status: string }>;
  punch: Array<{ id: string; number: number; description: string; status: string }>;
  claims: Array<{ id: string; status: string }>;
};

/** Every VERIDIAN read uses callVeridianResult (non-throwing) so one slow/failed
 *  project's data never takes down the whole digest -- it's just an empty bundle. */
async function fetchProjectItemBundle(organizationId: string, project: ProjectRef): Promise<ProjectItemBundle> {
  const [rfisRes, submittalsRes, punchRes, claimsRes] = await Promise.all([
    callVeridianResult<{ rfis?: Array<{ id: string; number: number; subject: string; status: string }> }>(`/rfis?projectId=${encodeURIComponent(project.id)}`, { organizationId }),
    callVeridianResult<{ submittals?: Array<{ id: string; number: number; title: string; status: string }> }>(`/submittals?projectId=${encodeURIComponent(project.id)}`, { organizationId }),
    callVeridianResult<{ items?: Array<{ id: string; number: number; description: string; status: string }> }>(`/punch-list?projectId=${encodeURIComponent(project.id)}`, { organizationId }),
    callVeridianResult<{ claims?: Array<{ id: string; status: string }> }>(`/billing-claims?projectId=${encodeURIComponent(project.id)}&all=true`, { organizationId }),
  ]);

  return {
    project,
    rfis: rfisRes.ok ? (rfisRes.data?.rfis ?? []).filter((r) => r.status === "open" || r.status === "answered") : [],
    submittals: submittalsRes.ok ? (submittalsRes.data?.submittals ?? []).filter((s) => s.status === "pending") : [],
    punch: punchRes.ok ? (punchRes.data?.items ?? []).filter((p) => p.status === "open" || p.status === "ready_for_review") : [],
    claims: claimsRes.ok ? (claimsRes.data?.claims ?? []).filter((c) => ["milestone_achieved", "drafted", "rejected"].includes(c.status)) : [],
  };
}

function openItemCount(bundle: ProjectItemBundle): number {
  return bundle.rfis.length + bundle.submittals.length + bundle.punch.length + bundle.claims.length;
}

/**
 * Everything currently open across this org that a Phase 1 digest can show
 * and act on: PROJEXA's own `todos` (org-wide, matching the pre-existing
 * digest's own scope -- not a regression) plus, for the MAX_PROJECTS
 * busiest of the org's real construction projects, open RFIs/pending
 * submittals/open punch-list items/actionable billing milestones.
 *
 * Ranking, not raw order: /projects returns every active project sorted by
 * name, which is not activity order -- an org's near-empty fixture/test
 * projects (e.g. "E2E-BatchA-...") can easily sort before its one genuinely
 * busy project. Naively taking the first MAX_PROJECTS produced real, empty
 * digests for real orgs. So every active project's item bundle is fetched
 * up front (a larger VERIDIAN fan-out than before, traded deliberately for
 * correctness -- see the PROJEXA-E2E digest gap this closes) and only the
 * MAX_PROJECTS with the most real open items are ever rendered into items.
 */
async function collectDigestItems(organizationId: string): Promise<CollectedItem[]> {
  const items: CollectedItem[] = [];

  const openTodos = await db
    .select()
    .from(todos)
    .where(and(eq(todos.organizationId, organizationId), eq(todos.done, false)))
    .limit(MAX_TODOS);
  for (const t of openTodos) {
    items.push({
      entityType: "todo",
      entityId: t.id,
      displayText: t.text + (t.dueDate ? ` (due ${t.dueDate})` : ""),
      allowedVerbs: ["done", "note"],
    });
  }

  const projectsResult = await callVeridianResult<{ projects: ProjectRef[] }>("/projects", { organizationId });
  const allProjects = projectsResult.ok ? projectsResult.data?.projects ?? [] : [];

  const bundles = await Promise.all(allProjects.map((project) => fetchProjectItemBundle(organizationId, project)));
  // Array.prototype.sort is stable, so projects tied on open-item count keep
  // /projects' own (name-sorted) relative order as the tiebreak.
  const rankedBundles = [...bundles].sort((a, b) => openItemCount(b) - openItemCount(a)).slice(0, MAX_PROJECTS);

  for (const { project, rfis, submittals, punch, claims } of rankedBundles) {
    for (const rfi of rfis.slice(0, MAX_ITEMS_PER_ENTITY_PER_PROJECT)) {
      items.push({
        entityType: "rfi",
        entityId: rfi.id,
        displayText: `RFI #${rfi.number} — ${rfi.subject} (${project.name})`,
        allowedVerbs: rfi.status === "open" ? ["answer"] : ["close"],
      });
    }

    for (const s of submittals.slice(0, MAX_ITEMS_PER_ENTITY_PER_PROJECT)) {
      items.push({
        entityType: "submittal",
        entityId: s.id,
        displayText: `Submittal #${s.number} — ${s.title} (${project.name})`,
        allowedVerbs: ["approved", "approved_as_noted", "revise_resubmit", "rejected"],
      });
    }

    for (const p of punch.slice(0, MAX_ITEMS_PER_ENTITY_PER_PROJECT)) {
      items.push({
        entityType: "punch_list",
        entityId: p.id,
        displayText: `Punch list #${p.number} — ${p.description} (${project.name})`,
        allowedVerbs: p.status === "open" ? ["ready"] : ["verify"],
      });
    }

    for (const c of claims.slice(0, MAX_ITEMS_PER_ENTITY_PER_PROJECT)) {
      items.push({
        entityType: "billing_milestone",
        entityId: c.id,
        displayText: `Billing milestone (${c.status.replace(/_/g, " ")}) — ${project.name}`,
        allowedVerbs: c.status === "drafted" ? ["submit"] : ["draft"],
      });
    }
  }

  return items;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function renderDigest(slot: DigestSlot, orgName: string, items: Array<{ refCode: number; displayText: string; clickUrl: string | null }>): { subject: string; html: string } {
  const heading = slot === "morning" ? "Here's what's on your plate today" : slot === "evening" ? "Time for your end-of-day report" : "Your open items";

  const replyHint =
    slot === "evening"
      ? `Reply with what you finished today (by number, e.g. "1 done") and what's still open. Add anything else -- blockers, what you're doing tomorrow -- as plain text below the numbers; it's saved as your report either way, even if nothing above changes.`
      : `Reply any time -- type the number and what happened, e.g. "1 done" or "2 answer: use grade-40 rebar". Anything you write that isn't a numbered item becomes a note for your team.`;

  const bodyHtml =
    items.length === 0
      ? `<p>Nothing open right now in <strong>${escapeHtml(orgName)}</strong>.</p>${slot === "evening" ? `<p>Reply to this email with your end-of-day report and tomorrow's plan anyway -- it's saved even with nothing open above.</p>` : ""}`
      : `<p><strong>${escapeHtml(orgName)}</strong> — ${items.length} open item${items.length === 1 ? "" : "s"}:</p>
         <ol style="padding-left:20px;margin:12px 0;">
           ${items
             .map(
               (i) =>
                 `<li style="margin-bottom:10px;">${escapeHtml(i.displayText)}${
                   i.clickUrl ? ` &nbsp;<a href="${i.clickUrl}" style="color:#F5820A;font-weight:600;">Mark done →</a>` : ""
                 }</li>`
             )
             .join("")}
         </ol>
         <p style="font-size:12px;color:#8B94A3;">${replyHint}</p>`;

  const subject =
    slot === "morning"
      ? `PROJEXA — Start of day: ${items.length} open item${items.length === 1 ? "" : "s"} in ${orgName}`
      : slot === "evening"
        ? `PROJEXA — End of day: give us your report (${orgName})`
        : `PROJEXA — ${items.length} open item${items.length === 1 ? "" : "s"} in ${orgName}`;

  return { subject, html: emailTemplate(heading, bodyHtml) };
}

/**
 * Collects, persists (as numbered email_digest_item rows), renders and sends
 * one digest to one membership. `runId` is null for a manual/ad-hoc send
 * (see sendDigestForMembership below); real scheduled sends always pass the
 * email_digest_run row that runDigestCadence() already claimed.
 */
export async function buildAndSendDigest(params: { runId: string | null; membershipId: string; slot: DigestSlot }): Promise<DigestSendResult> {
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, params.membershipId)).limit(1);
  if (!membership) throw new Error(`No membership ${params.membershipId}`);

  const [org] = await db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1);
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, membership.userId)).limit(1);
  if (!org || !profile) throw new Error("Could not resolve organization/profile for this membership");

  const collected = await collectDigestItems(membership.organizationId);
  const numbered = collected.map((item, i) => ({ ...item, refCode: i + 1 }));

  const replyToken = randomBytes(12).toString("base64url");
  const [delivery] = await db
    .insert(emailDigestDelivery)
    .values({ runId: params.runId, organizationId: membership.organizationId, membershipId: membership.id, replyToken })
    .returning();

  if (numbered.length > 0) {
    await db.insert(emailDigestItem).values(
      numbered.map((n) => ({
        deliveryId: delivery.id,
        refCode: n.refCode,
        entityType: n.entityType,
        entityId: n.entityId,
        allowedVerbs: n.allowedVerbs,
      }))
    );
  }

  // Keep the existing one-click link working, todos only -- unchanged
  // mechanism, exactly as before this feature. Other entity types are
  // reply-only in Phase 1 (see the plan's deferred-scope note): extending
  // one-click links to them would mean widening email_action_token's
  // todo-specific FK/trigger, a real, separate follow-up.
  const rendered = await Promise.all(
    numbered.map(async (n) => {
      let clickUrl: string | null = null;
      if (n.entityType === "todo" && n.allowedVerbs.includes("done")) {
        const rawToken = await issueEmailActionToken({
          todoId: n.entityId,
          organizationId: membership.organizationId,
          membershipId: membership.id,
          action: "mark_done",
        });
        clickUrl = `${APP_URL}/api/email/${rawToken}`;
      }
      return { refCode: n.refCode, displayText: n.displayText, clickUrl };
    })
  );

  const { subject, html } = renderDigest(params.slot, org.name, rendered);
  const result = await sendEmail({ to: profile.email, subject, html, replyTo: `d-${replyToken}@${REPLY_DOMAIN}` });

  await db
    .update(emailDigestDelivery)
    .set({ sentAt: result.sent ? new Date() : null })
    .where(eq(emailDigestDelivery.id, delivery.id));

  return { sent: result.sent, itemCount: numbered.length, membershipId: membership.id, deliveryId: delivery.id };
}

/** Manual "send me my digest now" -- POST /api/email/send-digest. Always sends, even an empty digest, as an interactive confirmation the click worked (unchanged behavior from before this feature). Not tied to any org schedule. */
export async function sendDigestForMembership(membershipId: string): Promise<DigestSendResult> {
  return buildAndSendDigest({ runId: null, membershipId, slot: "manual" });
}

// ── Cadence: real per-org, per-slot, timezone-aware scheduling ───────────
export type DigestCadenceOutcome = { membershipId: string; sent: boolean; error?: string };
export type DigestCadenceResult = {
  ranAt: string;
  checked: number;
  sent: number;
  failed: number;
  runsProcessed: number;
  results: DigestCadenceOutcome[];
};

/**
 * Meant to be called by a scheduler on every poll (every 15 minutes). No scheduler is wired since
 * 2026-09-25 (BUILD-001 U-21): the Vercel cron, the GitHub poll workflow and the
 * /api/internal/email-digest-cadence/run route were removed, and the digest is re-scheduled on
 * pg_cron by U-40. The claim logic below is unchanged.
 * For each enabled org_email_schedule row that's due right now (per
 * schedule-service.ts's isDue()), atomically claims that (schedule, local
 * calendar day) via INSERT ... ON CONFLICT DO NOTHING into email_digest_run
 * -- this is what makes it safe for more than one trigger source (the
 * existing vercel.json daily cron AND this poller) to call this same
 * function redundantly: only the first claim wins, every later one for the
 * same slot/day is a silent no-op.
 */
export async function runDigestCadence(now: Date = new Date()): Promise<DigestCadenceResult> {
  const schedules = await listEnabledSchedules();
  const results: DigestCadenceOutcome[] = [];
  let runsProcessed = 0;

  for (const schedule of schedules) {
    if (!isDue(schedule.localTime, now, schedule.timezone)) continue;

    const { localDate } = getOrgLocalDateTime(now, schedule.timezone);

    const [claimed] = await db
      .insert(emailDigestRun)
      .values({ organizationId: schedule.organizationId, scheduleId: schedule.scheduleId, localDate, status: "pending" })
      .onConflictDoNothing({ target: [emailDigestRun.scheduleId, emailDigestRun.localDate] })
      .returning();

    if (!claimed) continue; // another trigger already claimed this slot/day
    runsProcessed++;

    const orgMemberships = await db.select().from(memberships).where(eq(memberships.organizationId, schedule.organizationId));

    let sentCount = 0;
    let failedCount = 0;
    for (const membership of orgMemberships) {
      try {
        const outcome = await buildAndSendDigest({ runId: claimed.id, membershipId: membership.id, slot: schedule.slot as DigestSlot });
        results.push({ membershipId: membership.id, sent: outcome.sent });
        if (outcome.sent) sentCount++;
        else failedCount++;
      } catch (error) {
        failedCount++;
        results.push({ membershipId: membership.id, sent: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    await db
      .update(emailDigestRun)
      .set({
        status: orgMemberships.length === 0 ? "skipped_no_items" : failedCount === 0 ? "sent" : sentCount === 0 ? "failed" : "partial",
        finishedAt: new Date(),
        membershipsSent: sentCount,
        membershipsFailed: failedCount,
      })
      .where(eq(emailDigestRun.id, claimed.id));
  }

  return {
    ranAt: now.toISOString(),
    checked: results.length,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    runsProcessed,
    results,
  };
}
