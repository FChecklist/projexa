import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { db, securityAuditLog } from "@/lib/db";
import { callVeridianResult } from "@/lib/veridian-client";

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

// PROJEXA-E2E-001 / WO-PROJEXA-AI-LINK-001 follow-up (2026-09-21) -- Bug 1
// fix, write side. The target used to be PROJEXA's own local public.todos --
// a table with no reachable screen anywhere in the current UI (dead since
// the R52 M24Shell rewrite). The real, live task system the snapshot now
// shows (see [token]/route.ts) is compliance.pipeline_tasks, reached through
// VERIDIAN's /api/v1/projexa/tasks/[id] (GET to validate the target, PATCH
// to apply a status change) -- that table lives in compliance-tracker's own
// Supabase project, not this repo's, so every read AND write against it goes
// through that HTTP surface, never a local db query.
//
// A direct schema read of pipeline_tasks (compliance-tracker's src/lib/db/
// schema.ts) found NO assignee_id, NO due_date, and NO note/description
// column -- only `status` is real, and even that is written only through
// the new, narrowly-scoped PATCH compliance-tracker added for exactly this
// (see that repo's src/app/api/v1/projexa/tasks/[id]/route.ts for the full
// reasoning). So of the 5 allowed verbs, ASSIGN/SET_DUE/NOTE have nothing on
// pipeline_tasks to target -- refused here honestly, not forced onto a field
// that doesn't exist -- while MARK_STATUS and DRAFT keep working for real.
const UNSUPPORTED_ON_PIPELINE_TASKS: Partial<Record<Verb, string>> = {
  ASSIGN: "the live task record has no assignee field",
  SET_DUE: "the live task record has no due-date field",
  NOTE: "the live task record has no note/description field",
};

type Proposal = { verb?: string; targetKey?: string; payload?: Record<string, unknown>; approved?: boolean };
type ApplyResult = { targetKey: string | null; verb: string | null; ok: boolean; reason?: string };
type PipelineTask = { id: string; status: string };

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });
  const organizationId = ctx.organizationId;

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

    // Target existence + org scope, resolved against the REAL live table --
    // VERIDIAN's own GET /tasks/[id] already scopes id+orgId together (a
    // foreign-org id 404s there, same as this repo's own db query used to).
    const lookup = await callVeridianResult<{ task: PipelineTask }>(`/tasks/${encodeURIComponent(targetKey)}`, {
      organizationId,
      method: "GET",
      timeoutMs: 5000,
    });

    if (!lookup.ok) {
      if (lookup.status === 404) {
        // Deliberately the same message whether the id doesn't exist at all
        // or belongs to a different organization -- distinguishing the two
        // would tell a prober which ids are real.
        await logRefusal(ctx.user.id, targetKey, verb, "target_not_found_or_foreign_org");
        results.push({ targetKey, verb, ok: false, reason: "Target not found in your organization" });
      } else {
        // A degrade, not a security refusal -- the upstream is slow/down.
        // Not logged as a proposal refusal: nothing about the proposal
        // itself was judged.
        results.push({ targetKey, verb, ok: false, reason: "Could not verify the target right now. Try again." });
      }
      continue;
    }

    const unsupportedReason = UNSUPPORTED_ON_PIPELINE_TASKS[verb as Verb];
    if (unsupportedReason) {
      await logRefusal(ctx.user.id, targetKey, verb, `field_not_supported_on_pipeline_tasks: ${unsupportedReason}`);
      results.push({ targetKey, verb, ok: false, reason: `Not supported yet -- ${unsupportedReason}` });
      continue;
    }

    const applied = await applyVerb(verb as Verb, lookup.data.task.id, p.payload ?? {}, organizationId);
    if (!applied.ok) {
      results.push({ targetKey, verb, ok: false, reason: applied.reason });
      continue;
    }

    await db.insert(securityAuditLog).values({
      event: `ai_link_${verb.toLowerCase()}_applied`,
      actor: ctx.user.id,
      metadata: { organizationId, targetKey, payload: p.payload ?? {} },
    });
    results.push({ targetKey, verb, ok: true });
  }

  return NextResponse.json({ results });
}

async function applyVerb(
  verb: Verb,
  taskId: string,
  payload: Record<string, unknown>,
  organizationId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  switch (verb) {
    case "MARK_STATUS": {
      // The old todos MARK_STATUS was a plain boolean (`done`); kept as the
      // wire contract here too so the snapshot's own instructions don't have
      // to change shape -- {done:true} -> pipeline_tasks status 'done',
      // {done:false} -> 'to_do' (reopen). compliance-tracker's PATCH refuses
      // anything outside that pair, so this can never claim an executor-only
      // state (in_progress/waiting/blocked).
      const status = payload?.done === true ? "done" : "to_do";
      const result = await callVeridianResult(`/tasks/${encodeURIComponent(taskId)}`, {
        organizationId,
        method: "PATCH",
        body: { status },
        timeoutMs: 5000,
      });
      if (!result.ok) return { ok: false, reason: "Could not update the task right now. Try again." };
      return { ok: true };
    }
    case "DRAFT":
      // No draft-document table exists yet (RFI responses, quotations,
      // etc. are VERIDIAN-side, not PROJEXA's own Postgres) -- recorded via
      // the audit log above as the durable record of the proposal, applying
      // nothing further. A real draft-creation target is a follow-up, not
      // silently faked here. Unaffected by the pipeline_tasks repoint: this
      // was always a no-op, regardless of which table the target belonged to.
      return { ok: true };
    default:
      // ASSIGN/SET_DUE/NOTE never reach here -- UNSUPPORTED_ON_PIPELINE_TASKS
      // above refuses them before applyVerb is called.
      return { ok: false, reason: "Unsupported verb" };
  }
}

async function logRefusal(actor: string, targetKey: string | null, verb: string | undefined, reason: string): Promise<void> {
  await db.insert(securityAuditLog).values({
    event: "ai_link_proposal_refused",
    actor,
    metadata: { targetKey, verb: verb ?? null, reason },
  });
}
