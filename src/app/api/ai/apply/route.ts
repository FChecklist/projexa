import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { db, todos, securityAuditLog } from "@/lib/db";

// AUTHENTICATED. This is the only place a proposal from the AI Link snapshot
// (GET /api/ai/[token]) can actually take effect -- the public route above
// only ever hands out read-only text. Every line here is independently
// validated (verb is in the allowlist, target exists AND belongs to the
// caller's own organization) before it applies, and every rejection is
// logged, not silently dropped -- an unknown verb or a foreign-org target
// must be just as visible in the audit trail as a real action, so a bad
// proposal (whether from a confused AI or a probing attacker) leaves a
// record either way.
const ALLOWED_VERBS = ["ASSIGN", "SET_DUE", "NOTE", "MARK_STATUS", "DRAFT"] as const;
type Verb = (typeof ALLOWED_VERBS)[number];

type Proposal = { verb?: string; targetKey?: string; payload?: Record<string, unknown>; approved?: boolean };
type ApplyResult = { targetKey: string | null; verb: string | null; ok: boolean; reason?: string };

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const proposals: Proposal[] = Array.isArray(body?.proposals) ? body.proposals : [];
  const results: ApplyResult[] = [];

  for (const p of proposals) {
    const verb = p?.verb;
    const targetKey = p?.targetKey ?? null;

    // Only lines the user actually ticked apply -- pasting a proposal back
    // in is a preview, not a commit. Not logged as a refusal: declining to
    // check a box is an ordinary choice, not a rejected attempt.
    if (!p?.approved) {
      results.push({ targetKey, verb: verb ?? null, ok: false, reason: "Not approved" });
      continue;
    }

    if (!verb || !ALLOWED_VERBS.includes(verb as Verb)) {
      await logRefusal(ctx.user.id, targetKey, verb, "verb_not_allowed");
      results.push({ targetKey, verb: verb ?? null, ok: false, reason: "That action is not one this link is allowed to propose" });
      continue;
    }

    if (!targetKey) {
      await logRefusal(ctx.user.id, targetKey, verb, "missing_target");
      results.push({ targetKey, verb, ok: false, reason: "No target given" });
      continue;
    }

    const [todo] = await db
      .select()
      .from(todos)
      .where(and(eq(todos.id, targetKey), eq(todos.organizationId, ctx.organizationId)))
      .limit(1);

    if (!todo) {
      // Deliberately the same message whether the id doesn't exist at all
      // or belongs to a different organization -- distinguishing the two
      // would tell a prober which ids are real.
      await logRefusal(ctx.user.id, targetKey, verb, "target_not_found_or_foreign_org");
      results.push({ targetKey, verb, ok: false, reason: "Target not found in your organization" });
      continue;
    }

    await applyVerb(verb as Verb, targetKey, p.payload ?? {});
    await db.insert(securityAuditLog).values({
      event: `ai_link_${verb.toLowerCase()}_applied`,
      actor: ctx.user.id,
      metadata: { organizationId: ctx.organizationId, targetKey, payload: p.payload ?? {} },
    });
    results.push({ targetKey, verb, ok: true });
  }

  return NextResponse.json({ results });
}

async function applyVerb(verb: Verb, todoId: string, payload: Record<string, unknown>): Promise<void> {
  switch (verb) {
    case "MARK_STATUS":
      await db.update(todos).set({ done: payload?.done === true }).where(eq(todos.id, todoId));
      return;
    case "SET_DUE": {
      const due = typeof payload?.dueDate === "string" ? payload.dueDate : null;
      await db.update(todos).set({ dueDate: due }).where(eq(todos.id, todoId));
      return;
    }
    case "NOTE": {
      const note = typeof payload?.note === "string" ? payload.note.slice(0, 2000) : null;
      await db.update(todos).set({ note }).where(eq(todos.id, todoId));
      return;
    }
    case "ASSIGN": {
      const assigneeId = typeof payload?.assigneeId === "string" ? payload.assigneeId : null;
      await db.update(todos).set({ assigneeId }).where(eq(todos.id, todoId));
      return;
    }
    case "DRAFT":
      // No draft-document table exists yet (RFI responses, quotations,
      // etc. are VERIDIAN-side, not PROJEXA's own Postgres) -- recorded via
      // the audit log above as the durable record of the proposal, applying
      // nothing further. A real draft-creation target is a follow-up, not
      // silently faked here.
      return;
  }
}

async function logRefusal(actor: string, targetKey: string | null, verb: string | undefined, reason: string): Promise<void> {
  await db.insert(securityAuditLog).values({
    event: "ai_link_proposal_refused",
    actor,
    metadata: { targetKey, verb: verb ?? null, reason },
  });
}
